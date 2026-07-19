"""PII redaction for flywheel record text — IPs, MACs, serial numbers.

ZTA role: this is the last thing that touches record text before
:mod:`factorylm_ai.flywheel.export` serializes it into a shared fine-tuning
corpus. The regex set below MIRRORS — does not import; cross-package imports
between ``factorylm_ai`` and ``mira-bots`` are not part of this package's
design (this lab stays isolated, per ``docs/zta/factorylm-ai-model-lab.md``)
— the patterns in ``mira-bots/shared/inference/router.py``'s
``InferenceRouter.sanitize_context()`` / ``sanitize_text()``: IPv4 addresses
-> ``[IP]``, MAC addresses -> ``[MAC]``, serial-number-labeled tokens ->
``[SN]``. If you need to change what counts as PII here, read that file
first and keep the two independently-maintained implementations in sync by
hand — don't add a cross-package import to "fix" drift.
"""

from __future__ import annotations

import re
from typing import Any

# Mirrors mira-bots/shared/inference/router.py's _IPV4_RE / _MAC_RE / _SERIAL_RE
# verbatim, independently reimplemented here (see module docstring above —
# this package does not import from mira-bots).
_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
_MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b")
_SERIAL_RE = re.compile(
    r"\b(?:S/?N|SER(?:IAL)?(?:\s*(?:NO|NUM|NUMBER)?)?)[:\s#]*[A-Z0-9\-]{4,20}\b",
    re.IGNORECASE,
)


def redact_text(text: str) -> str:
    """Strip IPv4 addresses, MAC addresses, and serial-number tokens from ``text``."""
    text = _IPV4_RE.sub("[IP]", text)
    text = _MAC_RE.sub("[MAC]", text)
    text = _SERIAL_RE.sub("[SN]", text)
    return text


def redact_record(record: dict[str, Any]) -> dict[str, Any]:
    """Return a COPY of ``record`` with ``input_text``/``final_text``/
    ``messages[].content`` redacted via :func:`redact_text`.

    Never mutates the input. Fields the record does not have, or whose
    value is not a string (including ``None``), are left exactly as they
    are — this function only ever narrows string content, never reshapes
    a record.
    """
    redacted = dict(record)

    input_text = redacted.get("input_text")
    if isinstance(input_text, str):
        redacted["input_text"] = redact_text(input_text)

    final_text = redacted.get("final_text")
    if isinstance(final_text, str):
        redacted["final_text"] = redact_text(final_text)

    messages = redacted.get("messages")
    if isinstance(messages, list):
        new_messages: list[Any] = []
        for msg in messages:
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                new_messages.append({**msg, "content": redact_text(msg["content"])})
            else:
                new_messages.append(msg)
        redacted["messages"] = new_messages

    return redacted
