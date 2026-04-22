"""Infrastructure Guardian Agent — detects VPS service health failures, self-heals.

detect(): hit health endpoints for all critical services; return issues for any unhealthy.
act():    restart the failed container via `docker compose restart`.
verify(): re-hit the health endpoint after restart — True if 200 OK.

Runs on the VPS (via cron) so docker commands are local, not SSH.
COMPOSE_FILE env var overrides the docker-compose file path.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

from .base import AgentIssue, AgentResult, MIRAAgent

logger = logging.getLogger("mira-agents")

COMPOSE_FILE = os.getenv("COMPOSE_FILE", "/opt/mira/docker-compose.saas.yml")

# Services to monitor: name, container, health URL (from host)
_SERVICES: list[dict] = [
    {
        "name": "mira-pipeline",
        "container": "mira-pipeline-saas",
        "health_url": "http://localhost:9099/health",
        "severity": "critical",
    },
    {
        "name": "mira-ingest",
        "container": "mira-ingest-saas",
        "health_url": "http://localhost:8001/health",
        "severity": "high",
    },
    {
        "name": "mira-core",
        "container": "mira-core-saas",
        "health_url": "http://localhost:8080/health",
        "severity": "high",
    },
    {
        "name": "mira-mcp",
        "container": "mira-mcp-saas",
        "health_url": "http://localhost:8001/health",  # mcp shares ingest port on :8001
        "severity": "medium",
    },
]


class InfraGuardianAgent(MIRAAgent):
    name = "infra_guardian"
    description = "Monitors VPS service health, auto-restarts failed containers"
    max_issues_per_run = 5
    timeout_seconds = 120

    async def detect(self) -> list[AgentIssue]:
        issues: list[AgentIssue] = []
        async with httpx.AsyncClient(timeout=5) as client:
            for svc in _SERVICES:
                try:
                    resp = await client.get(svc["health_url"])
                    if resp.status_code >= 400:
                        issues.append(
                            AgentIssue(
                                id=f"health_{svc['name']}",
                                category="service_health",
                                description=f"{svc['name']} returned HTTP {resp.status_code}",
                                severity=svc["severity"],
                                data=svc,
                            )
                        )
                    else:
                        logger.debug("GUARDIAN %s healthy (%d)", svc["name"], resp.status_code)
                except Exception as exc:
                    issues.append(
                        AgentIssue(
                            id=f"health_{svc['name']}",
                            category="service_health",
                            description=f"{svc['name']} unreachable: {type(exc).__name__}",
                            severity=svc["severity"],
                            data=svc,
                        )
                    )

        if issues:
            logger.warning(
                "GUARDIAN detected %d unhealthy service(s): %s",
                len(issues),
                [i.id for i in issues],
            )
        return issues

    async def act(self, issue: AgentIssue) -> AgentResult:
        container = issue.data.get("container", "")
        health_url = issue.data.get("health_url", "")

        if not container:
            return AgentResult(
                issue_id=issue.id,
                action_taken="skip — no container name",
                success=False,
                details="container name missing from issue data",
            )

        logger.info("GUARDIAN restarting %s (container: %s)", issue.data["name"], container)
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker",
                "compose",
                "-f",
                COMPOSE_FILE,
                "restart",
                container,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)

            if proc.returncode != 0:
                return AgentResult(
                    issue_id=issue.id,
                    action_taken=f"docker compose restart {container}",
                    success=False,
                    details=stderr.decode()[:300],
                )

            # Give the container time to start before verify()
            await asyncio.sleep(15)

            return AgentResult(
                issue_id=issue.id,
                action_taken=f"Restarted {container}",
                success=True,
                details=f"Restarted {container}, waiting for health check",
                data={"health_url": health_url, "container": container},
            )

        except asyncio.TimeoutError:
            return AgentResult(
                issue_id=issue.id,
                action_taken=f"docker compose restart {container}",
                success=False,
                details="docker restart timed out after 60s",
            )
        except Exception as exc:
            return AgentResult(
                issue_id=issue.id,
                action_taken=f"docker compose restart {container}",
                success=False,
                details=str(exc)[:200],
            )

    async def verify(self, result: AgentResult) -> bool:
        health_url = result.data.get("health_url", "")
        if not health_url:
            return result.success

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(health_url)
                ok = resp.status_code < 400
                logger.info(
                    "GUARDIAN verify %s → HTTP %d (%s)",
                    result.data.get("container", "?"),
                    resp.status_code,
                    "healthy" if ok else "still unhealthy",
                )
                return ok
        except Exception as exc:
            logger.warning("GUARDIAN verify request failed: %s", exc)
            return False
