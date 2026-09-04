#!/usr/bin/env python3
"""FactoryLM Foreman - Slack bot for fleet orchestration via Grok + Fleet Gateway MCP.

Architecture:
  Mike → Slack (#factorylm-foreman) → FactoryLM Foreman (this bot)
  → Grok (Cursor cloud agent with grok-4.6 model)
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

from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
from slack_bolt.async_app import AsyncApp
from specialists import render_roster, routing_card_enabled

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("foreman")

try:
    from cursor_sdk import (
        Agent,
        AgentOptions,
        CloudAgentOptions,
        CloudRepository,
        HttpMcpServerConfig,
    )
except ImportError:
    logger.error("cursor-sdk not installed. Run: pip install cursor-sdk")
    sys.exit(1)

# Live-proven Cursor model id (FLEET-SLACK-IDENTITY, 2026-09-04). The
# `cursor-grok-4.6-medium` slug is rejected by Agent.create.
DEFAULT_GROK_MODEL = "grok-4.6"


class ForemanConfig:
    """Configuration for FactoryLM Foreman bot."""

    def __init__(self) -> None:
        # Slack credentials
        # Prefer FOREMAN_BOT_SLACK_TOKEN (Doppler name), fall back to FOREMAN_SLACK_BOT_TOKEN
        self.slack_bot_token = os.environ.get(
            "FOREMAN_BOT_SLACK_TOKEN", os.environ.get("FOREMAN_SLACK_BOT_TOKEN", "")
        )
        self.slack_app_token = os.environ.get("FOREMAN_SLACK_APP_TOKEN", "")

        # Cursor API key for launching cloud agents
        # Prefer CURSOR_API_KEY, fall back to CURSOR_API (current Doppler name)
        self.cursor_api_key = os.environ.get("CURSOR_API_KEY", os.environ.get("CURSOR_API", ""))

        # Target repository for cloud agents
        self.repo_url = os.environ.get("FOREMAN_REPO_URL", "https://github.com/Mikecranesync/MIRA")
        self.repo_branch = os.environ.get("FOREMAN_REPO_BRANCH", "main")

        # Grok model to use. Override with FOREMAN_GROK_MODEL; default is the
        # live-proven Cursor id, not the `cursor-grok-4.6-*` slug.
        self.grok_model = os.environ.get("FOREMAN_GROK_MODEL", DEFAULT_GROK_MODEL)

        # Allowed channel (only respond in this channel)
        self.allowed_channel = os.environ.get("FOREMAN_ALLOWED_CHANNEL", "C0BTXHXBKML")

        # Fleet Gateway MCP URL
        self.fleet_gateway_url = os.environ.get(
            "FLEET_GATEWAY_MCP_URL",
            "https://ultra-manufacturers-goat-enquiries.trycloudflare.com/mcp",
        )

        # Fleet Gateway bearer token
        # Prefer FLEET_GATEWAY_TOKEN, fall back to FLEET_GATEWAY_BEARER (live Gateway worktree)
        self.fleet_gateway_token = os.environ.get(
            "FLEET_GATEWAY_TOKEN", os.environ.get("FLEET_GATEWAY_BEARER", "")
        )

        # Bot's own user ID (filled at runtime after auth_test)
        self.bot_user_id: str = ""

    def validate(self) -> list[str]:
        """Validate required configuration. Returns list of errors."""
        errors = []
        if not self.slack_bot_token:
            errors.append("FOREMAN_BOT_SLACK_TOKEN or FOREMAN_SLACK_BOT_TOKEN is required")
        if not self.slack_app_token:
            errors.append("FOREMAN_SLACK_APP_TOKEN is required")
        if not self.cursor_api_key:
            errors.append("CURSOR_API_KEY or CURSOR_API is required")
        if not self.fleet_gateway_token:
            errors.append("FLEET_GATEWAY_TOKEN or FLEET_GATEWAY_BEARER is required")
        return errors


def build_agent_options(config: ForemanConfig) -> AgentOptions:
    """Build the AgentOptions passed to Agent.create.

    Installed cursor-sdk (1.0.x) facts this encodes:
    - CloudAgentOptions.__init__ has no mcpServers / mcp_servers
      (TypeError: unexpected keyword argument).
    - Agent.create() has no mcp_servers keyword; MCP belongs on AgentOptions.
    - Bearer auth is HttpMcpServerConfig.headers, not a list of {name,value}.
    """
    mcp_servers: dict[str, Any] | None = None
    if config.fleet_gateway_url and config.fleet_gateway_token:
        mcp_servers = {
            "fleet-gateway": HttpMcpServerConfig(
                url=config.fleet_gateway_url,
                headers={
                    "Authorization": f"Bearer {config.fleet_gateway_token}",
                },
            )
        }
        logger.debug("Fleet Gateway MCP configured: url=%s", config.fleet_gateway_url)
    else:
        logger.warning("Fleet Gateway MCP not configured (missing URL or token)")

    return AgentOptions(
        api_key=config.cursor_api_key,
        model=config.grok_model,
        cloud=CloudAgentOptions(
            repos=[
                CloudRepository(
                    url=config.repo_url,
                    starting_ref=config.repo_branch,
                )
            ],
        ),
        mcp_servers=mcp_servers,
    )


class ForemanBot:
    """FactoryLM Foreman bot implementation."""

    def __init__(self, config: ForemanConfig) -> None:
        self.config = config
        self.app = AsyncApp(token=config.slack_bot_token)
        self.seen_events: set[str] = set()

        # Warm/persistent Grok session
        self._grok_agent: Optional[Any] = None
        self._agent_lock = asyncio.Lock()

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

    async def _ensure_agent_unlocked(self) -> Any:
        """Return the live warm agent. Caller must hold ``_agent_lock``."""
        if self._grok_agent is not None:
            try:
                _ = self._grok_agent.agent_id
                logger.debug("Reusing warm agent: %s", self._grok_agent.agent_id)
                return self._grok_agent
            except Exception as exc:
                logger.warning(
                    "Warm agent unhealthy (id=%s): %s — will recover",
                    getattr(self._grok_agent, "agent_id", "unknown"),
                    exc,
                )
                self._grok_agent = None

        logger.info("Creating Grok cloud agent: model=%s", self.config.grok_model)
        agent = await asyncio.to_thread(Agent.create, build_agent_options(self.config))
        logger.info("✓ Warm agent created: agent_id=%s", agent.agent_id)
        self._grok_agent = agent
        await self._brief_agent(agent)
        return agent

    async def _brief_agent(self, agent: Any) -> None:
        """Send the specialist routing card once, on a freshly created agent.

        Opt-in via FOREMAN_ROUTING_CARD; unset means this is a no-op and Foreman
        behaves exactly as it did before. Sent ONCE at creation rather than
        prepended to every message because the warm agent retains conversation
        context — re-sending it each turn would pay for it repeatedly and bury
        the user's actual message.

        Best-effort: a briefing failure must never cost Mike his message, so it
        is logged and swallowed. The agent then behaves as an unbriefed one.
        """
        if not routing_card_enabled():
            return
        try:
            card = render_roster()
        except Exception as exc:  # a malformed definition must not break Slack
            logger.error("Routing card failed to render: %s", exc, exc_info=True)
            return
        if not card:
            logger.warning("Routing card enabled but no specialist definitions found")
            return
        try:
            await asyncio.to_thread(self._send_and_wait, agent, card)
            logger.info("✓ Routing card sent to agent_id=%s", agent.agent_id)
        except Exception as exc:
            logger.error("Routing card send failed: %s", exc, exc_info=True)

    async def _ensure_agent(self) -> Any:
        """Ensure warm Grok agent exists, creating or recovering as needed.

        Returns the live agent. Thread-safe via _agent_lock.
        """
        async with self._agent_lock:
            return await self._ensure_agent_unlocked()

    @staticmethod
    def _send_and_wait(agent: Any, prompt: str) -> str:
        """Blocking Cursor SDK turn: send() through run.wait().

        Must run off the Slack asyncio loop (via ``asyncio.to_thread``).
        """
        run = agent.send(prompt)
        logger.info("Run started: run_id=%s agent=%s", run.run_id, agent.agent_id)
        result = run.wait()
        logger.info(
            "Run completed: run_id=%s status=%s",
            run.run_id,
            result.status,
        )
        return result.result or "(no response)"

    async def _invoke_grok(self, prompt: str, user_id: str) -> str:
        """Send prompt to warm Grok agent and return response.

        Reuses the persistent agent across messages. Agent retains conversation
        context. Each accepted Slack turn holds ``_agent_lock`` from send()
        through run.wait() so two concurrent handle_message calls cannot
        overlap on the same agent (live ``[agent_busy]`` race, 2026-09-04).
        Synchronous SDK calls run in a worker thread so Slack's event loop
        stays free.

        Args:
            prompt: User's message
            user_id: Slack user ID (for logging/attribution)

        Returns:
            Agent's final response text
        """
        async with self._agent_lock:
            agent = await self._ensure_agent_unlocked()
            try:
                return await asyncio.to_thread(self._send_and_wait, agent, prompt)
            except Exception as exc:
                logger.error("Agent execution failed: %s", exc, exc_info=True)
                if self._grok_agent is agent:
                    self._grok_agent = None
                raise

    async def shutdown(self) -> None:
        """Clean shutdown: tear down warm agent without leaking."""
        async with self._agent_lock:
            if self._grok_agent is not None:
                try:
                    logger.info("Shutting down warm agent: %s", self._grok_agent.agent_id)
                    # Cursor SDK agents are context managers; explicit close
                    if hasattr(self._grok_agent, "__aexit__"):
                        await self._grok_agent.__aexit__(None, None, None)
                    elif hasattr(self._grok_agent, "close"):
                        await self._grok_agent.close()
                    logger.info("✓ Warm agent shut down cleanly")
                except Exception as exc:
                    logger.warning("Agent shutdown error: %s", exc)
                finally:
                    self._grok_agent = None


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
    logger.info("FactoryLM Foreman started (warm session mode)")
    logger.info("  Model: %s", config.grok_model)
    logger.info("  Channel: %s", config.allowed_channel)
    logger.info("  Repo: %s@%s", config.repo_url, config.repo_branch)
    logger.info("  Fleet Gateway: %s", config.fleet_gateway_url)
    logger.info("  Bot User ID: %s", config.bot_user_id)
    logger.info("=" * 70)

    # Start Socket Mode handler
    handler = AsyncSocketModeHandler(bot.app, config.slack_app_token)

    try:
        await handler.start_async()
    finally:
        # Clean shutdown: tear down warm agent
        logger.info("Shutting down...")
        await bot.shutdown()
        logger.info("✓ Shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
