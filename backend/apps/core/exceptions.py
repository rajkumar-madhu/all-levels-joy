import logging

from django.db import DatabaseError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler, set_rollback

log = logging.getLogger(__name__)

# SQLSTATEs the legacy functions raise for expected business-rule failures.
USER_ERROR_STATES = {"P0001", "22023", "23514", "23505", "22P02", "22007", "22008"}
FORBIDDEN_STATES = {"42501"}


def api_exception_handler(exc, context):
    if isinstance(exc, DatabaseError):
        set_rollback()
        sqlstate = getattr(exc.__cause__, "sqlstate", None)
        diag = getattr(exc.__cause__, "diag", None)
        message = getattr(diag, "message_primary", None) or "The request could not be saved."
        if sqlstate in FORBIDDEN_STATES:
            return Response({"detail": message}, status=status.HTTP_403_FORBIDDEN)
        if sqlstate in USER_ERROR_STATES:
            return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)
        log.exception("Unexpected database error (%s)", sqlstate)
        return Response({"detail": "Something went wrong. Try again."}, status=500)
    return exception_handler(exc, context)
