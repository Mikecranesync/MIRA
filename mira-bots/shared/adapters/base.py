"""MIRA Platform Adapter Base Class.

All platform adapters (Telegram, Slack, Teams, WhatsApp) inherit from this.
Session ID format: {tenant_id}_{platform}_{user_id}
"""

from __future__ import annotations

import abc
import logging

logger = logging.getLogger("mira-adapter")


class MIRAAdapter(abc.ABC):
    """Base class for all MIRA platform adapters.

    Subclasses implement the three abstract methods. The base class
    provides shared error handling and session ID formatting.
    """

    platform: str = "unknown"

    def build_session_id(self, tenant_id: str, user_id: str) -> str:
        """Return canonical session ID: {tenant_id}_{platform}_{user_id}."""
        return f"{tenant_id}_{self.platform}_{user_id}"

    @abc.abstractmethod
    async def send_photo(self, image_bytes: bytes, session_id: str, caption: str = "") -> str:
        """Process an incoming photo and return the response text."""
        ...

    @abc.abstractmethod
    async def send_text(self, text: str, session_id: str) -> str:
        """Process an incoming text message and return the response text."""
        ...

    @abc.abstractmethod
    async def format_response(self, raw_response: str) -> str:
        """Apply platform-specific formatting to a raw response string."""
        ...

    async def handle_error(self, exc: Exception | None = None) -> str:
        """Return a user-facing error message. Override for platform-specific copy."""
        if exc:
            logger.error("[%s] adapter error: %s", self.platform, exc)
        return "I'm having trouble right now — try again in a moment."
