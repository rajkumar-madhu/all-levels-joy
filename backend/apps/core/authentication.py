import functools

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions

from .identity import IdentityError, load_workspaces, resolve_user_id
from .principal import Principal


@functools.cache
def jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(settings.KEYCLOAK_JWKS_URL, cache_keys=True, lifespan=300)


def decode_access_token(token: str) -> dict:
    try:
        signing_key = jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.KEYCLOAK_AUDIENCE,
            issuer=settings.KEYCLOAK_ISSUER,
            options={"require": ["exp", "iat", "sub", "iss"]},
            leeway=30,
        )
    except jwt.PyJWKClientError as error:
        raise exceptions.AuthenticationFailed("Sign-in service keys are unavailable.") from error
    except jwt.InvalidTokenError as error:
        raise exceptions.AuthenticationFailed("Your session is invalid or has expired. Sign in again.") from error


class KeycloakJWTAuthentication(authentication.BaseAuthentication):
    """Bearer access tokens issued by the Keycloak realm (authorization code + PKCE in the SPA)."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1")
        if not header:
            return None
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise exceptions.AuthenticationFailed("Use a Bearer access token.")
        claims = decode_access_token(token.strip())
        try:
            user_id = resolve_user_id(
                claims["iss"], claims["sub"], claims.get("email"), bool(claims.get("email_verified"))
            )
        except IdentityError as error:
            raise exceptions.AuthenticationFailed(str(error)) from error
        principal = Principal(
            user_id=user_id,
            issuer=claims["iss"],
            subject=claims["sub"],
            email=claims.get("email"),
            email_verified=bool(claims.get("email_verified")),
            claims=claims,
            workspaces=load_workspaces(user_id),
        )
        return principal, token

    def authenticate_header(self, request):
        return self.keyword
