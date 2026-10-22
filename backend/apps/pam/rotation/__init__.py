"""Rotation backends change a password on the target system and verify it.

`PAM_ROTATION_BACKEND` picks one:
- "live": changes the password on the target, by template: Linux accounts over SSH, PostgreSQL and MySQL
  accounts over their own protocol, Windows local accounts over WinRM. API keys cannot be rotated
  generically and fail with a clear message. "ssh" is accepted as an older name for "live".
- "simulated": development and demos; it changes nothing outside the vault.
"""

from dataclasses import dataclass

from django.conf import settings
from django.utils.module_loading import import_string


class RotationError(Exception):
    """A rotation or verification failed; the message is shown to custodians."""


@dataclass(frozen=True)
class Target:
    host: str
    port: int
    username: str
    template: str
    database_engine: str | None = None


class Rotator:
    def rotate(self, target: Target, current: str, new: str) -> None:
        raise NotImplementedError

    def verify(self, target: Target, password: str) -> bool:
        raise NotImplementedError


BACKENDS = {
    "simulated": "apps.pam.rotation.simulated.SimulatedRotator",
    "live": "apps.pam.rotation.live.LiveRotator",
    "ssh": "apps.pam.rotation.live.LiveRotator",
}


def get_rotator() -> Rotator:
    name = settings.PAM_ROTATION_BACKEND
    if name not in BACKENDS:
        raise RotationError(f"Unknown rotation backend: {name}")
    return import_string(BACKENDS[name])()
