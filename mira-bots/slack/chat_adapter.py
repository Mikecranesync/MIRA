"""Slack adapter implementing the ChatAdapter protocol."""

from __future__ import annotations

import logging

import httpx
from shared.chat.renderers.slack_blocks import render_slack
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse

logger = logging.getLogger("mira-slack")

_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}


class SlackChatAdapter:
    platform = "slack"

    def __init__(self, bot_token: str, signing_secret: str = "") -> None:
        self.bot_token = bot_token
        self.signing_secret = signing_secret  # used by Bolt; stored for completeness

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert Slack event API payload to NormalizedChatEvent.

        Accepts either a full Events API payload (with top-level 'event' key +
        'team_id') or a bare inner event dict (what Bolt passes to handlers).
        """
        event = raw_event.get("event", raw_event)
        team_id = raw_event.get("team_id", "")

        attachments: list[NormalizedAttachment] = []
        for f in event.get("files", []):
            mime = f.get("mimetype", "")
            kind = (
                "image" if mime in _IMAGE_MIMES else "pdf" if mime == "application/pdf" else "other"
            )
            attachments.append(
                NormalizedAttachment(
                    kind=kind,
                    mime_type=mime,
                    filename=f.get("name", ""),
                    url=f.get("url_private_download", f.get("url_private", "")),
                    auth_header=f"Bearer {self.bot_token}",
                    size_bytes=f.get("size", 0),
                )
            )

        channel_type = event.get("channel_type", "")
        event_type = "dm" if channel_type == "im" else "mention"

        return NormalizedChatEvent(
            event_id=event.get("client_msg_id", event.get("ts", "")),
            platform="slack",
            tenant_id=team_id,
            user_id="",  # resolved later by identity service
            external_user_id=event.get("user", ""),
            external_channel_id=event.get("channel", ""),
            external_thread_id=event.get("thread_ts", ""),
            text=event.get("text", ""),
            attachments=attachments,
            event_type=event_type,
            raw=raw_event,
        )

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send response to Slack using Block Kit when blocks are present,
        falling back to plain text when the response has no blocks."""
        payload = render_slack(response)
        payload["channel"] = event.external_channel_id
        if event.external_thread_id:
            payload["thread_ts"] = event.external_thread_id

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://slack.com/api/chat.postMessage",
                    headers={"Authorization": f"Bearer {self.bot_token}"},
                    json=payload,
                )
                data = resp.json()
                if not data.get("ok"):
                    logger.warning("Slack postMessage error: %s", data.get("error"))
        except Exception as exc:
            logger.error("render_outgoing failed: %s", exc)

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download a Slack file using the bot token."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                attachment.url,
                headers={"Authorization": attachment.auth_header},
            )
            resp.raise_for_status()
            return resp.content
