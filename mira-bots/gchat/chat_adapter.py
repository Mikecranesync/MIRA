"""Google Chat adapter implementing the ChatAdapter protocol.

Uses Google Chat API for receiving/sending messages (synchronous HTTP response).
Uses Google Drive API via WorkspaceClient for attachment downloads.
Uses Cards v2 via shared gchat_cards renderer for rich responses.
"""

from __future__ import annotations

import logging

import httpx
from shared.chat.renderers.gchat_cards import render_gchat
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse
from workspace_client import WorkspaceClient

logger = logging.getLogger("mira-gchat")

_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}


class GoogleChatAdapter:
    platform = "gchat"

    def __init__(self, service_account_info: str | dict) -> None:
        self._workspace = WorkspaceClient(service_account_info)

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert Google Chat event JSON to NormalizedChatEvent.

        Accepts the full event dict posted to the webhook by Google Chat.
        Handles MESSAGE, ADDED_TO_SPACE, REMOVED_FROM_SPACE, and CARD_CLICKED types.
        """
        message = raw_event.get("message", {})
        user = raw_event.get("user", {})
        space = raw_event.get("space", {})

        # Google Chat resource names follow "type/id" format
        user_name = user.get("name") or message.get("sender", {}).get("name", "")
        space_name = space.get("name", "")
        space_type = space.get("type", "ROOM")  # ROOM | DM | GROUP_CHAT

        external_user_id = user_name.split("/")[-1] if "/" in user_name else user_name
        external_channel_id = space_name

        msg_name = message.get("name", "")
        event_id = msg_name or raw_event.get("eventTime", "")

        # Thread: "spaces/X/threads/Y" → external_thread_id = "Y"
        thread_name = message.get("thread", {}).get("name", "")
        external_thread_id = thread_name.split("/")[-1] if "/" in thread_name else thread_name

        text = (message.get("text") or "").strip()
        command = ""

        # Slash command — strip the command token from text
        slash_cmd = message.get("slashCommand", {})
        if slash_cmd and " " in text:
            command, text = text.split(" ", 1)
        elif slash_cmd:
            command = text
            text = ""

        attachments: list[NormalizedAttachment] = []
        for att in message.get("attachment") or []:
            content_type = att.get("contentType", "")
            kind = (
                "image"
                if content_type in _IMAGE_MIMES or content_type.startswith("image/")
                else "pdf"
                if content_type == "application/pdf"
                else "other"
            )
            # Prefer downloadUri (pre-signed, no auth) over Drive resource name
            download_uri = att.get("downloadUri", "")
            resource_name = att.get("attachmentDataRef", {}).get("resourceName", "")
            url = download_uri or resource_name
            needs_auth = not download_uri and bool(resource_name)

            attachments.append(
                NormalizedAttachment(
                    kind=kind,
                    mime_type=content_type,
                    filename=att.get("name", msg_name).split("/")[-1],
                    url=url,
                    auth_header="DriveAPI" if needs_auth else "",
                )
            )

        event_type = (
            "dm"
            if space_type == "DM"
            else "command"
            if slash_cmd
            else "mention"
        )

        return NormalizedChatEvent(
            event_id=event_id,
            platform="gchat",
            tenant_id="",
            user_id="",
            external_user_id=external_user_id,
            external_channel_id=external_channel_id,
            external_thread_id=external_thread_id,
            text=text,
            attachments=attachments,
            event_type=event_type,
            command=command,
            raw=raw_event,
        )

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send response to Google Chat space via API (async / proactive path).

        For the standard synchronous webhook flow, callers should call
        render_gchat(response) and return it directly in the HTTP response body.
        This method is used for proactive messages or follow-up replies.
        """
        message = render_gchat(response)
        if event.external_thread_id:
            message["thread"] = {
                "name": f"{event.external_channel_id}/threads/{event.external_thread_id}"
            }
            message["messageReplyOption"] = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
        await self._workspace.send_message(event.external_channel_id, message)

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download a Google Chat attachment.

        - DriveAPI attachments: use WorkspaceClient Drive download
        - Pre-signed downloadUri: direct GET, no auth required
        """
        url = attachment.url
        if not url:
            raise ValueError(f"Attachment '{attachment.filename}' has no download URL")

        if attachment.auth_header == "DriveAPI":
            return await self._workspace.download_file(url)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
            return resp.content
