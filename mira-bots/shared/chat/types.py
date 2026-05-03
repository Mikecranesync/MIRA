"""Platform-agnostic chat event and response types.

Every chat adapter (Telegram, Slack, Teams, Google Chat) translates
platform-specific events INTO these types, and translates responses
back OUT to platform-specific formats. Business logic never sees
platform-specific structures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


@dataclass
class NormalizedAttachment:
    kind: Literal["image", "pdf", "document", "audio", "video", "other"]
    mime_type: str
    filename: str
    url: str  # platform-specific download URL
    auth_header: str = ""  # some platforms need bearer token to download
    size_bytes: int = 0
    data: bytes = field(
        default_factory=bytes
    )  # pre-downloaded content (set by adapter before dispatch)


@dataclass
class NormalizedChatEvent:
    """One inbound message from any platform, normalized."""

    event_id: str
    platform: Literal[
        "telegram", "slack", "teams", "gchat", "webui", "email", "whatsapp", "webchat"
    ]
    tenant_id: str
    user_id: str  # canonical MIRA user ID (after identity resolution)
    external_user_id: str  # platform-specific user ID
    external_channel_id: str  # channel/conversation/chat ID
    external_thread_id: str = ""
    text: str = ""
    attachments: list[NormalizedAttachment] = field(default_factory=list)
    event_type: Literal["message", "mention", "dm", "file_share", "command", "photo"] = "message"
    command: str = ""  # for slash commands: /mira, /work-order
    command_args: str = ""
    timestamp: datetime = field(default_factory=datetime.utcnow)
    raw: dict = field(default_factory=dict)  # original payload for debugging


@dataclass
class ResponseBlock:
    """Platform-agnostic content block. Renderers translate per platform."""

    kind: Literal[
        "header",
        "paragraph",
        "bullet_list",
        "key_value",
        "button_row",
        "divider",
        "image",
        "code",
        "citation",
        "warning",
        "suggestion_chips",
    ]
    data: dict = field(default_factory=dict)


@dataclass
class NormalizedChatResponse:
    """One outbound response to any platform."""

    text: str  # plain text fallback (always required)
    blocks: list[ResponseBlock] = field(default_factory=list)
    thread_id: str = ""
    ephemeral: bool = False
    files: list[dict] = field(default_factory=list)  # file uploads
    suggestions: list[str] = field(default_factory=list)  # suggestion chips
