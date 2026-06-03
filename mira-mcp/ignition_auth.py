"""HMAC-SHA256 authentication for Ignition WebDev chat requests.

Protocol (shared contract — mira-relay task implements the same signing):
  Signed string: f"{tenant}\\n{nonce}\\n{timestamp}\\n{sha256_hex(body_bytes)}"
  Signature:     hex(HMAC-SHA256(MIRA_IGNITION_HMAC_KEY, signed_string))

Key source: env var MIRA_IGNITION_HMAC_KEY.

# MVP NOTE: single global key shared across all tenants.
# Post-MVP: replace with per-tenant key registry (keyed by tenant UUID) backed
# by NeonDB or Doppler-managed secrets, looked up before HMAC verification.

Nonce dedup: in-process LRU dict {(tenant, nonce): expires_at}.
# MVP NOTE: per-process only — restarts reset the nonce store. Under horizontal
# scaling nonces from one process are invisible to others. Post-MVP: replace with
# Redis SETNX with TTL=600 or a NeonDB nonce_log table with an expiry index.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time

from starlette.exceptions import HTTPException
from starlette.requests import Request

logger = logging.getLogger("mira-mcp.ignition_auth")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TIMESTAMP_SKEW_S = 300  # ±5 minutes
_NONCE_TTL_S = 600  # nonces expire after 10 minutes

# ---------------------------------------------------------------------------
# In-process nonce store
# ---------------------------------------------------------------------------

# {(tenant_id, nonce): expires_at (monotonic)}
_NONCE_STORE: dict[tuple[str, str], float] = {}


def _evict_expired_nonces(now: float) -> None:
    """Remove expired nonce entries. Called on every verification — O(n) but
    the store is small (bounded by 600s window × request rate)."""
    expired = [k for k, exp in _NONCE_STORE.items() if exp <= now]
    for k in expired:
        del _NONCE_STORE[k]


def _check_and_record_nonce(tenant: str, nonce: str) -> bool:
    """Return True if nonce is fresh (not seen). Records it on first use.

    Thread-safety note: asyncio is single-threaded per event loop — no lock
    needed for in-process dict access under uvicorn's default asyncio mode.
    Under multi-process uvicorn (workers > 1) nonces from other workers are
    invisible; see module-level MVP NOTE.
    """
    now = time.monotonic()
    _evict_expired_nonces(now)
    key = (tenant, nonce)
    if key in _NONCE_STORE:
        return False
    _NONCE_STORE[key] = now + _NONCE_TTL_S
    return True


# ---------------------------------------------------------------------------
# Public verifier
# ---------------------------------------------------------------------------


async def verify_hmac(request: Request, key: str) -> str:
    """Verify the HMAC-SHA256 signature on an Ignition chat request.

    Returns the tenant_id string on success.
    Raises HTTPException(401) on any failure — error messages are deliberately
    non-specific to avoid leaking implementation details to an adversary.

    The raw request body is read here and cached on request.state.body so that
    the route handler can call await request.body() again (Starlette caches it
    after first read, so this is idempotent).

    Failure ordering:
      1. Missing required headers
      2. Timestamp skew (fast check, no crypto)
      3. HMAC signature mismatch (constant-time compare)
      4. Nonce replay (only after signature passes — avoids replay oracle)
    """
    tenant = request.headers.get("X-MIRA-Tenant", "")
    nonce = request.headers.get("X-MIRA-Nonce", "")
    timestamp_raw = request.headers.get("X-MIRA-Timestamp", "")
    signature = request.headers.get("X-MIRA-Signature", "")

    if not all([tenant, nonce, timestamp_raw, signature]):
        logger.warning("IGNITION_AUTH missing_headers tenant=%r", tenant)
        raise HTTPException(status_code=401, detail="Missing required authentication headers")

    # 1. Timestamp skew
    try:
        ts = int(timestamp_raw)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid timestamp")

    server_now = int(time.time())
    if abs(server_now - ts) > _TIMESTAMP_SKEW_S:
        logger.warning("IGNITION_AUTH timestamp_skew tenant=%r skew=%ds", tenant, server_now - ts)
        raise HTTPException(status_code=401, detail="Request timestamp outside allowed window")

    # 2. Read body (Starlette caches after first read)
    body_bytes: bytes = await request.body()
    body_hash = hashlib.sha256(body_bytes).hexdigest()

    # 3. HMAC verification
    signed_string = f"{tenant}\n{nonce}\n{timestamp_raw}\n{body_hash}"
    expected = hmac.new(
        key.encode("utf-8"),
        signed_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature.lower()):
        logger.warning("IGNITION_AUTH bad_signature tenant=%r", tenant)
        raise HTTPException(status_code=401, detail="Invalid signature")

    # 4. Nonce replay check (after HMAC passes — avoids replay oracle)
    if not _check_and_record_nonce(tenant, nonce):
        logger.warning("IGNITION_AUTH nonce_replay tenant=%r", tenant)
        raise HTTPException(status_code=401, detail="Nonce already used")

    return tenant
