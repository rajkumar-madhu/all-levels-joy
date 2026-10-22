"""Rotate database account passwords by signing in as the account and changing its own password.

Connections use TLS: PostgreSQL with PAM_DB_SSLMODE (default "require"; "verify-full" with
PAM_DB_SSL_CA checks the server certificate), MySQL with PAM_DB_SSL_CA when set. The new password is
sent as a quoted literal in ALTER ROLE / ALTER USER; servers that log DDL statements will log it, so keep
statement logging for these accounts off.
"""

import psycopg
import pymysql
from django.conf import settings
from psycopg import sql

from . import RotationError, Rotator, Target


class PostgresRotator(Rotator):
    connect = staticmethod(psycopg.connect)

    def _connect(self, target: Target, password: str):
        options = {"sslmode": settings.PAM_DB_SSLMODE}
        if settings.PAM_DB_SSL_CA:
            options["sslrootcert"] = settings.PAM_DB_SSL_CA
        return self.connect(
            host=target.host,
            port=target.port,
            user=target.username,
            password=password,
            dbname=settings.PAM_DB_DEFAULT_DATABASE,
            connect_timeout=int(settings.PAM_SSH_TIMEOUT_SECONDS),
            autocommit=True,
            **options,
        )

    def rotate(self, target: Target, current: str, new: str) -> None:
        try:
            with self._connect(target, current) as conn:
                conn.execute(sql.SQL("ALTER ROLE CURRENT_USER WITH PASSWORD {}").format(sql.Literal(new)))
        except psycopg.OperationalError as error:
            raise RotationError(f"Could not sign in to {target.host}:{target.port} as {target.username}.") from error
        except psycopg.Error as error:
            raise RotationError(f"{target.host} refused the password change: {error.diag.message_primary}") from error
        if not self.verify(target, new):
            raise RotationError(f"{target.host} did not accept the new password after the change.")

    def verify(self, target: Target, password: str) -> bool:
        try:
            with self._connect(target, password) as conn:
                conn.execute("SELECT 1")
        except psycopg.OperationalError:
            return False
        return True


class MysqlRotator(Rotator):
    connect = staticmethod(pymysql.connect)

    def _connect(self, target: Target, password: str):
        tls = (
            {"ssl_ca": settings.PAM_DB_SSL_CA, "ssl_verify_cert": True, "ssl_verify_identity": True}
            if settings.PAM_DB_SSL_CA
            else {}
        )
        return self.connect(
            host=target.host,
            port=target.port,
            user=target.username,
            password=password,
            connect_timeout=int(settings.PAM_SSH_TIMEOUT_SECONDS),
            autocommit=True,
            **tls,
        )

    def rotate(self, target: Target, current: str, new: str) -> None:
        try:
            conn = self._connect(target, current)
        except pymysql.err.OperationalError as error:
            raise RotationError(f"Could not sign in to {target.host}:{target.port} as {target.username}.") from error
        try:
            with conn.cursor() as cursor:
                # pymysql quotes the parameter client-side; ALTER USER cannot be prepared server-side.
                cursor.execute("ALTER USER CURRENT_USER() IDENTIFIED BY %s", [new])
        except pymysql.MySQLError as error:
            raise RotationError(f"{target.host} refused the password change: {error.args[-1]}") from error
        finally:
            conn.close()
        if not self.verify(target, new):
            raise RotationError(f"{target.host} did not accept the new password after the change.")

    def verify(self, target: Target, password: str) -> bool:
        try:
            self._connect(target, password).close()
        except pymysql.err.OperationalError:
            return False
        return True
