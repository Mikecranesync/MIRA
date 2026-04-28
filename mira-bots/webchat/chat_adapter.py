"""WebChat ChatAdapter — embeddable widget for internal maintenance portals.

Implements the ChatAdapter Protocol for a browser-based chat widget.
The widget posts JSON to the FastAPI endpoint in bot.py; this adapter
normalizes those requests into NormalizedChatEvents and renders replies
as JSON responses the widget can display.

Inbound:  POST /chat JSON → NormalizedChatEvent
Outbound: NormalizedChatResponse → JSON reply rendered as Markdown→HTML

Auth:
    Per-tenant widget key: Authorization: Bearer wk_{tenant}_{random}
    Or query param: ?key=wk_{tenant}_{random}
    Set MIRA_WIDGET_KEY in Doppler (or MIRA_WIDGET_KEYS as comma-separated list).

Message format (inbound):
    {
        "user_id":   "tech@acme.com",   # stable user identifier
        "session_id": "sess_abc123",     # optional: persist across page reloads
        "text":      "Pump P-3 cavitating",
        "image_b64": "data:image/jpeg;base64,/9j/...",  # optional
        "tenant_id": "acme-corp",        # optional: override from auth key
    }

Message format (outbound):
    {
        "reply":       "<p>Before I diagnose...</p>",  # HTML
        "text":        "Before I diagnose...",          # plain text fallback
        "suggestions": ["Check suction pressure", "Inspect impeller"],
        "confidence":  "medium",
        "session_id":  "sess_abc123",
    }

Example bot.py usage:
    adapter = WebChatAdapter()
    dispatcher = ChatDispatcher(engine)

    @app.post("/chat")
    async def chat(body: ChatRequest, request: Request):
        raw_event = {
            "user_id":    body.user_id,
            "session_id": body.session_id,
            "text":       body.text,
            "image_b64":  body.image_b64,
            "tenant_id":  body.tenant_id or _resolve_tenant_from_key(request),
        }
        event = await adapter.normalize_incoming(raw_event)

        # Pre-download image if provided (adapter sets attachment.data)
        for att in event.attachments:
            att.data = await adapter.download_attachment(att)

        response = await dispatcher.dispatch(event)
        return await adapter.render_outgoing_json(response, event)
"""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import uuid

from shared.chat.types import (
    NormalizedAttachment,
    NormalizedChatEvent,
    NormalizedChatResponse,
)

logger = logging.getLogger("mira-webchat")

_IMAGE_DATA_URI = re.compile(r"^data:(image/[^;]+);base64,(.+)$", re.DOTALL)
_MAX_REPLY_LEN = 4000  # browser widget handles long responses fine


def _md_to_html(text: str) -> str:
    """Minimal Markdown → HTML conversion for widget display.

    Handles headers, bold, italic, inline code, fenced code blocks,
    and bullet lists. Not a full Markdown parser — sufficient for MIRA
    diagnostic replies.
    """
    lines = text.split("\n")
    out: list[str] = []
    in_code = False
    in_list = False

    for line in lines:
        # Fenced code block toggle
        if line.strip().startswith("```"):
            if in_list:
                out.append("</ul>")
                in_list = False
            if in_code:
                out.append("</code></pre>")
                in_code = False
            else:
                lang = line.strip()[3:].strip() or "text"
                out.append(f'<pre><code class="language-{lang}">')
                in_code = True
            continue

        if in_code:
            out.append(_escape_html(line))
            continue

        stripped = line.strip()

        # Bullet list
        if stripped.startswith(("- ", "* ", "• ")):
            if not in_list:
                out.append("<ul>")
                in_list = True
            item = _inline_md(stripped[2:])
            out.append(f"<li>{item}</li>")
            continue

        # Numbered list
        if re.match(r"^\d+\.\s", stripped):
            if not in_list:
                out.append("<ul>")
                in_list = True
            item = _inline_md(re.sub(r"^\d+\.\s", "", stripped))
            out.append(f"<li>{item}</li>")
            continue

        if in_list:
            out.append("</ul>")
            in_list = False

        # Headers
        m = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if m:
            level = len(m.group(1))
            out.append(f"<h{level}>{_inline_md(m.group(2))}</h{level}>")
            continue

        # Horizontal rule
        if re.match(r"^[-*_]{3,}$", stripped):
            out.append("<hr>")
            continue

        # Empty line → paragraph break
        if not stripped:
            out.append("<br>")
            continue

        out.append(f"<p>{_inline_md(stripped)}</p>")

    if in_list:
        out.append("</ul>")
    if in_code:
        out.append("</code></pre>")

    return "\n".join(out)


