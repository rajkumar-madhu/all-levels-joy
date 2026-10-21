"""Constant-time checks for the public intake endpoints (ported from the TanStack routes)."""

import hashlib
import hmac
import re

PAGERDUTY_PART = re.compile(r"^v1=([0-9a-f]{64})$", re.IGNORECASE)


def bearer_token_valid(authorization: str, secret: str) -> bool:
    token = re.sub(r"^Bearer\s+", "", authorization or "", flags=re.IGNORECASE)
    return hmac.compare_digest(token.encode(), secret.encode())


def pagerduty_signature_valid(body: bytes, header: str, secret: str) -> bool:
    """X-PagerDuty-Signature: comma-separated `v1=<hex HMAC-SHA256(body)>` (several during rotation)."""
    expected = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    for part in (header or "").split(","):
        match = PAGERDUTY_PART.match(part.strip())
        if match and hmac.compare_digest(bytes.fromhex(match.group(1)), expected):
            return True
    return False


def scanner_signature_valid(body: bytes, header: str, secret: str) -> bool:
    """x-argus-signature: hex HMAC-SHA256(body, SECURITY_SCANNER_SECRET), optional `sha256=` prefix."""
    signature = re.sub(r"^sha256=", "", header or "")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature.encode(), expected.encode())
