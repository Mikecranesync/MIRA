"""Agent runner — executes agents on their schedules."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger("mira-agents")


class AgentRunner:
    """Runs a set of agents, each with their own schedule."""

    def __init__(self) -> None:
        self.agents: list[dict] = []

    def register(self, agent: object, interval_minutes: int) -> None:
        """Register an agent with a run interval in minutes."""
        self.agents.append(
            {
                "agent": agent,
                "interval": interval_minutes * 60,
                "last_run": 0,
            }
        )

    async def run_once(self) -> None:
        """Run all agents whose interval has elapsed."""
        now = datetime.now(timezone.utc).timestamp()
        for entry in self.agents:
            if now - entry["last_run"] >= entry["interval"]:
                try:
                    await entry["agent"].run()
                    entry["last_run"] = now
                except Exception as e:
                    logger.error(
                        "RUNNER_ERROR agent=%s error=%s",
                        entry["agent"].name,
                        str(e)[:200],
                    )

    async def run_forever(self, check_interval: int = 60) -> None:
        """Main loop — checks every minute which agents need to run."""
        logger.info("AGENT_RUNNER starting with %d agents", len(self.agents))
        while True:
            await self.run_once()
            await asyncio.sleep(check_interval)
