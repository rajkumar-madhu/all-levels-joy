from rest_framework import exceptions, permissions

from . import policy
from .principal import Principal


class AuthorizationUnavailable(exceptions.APIException):
    status_code = 503
    default_detail = "Authorization is temporarily unavailable. Try again shortly."
    default_code = "authorization_unavailable"


class IsAuthenticatedPrincipal(permissions.BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, Principal)


class PolicyPermission(IsAuthenticatedPrincipal):
    """Checks `view.policy_actions[METHOD]` with OPA. Views without an entry are denied."""

    message = "You do not have access to this action."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        action = getattr(view, "policy_actions", {}).get(request.method)
        if not action:
            return False
        resource = {"org_id": str(view.kwargs["org_id"])} if "org_id" in view.kwargs else {}
        try:
            return policy.evaluate(request.user, action, resource)
        except policy.PolicyUnavailable as error:
            raise AuthorizationUnavailable from error
