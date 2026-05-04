"""Robust MIME email parser.

Handles multipart/mixed, multipart/alternative, multipart/related.
Extracts plain text body (preferred over HTML), attachments, and inline images.
Detects auto-replies and strips email signatures.

Never raises on malformed or unexpected input.
"""

from __future__ import annotations

import email as _email
import email.header
import logging
import re
from email.message import Message
from typing import NamedTuple

logger = logging.getLogger("mira-email")

# Signature detection --------------------------------------------------------

_SIG_DASHES = re.compile(r"(?:\r?\n|^)--\s*(?:\r?\n|$)", re.MULTILINE)

_SIG_PHRASES = (
    "sent from my iphone",
    "sent from my ipad",
    "sent from my android",
    "sent from my samsung",
    "sent from my galaxy",
    "get outlook for",
    "________________________________",
    "confidentiality notice",
    "this email and any files transmitted",
    "this message (including any attachments)",
    "disclaimer:",
    "legal notice:",
)

# Auto-reply detection -------------------------------------------------------

_AUTO_HEADERS = frozenset(
    {
        "x-auto-response-suppress",
        "auto-submitted",
        "x-autorespond",
        "x-autoreply",
        "x-automate",
    }
)

_AUTO_SUBJECTS = (
    "out of office",
    "automatic reply",
    "auto reply",
    "auto-reply",
    "vacation",
    "away from",
    "absence from",
    "currently unavailable",
    "delivery status notification",
    "delivery failure",
    "mail delivery failed",
    "undeliverable",
)


class ParsedEmail(NamedTuple):
    message_id: str
    in_reply_to: str
    references: list[str]
    subject: str
    sender: str
    reply_to: str
    body: str
    html_body: str
    attachments: list[dict]  # {filename, content_type, data, disposition, content_id}
    is_auto_reply: bool
    headers: dict[str, str]


_EMPTY = ParsedEmail(
    message_id="",
    in_reply_to="",
    references=[],
    subject="",
    sender="",
    reply_to="",
    body="",
    html_body="",
    attachments=[],
    is_auto_reply=False,
    headers={},
)


def parse_email(raw: bytes | str) -> ParsedEmail:
    """Parse raw email bytes/str into a structured ParsedEmail.

    Never raises. Returns _EMPTY on catastrophic failure.
    """
    try:
        if isinstance(raw, str):
            raw = raw.encode("utf-8", errors="replace")
        msg = _email.message_from_bytes(raw)
        return _parse_message(msg)
    except Exception as exc:
        logger.error("EMAIL_PARSE_FAIL error=%s", str(exc)[:300])
        return _EMPTY


def extract_sender_email(sender: str) -> str:
    """Extract bare email address from 'Display Name <addr@host>' format."""
    m = re.search(r"<([^>]+)>", sender)
    if m:
        return m.group(1).lower().strip()
    addr = sender.strip().lower()
    # strip any surrounding quotes
    addr = addr.strip("\"'")
    return addr


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_message(msg: Message) -> ParsedEmail:
    message_id = _hdr(msg, "message-id").strip("<> ")
    in_reply_to = _hdr(msg, "in-reply-to").strip("<> ")
    refs_raw = _hdr(msg, "references")
    references = [r.strip("<> ") for r in refs_raw.split() if r.strip()]
    subject = _decode_header_value(_hdr(msg, "subject"))
    sender = _decode_header_value(_hdr(msg, "from"))
    reply_to = _decode_header_value(_hdr(msg, "reply-to")) or sender

    headers = {k.lower(): str(v) for k, v in msg.items()}
    is_auto_reply = _detect_auto_reply(headers)

    text_parts: list[str] = []
    html_parts: list[str] = []
    attachments: list[dict] = []
    _walk(msg, text_parts, html_parts, attachments, depth=0)

    body = "\n\n".join(p for p in text_parts if p).strip()
    body = _strip_signature(body)
    html_body = "\n".join(h for h in html_parts if h).strip()

    return ParsedEmail(
        message_id=message_id,
        in_reply_to=in_reply_to,
        references=references,
        subject=subject,
        sender=sender,
        reply_to=reply_to,
        body=body,
        html_body=html_body,
        attachments=attachments,
        is_auto_reply=is_auto_reply,
        headers=headers,
    )


