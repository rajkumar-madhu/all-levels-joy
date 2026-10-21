"""Vault encryption: AES-256-GCM under PAM_MASTER_KEY.

Each value is stored as nonce (12 bytes) + ciphertext/tag. The workspace and secret ids are bound in as
associated data, so a ciphertext copied onto another row fails to decrypt instead of revealing that
row's password.
"""

import base64
import hashlib
import os
import secrets
import string

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

KEY_VERSION = 1
NONCE_BYTES = 12


class VaultError(Exception):
    pass


def master_key() -> bytes:
    raw = settings.PAM_MASTER_KEY
    if not raw:
        if not settings.DEBUG:
            raise ImproperlyConfigured("PAM_MASTER_KEY is required when DJANGO_DEBUG is off")
        # Development only: a stable key derived from the dev secret key.
        return hashlib.sha256(b"itsm-pam-dev:" + settings.SECRET_KEY.encode()).digest()
    try:
        key = base64.b64decode(raw, validate=True)
    except ValueError as error:
        raise ImproperlyConfigured("PAM_MASTER_KEY must be base64") from error
    if len(key) != 32:
        raise ImproperlyConfigured("PAM_MASTER_KEY must decode to 32 bytes (AES-256)")
    return key


def _aad(org_id: str, secret_id: str) -> bytes:
    return f"pam:{org_id}:{secret_id}".encode()


def encrypt(plaintext: str, org_id: str, secret_id: str) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(master_key()).encrypt(nonce, plaintext.encode(), _aad(str(org_id), str(secret_id)))


def decrypt(blob: bytes, org_id: str, secret_id: str) -> str:
    blob = bytes(blob)
    try:
        plain = AESGCM(master_key()).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], _aad(str(org_id), str(secret_id)))
    except InvalidTag as error:
        raise VaultError("The stored secret could not be decrypted") from error
    return plain.decode()


# Characters that survive shells, connection strings and most password policies.
_SYMBOLS = "-_.,:+=@%"
_ALPHABET = string.ascii_letters + string.digits + _SYMBOLS


def generate_password(length: int = 24) -> str:
    """Random password with at least one lowercase, uppercase, digit and symbol."""
    while True:
        value = "".join(secrets.choice(_ALPHABET) for _ in range(length))
        if (
            any(c.islower() for c in value)
            and any(c.isupper() for c in value)
            and any(c.isdigit() for c in value)
            and any(c in _SYMBOLS for c in value)
        ):
            return value
