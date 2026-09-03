#!/usr/bin/env python3
"""FactoryLM Foreman - Slack bot for fleet orchestration via Grok + Fleet Gateway MCP.

Architecture:
  Mike → Slack (#factorylm-foreman) → FactoryLM Foreman (this bot)
  → Grok (Cursor cloud agent with cursor-grok-4.6 model)
  → Fleet Gateway MCP (launch_worker, fleet_status, etc.)
  → Response posted back to Slack as FactoryLM Foreman

Critical safety: ALL bot messages (including Foreman's own) are rejected BEFORE
invoking the cloud agent, preventing infinite loops.
"""

import asyncio
import logging
import os
import sys
from typing import Any, Optional

from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

try:
    from cursor_sdk import Agent, CloudAgentOptions
except ImportError:
    print("ERROR: cursor-sdk not installed. Run: pip install cursor-sdk", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("foreman")


class ForemanConfig:
    """Configuration for FactoryLM Foreman bot."""

    def __init__(self) -> None:
        # Slack credentials
        self.slack_bot_token = os.environ.get("FOREMAN_SLACK_BOT_TOKEN", "")
        self.slack_app_token = os.environ.get("FOREMAN_SLACK_APP_TOKEN", "")

        # Cursor API key for launching cloud agents
        self.cursor_api_key = os.environ.get("CURSOR_API_KEY", "")

        # Target repository for cloud agents
        self.repo_url = os.environ.get(
            "FOREMAN_REPO_URL", "https://github.com/Mikecranesync/MIRA"
        )
        self.repo_branch = os.environ.get("FOREMAN_REPO_BRANCH", "main")

        # Grok model to use
        self.grok_model = os.environ.get("FOREMAN_GROK_MODEL", "cursor-grok-4.6-medium")

        # Allowed channel (only respond in this channel)
        self.allowed_channel = os.environ.get("FOREMAN_ALLOWED_CHANNEL", "C0BTXHXBKML")

        # Fleet Gateway MCP URL
        self.fleet_gateway_url = os.environ.get(
            "FLEET_GATEWAY_MCP_URL",
            "https://ultra-manufacturers-goat-enquiries.trycloudflare.com/mcp",
        )

        # Fleet Gateway bearer token
        self.fleet_gateway_token = os.environ.get("FLEET_GATEWAY_TOKEN", "")

        # Bot's own user ID (filled at runtime after auth_test)
        self.bot_user_id: str = ""

    def validate(self) -> list[str]:
        """Validate required configuration. Returns list of errors."""
        errors = []
        if not self.slack_bot_token:
            errors.append("FOREMAN_SLACK_BOT_TOKEN is required")
        if not self.slack_app_token:
            errors.append("FOREMAN_SLACK_APP_TOKEN is required")
        if not self.cursor_api_key:
            errors.append("CURSOR_API_KEY is required")
        if not self.fleet_gateway_token:
            errors.append("FLEET_GATEWAY_TOKEN is required")
        return errors


class ForemanBot:
    """FactoryLM Foreman bot implementation."""

    def __init__(self, config: ForemanConfig) -> None:
        self.config = config
        self.app = AsyncApp(token=config.slack_bot_token)
        self.seen_events: set[str] = set()

        # Register event handlers
        self.app.event("message")(self.handle_message)

    async def initialize(self) -> None:
        """Initialize bot: fetch bot_user_id and log identity."""
        try:
            auth_resp = await self.app.client.auth_test()
            self.config.bot_user_id = auth_resp.get("user_id", "")
            bot_id = auth_resp.get("bot_id", "")
            team = auth_resp.get("team", "")
            logger.info(
                "✓ FactoryLM Foreman authenticated: user_id=%s bot_id=%s team=%s",
                self.config.bot_user_id,
                bot_id,
                team,
            )
        except Exception as exc:
            logger.error("✗ Failed to authenticate Foreman bot: %s", exc)
            raise

    def _is_bot_message(self, event: dict[str, Any]) -> bool:
        """Return True if this event is from ANY bot (including Foreman itself).

        This is the CRITICAL SAFETY GATE. ALL bot messages must be rejected
        BEFORE invoking the cloud agent to prevent infinite loops.

        Detection criteria:
        1. event["bot_id"] is present (Slack bot messages)
        2. event["user"] matches our bot_user_id
        3. event["subtype"] in {"bot_message", "message_changed", "message_deleted"}
        """
        # Check 1: Explicit bot_id field
        if event.get("bot_id"):
            logger.debug(
                "Rejecting bot message (bot_id=%s) ts=%s",
                event.get("bot_id"),
                event.get("ts"),
            )
            return True

        # Check 2: Message from Foreman's own user_id
        if event.get("user") == self.config.bot_user_id:
            logger.debug(
                "Rejecting own message (user=%s) ts=%s",
                event.get("user"),
                event.get("ts"),
            )
            return True

        # Check 3: Bot message subtypes
        if event.get("subtype") in {"bot_message", "message_changed", "message_deleted"}:
            logger.debug(
                "Rejecting subtype=%s ts=%s",
                event.get("subtype"),
                event.get("ts"),
            )
            return True

        return False

    async def handle_message(self, event: dict[str, Any], say: Any) -> None:
        """Handle incoming Slack messages.

        Flow:
        1. Deduplicate (ts-based)
        2. REJECT ALL BOT MESSAGES (safety gate)
        3. Check channel allowlist
        4. Launch Grok cloud agent with fleet-gateway MCP
        5. Post response
        """
        ts = event.get("ts", "")
        if not ts:
            return

        # Dedupe
        if ts in self.seen_events:
            logger.debug("Ignoring duplicate event ts=%s", ts)
            return
        self.seen_events.add(ts)
        if len(self.seen_events) > 500:
            self.seen_events.clear()

        # SAFETY: Reject ALL bot messages BEFORE invoking Grok
        if self._is_bot_message(event):
            logger.info(
                "✓ Pre-Grok safety gate: rejected bot message ts=%s channel=%s",
                ts,
                event.get("channel"),
            )
            return

        # Channel filtering
        channel = event.get("channel", "")
        if self.config.allowed_channel and channel != self.config.allowed_channel:
            logger.debug(
                "Ignoring message in non-allowed channel=%s (allowed=%s)",
                channel,
                self.config.allowed_channel,
            )
            return

        # Extract text
        text = event.get("text", "").strip()
        if not text:
            logger.debug("Ignoring empty message ts=%s", ts)
            return

        thread_ts = event.get("thread_ts", ts)
        user = event.get("user", "unknown")

        logger.info(
            "→ Foreman received: channel=%s user=%s thread=%s text=%r",
            channel,
            user,
            thread_ts,
            text[:100],
        )

        # Invoke Grok via Cursor cloud agent
        try:
            response_text = await self._invoke_grok(text, user)
        except Exception as exc:
            logger.error("Grok invocation failed: %s", exc, exc_info=True)
            response_text = f"⚠️ Foreman error: {exc}"

        # Post response
        await say(text=response_text, thread_ts=thread_ts)
        logger.info("← Foreman posted response: %d chars", len(response_text))

    async def _invoke_grok(self, prompt: str, user_id: str) -> str:
        """Launch a Cursor cloud agent with Grok model and fleet-gateway MCP.

        Args:
            prompt: User's message
            user_id: Slack user ID (for logging/attribution)

        Returns:
            Agent's final response text
        """
        logger.info("Launching Grok cloud agent: model=%s", self.config.grok_model)

        # Prepare MCP server config for fleet-gateway
        mcp_servers: list[dict[str, Any]] = []
        if self.config.fleet_gateway_url and self.config.fleet_gateway_token:
            mcp_servers.append(
                {
                    "name": "fleet-gateway",
                    "type": "http",
                    "url": self.config.fleet_gateway_url,
                    "headers": [
                        {"name": "Authorization", "value": f"Bearer {self.config.fleet_gateway_token}"}
                    ],
                }
            )
            logger.debug("Fleet Gateway MCP configured: url=%s", self.config.fleet_gateway_url)
        else:
            logger.warning("Fleet Gateway MCP not configured (missing URL or token)")

        # Launch cloud agent
        cloud_options = CloudAgentOptions(
            repos=[
                {
                    "url": self.config.repo_url,
                    "startingRef": self.config.repo_branch,
                }
            ],
            mcpServers=mcp_servers if mcp_servers else None,
        )

        try:
            async with Agent.create(
                api_key=self.config.cursor_api_key,
                model=self.config.grok_model,
                cloud=cloud_options,
            ) as agent:
                logger.info("Cloud agent created: agent_id=%s", agent.agent_id)

                # Send prompt and wait for response
                run = agent.send(prompt)
                logger.info("Run started: run_id=%s", run.run_id)

                # Wait for completion
                result = run.wait()
                response_text = result.result or "(no response)"

                logger.info(
                    "Run completed: run_id=%s status=%s",
                    run.run_id,
                    result.status,
                )

                return response_text

        except Exception as exc:
            logger.error("Agent execution failed: %s", exc, exc_info=True)
            raise


async def main() -> None:
    """Main entry point."""
    config = ForemanConfig()

    # Validate configuration
    errors = config.validate()
    if errors:
        for error in errors:
            logger.error("Configuration error: %s", error)
        sys.exit(1)

    logger.info("✓ Configuration validated")

    # Create bot
    bot = ForemanBot(config)

    # Initialize (fetch bot_user_id)
    await bot.initialize()

    # Log startup
    logger.info("=" * 70)
    logger.info("FactoryLM Foreman started")
    logger.info("  Model: %s", config.grok_model)
    logger.info("  Channel: %s", config.allowed_channel)
    logger.info("  Repo: %s@%s", config.repo_url, config.repo_branch)
    logger.info("  Fleet Gateway: %s", config.fleet_gateway_url)
    logger.info("  Bot User ID: %s", config.bot_user_id)
    logger.info("=" * 70)

    # Start Socket Mode handler
    handler = AsyncSocketModeHandler(bot.app, config.slack_app_token)
    await handler.start_async()


if __name__ == "__main__":
    asyncio.run(main())
