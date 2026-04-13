"""PII sanitization for outbound LLM messages.

Strips IPv4 addresses, MAC addresses, and serial numbers before sending
to any LLM provider. Patterns match security-boundaries.md and
mira-bots/shared/inference/router.py.

Used by both AnthropicProvider and OllamaProvider.
"""

from __future__ import annotations

import re

_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
_MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b")
_SERIAL_RE = re.compile(
    r"\b(?:S/?N|SER(?:IAL)?(?:\s*(?:NO|NUM|NUMBER)?)?)[:\s#]*[A-Z0-9\-]{4,20}\b",
    re.IGNORECASE,
)


def sanitize_text(text: str) -> str:
    """Replace PII tokens with safe placeholders."""
    text = _IPV4_RE.sub("[IP]", text)
    text = _MAC_RE.sub("[MAC]", text)
    text = _SERIAL_RE.sub("[SN]", text)
    return text


def sanitize_messages(messages: list[dict]) -> list[dict]:
    """Return a sanitized copy of a messages list.

    Handles both plain string content and list-of-blocks content (multipart).
    """
    sanitized: list[dict] = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            sanitized.append({**msg, "content": sanitize_text(content)})
        elif isinstance(content, list):
            new_blocks = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    new_blocks.append({**block, "text": sanitize_text(block.get("text", ""))})
                else:
                    new_blocks.append(block)
            sanitized.append({**msg, "content": new_blocks})
        else:
            sanitized.append(msg)
    return sanitized
