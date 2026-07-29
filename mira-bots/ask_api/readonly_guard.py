"""Read-only safety guard for kiosk-facing Ask MIRA replies."""

from __future__ import annotations

import re

_READONLY_WARNING = (
    "I can't provide register-write or fieldbus write instructions from this "
    "read-only kiosk. Follow the OEM/site LOTO procedure or have a qualified "
    "technician use an approved control workflow."
)

_WRITE_PATTERNS = (
    re.compile(
        r"\bwrite\s+\S+(?:\s+\S+){0,8}\s+to\s+(?:register|param(?:eter)?|0x[0-9a-f]+)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:fc0?5|fc0?6|fc15|fc16|function code\s+0?(?:5|6|15|16))\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:reset|clear)\b.{0,40}\b(?:write|register|0x[0-9a-f]+)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bset\s+p\d{1,3}(?:\.\d{1,3})?\b", re.IGNORECASE),
)


def enforce_readonly_kiosk_reply(reply: str) -> str:
    """Replace kiosk replies that contain register/control-write instructions."""

    if any(pattern.search(reply) for pattern in _WRITE_PATTERNS):
        return _READONLY_WARNING
    return reply
