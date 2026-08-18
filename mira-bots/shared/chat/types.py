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
    # Canonical Hub channel-workflow metadata. Existing engine callers leave
    # these at their neutral defaults; Telegram/Slack render them but never
    # recompute their meaning.
    operation_id: str = ""
    operation_state: str = ""
    semantic_kind: str = ""
    citations: list[dict] = field(default_factory=list)
    provenance: dict = field(default_factory=dict)
    terminal_delivery_token: str = ""
    suppress_delivery: bool = False
    # None for legacy engine responses. Canonical adapters render only True;
    # False is an explicit Hub-owned delegation to the legacy diagnostic path.
    workflow_handled: bool | None = None
    # Authenticated delivery context is transport metadata, not canonical
    # provenance and is never rendered.
    delivery_tenant_id: str = ""
    delivery_user_id: str = ""
    delivery_channel: str = ""
