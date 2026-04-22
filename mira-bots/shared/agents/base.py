"""MIRA Agent Orchestrator — generic detect→act→verify→escalate loop.

Every autonomous agent inherits from MIRAAgent and implements 4 methods.
The orchestrator handles scheduling, logging, error recovery, and ntfy alerts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger("mira-agents")

AGENT_LOG_DIR = Path(os.getenv("AGENT_LOG_DIR", "/opt/mira/data/agent-runs"))
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "mira-factorylm-alerts")


@dataclass
class AgentIssue:
    """Something the agent detected that needs action."""

    id: str
    category: str
    description: str
    severity: str = "medium"  # low, medium, high, critical
    data: dict = field(default_factory=dict)


@dataclass
class AgentResult:
    """Result of an agent taking action on an issue."""

    issue_id: str
    action_taken: str
    success: bool
    details: str = ""
    data: dict = field(default_factory=dict)


@dataclass
class AgentRunReport:
    """Summary of one complete agent run."""

    agent_name: str
    started_at: str
    finished_at: str
    duration_seconds: float
    issues_detected: int
    actions_taken: int
    actions_succeeded: int
    actions_failed: int
    escalations: int
    details: list[dict] = field(default_factory=list)


class MIRAAgent(ABC):
    """Base class for all autonomous MIRA agents."""

    name: str = "unnamed_agent"
    description: str = ""
    max_issues_per_run: int = 10  # safety cap
    timeout_seconds: int = 300  # 5 min default

    def __init__(self) -> None:
        AGENT_LOG_DIR.mkdir(parents=True, exist_ok=True)

    @abstractmethod
    async def detect(self) -> list[AgentIssue]:
        """Find issues that need action. Returns list of AgentIssue."""
        ...

    @abstractmethod
    async def act(self, issue: AgentIssue) -> AgentResult:
        """Take action on a single issue. Returns AgentResult."""
        ...

    @abstractmethod
    async def verify(self, result: AgentResult) -> bool:
        """Verify the action worked. Returns True if successful."""
        ...

    async def escalate(self, issue: AgentIssue, result: AgentResult) -> None:
        """Alert Mike via ntfy when verification fails."""
        try:
            msg = (
                f"Agent: {self.name}\n"
                f"Issue: {issue.description}\n"
                f"Action: {result.action_taken}\n"
                f"Result: {result.details}"
            )
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"https://ntfy.sh/{NTFY_TOPIC}",
                    content=msg.encode(),
                    headers={
                        "Title": f"Agent Alert: {self.name}",
                        "Priority": "high" if issue.severity in ("high", "critical") else "default",
                        "Tags": "robot_face,warning",
                    },
                )
        except Exception as e:
            logger.error("AGENT_ESCALATE_FAIL agent=%s error=%s", self.name, str(e)[:100])

    async def run(self) -> AgentRunReport:
        """Execute one complete agent cycle: detect → act → verify → escalate."""
        start = time.time()
        started_at = datetime.now(timezone.utc).isoformat()

        report = AgentRunReport(
            agent_name=self.name,
            started_at=started_at,
            finished_at="",
            duration_seconds=0,
            issues_detected=0,
            actions_taken=0,
            actions_succeeded=0,
            actions_failed=0,
            escalations=0,
        )

        try:
            issues = await asyncio.wait_for(self.detect(), timeout=self.timeout_seconds)
            issues = issues[: self.max_issues_per_run]  # safety cap
            report.issues_detected = len(issues)

            if not issues:
                logger.info("AGENT_RUN agent=%s issues=0 (nothing to do)", self.name)
                report.finished_at = datetime.now(timezone.utc).isoformat()
                report.duration_seconds = time.time() - start
                self._save_report(report)
                return report

            for issue in issues:
                try:
                    result = await asyncio.wait_for(
                        self.act(issue), timeout=self.timeout_seconds
                    )
                    report.actions_taken += 1

                    verified = await asyncio.wait_for(self.verify(result), timeout=60)

                    if verified:
                        report.actions_succeeded += 1
                        report.details.append(
                            {
                                "issue": issue.description,
                                "action": result.action_taken,
                                "status": "success",
                            }
                        )
                    else:
                        report.actions_failed += 1
                        report.escalations += 1
                        await self.escalate(issue, result)
                        report.details.append(
                            {
                                "issue": issue.description,
                                "action": result.action_taken,
                                "status": "failed_escalated",
                                "details": result.details,
                            }
                        )

                except asyncio.TimeoutError:
                    report.actions_failed += 1
                    logger.warning("AGENT_TIMEOUT agent=%s issue=%s", self.name, issue.id)
                except Exception as e:
                    report.actions_failed += 1
                    logger.error(
                        "AGENT_ERROR agent=%s issue=%s error=%s",
                        self.name,
                        issue.id,
                        str(e)[:200],
                    )

        except asyncio.TimeoutError:
            logger.error("AGENT_DETECT_TIMEOUT agent=%s", self.name)
        except Exception as e:
            logger.error("AGENT_DETECT_ERROR agent=%s error=%s", self.name, str(e)[:200])

        report.finished_at = datetime.now(timezone.utc).isoformat()
        report.duration_seconds = round(time.time() - start, 1)

        logger.info(
            "AGENT_RUN agent=%s detected=%d acted=%d succeeded=%d failed=%d escalated=%d duration=%.1fs",
            self.name,
            report.issues_detected,
            report.actions_taken,
            report.actions_succeeded,
            report.actions_failed,
            report.escalations,
            report.duration_seconds,
        )

        self._save_report(report)
        if report.actions_taken > 0:
            await self._send_summary(report)

        return report

    def _save_report(self, report: AgentRunReport) -> None:
        try:
            log_file = AGENT_LOG_DIR / f"{self.name}.ndjson"
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(
                    json.dumps(
                        {
                            "agent": report.agent_name,
                            "started": report.started_at,
                            "finished": report.finished_at,
                            "duration_s": report.duration_seconds,
                            "detected": report.issues_detected,
                            "succeeded": report.actions_succeeded,
                            "failed": report.actions_failed,
                            "escalated": report.escalations,
                            "details": report.details,
                        },
                        default=str,
                    )
                    + "\n"
                )
        except Exception:
            pass

    async def _send_summary(self, report: AgentRunReport) -> None:
        if report.actions_succeeded == 0 and report.actions_failed == 0:
            return

        emoji = "✅" if report.actions_failed == 0 else "⚠️"
        msg = f"{emoji} {self.name}: {report.actions_succeeded} succeeded"
        if report.actions_failed > 0:
            msg += f", {report.actions_failed} failed"
        if report.details:
            top = report.details[0]
            msg += f"\nTop: {top.get('issue', '')[:80]}"

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"https://ntfy.sh/{NTFY_TOPIC}",
                    content=msg.encode(),
                    headers={
                        "Title": f"Agent: {self.name}",
                        "Priority": "low" if report.actions_failed == 0 else "default",
                        "Tags": "robot_face",
                    },
                )
        except Exception:
            pass
