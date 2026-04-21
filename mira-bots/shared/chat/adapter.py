"""ChatAdapter protocol — every platform adapter implements this."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse


@runtime_checkable
class ChatAdapter(Protocol):
    """Interface every chat platform adapter must implement."""

    platform: str  # "telegram", "slack", "teams", "gchat"

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert platform-specific event to NormalizedChatEvent."""
        ...

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Convert NormalizedChatResponse to platform-specific format and send."""
        ...

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download an attachment using platform-specific auth."""
        ...
