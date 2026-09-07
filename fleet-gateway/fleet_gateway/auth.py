"""Bearer-token auth. Token lives in env (FLEET_GATEWAY_BEARER), never in git."""

from __future__ import annotations

import hmac
import os

from fleet_gateway.errors import AuthenticationError

BEARER_ENV = "FLEET_GATEWAY_BEARER"


def configured_bearer(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    return (env.get(BEARER_ENV) or "").strip()


def extract_bearer(authorization: str | None) -> str:
    if authorization is None:
        return ""
    raw = authorization.strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return raw


def require_bearer(configured: str, authorization: str | None) -> None:
    """Refuse missing or wrong auth. Empty configured token refuses everyone."""
    if not configured:
        raise AuthenticationError("missing gateway bearer configuration")
    provided = extract_bearer(authorization)
    if not provided:
        raise AuthenticationError("missing bearer token")
    if not hmac.compare_digest(provided, configured):
        raise AuthenticationError("invalid bearer token")