def _hdr(msg: Message, name: str) -> str:
    val = msg.get(name, "")
    return str(val) if val else ""


def _decode_header_value(raw: str) -> str:
    """Decode RFC 2047-encoded header value (=?charset?encoding?text?=)."""
    if not raw:
        return ""
    try:
        parts = []
        for data, charset in email.header.decode_header(raw):
            if isinstance(data, bytes):
                parts.append(data.decode(charset or "utf-8", errors="replace"))
            else:
                parts.append(str(data))
        return "".join(parts)
    except Exception:
        return raw


def _detect_auto_reply(headers: dict[str, str]) -> bool:
    for h in _AUTO_HEADERS:
        val = headers.get(h, "").lower().strip()
        if val and val not in ("no", "false", "none", ""):
            return True
    subj = headers.get("subject", "").lower()
    return any(phrase in subj for phrase in _AUTO_SUBJECTS)


def _walk(
    part: Message,
    text_parts: list[str],
    html_parts: list[str],
    attachments: list[dict],
    depth: int,
) -> None:
    """Recursively walk MIME tree. Depth-limited to prevent DoS."""
    if depth > 12:
        return

    ct = part.get_content_type().lower()
    disposition = (part.get("content-disposition") or "").lower()
    filename = _get_filename(part)

    if part.is_multipart():
        for sub in part.get_payload(decode=False) or []:
            if isinstance(sub, Message):
                _walk(sub, text_parts, html_parts, attachments, depth + 1)
        return

    # Decode payload
    try:
        data: bytes = part.get_payload(decode=True) or b""
    except Exception:
        data = b""

    # Classify part
    is_attachment = (
        "attachment" in disposition
        or (filename and ct not in ("text/plain", "text/html"))
    )
    is_inline_non_text = "inline" in disposition and ct not in ("text/plain", "text/html")

    if is_attachment or is_inline_non_text:
        safe_name = filename or f"attachment.{ct.split('/')[-1]}"
        attachments.append(
            {
                "filename": safe_name,
                "content_type": ct,
                "data": data,
                "disposition": "attachment" if is_attachment else "inline",
                "content_id": (part.get("content-id") or "").strip("<>"),
                "size": len(data),
            }
        )
        return

    if ct == "text/plain":
        charset = part.get_content_charset() or "utf-8"
        try:
            text_parts.append(data.decode(charset, errors="replace"))
        except Exception:
            text_parts.append(data.decode("utf-8", errors="replace"))

    elif ct == "text/html":
        charset = part.get_content_charset() or "utf-8"
        try:
            html_parts.append(data.decode(charset, errors="replace"))
        except Exception:
            html_parts.append(data.decode("utf-8", errors="replace"))


def _get_filename(part: Message) -> str:
    """Extract and RFC 2047-decode filename from Content-Disposition or Content-Type."""
    raw = part.get_filename()
    if not raw:
        return ""
    return _decode_header_value(raw)


def _strip_signature(text: str) -> str:
    """Remove email signature. Tries standard separator, then phrase heuristics."""
    # Standard "-- \n" signature separator
    m = _SIG_DASHES.search(text)
    if m:
        text = text[: m.start()].strip()

    # Phrase-based: scan from bottom up
    lines = text.splitlines()
    cutoff = len(lines)
    for i in range(len(lines) - 1, max(len(lines) - 20, -1), -1):
        low = lines[i].lower().strip()
        if any(phrase in low for phrase in _SIG_PHRASES):
            cutoff = i
            break

    return "\n".join(lines[:cutoff]).strip()
