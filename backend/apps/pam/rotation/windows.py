"""Rotate Windows local account passwords over WinRM (HTTPS, NTLM), signing in as the account itself.

The account changes its own password with ADSI's ChangePassword, which needs the current password and no
administrator rights. Domain accounts are out of scope: rotate those in the directory. The server
certificate is validated (PAM_WINRM_CA for a private CA).
"""

import winrm
from django.conf import settings
from winrm.exceptions import InvalidCredentialsError, WinRMError, WinRMTransportError

from . import RotationError, Rotator, Target


def _ps_literal(value: str) -> str:
    """A single-quoted PowerShell string; quotes are doubled, nothing else is interpreted."""
    return "'" + value.replace("'", "''") + "'"


class WindowsRotator(Rotator):
    session_factory = staticmethod(winrm.Session)

    def _session(self, target: Target, password: str):
        return self.session_factory(
            f"https://{target.host}:{target.port}/wsman",
            auth=(target.username, password),
            transport="ntlm",
            server_cert_validation="validate",
            ca_trust_path=settings.PAM_WINRM_CA or "legacy_requests",
            operation_timeout_sec=int(settings.PAM_SSH_TIMEOUT_SECONDS),
            read_timeout_sec=int(settings.PAM_SSH_TIMEOUT_SECONDS) + 5,
        )

    def rotate(self, target: Target, current: str, new: str) -> None:
        account = target.username.split("\\")[-1]
        script = (
            "$ErrorActionPreference = 'Stop'; "
            f"([ADSI]('WinNT://./' + {_ps_literal(account)} + ',user')).ChangePassword("
            f"{_ps_literal(current)}, {_ps_literal(new)})"
        )
        try:
            result = self._session(target, current).run_ps(script)
        except InvalidCredentialsError as error:
            raise RotationError("The vaulted password was refused by the host.") from error
        except (WinRMError, WinRMTransportError, OSError) as error:
            raise RotationError(f"Could not reach WinRM on {target.host}:{target.port}: {error}") from error
        if result.status_code != 0:
            # PowerShell's error text; it does not echo the script's arguments.
            detail = result.std_err.decode(errors="replace").strip().splitlines()
            raise RotationError(f"Password change failed on {target.host}: {detail[0] if detail else 'no output'}")
        if not self.verify(target, new):
            raise RotationError(f"{target.host} did not accept the new password after the change.")

    def verify(self, target: Target, password: str) -> bool:
        try:
            return self._session(target, password).run_cmd("whoami").status_code == 0
        except InvalidCredentialsError:
            return False
        except (WinRMError, WinRMTransportError, OSError) as error:
            raise RotationError(f"Could not reach WinRM on {target.host}:{target.port}: {error}") from error
