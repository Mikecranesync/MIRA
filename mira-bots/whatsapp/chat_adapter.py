"""WhatsApp ChatAdapter — Twilio WhatsApp Sandbox.

Implements the ChatAdapter Protocol so WhatsApp slots into the same
dispatcher→engine pipeline as Telegram, Slack, Teams, and Email.

Inbound:  Twilio webhook form fields → NormalizedChatEvent
Outbound: NormalizedChatResponse → Twilio Messages REST API (POST)
Media:    HTTP GET with Twilio Basic auth (account_sid:auth_token)

Usage in bot.py:
    adapter = WhatsAppChatAdapter(
        account_sid=TWILIO_ACCOUNT_SID,
        auth_token=TWILIO_AUTH_TOKEN,
        from_number=TWILIO_WHATSAPP_FROM,
    )
    dispatcher = ChatDispatcher(engine)

    @app.post("/webhook")
    async def webhook(request: Request, ...form fields...):
        raw_event = {
            "From": From, "Body": Body,
            "NumMedia": NumMedia, "MediaUrl0": MediaUrl0,
            "MediaContentType0": MediaContentType0,
            "tenant_id": MIRA_TENANT_ID,
        }
        event = await adapter.normalize_incoming(raw_event)
        response = await dispatcher.dispatch(event)
        await adapter.render_outgoing(response, event)
        return PlainTextResponse("", status_code=204)  # Twilio ignores body if we send separately
"""

from __future__ import annotations

import hashlib
import logging
import re

import httpx

from shared.chat.types import (
    NormalizedAttachment,
    NormalizedChatEvent,
    NormalizedChatResponse,
)

logger = logging.getLogger("mira-whatsapp")

_TWILIO_MESSAGES_URL = "https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
_MAX_WA_LENGTH = 1600  # WhatsApp truncates beyond ~4096 but 1600 keeps it readable

_IMAGE_MIMES = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})


def _strip_markdown(text: str) -> str:
    """Convert Markdown to WhatsApp-compatible formatting.

    WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```code```.
    Convert common Markdown patterns to their WA equivalents.
    """
    # Headers → bold line
    text = re.sub(r"^#{1,3}\s+(.+)$", r"*\1*", text, flags=re.MULTILINE)
    # Markdown bold (**text** or __text__) → WA bold (*text*)
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)
    text = re.sub(r"__(.+?)__", r"*\1*", text)
    # Markdown italic (*text* or _text_) — already WA italic for _text_
    # Remove Markdown links [label](url) → label (url)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    # Markdown inline code `code` → ```code```
    text = re.sub(r"`([^`]+)`", r"```\1```", text)
    return text.strip()


class WhatsAppChatAdapter:
    """ChatAdapter for WhatsApp via Twilio."""

    platform = "whatsapp"

    def __init__(
        self,
        account_sid: str,
        auth_token: str,
        from_number: str,
    ) -> None:
        self._sid = account_sid
        self._token = auth_token
        self._from = from_number  # "whatsapp:+14155238886"

    # ------------------------------------------------------------------
    # ChatAdapter Protocol — normalize_incoming
    # ------------------------------------------------------------------

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert Twilio webhook form fields to NormalizedChatEvent.

        raw_event keys:
            From              — "whatsapp:+15551234567"
            Body              — message text (may be empty if media-only)
            NumMedia          — "0" | "1" | ...
            MediaUrl0         — media download URL (Twilio-hosted)
            MediaContentType0 — MIME type of first attachment
            tenant_id         — MIRA tenant ID (set by bot.py)
        """
        raw_from: str = raw_event.get("From", "")
        phone = raw_from.replace("whatsapp:", "").strip()
        tenant_id: str = raw_event.get("tenant_id", "")
        body: str = raw_event.get("Body", "").strip()
        num_media = int(raw_event.get("NumMedia", "0") or "0")
        media_url: str = raw_event.get("MediaUrl0", "")
        media_mime: str = raw_event.get("MediaContentType0", "")

        # Stable, opaque event ID from phone + body (no message SID in sandbox)
        event_id = hashlib.sha1(f"{phone}:{body}:{media_url}".encode()).hexdigest()[:16]

        attachments: list[NormalizedAttachment] = []
        event_type = "message"

        if num_media > 0 and media_url:
            kind = "image" if media_mime in _IMAGE_MIMES else "other"
            if kind == "image":
                event_type = "photo"
            attachments.append(
                NormalizedAttachment(
                    kind=kind,
                    mime_type=media_mime,
                    filename=f"media.{media_mime.split('/')[-1]}",
                    url=media_url,
                    auth_header=self._basic_auth_header(),
                )
            )

        return NormalizedChatEvent(
            event_id=event_id,
            platform="whatsapp",
            tenant_id=tenant_id,
            user_id="",  # filled by dispatcher via IdentityService if configured
            external_user_id=phone,
            external_channel_id=phone,  # WhatsApp: 1 user = 1 channel
            external_thread_id="",
            text=body,
            attachments=attachments,
            event_type=event_type,
            raw=raw_event,
        )

    # ------------------------------------------------------------------
    # ChatAdapter Protocol — render_outgoing
    # ------------------------------------------------------------------

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send reply to user's WhatsApp number via Twilio Messages API."""
        text = _strip_markdown(response.text)

        # Append suggestion chips as numbered list (WA has no native chips)
        if response.suggestions:
            chips = "\n".join(f"{i+1}. {s}" for i, s in enumerate(response.suggestions))
            text = f"{text}\n\n{chips}"

        # Truncate to WA limit
        if len(text) > _MAX_WA_LENGTH:
            text = text[: _MAX_WA_LENGTH - 3] + "..."

        to_number = f"whatsapp:{event.external_user_id}"
        await self._send_message(to_number, text)

    # ------------------------------------------------------------------
    # ChatAdapter Protocol — download_attachment
    # ------------------------------------------------------------------

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download Twilio-hosted media using Basic auth."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                attachment.url,
                headers={"Authorization": attachment.auth_header},
            )
            resp.raise_for_status()
            return resp.content

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _basic_auth_header(self) -> str:
        import base64
        credentials = base64.b64encode(f"{self._sid}:{self._token}".encode()).decode()
        return f"Basic {credentials}"

    async def _send_message(self, to: str, body: str) -> None:
        """POST to Twilio Messages API."""
        url = _TWILIO_MESSAGES_URL.format(account_sid=self._sid)
        data = {"From": self._from, "To": to, "Body": body}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                data=data,
                auth=(self._sid, self._token),
            )
            if resp.status_code not in (200, 201):
                logger.error(
                    "Twilio send failed: %s %s",
                    resp.status_code,
                    resp.text[:200],
                )
            else:
                logger.info("WhatsApp reply sent to %s (%d chars)", to, len(body))
