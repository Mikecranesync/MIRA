"""Verify Monday's iframe sessionToken to extract `account_id` server-side.

Monday's iframe SDK passes a short-lived JWT (signed with the app's
client_secret) on every request from inside the iframe. The frontend
already forwards it as `X-Monday-Session-Token` (see
`frontend/src/lib/api.js`). This module verifies the signature and
extracts the installing account id so we can stamp scan_queue rows
with the right tenant.

Standalone path (no Monday iframe context): no header → returns None,
endpoints carry on without per-account scoping (KB lookups stay shared,
queue rows store NULL tenant_id).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import jwt

logger = logging.getLogger("mira-scan.session")

# Monday signs sessionTokens with the app's OAuth client_secret. Using
# MONDAY_SIGNING_SECRET as an explicit override lets ops rotate the JWT
# secret independently of the OAuth client_secret if Monday ever splits
# them — for now they're the same value.
MONDAY_SIGNING_SECRET = os.getenv(
    "MONDAY_SIGNING_SECRET",
    os.getenv("MONDAY_OAUTH_CLIENT_SECRET", ""),
)


class SessionInvalid(RuntimeError):
    pass


def _signing_secret() -> str:
    if not MONDAY_SIGNING_SECRET:
        raise SessionInvalid("server signing secret not configured")
    return MONDAY_SIGNING_SECRET


def verify_session_token(token: str) -> dict[str, Any]:
    """Decode + verify a Monday session token. Returns claims on success.

    Raises SessionInvalid on any decode/signature/expiry failure.
    """
    if not token:
        raise SessionInvalid("empty token")
    try:
        return jwt.decode(
            token,
            _signing_secret(),
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise SessionInvalid(f"jwt decode failed: {exc}") from exc


def account_id_from_headers(headers: Any) -> str | None:
    """Extract a verified `account_id` from request headers, or None.

    Accepts FastAPI's `request.headers` (case-insensitive Mapping). Returns
    None silently when:
      - no `x-monday-session-token` header is present (standalone path)
      - the token fails verification (logged at warning)
    Never raises — multi-tenant scoping is best-effort by design.
    """
    raw = None
    if hasattr(headers, "get"):
        raw = headers.get("x-monday-session-token")
    if not raw:
        return None
    try:
        claims = verify_session_token(raw)
    except SessionInvalid as exc:
        logger.warning("session token rejected: %s", exc)
        return None
    aid = claims.get("aid")
    if aid is None:
        dat = claims.get("dat") or {}
        aid = dat.get("account_id")
    if aid is None:
        return None
    return str(aid)
