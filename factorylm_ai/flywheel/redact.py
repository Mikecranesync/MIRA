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
# MIRROR of mira-bots/shared/inference/router.py::_SERIAL_RE (#3305). Kept
# byte-identical and enforced by
# mira-bots/tests/test_serial_redaction.py::test_every_serial_mirror_matches_the_canonical_pattern.
# This copy is the highest-consequence one: redact_record()/redact_text() run over
# SFT and DPO exports (export.py:137,200,310), so a stale pattern here bakes the
# corruption permanently into the TRAINING CORPUS rather than one live turn.
_SERIAL_RE = re.compile(
    r"\b(?:"
    # (1) keyword WITH an abbreviation word (No./Num./Number) — only then may a
    #     period follow, because that period is an abbreviation mark
    r"(?:S/?N|SER(?:IAL)?)\s*(?:NO|NUM|NUMBER)\.?[:\s#-]*(?=[A-Z0-9\-]*[0-9])[A-Z0-9\-]{4,20}"
    r"|"
    # (2) keyword + a real separator that is NOT a period — digit optional
    r"(?:S/?N|SER(?:IAL)?)\s*(?:NO|NUM|NUMBER)?[:\s#-]+[A-Z0-9\-]{4,20}"
    r"|"
    # (3) keyword + NO separator at all — digit required, and the keyword must be
    #     the FULL form. Accepting the bare "SER" prefix here matched every
    #     ser-word containing a digit: "service-2", "series500", "server2".
    r"(?:S/?N|SERIAL)(?=[A-Z0-9\-]*[0-9])[A-Z0-9\-]{4,20}"
    r")\b",
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
