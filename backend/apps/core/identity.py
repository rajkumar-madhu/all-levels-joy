"""Map a Keycloak identity onto the legacy user id and load the caller's workspaces.

These queries run as the API's login role, before the request switches to the `authenticated`
database role, because they read identity tables the caller cannot read through RLS.
"""

from django.db import connection

from .principal import Workspace


class IdentityError(Exception):
    pass


def resolve_user_id(issuer: str, subject: str, email: str | None, email_verified: bool) -> str:
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE app.external_identities SET last_seen_at = now(), email = coalesce(%s, email) "
            "WHERE issuer = %s AND subject = %s RETURNING user_id",
            [email, issuer, subject],
        )
        row = cursor.fetchone()
        if row:
            return str(row[0])

        # First sign-in through Keycloak: link to the existing account with the same verified email
        # so tickets, approvals and audit history keep their owner. Unverified emails never link.
        if not email or not email_verified:
            raise IdentityError("Verify your email address in the sign-in service before using the workspace.")
        cursor.execute(
            "SELECT id FROM auth.users WHERE lower(email) = lower(%s) ORDER BY created_at, id LIMIT 1",
            [email],
        )
        row = cursor.fetchone()
        if row:
            user_id = row[0]
        else:
            cursor.execute("INSERT INTO auth.users(email, email_confirmed_at) VALUES (%s, now()) RETURNING id", [email])
            user_id = cursor.fetchone()[0]
        cursor.execute(
            "INSERT INTO app.external_identities(issuer, subject, user_id, email) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (issuer, subject) DO NOTHING",
            [issuer, subject, user_id, email],
        )
        cursor.execute(
            "SELECT user_id FROM app.external_identities WHERE issuer = %s AND subject = %s",
            [issuer, subject],
        )
        return str(cursor.fetchone()[0])


def load_workspaces(user_id: str) -> list[Workspace]:
    """Active memberships with their roles; the same rows public.is_org_member() accepts."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT o.id, o.name, o.slug,
                   coalesce(array_agg(r.role::text ORDER BY r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}')
            FROM public.memberships m
            JOIN public.organizations o ON o.id = m.organization_id
            LEFT JOIN public.user_roles r ON r.organization_id = m.organization_id AND r.user_id = m.user_id
            WHERE m.user_id = %s AND m.is_active
            GROUP BY o.id, o.name, o.slug
            ORDER BY o.name
            """,
            [user_id],
        )
        return [Workspace(str(i), name, slug, tuple(roles)) for i, name, slug, roles in cursor.fetchall()]
