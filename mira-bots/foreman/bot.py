#!/usr/bin/env python3
"""FactoryLM Foreman - Fleet Orchestration Slack Bot

This bot monitors #factorylm-foreman for messages and orchestrates work across
the MIRA fleet by launching cloud agents. It has its own distinct Slack bot
identity to prevent self-echo loops.

Key behaviors:
- Listens to #factorylm-foreman (configurable via FOREMAN_SLACK_CHANNEL)
- Ignores messages from itself (bot_id check)
- Ignores bot_message, message_changed, message_deleted subtypes  
- Accepts normal human messages (no FLEET: prefix required)
- Posts responses using the Foreman bot identity
- Thread replies work
- Respects #cursor-enterprise stay-out behavior (configurable via FOREMAN_EXCLUDED_CHANNELS)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Mapping

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("foreman-bot")

_SECRET_PREFIX_RE = re.compile(r"(xox[a-zA-Z0-9-]*-|xapp-)[A-Za-z0-9-]+")


class ForemanConfigError(RuntimeError):
    """Raised when required Foreman runtime configuration is missing."""


@dataclass(frozen=True, slots=True)
class ForemanSettings:
    """Foreman bot configuration from environment variables."""

    bot_token: str
    app_token: str
    bot_user_id: str = ""
    foreman_channel: str = "factorylm-foreman"  # Default channel name
    excluded_channels: tuple[str, ...] = ("cursor-enterprise",)  # Stay-out channels
    dry_run: bool = False  # If True, log actions but don't launch agents

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "ForemanSettings":
        source = os.environ if env is None else env
        bot_token = source.get("FOREMAN_SLACK_BOT_TOKEN", "").strip()
        app_token = source.get("FOREMAN_SLACK_APP_TOKEN", "").strip()

        if not bot_token:
            raise ForemanConfigError("FOREMAN_SLACK_BOT_TOKEN is required")
        if not app_token:
            raise ForemanConfigError("FOREMAN_SLACK_APP_TOKEN is required for Socket Mode")

        foreman_channel = source.get("FOREMAN_SLACK_CHANNEL", "factorylm-foreman").strip()
        excluded_raw = source.get("FOREMAN_EXCLUDED_CHANNELS", "cursor-enterprise").strip()
        excluded_channels = tuple(c.strip() for c in excluded_raw.split(",") if c.strip())
        dry_run = source.get("FOREMAN_DRY_RUN", "0").strip() == "1"

        return cls(
            bot_token=bot_token,
            app_token=app_token,
            bot_user_id=source.get("FOREMAN_SLACK_BOT_USER_ID", "").strip(),
            foreman_channel=foreman_channel,
            excluded_channels=excluded_channels,
            dry_run=dry_run,
        )


def _redact_secret(value: object) -> str:
    return _SECRET_PREFIX_RE.sub(r"\1REDACTED", str(value))


def _event_meta(event: dict) -> dict[str, object]:
    return {
        "channel": event.get("channel", ""),
        "channel_type": event.get("channel_type", ""),
        "user": event.get("user", ""),
        "bot_id": event.get("bot_id", ""),
        "subtype": event.get("subtype", ""),
        "thread_ts": event.get("thread_ts", ""),
        "ts": event.get("ts", ""),
        "text_preview": (event.get("text", "") or "")[:50],
    }


def _log_event_decision(event: dict, *, decision: str, reason: str) -> None:
    logger.info(
        "foreman_event decision=%s reason=%s meta=%s",
        decision,
        reason,
        _event_meta(event),
    )


def _thread_ts(event: dict) -> str:
    """Get the thread_ts to reply in-thread."""
    return event.get("thread_ts", event.get("ts", ""))


class ForemanRuntime:
    """Foreman bot runtime that handles Slack events and orchestrates agents."""

    def __init__(self, *, settings: ForemanSettings) -> None:
        self.settings = settings
        self.seen_events: set[str] = set()
        self.foreman_channel_id: str | None = None  # Resolved on startup

    async def log_startup_auth_identity(self, app: Any) -> None:
        """Log the bot's authenticated identity and resolve channel IDs."""
        try:
            auth = await app.client.auth_test()
        except Exception as exc:
            logger.error("foreman_auth_test_failed error=%s", type(exc).__name__)
            return

        user_id = auth.get("user_id", "")
        bot_id = auth.get("bot_id", "")
        team_id = auth.get("team_id", "")
        team = auth.get("team", "")
        expected = self.settings.bot_user_id
        mismatch = bool(expected and user_id and user_id != expected)

        if mismatch:
            logger.error(
                "foreman_auth_identity_mismatch expected_user_id=%s actual_user_id=%s "
                "bot_id=%s team_id=%s team=%s",
                expected,
                user_id,
                bot_id,
                team_id,
                team,
            )
        else:
            logger.info(
                "foreman_auth_identity_ok user_id=%s bot_id=%s team_id=%s team=%s "
                "expected_configured=%s",
                user_id,
                bot_id,
                team_id,
                team,
                bool(expected),
            )

        # Resolve channel name to ID
        try:
            response = await app.client.conversations_list(types="public_channel,private_channel")
            channels = response.get("channels", [])
            for ch in channels:
                if ch.get("name") == self.settings.foreman_channel:
                    self.foreman_channel_id = ch.get("id")
                    logger.info(
                        "foreman_channel_resolved name=%s id=%s",
                        self.settings.foreman_channel,
                        self.foreman_channel_id,
                    )
                    break
            if not self.foreman_channel_id:
                logger.warning(
                    "foreman_channel_not_found name=%s (bot may not be a member)",
                    self.settings.foreman_channel,
                )
        except Exception as exc:
            logger.error("foreman_channel_resolution_failed error=%s", type(exc).__name__)

    async def handle_message(self, event: dict, say, client) -> None:
        """Handle message events and orchestrate cloud agents."""
        ts = event.get("ts", "")
        if ts in self.seen_events:
            _log_event_decision(event, decision="ignored", reason="duplicate")
            return
        self.seen_events.add(ts)
        if len(self.seen_events) > 200:
            self.seen_events.clear()

        # Filter: subtype (bot_message, message_changed, message_deleted)
        if event.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
            _log_event_decision(
                event,
                decision="ignored",
                reason=f"subtype:{event.get('subtype')}",
            )
            return

        # Filter: bot messages (INFRASTRUCTURE-LEVEL SELF-ECHO PREVENTION)
        if event.get("bot_id"):
            _log_event_decision(event, decision="ignored", reason="bot_event")
            return

        # Filter: excluded channels (e.g., #cursor-enterprise)
        channel_id = event.get("channel", "")
        # Resolve channel name if we have the ID
        channel_name = None
        if channel_id:
            try:
                info = await client.conversations_info(channel=channel_id)
                channel_name = info.get("channel", {}).get("name", "")
            except Exception:
                pass  # Fail soft; filter will check ID if name resolution fails

        if channel_name in self.settings.excluded_channels:
            _log_event_decision(
                event,
                decision="ignored",
                reason=f"excluded_channel:{channel_name}",
            )
            return

        # Filter: only listen in the configured foreman channel
        if self.foreman_channel_id and channel_id != self.foreman_channel_id:
            _log_event_decision(
                event,
                decision="ignored",
                reason=f"not_foreman_channel (listening_to={self.foreman_channel_id})",
            )
            return

        text = (event.get("text", "") or "").strip()
        if not text:
            _log_event_decision(event, decision="ignored", reason="empty_text")
            return

        _log_event_decision(event, decision="accepted", reason="message_handler")
        thread = _thread_ts(event)
        user = event.get("user", "")

        if self.settings.dry_run:
            logger.info(
                "foreman_dry_run_mode: would launch agent for user=%s text=%r thread=%s",
                user,
                text[:50],
                thread,
            )
            await say(
                text=f"[DRY RUN] Foreman would launch agent for: {text[:50]}...",
                thread_ts=thread,
            )
            return

        # TODO: Launch cloud agent via fleet-gateway MCP or Cursor API
        # For now, just acknowledge receipt
        logger.info(
            "foreman_orchestration_todo: launch agent for user=%s text=%r thread=%s",
            user,
            text[:50],
            thread,
        )
        await say(
            text=f"Foreman received: {text[:50]}... (orchestration not yet wired)",
            thread_ts=thread,
        )


def create_runtime(settings: ForemanSettings) -> ForemanRuntime:
    """Create a ForemanRuntime instance."""
    return ForemanRuntime(settings=settings)


def create_app(runtime: ForemanRuntime):
    """Create and configure the Slack Bolt app."""
    from slack_bolt.async_app import AsyncApp

    app = AsyncApp(token=runtime.settings.bot_token)

    @app.event("message")
    async def handle_message(event, say, client):
        await runtime.handle_message(event, say, client)

    return app


async def main() -> None:
    """Main entry point for the Foreman bot."""
    from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

    settings = ForemanSettings.from_env()
    runtime = create_runtime(settings)
    app = create_app(runtime)
    await runtime.log_startup_auth_identity(app)

    handler = AsyncSocketModeHandler(app, settings.app_token)
    logger.info(
        "Foreman bot started (Socket Mode) - listening to %s, excluded: %s, dry_run=%s",
        settings.foreman_channel,
        settings.excluded_channels,
        settings.dry_run,
    )
    await handler.start_async()


if __name__ == "__main__":
    asyncio.run(main())
