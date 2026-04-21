"""Dispatcher — routes NormalizedChatEvents through the Conversation Router + GSDEngine."""

from __future__ import annotations

import logging

from .types import NormalizedChatEvent, NormalizedChatResponse

logger = logging.getLogger("mira-gsd")


class ChatDispatcher:
    """Takes normalized events from any adapter, runs them through MIRA's engine,
    returns normalized responses."""

    def __init__(self, engine):
        """engine is a Supervisor instance (GSDEngine)."""
        self.engine = engine

    async def dispatch(self, event: NormalizedChatEvent) -> NormalizedChatResponse:
        """Process one chat event and return a response."""

        # Extract photo if present
        photo_b64 = None
        for att in event.attachments:
            if att.kind == "image":
                # Adapter should have already downloaded;
                # or we call adapter.download_attachment here
                pass

        # Call the engine (existing Supervisor.process)
        result = await self.engine.process(
            chat_id=f"{event.platform}:{event.external_channel_id}",
            message=event.text,
            user_id=event.user_id or event.external_user_id,
            photo_b64=photo_b64,
        )

        # Convert engine output to NormalizedChatResponse
        # The engine currently returns a formatted string
        # Parse it into blocks where possible
        response = NormalizedChatResponse(
            text=result if isinstance(result, str) else str(result),
            thread_id=event.external_thread_id,
        )

        logger.info(
            "DISPATCH platform=%s user=%s chat=%s text_len=%d",
            event.platform,
            event.external_user_id,
            event.external_channel_id,
            len(response.text),
        )

        return response
