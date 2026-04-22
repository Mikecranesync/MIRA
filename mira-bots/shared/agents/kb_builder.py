"""KB Builder Agent — detects under-covered manufacturers, triggers documentation crawls.

detect(): query NeonDB for manufacturers with fewer than KB_MIN_CHUNKS_PER_MFR chunks.
act():    POST /ingest/scrape-trigger for each under-covered manufacturer.
verify(): success if the crawl job was accepted (not whether chunks landed — that
          takes minutes and will be detected by the next run).
"""

from __future__ import annotations

import logging
import os
import time

import httpx

from .base import AgentIssue, AgentResult, MIRAAgent

logger = logging.getLogger("mira-agents")

NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")
INGEST_SERVICE_URL = os.getenv("INGEST_SERVICE_URL", "http://localhost:8002")
MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
MIN_CHUNKS = int(os.getenv("KB_MIN_CHUNKS_PER_MFR", "5"))


class KBBuilderAgent(MIRAAgent):
    name = "kb_builder"
    description = "Finds under-covered manufacturers and triggers documentation crawls"
    max_issues_per_run = 3  # don't hammer the crawl API per run
    timeout_seconds = 120

    async def detect(self) -> list[AgentIssue]:
        if not NEON_DATABASE_URL:
            logger.info("KB_BUILDER skip: NEON_DATABASE_URL not set")
            return []

        try:
            from sqlalchemy import create_engine, text  # type: ignore[import]
            from sqlalchemy.pool import NullPool  # type: ignore[import]

            engine = create_engine(
                NEON_DATABASE_URL,
                poolclass=NullPool,
                connect_args={"sslmode": "require"},
                pool_pre_ping=True,
            )
            with engine.connect() as conn:
                rows = conn.execute(
                    text("""
                        SELECT manufacturer, COUNT(*) AS chunk_count
                        FROM knowledge_entries
                        WHERE tenant_id = :tid
                          AND manufacturer IS NOT NULL
                          AND manufacturer != ''
                        GROUP BY manufacturer
                        ORDER BY chunk_count ASC
                        LIMIT 20
                    """),
                    {"tid": MIRA_TENANT_ID},
                ).fetchall()

            issues = []
            for row in rows:
                mfr, count = row[0], int(row[1])
                if count < MIN_CHUNKS:
                    safe_id = mfr.lower().replace(" ", "_").replace("-", "_")
                    issues.append(
                        AgentIssue(
                            id=f"kb_coverage_{safe_id}",
                            category="kb_coverage",
                            description=f"{mfr}: {count} chunks (min {MIN_CHUNKS})",
                            severity="medium",
                            data={"manufacturer": mfr, "chunk_count": count},
                        )
                    )
            logger.info("KB_BUILDER detected %d under-covered manufacturers", len(issues))
            return issues

        except Exception as exc:
            logger.warning("KB_BUILDER detect failed: %s", exc)
            return []

    async def act(self, issue: AgentIssue) -> AgentResult:
        mfr = issue.data.get("manufacturer", "")
        job_id = f"agent_kb_{issue.id}_{int(time.time())}"

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{INGEST_SERVICE_URL}/ingest/scrape-trigger",
                    json={
                        "chat_id": job_id,
                        "manufacturer": mfr,
                        "model": "",
                        "use_firecrawl": True,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            return AgentResult(
                issue_id=issue.id,
                action_taken=f"Triggered crawl for {mfr}",
                success=True,
                details=f"job_id={data.get('job_id', job_id)}",
                data=data,
            )

        except Exception as exc:
            return AgentResult(
                issue_id=issue.id,
                action_taken=f"Trigger crawl for {mfr}",
                success=False,
                details=str(exc)[:200],
            )

    async def verify(self, result: AgentResult) -> bool:
        # Crawls are async — verification means the job was accepted, not that
        # chunks have landed. A future detect() run catches if coverage stayed low.
        return result.success
