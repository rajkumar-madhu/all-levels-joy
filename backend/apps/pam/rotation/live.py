from . import RotationError, Rotator, Target
from .database import MysqlRotator, PostgresRotator
from .ssh import SshRotator
from .windows import WindowsRotator


class LiveRotator(Rotator):
    """Picks the rotator for the secret's template (and database engine)."""

    def _for(self, target: Target) -> Rotator:
        if target.template == "ssh":
            return SshRotator()
        if target.template == "windows":
            return WindowsRotator()
        if target.template == "database":
            if target.database_engine == "mysql":
                return MysqlRotator()
            if target.database_engine == "postgresql":
                return PostgresRotator()
            raise RotationError("Set the database engine on this secret before rotating it.")
        raise RotationError("API keys are issued by their provider; replace the stored key by hand after reissuing it.")

    def rotate(self, target: Target, current: str, new: str) -> None:
        self._for(target).rotate(target, current, new)

    def verify(self, target: Target, password: str) -> bool:
        return self._for(target).verify(target, password)