def _inline_md(text: str) -> str:
    """Apply inline Markdown (bold, italic, code) to a single line."""
    text = _escape_html(text)
    # Bold: **text** or __text__
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__(.+?)__", r"<strong>\1</strong>", text)
    # Italic: *text* or _text_
    text = re.sub(r"\*([^*]+?)\*", r"<em>\1</em>", text)
    text = re.sub(r"_([^_]+?)_", r"<em>\1</em>", text)
    # Inline code: `code`
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    # Links: [label](url)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" target="_blank">\1</a>', text)
    return text


def _escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class WebChatAdapter:
    """ChatAdapter for the embeddable MIRA web widget."""

    platform = "webchat"

    # ------------------------------------------------------------------
    # ChatAdapter Protocol — normalize_incoming
    # ------------------------------------------------------------------

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert widget JSON body to NormalizedChatEvent.

        raw_event keys:
            user_id     — stable user identifier (email or UUID)
            session_id  — optional session token for state persistence
            text        — message text
            image_b64   — optional data: URI or raw base64 string
            tenant_id   — MIRA tenant ID
        """
        user_id: str = raw_event.get("user_id", "") or str(uuid.uuid4())
        session_id: str = raw_event.get("session_id", "") or _new_session_id(user_id)
        text: str = raw_event.get("text", "").strip()
        image_b64_raw: str = raw_event.get("image_b64", "") or ""
        tenant_id: str = raw_event.get("tenant_id", "")

        # Stable event ID from session + text content
        event_id = hashlib.sha1(f"{session_id}:{text}".encode()).hexdigest()[:16]

        attachments: list[NormalizedAttachment] = []
        event_type = "message"

        if image_b64_raw:
            mime, b64_data = _parse_image_b64(image_b64_raw)
            attachments.append(
                NormalizedAttachment(
                    kind="image",
                    mime_type=mime,
                    filename="photo.jpg",
                    url="",  # no URL — data is inline
                    data=b64_data,  # raw bytes pre-populated; no download needed
                )
            )
            event_type = "photo"

        return NormalizedChatEvent(
            event_id=event_id,
            platform="webchat",
            tenant_id=tenant_id,
            user_id=user_id,
            external_user_id=user_id,
            external_channel_id=session_id,
            external_thread_id="",
            text=text,
            attachments=attachments,
            event_type=event_type,
            raw=raw_event,
        )

    # ------------------------------------------------------------------
    # ChatAdapter Protocol — render_outgoing
    # ------------------------------------------------------------------

    async def render_outgoing(
        self,
        response: NormalizedChatResponse,
        event: NormalizedChatEvent,
    ) -> None:
        """No-op for webchat — use render_outgoing_json() to get the dict.

        WebChat is request/response (not push), so render_outgoing_json()
        is the primary path. This stub satisfies the Protocol.
        """
        _ = response, event  # unused — push not applicable to request/response pattern

    async def render_outgoing_json(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> dict:
        """Return the response as a JSON-serializable dict for the widget.

        Called directly by bot.py instead of render_outgoing() because
        webchat is request/response, not push — the reply is the HTTP response.
        """
        text = response.text[:_MAX_REPLY_LEN]
        return {
            "reply": _md_to_html(text),
            "text": text,
            "suggestions": response.suggestions,
            "confidence": event.raw.get("_confidence", ""),
            "session_id": event.external_channel_id,
        }

    # ------------------------------------------------------------------
    # ChatAdapter Protocol — download_attachment
    # ------------------------------------------------------------------

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Decode inline base64 image — no HTTP download needed for webchat."""
        if attachment.data:
            return attachment.data  # already decoded in normalize_incoming
        if attachment.url:
            # Shouldn't happen for webchat, but handle gracefully
            raise ValueError(f"Unexpected URL attachment in webchat: {attachment.url}")
        return b""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _new_session_id(user_id: str) -> str:
    """Generate a new session ID scoped to a user."""
    return f"sess_{hashlib.sha1(f'{user_id}:{uuid.uuid4()}'.encode()).hexdigest()[:12]}"


def _parse_image_b64(raw: str) -> tuple[str, bytes]:
    """Parse a data: URI or raw base64 string into (mime_type, bytes).

    Accepts:
        data:image/jpeg;base64,/9j/...
        /9j/...   (bare JPEG base64, no data: prefix)
    """
    m = _IMAGE_DATA_URI.match(raw)
    if m:
        mime = m.group(1)
        data = base64.b64decode(m.group(2))
    else:
        # Assume JPEG if no mime prefix
        mime = "image/jpeg"
        data = base64.b64decode(raw)
    return mime, data
