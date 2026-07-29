"""Dispatcher — routes NormalizedChatEvents through the Conversation Router + GSDEngine."""

from __future__ import annotations

import logging
import os
import time
from typing import TYPE_CHECKING

from .types import NormalizedChatEvent, NormalizedChatResponse

if TYPE_CHECKING:
    from shared.identity.service import IdentityService

logger = logging.getLogger("mira-gsd")

_RATE_LIMIT_MESSAGES = int(os.getenv("RATE_LIMIT_MESSAGES", "10"))
_RATE_LIMIT_WINDOW = 60  # seconds


def _admin_telegram_ids() -> frozenset[str]:
    """Parse ADMIN_TELEGRAM_IDS env (CSV) — admins bypass the identity gate."""
    raw = os.getenv("ADMIN_TELEGRAM_IDS", "")
    return frozenset(tok.strip() for tok in raw.split(",") if tok.strip())


class ChatDispatcher:
    """Takes normalized events from any adapter, runs them through MIRA's engine,
    returns normalized responses."""

    def __init__(self, engine, identity_service: "IdentityService | None" = None):
        """engine is a Supervisor instance (GSDEngine).
        identity_service is optional; when provided, resolves user_id before dispatch.
        """
        self.engine = engine
        self._identity = identity_service
        # {chat_id: [monotonic_timestamp, ...]} — pruned on every check
        self._rate_windows: dict[str, list[float]] = {}

    def _check_rate_limit(self, chat_id: str) -> bool:
        """Return True if under limit, False if the user should be throttled.

        Tracks the last _RATE_LIMIT_MESSAGES timestamps per chat_id in a
        sliding window of _RATE_LIMIT_WINDOW seconds.
        """
        now = time.monotonic()
        window = [ts for ts in self._rate_windows.get(chat_id, []) if now - ts < _RATE_LIMIT_WINDOW]
        if len(window) >= _RATE_LIMIT_MESSAGES:
            self._rate_windows[chat_id] = window
            logger.warning(
                "RATE_LIMIT_HIT chat_id=%s messages=%d window=%ds",
                chat_id,
                len(window),
                _RATE_LIMIT_WINDOW,
            )
            return False
        window.append(now)
        self._rate_windows[chat_id] = window
        return True

    async def dispatch(self, event: NormalizedChatEvent) -> NormalizedChatResponse:
        """Process one chat event and return a response."""
        import asyncio
        import base64

        if event.external_thread_id:
            chat_id = f"{event.platform}:{event.external_channel_id}:{event.external_thread_id}"
        else:
            chat_id = f"{event.platform}:{event.external_channel_id}"

        if not self._check_rate_limit(chat_id):
            return NormalizedChatResponse(
                text=(
                    "You're sending messages too quickly. "
                    "Please wait a moment before sending another message."
                ),
                thread_id=event.external_thread_id,
            )

        # Strict gate: identity_links row required, no env-var fallback, no auto-create.
        if self._identity is None:
            logger.error("DISPATCH_NO_IDENTITY platform=%s — failing closed", event.platform)
            return NormalizedChatResponse(
                text=(
                    "MIRA is not configured for multi-tenant access yet. "
                    "If you believe this is a mistake, ask your admin."
                ),
                thread_id=event.external_thread_id,
            )

        try:
            mira_user = await asyncio.to_thread(
                self._identity.lookup_only, event.platform, event.external_user_id
            )
        except Exception as exc:
            logger.error(
                "IDENTITY_LOOKUP_FAILED platform=%s ext=%s err=%s",
                event.platform,
                event.external_user_id,
                exc,
            )
            return NormalizedChatResponse(
                text="MIRA is temporarily unavailable. Please retry shortly.",
                thread_id=event.external_thread_id,
            )

        if mira_user is None:
            # Admin bypass: ADMIN_TELEGRAM_IDS holders are the operators of the
            # bot — they should never be gated by their own enrollment system.
            # Synthesize a MiraUser with the default tenant_id from env so the
            # rest of the pipeline (engine.process, ChatDispatcher logging) has
            # the fields it expects.
            admin_ids = _admin_telegram_ids()
            if event.platform == "telegram" and str(event.external_user_id) in admin_ids:
                from shared.identity.service import MiraUser as _MiraUser

                tenant_id = os.getenv("MIRA_TENANT_ID", "")
                mira_user = _MiraUser(
                    id=f"admin:{event.external_user_id}",
                    tenant_id=tenant_id,
                    display_name="Admin",
                    email="",
                )
                logger.info(
                    "DISPATCH_ADMIN_BYPASS platform=%s ext=%s tenant=%s",
                    event.platform,
                    event.external_user_id,
                    tenant_id,
                )
            else:
                logger.info(
                    "DISPATCH_BLOCKED platform=%s ext=%s reason=stranger",
                    event.platform,
                    event.external_user_id,
                )
                return NormalizedChatResponse(
                    text=(
                        "Hi — I'm MIRA, your team's maintenance assistant. "
                        "I'm invite-only. Ask your admin to send you an enrollment link."
                    ),
                    thread_id=event.external_thread_id,
                )

        # Extract pre-downloaded image bytes (set by adapter before dispatch)
        photo_b64 = None
        for att in event.attachments:
            if att.kind == "image" and att.data:
                photo_b64 = base64.b64encode(att.data).decode()
                break

        result = await self.engine.process(
            chat_id=chat_id,
            message=event.text,
            photo_b64=photo_b64,
            platform=event.platform,
            tenant_id=mira_user.tenant_id,
            mira_user_id=mira_user.id,
        )

        response = NormalizedChatResponse(
            text=result if isinstance(result, str) else str(result),
            thread_id=event.external_thread_id,
        )

        logger.info(
            "DISPATCH platform=%s user=%s mira_user=%s tenant=%s chat=%s text_len=%d",
            event.platform,
            event.external_user_id,
            mira_user.id,
            mira_user.tenant_id,
            event.external_channel_id,
            len(response.text),
        )
        return response
