"""Strip secrets, LAN/Tailscale IPs, and CAO ports from logs and public payloads."""

from __future__ import annotations

import ipaddress
import re
from typing import Any

SECRET_KEY_FRAGMENTS: tuple[str, ...] = (
    "token",
    "secret",
    "password",
    "passwd",
    "bearer",
    "authorization",
    "api_key",
    "apikey",
    "credential",
    "private_key",
    "access_key",
)

NETWORK_KEY_FRAGMENTS: tuple[str, ...] = (
    "ip",
    "ipv4",
    "ipv6",
    "host",
    "hostname",
    "address",
    "port",
    "ports",
    "endpoint",
    "base_url",
    "url",
    "tailscale",
    "lan",
    "bind",
)

_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_IPV6_RE = re.compile(r"\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b", re.I)
_REDACTED = "[redacted]"


def is_secret_key(key: str) -> bool:
    lowered = key.lower().replace("-", "_")
    return any(frag in lowered for frag in SECRET_KEY_FRAGMENTS)


def is_network_key(key: str) -> bool:
    lowered = key.lower().replace("-", "_")
    if lowered in {"report", "support", "import", "important"}:
        return False
    return any(frag == lowered or lowered.endswith("_" + frag) for frag in NETWORK_KEY_FRAGMENTS)


def _looks_like_ip(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    host = text.split("%", 1)[0]
    host = host.split("/")[0]
    if host.startswith("[") and "]" in host:
        host = host[1 : host.index("]")]
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if _IPV4_RE.search(text) or _IPV6_RE.search(text):
        return True
    return False


def sanitize_string(value: str) -> str:
    if _looks_like_ip(value):
        return _REDACTED
    # Drop host:port forms that would leak CAO/LAN topology.
    if _IPV4_RE.search(value) or _IPV6_RE.search(value):
        return _IPV4_RE.sub(_REDACTED, _IPV6_RE.sub(_REDACTED, value))
    return value


def redact_params(params: dict[str, Any]) -> dict[str, Any]:
    """Copy parameters with secrets removed (audit + logs)."""
    out: dict[str, Any] = {}
    for key, value in params.items():
        if is_secret_key(str(key)):
            out[key] = _REDACTED
        else:
            out[key] = sanitize_value(value)
    return out


def sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return sanitize_public_payload(value)
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    if isinstance(value, str):
        return sanitize_string(value)
    return value


def sanitize_public_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop network/secret keys and scrub IP-like strings from remaining values."""
    out: dict[str, Any] = {}
    for key, value in payload.items():
        key_s = str(key)
        if is_secret_key(key_s) or is_network_key(key_s):
            continue
        out[key_s] = sanitize_value(value)
    return out
