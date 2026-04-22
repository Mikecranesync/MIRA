"""Telegram adapter implementing the ChatAdapter protocol."""

from __future__ import annotations

import logging

import httpx
from renderers import render_telegram
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse

logger = logging.getLogger("mira-bot")

_TG_API = "https://api.telegram.org"
_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}


class TelegramChatAdapter:
    platform = "telegram"

    def __init__(self, bot_token: str) -> None:
        self.bot_token = bot_token

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert Telegram Update dict to NormalizedChatEvent.

        Accepts either a full Update dict (with top-level 'message' key) or a
        bare message dict (for slash-command-style callers).
        """
        msg = raw_event.get("message") or raw_event.get("edited_message") or raw_event

        update_id = str(raw_event.get("update_id", ""))
        msg_id = str(msg.get("message_id", ""))
        event_id = f"{update_id}:{msg_id}" if update_id else msg_id

        chat = msg.get("chat", {})
        chat_id = str(chat.get("id", msg.get("chat_id", "")))
        chat_type = chat.get("type", "")  # private | group | supergroup | channel

        from_user = msg.get("from", {})
        external_user_id = str(from_user.get("id", ""))

        text = msg.get("text", "") or msg.get("caption", "")

        reply_to = msg.get("reply_to_message") or {}
        thread_id = str(reply_to.get("message_id", "")) if reply_to else ""

        attachments: list[NormalizedAttachment] = []

        photos = msg.get("photo", [])
        if photos:
            largest = photos[-1]
            attachments.append(
                NormalizedAttachment(
                    kind="image",
                    mime_type="image/jpeg",
                    filename=f"photo_{largest.get('file_id', '')[:8]}.jpg",
                    url=largest.get("file_id", ""),
                    auth_header=f"Bot {self.bot_token}",
                    size_bytes=largest.get("file_size", 0),
                )
            )

        doc = msg.get("document")
        if doc:
            mime = doc.get("mime_type", "application/octet-stream")
            kind = (
                "image" if mime in _IMAGE_MIMES else "pdf" if mime == "application/pdf" else "other"
            )
            attachments.append(
                NormalizedAttachment(
                    kind=kind,
                    mime_type=mime,
                    filename=doc.get("file_name", "document"),
                    url=doc.get("file_id", ""),
                    auth_header=f"Bot {self.bot_token}",
                    size_bytes=doc.get("file_size", 0),
                )
            )

        voice = msg.get("voice")
        if voice:
            attachments.append(
                NormalizedAttachment(
                    kind="other",
                    mime_type=voice.get("mime_type", "audio/ogg"),
                    filename="voice.ogg",
                    url=voice.get("file_id", ""),
                    auth_header=f"Bot {self.bot_token}",
                    size_bytes=voice.get("file_size", 0),
                )
            )

        event_type = "dm" if chat_type == "private" else "mention"

        return NormalizedChatEvent(
            event_id=event_id,
            platform="telegram",
            tenant_id="",
            user_id="",
            external_user_id=external_user_id,
            external_channel_id=chat_id,
            external_thread_id=thread_id,
            text=text,
            attachments=attachments,
            event_type=event_type,
            raw=raw_event,
        )

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send response to Telegram using MarkdownV2, with InlineKeyboard for buttons."""
        text, reply_markup = render_telegram(response)
        payload: dict = {
            "chat_id": event.external_channel_id,
            "text": text or response.text,
            "parse_mode": "MarkdownV2",
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        if event.external_thread_id:
            try:
                payload["reply_to_message_id"] = int(event.external_thread_id)
            except (ValueError, TypeError):
                pass

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{_TG_API}/bot{self.bot_token}/sendMessage",
                    json=payload,
                )
                data = resp.json()
                if not data.get("ok"):
                    err_desc = data.get("description", "")
                    logger.warning("Telegram sendMessage error: %s", err_desc)
                    # MarkdownV2 parse failure → retry as plain text
                    if "can't parse" in err_desc.lower() or "parse" in err_desc.lower():
                        plain_payload = {**payload, "text": response.text}
                        plain_payload.pop("parse_mode", None)
                        resp2 = await client.post(
                            f"{_TG_API}/bot{self.bot_token}/sendMessage",
                            json=plain_payload,
                        )
                        data2 = resp2.json()
                        if not data2.get("ok"):
                            logger.error(
                                "Telegram plain-text fallback also failed: %s",
                                data2.get("description"),
                            )
        except Exception as exc:
            logger.error("render_outgoing failed: %s", exc)

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download a Telegram file by file_id stored in attachment.url."""
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{_TG_API}/bot{self.bot_token}/getFile",
                params={"file_id": attachment.url},
            )
            r.raise_for_status()
            file_path = r.json()["result"]["file_path"]
            r2 = await client.get(f"{_TG_API}/file/bot{self.bot_token}/{file_path}")
            r2.raise_for_status()
            return r2.content
