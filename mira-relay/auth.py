from __future__ import annotations

"""HMAC-SHA256 verifier for mira-relay inbound requests.

Contract (must match tasks 2 & 3):
  Headers:
    X-MIRA-Tenant:    <tenant_uuid>
    X-MIRA-Nonce:     <opaque string, monotonic per tenant>
    X-MIRA-Timestamp: <unix-seconds int>
    X-MIRA-Signature: <hex hmac-sha256>

  Signed string:
    f"{tenant}\\n{nonce}\\n{timestamp}\\n{sha256_hex(body_bytes)}"

  Key source: env var MIRA_IGNITION_HMAC_KEY

Rejection criteria:
  - Any header missing
  - Signature mismatch
  - Timestamp outside ±300 s of server clock
  - (tenant, nonce) seen within last 600 s → replay

NOTE: The replay store is in-process (LRU dict, max 10_000 entries).
This means replay protection is per-process only — two relay instances
could each accept the same nonce. Post-MVP: replace with Redis SETNX
or a shared nonce store.
"""

import hashlib
import hmac
import time
from collections import OrderedDict
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────────
# Replay store — LRU dict capped at MAX_REPLAY_ENTRIES
# key: (tenant_id, nonce) → expiry_time (float, unix seconds)
# ──────────────────────────────────────────────────────────────────────────────
MAX_REPLAY_ENTRIES = 10_000
REPLAY_TTL_SECONDS = 600
TIMESTAMP_SKEW_SECONDS = 300

_replay_store: OrderedDict[tuple[str, str], float] = OrderedDict()


def _evict_expired(now: float) -> None:
    """Remove entries whose TTL has passed."""
    stale = [k for k, exp in _replay_store.items() if exp <= now]
    for k in stale:
        del _replay_store[k]


def _check_and_record_nonce(tenant: str, nonce: str, now: float) -> bool:
    """Return True if nonce is fresh (not seen). Record it. Return False if replay."""
    _evict_expired(now)
    key = (tenant, nonce)
    if key in _replay_store:
        return False
    # Evict oldest entry if at capacity
    if len(_replay_store) >= MAX_REPLAY_ENTRIES:
        _replay_store.popitem(last=False)
    _replay_store[key] = now + REPLAY_TTL_SECONDS
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def verify_hmac(
    headers: dict[str, str],
    body_bytes: bytes,
    key: str,
    *,
    _now: Optional[float] = None,
) -> str:
    """Verify HMAC headers and return tenant_id on success.

    Raises ValueError with a short reason string on any failure.
    Never logs the key.

    Args:
        headers:    mapping of header names (any case) to values.
        body_bytes: raw request body bytes.
        key:        MIRA_IGNITION_HMAC_KEY value.
        _now:       override current time (for tests).

    Returns:
        tenant_id (str)

    Raises:
        ValueError with one of:
          "missing_headers", "bad_timestamp", "signature_mismatch",
          "replay_detected"
    """
    # Normalise header names to lowercase for lookup
    h = {k.lower(): v for k, v in headers.items()}

    tenant = h.get("x-mira-tenant", "").strip()
    nonce = h.get("x-mira-nonce", "").strip()
    timestamp_str = h.get("x-mira-timestamp", "").strip()
    signature = h.get("x-mira-signature", "").strip()

    if not (tenant and nonce and timestamp_str and signature):
        raise ValueError("missing_headers")

    # Timestamp window check
    try:
        ts = int(timestamp_str)
    except ValueError:
        raise ValueError("bad_timestamp")

    now = _now if _now is not None else time.time()
    if abs(now - ts) > TIMESTAMP_SKEW_SECONDS:
        raise ValueError("bad_timestamp")

    # Signature check
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed_string = f"{tenant}\n{nonce}\n{timestamp_str}\n{body_hash}"
    expected = hmac.new(
        key.encode(),
        signed_string.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise ValueError("signature_mismatch")

    # Replay check (after signature so we don't poison the store on bad sigs)
    if not _check_and_record_nonce(tenant, nonce, now):
        raise ValueError("replay_detected")

    return tenant
