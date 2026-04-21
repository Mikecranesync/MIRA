"""Dispatcher — routes NormalizedChatEvents through the Conversation Router + GSDEngine."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .types import NormalizedChatEvent, NormalizedChatResponse

if TYPE_CHECKING:
    from shared.identity.service import IdentityService

logger = logging.getLogger("mira-gsd")


class ChatDispatcher:
    """Takes normalized events from any adapter, runs them through MIRA's engine,
    returns normalized responses."""

    def __init__(self, engine, identity_service: "IdentityService | None" = None):
        """engine is a Supervisor instance (GSDEngine).
        identity_service is optional; when provided, resolves user_id before dispatch.
        """
        self.engine = engine
        self._identity = identity_service

    async def dispatch(self, event: NormalizedChatEvent) -> NormalizedChatResponse:
        """Process one chat event and return a response."""
        import asyncio
        import base64

        # Scope chat_id per thread when a thread_id is present so separate
        # threads in the same channel don't share FSM state (matches existing
        # Slack bot behaviour: slack:{channel}:{thread_ts}).
        if event.external_thread_id:
            chat_id = f"{event.platform}:{event.external_channel_id}:{event.external_thread_id}"
        else:
            chat_id = f"{event.platform}:{event.external_channel_id}"

        # Resolve canonical user_id via identity service when available
        user_id = event.user_id or event.external_user_id
        if self._identity and event.external_user_id and event.tenant_id:
            try:
                mira_user = await asyncio.to_thread(
                    self._identity.resolve,
                    event.platform,
                    event.external_user_id,
                    event.tenant_id,
                )
                user_id = mira_user.id
                logger.debug(
                    "IDENTITY resolved platform=%s ext=%s → mira_user=%s",
                    event.platform,
                    event.external_user_id,
                    user_id,
                )
            except Exception as exc:
                logger.warning("Identity resolution failed: %s — using external_user_id", exc)

        # Extract pre-downloaded image bytes (set by adapter before dispatch)
        photo_b64 = None
        for att in event.attachments:
            if att.kind == "image" and att.data:
                photo_b64 = base64.b64encode(att.data).decode()
                break

        # Call the engine (existing Supervisor.process)
        result = await self.engine.process(
            chat_id=chat_id,
            message=event.text,
            user_id=user_id,
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
