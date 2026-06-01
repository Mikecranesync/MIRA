# MIRA Ignition Chat — HMAC-SHA256 signing helper
#
# Pure stdlib, NO system.* imports — importable from both:
#   * Jython 2.7 inside Ignition Gateway (doPost.py)
#   * Python 3 under pytest (tests/ignition/test_chat_signing.py)
#
# Usage:
#   from signing import build_headers, sign_request
#
# Config override (for future use):
#   Set MIRA_CLOUD_URL in factorylm.properties or as a Jython global
#   before importing; doPost.py reads it via getMiraConfig().

import hashlib
import hmac
import time
import uuid


DEFAULT_CLOUD_URL = "https://api.factorylm.com/api/v1/ignition/chat"


def sign_request(key, tenant_id, nonce, timestamp, body_bytes):
    """
    Build and return an HMAC-SHA256 hex signature.

    Signed string:
        tenant_id + "\\n" + nonce + "\\n" + str(timestamp) + "\\n" + sha256_hex(body_bytes)

    Args:
        key        (str)   : HMAC signing key (plain text secret)
        tenant_id  (str)   : tenant UUID
        nonce      (str)   : random per-request hex string (32 chars)
        timestamp  (int)   : Unix epoch seconds
        body_bytes (bytes) : raw UTF-8 encoded request body

    Returns:
        str: lowercase hex HMAC-SHA256 digest

    Raises:
        ValueError: if key is empty/None
    """
    if not key:
        raise ValueError("HMAC key must not be empty")

    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed_string = "%s\n%s\n%s\n%s" % (tenant_id, nonce, str(timestamp), body_hash)

    if isinstance(key, str):
        key_bytes = key.encode("utf-8")
    else:
        key_bytes = key

    if isinstance(signed_string, str):
        signed_string_bytes = signed_string.encode("utf-8")
    else:
        signed_string_bytes = signed_string

    digest = hmac.new(key_bytes, signed_string_bytes, hashlib.sha256).hexdigest()
    return digest


def build_headers(key, tenant_id, body_bytes):
    """
    Generate a complete set of MIRA auth headers for one request.

    Args:
        key        (str)   : HMAC signing key
        tenant_id  (str)   : tenant UUID
        body_bytes (bytes) : raw UTF-8 encoded request body

    Returns:
        dict: headers dict ready to pass to urllib2.Request.add_header()

    Raises:
        ValueError: if key is empty/None
    """
    if not key:
        raise ValueError("HMAC key must not be empty")

    nonce = uuid.uuid4().hex          # 32-char lowercase hex
    ts = int(time.time())
    signature = sign_request(key, tenant_id, nonce, ts, body_bytes)

    return {
        "Content-Type": "application/json",
        "X-MIRA-Tenant": tenant_id,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": str(ts),
        "X-MIRA-Signature": signature,
    }
