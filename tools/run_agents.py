#!/usr/bin/env python3
"""Run MIRA autonomous agents.

Usage:
  python3 tools/run_agents.py                         # run all agents once
  python3 tools/run_agents.py --agent infra_guardian  # run one agent once
  python3 tools/run_agents.py --daemon                # run on schedule forever

Schedules (daemon mode):
  infra_guardian:   every 15 min
  kb_builder:       every 2 hours
  prompt_optimizer: every 24 hours
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Repo root → mira-bots on sys.path so `shared.*` imports resolve
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mira-bots"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("run-agents")


def _build_registry() -> dict[str, tuple]:
    """Return {name: (agent_instance, interval_minutes)}."""
    from shared.agents.infra_guardian import InfraGuardianAgent
    from shared.agents.kb_builder import KBBuilderAgent
    from shared.agents.prompt_optimizer import PromptOptimizerAgent

    return {
        "infra_guardian": (InfraGuardianAgent(), 15),
        "kb_builder": (KBBuilderAgent(), 120),
        "prompt_optimizer": (PromptOptimizerAgent(), 60 * 24),
    }


async def run_all_once(registry: dict) -> None:
    for name, (agent, _) in registry.items():
        logger.info("Running %s...", name)
        try:
            report = await agent.run()
            logger.info(
                "  %s: detected=%d succeeded=%d failed=%d escalated=%d (%.1fs)",
                name,
                report.issues_detected,
                report.actions_succeeded,
                report.actions_failed,
                report.escalations,
                report.duration_seconds,
            )
        except Exception as exc:
            logger.error("  %s failed: %s", name, exc)


async def run_one_once(registry: dict, agent_name: str) -> None:
    agent, _ = registry[agent_name]
    report = await agent.run()
    print(
        f"{agent_name}: detected={report.issues_detected} "
        f"succeeded={report.actions_succeeded} "
        f"failed={report.actions_failed} "
        f"escalated={report.escalations} "
        f"duration={report.duration_seconds}s"
    )


async def run_daemon(registry: dict) -> None:
    from shared.agents.runner import AgentRunner

    runner = AgentRunner()
    for name, (agent, interval) in registry.items():
        runner.register(agent, interval)
        logger.info("Registered %s (every %d min)", name, interval)
    await runner.run_forever()


def main() -> int:
    parser = argparse.ArgumentParser(description="MIRA autonomous agent runner")
    parser.add_argument(
        "--agent",
        choices=["kb_builder", "prompt_optimizer", "infra_guardian"],
        help="Run a single agent once",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run all agents on their schedules forever",
    )
    args = parser.parse_args()

    try:
        registry = _build_registry()
    except ImportError as exc:
        logger.error("Failed to import agents: %s", exc)
        return 1

    if args.daemon:
        asyncio.run(run_daemon(registry))
    elif args.agent:
        asyncio.run(run_one_once(registry, args.agent))
    else:
        asyncio.run(run_all_once(registry))

    return 0


if __name__ == "__main__":
    sys.exit(main())
