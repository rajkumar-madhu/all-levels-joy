"""Rotate Linux account passwords over SSH with `passwd`, signing in as the account itself.

Host keys must already be in PAM_SSH_KNOWN_HOSTS: unknown hosts are refused rather than trusted on
first use, so a spoofed host never receives the current or new password.
"""

import paramiko
from django.conf import settings

from . import RotationError, Rotator, Target


def _client() -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    if settings.PAM_SSH_KNOWN_HOSTS:
        client.load_host_keys(settings.PAM_SSH_KNOWN_HOSTS)
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    return client


class SshRotator(Rotator):
    client_factory = staticmethod(_client)

    def _connect(self, target: Target, password: str) -> paramiko.SSHClient:
        if target.template != "ssh":
            raise RotationError(f"The SSH backend cannot rotate {target.template} secrets.")
        client = self.client_factory()
        try:
            client.connect(
                target.host,
                port=target.port,
                username=target.username,
                password=password,
                timeout=settings.PAM_SSH_TIMEOUT_SECONDS,
                auth_timeout=settings.PAM_SSH_TIMEOUT_SECONDS,
                allow_agent=False,
                look_for_keys=False,
            )
        except paramiko.AuthenticationException:
            client.close()
            raise
        except (TimeoutError, paramiko.SSHException, OSError) as error:
            client.close()
            raise RotationError(f"Could not connect to {target.host}:{target.port}: {error}") from error
        return client

    def rotate(self, target: Target, current: str, new: str) -> None:
        try:
            client = self._connect(target, current)
        except paramiko.AuthenticationException as error:
            raise RotationError("The vaulted password was refused by the host.") from error
        try:
            stdin, stdout, stderr = client.exec_command("passwd", timeout=settings.PAM_SSH_TIMEOUT_SECONDS)
            stdin.write(f"{current}\n{new}\n{new}\n")
            stdin.flush()
            stdin.channel.shutdown_write()
            if stdout.channel.recv_exit_status() != 0:
                # passwd's own message (policy, history); it never echoes the passwords.
                detail = stderr.read().decode(errors="replace").strip().splitlines()
                raise RotationError(f"passwd failed on {target.host}: {detail[-1] if detail else 'no output'}")
        finally:
            client.close()
        if not self.verify(target, new):
            raise RotationError(f"{target.host} did not accept the new password after the change.")

    def verify(self, target: Target, password: str) -> bool:
        try:
            client = self._connect(target, password)
        except paramiko.AuthenticationException:
            return False
        client.close()
        return True
