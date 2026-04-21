"""Microsoft Teams adapter implementing the ChatAdapter protocol.

Uses Bot Framework SDK (botbuilder-core) for receiving messages.
Uses Microsoft Graph API (via GraphClient) for authenticated file downloads.
Uses Adaptive Cards v1.5 via shared teams_cards renderer for rich responses.
"""

from __future__ import annotations

import logging

import httpx
from botbuilder.schema import Activity, ActivityTypes, Attachment
from graph_client import GraphClient
from shared.chat.renderers.teams_cards import render_teams
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse

logger = logging.getLogger("mira-teams")

_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}
_TEAMS_FILE_CONTENT_TYPE = "application/vnd.microsoft.teams.file.download.info"


class TeamsChatAdapter:
    platform = "teams"

    def __init__(self, app_id: str, app_password: str, tenant_id: str = "common") -> None:
        self.app_id = app_id
        self.app_password = app_password
        self.tenant_id = tenant_id
        self._graph = GraphClient(app_id, app_password, tenant_id)
        self._turn_context = None  # set by bot.py before render_outgoing

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert Teams Activity JSON dict to NormalizedChatEvent.

        Accepts the raw request body dict from the Bot Framework webhook.
        """
        from_user = raw_event.get("from", {})
        # Prefer AAD object ID (stable Entra ID), fall back to Bot Framework user ID
        external_user_id = from_user.get("aadObjectId") or from_user.get("id", "")

        conv = raw_event.get("conversation", {})
        channel_id = conv.get("id", "")
        conv_type = conv.get("conversationType", "")
        # Tenant ID lives in conversation or channelData.tenant
        tenant_id = (
            conv.get("tenantId")
            or raw_event.get("channelData", {}).get("tenant", {}).get("id", "")
        )

        text = (raw_event.get("text") or "").strip()
        activity_id = raw_event.get("id", "")
        reply_to_id = raw_event.get("replyToId", "")

        attachments: list[NormalizedAttachment] = []
        for att in raw_event.get("attachments") or []:
            content_type = att.get("contentType", "")
            name = att.get("name", "")

            if content_type in _IMAGE_MIMES:
                url = att.get("contentUrl", "")
                attachments.append(
                    NormalizedAttachment(
                        kind="image",
                        mime_type=content_type,
                        filename=name or "image.jpg",
                        url=url,
                        auth_header="BotToken",  # needs connector token
                    )
                )
            elif content_type == _TEAMS_FILE_CONTENT_TYPE:
                content = att.get("content", {})
                url = content.get("downloadUrl", "")
                file_type = content.get("fileType", "").lower()
                if file_type in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
                    kind, mime = "image", f"image/{file_type}"
                elif file_type == "pdf":
                    kind, mime = "pdf", "application/pdf"
                else:
                    kind, mime = "other", "application/octet-stream"
                attachments.append(
                    NormalizedAttachment(
                        kind=kind,
                        mime_type=mime,
                        filename=name or f"file.{file_type}",
                        url=url,
                        auth_header="",  # pre-signed SAS URL — no auth needed
                    )
                )

        event_type = "dm" if conv_type in ("personal", "") else "mention"

        return NormalizedChatEvent(
            event_id=activity_id,
            platform="teams",
            tenant_id=tenant_id,
            user_id="",
            external_user_id=external_user_id,
            external_channel_id=channel_id,
            external_thread_id=reply_to_id,
            text=text,
            attachments=attachments,
            event_type=event_type,
            raw=raw_event,
        )

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send Adaptive Card response via the stored Bot Framework TurnContext."""
        if self._turn_context is None:
            logger.error("render_outgoing called without a stored turn_context")
            return

        card_data = render_teams(response)
        att_data = card_data["attachments"][0]
        reply = Activity(
            type=ActivityTypes.message,
            text=response.text,
            attachments=[
                Attachment(
                    content_type=att_data["contentType"],
                    content=att_data["content"],
                )
            ],
        )
        await self._turn_context.send_activity(reply)

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download a Teams attachment.

        - BotToken attachments: try Graph app-level token (works for Azure CDN-hosted
          inline images when the app has Files.Read.All / Sites.Read.All scope).
        - Pre-signed URLs (auth_header=""): direct GET, no auth required.
        """
        url = attachment.url
        if not url:
            raise ValueError(f"Attachment '{attachment.filename}' has no download URL")

        if attachment.auth_header == "BotToken":
            try:
                return await self._graph.download_file(url)
            except Exception as graph_exc:
                logger.warning(
                    "Graph download failed for %s, retrying unauthenticated: %s",
                    attachment.filename,
                    graph_exc,
                )

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
            return resp.content
