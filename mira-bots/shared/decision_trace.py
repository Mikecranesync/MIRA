"""Decision-trace writer — the clinical record of every grounded turn (Phase 9).

After MIRA answers a troubleshooting turn, this writes one `decision_traces`
row (Hub migration 032) tying together what the engine actually used: the
resolved UNS context (path / source / confidence), the tag / manual / KG
evidence consulted, the recommendation given, whether a citation was present,
and the outcome. It is the durable groundedness audit the master plan (D5) and
THEORY_OF_OPERATIONS Invariant #6 require — distinct from benchmark_db
(regression eval) and conversation_logger (per-turn review digest).

Design constraints (mirror conversation_logger.py — the established precedent):

- **Fail-open. ALWAYS.** A trace-write failure (NeonDB down, env unset, schema
  drift) must NEVER block, delay, or fail the user reply. Every error is caught
  and logged, never raised. This module is observational, not load-bearing.
- **Event loop never blocked.** The INSERT is offloaded to a worker thread via
  run_in_executor; a 2s timeout caps it. The reply has already been returned to
  the caller by the time this runs (the engine schedules it after the turn).
- **PII-sanitised.** user_question + recommendation go through
  InferenceRouter.sanitize_text (IP/MAC/SN scrub) — same contract as 031_audit
  and conversation_logger.
- **Lazy imports.** sqlalchemy imported inside the worker so bot containers
  without it still boot.

The row assembly (`build_trace_row`) is a pure function so the evidence-shaping
logic is unit-tested without a live NeonDB.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger("mira-gsd.decision_trace")

# Same citation token the RAG worker / citation_compliance use. Inlined (not
# imported from rag_worker) to keep this module dependency-light and importable
# by offline tests — same precedent as conversation_logger._sanitize.
_CITATION_TAG_RE = re.compile(r"\[Source:[^\]]+\]", re.IGNORECASE)

_TIMEOUT_SECONDS = 2

_INSERT_SQL = """
INSERT INTO decision_traces (
    tenant_id, session_id, platform, uns_path, user_question,
    tag_evidence, manual_evidence, kg_evidence, recommendation,
    citations_present, technician_confirmed, outcome, model_used, latency_ms
) VALUES (
    CAST(:tenant_id AS UUID),
    CAST(:session_id AS UUID),
    :platform,
    CAST(:uns_path AS LTREE),
    :user_question,
    CAST(:tag_evidence AS JSONB),
    CAST(:manual_evidence AS JSONB),
    CAST(:kg_evidence AS JSONB),
    :recommendation,
    :citations_present,
    :technician_confirmed,
    :outcome,
    :model_used,
    :latency_ms
)
"""


def citations_present_in(reply: Optional[str]) -> bool:
    """True iff the reply carries at least one ``[Source: ...]`` citation."""
    return bool(_CITATION_TAG_RE.search(reply or ""))


def _sanitize(text: Optional[str]) -> str:
    """Apply the cascade PII sanitiser; passthrough on any failure."""
    if not text:
        return ""
    try:
        from .inference.router import InferenceRouter

        return InferenceRouter.sanitize_text(text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("sanitize_text fallback (passthrough): %s", exc)
        return text


def _manual_evidence_from_sources(sources: Optional[list]) -> list[dict[str, Any]]:
    """Shape RAG source chunks into the manual_evidence JSONB shape.

    The engine exposes retrieved chunks as a list of strings
    (rag_worker._last_sources). We store a bounded, sanitised excerpt per chunk
    so the trace is self-describing without re-querying the KB.
    """
    out: list[dict[str, Any]] = []
    for i, src in enumerate(sources or []):
        if isinstance(src, dict):
            out.append(
                {
                    "chunk_id": src.get("chunk_id") or src.get("id"),
                    "doc": src.get("doc") or src.get("source"),
                    "page": src.get("page"),
                    "score": src.get("score"),
                }
            )
        else:
            out.append({"rank": i, "excerpt": _sanitize(str(src))[:300]})
        if len(out) >= 5:  # bound the payload
            break
    return out


def build_trace_row(
    *,
    tenant_id: str,
    user_question: str,
    recommendation: str,
    platform: Optional[str] = None,
    uns_context: Optional[dict] = None,
    session_id: Optional[str] = None,
    tag_evidence: Optional[list] = None,
    manual_sources: Optional[list] = None,
    kg_evidence: Optional[list] = None,
    technician_confirmed: Optional[bool] = None,
    outcome: Optional[str] = None,
    model_used: Optional[str] = None,
    latency_ms: Optional[int] = None,
) -> dict[str, Any]:
    """Assemble the decision_traces row from engine-turn inputs (pure).

    uns_context is state["context"]["uns_context"] — we pull path / source /
    confidence from it. Evidence lists are stored as-is (tag/kg) or shaped
    (manual). citations_present is derived from the recommendation text.
    """
    import json

    ctx = uns_context or {}
    uns_path = ctx.get("uns_path") or ctx.get("path") or None

    return {
        "tenant_id": tenant_id,
        "session_id": session_id,
        "platform": platform,
        "uns_path": uns_path,
        "user_question": _sanitize(user_question),
        "tag_evidence": json.dumps(tag_evidence or []),
        "manual_evidence": json.dumps(_manual_evidence_from_sources(manual_sources)),
        "kg_evidence": json.dumps(kg_evidence or []),
        "recommendation": _sanitize(recommendation),
        "citations_present": citations_present_in(recommendation),
        "technician_confirmed": technician_confirmed,
        "outcome": outcome,
        "model_used": model_used,
        "latency_ms": latency_ms,
        # Carried for callers/tests; not a DB column.
        "_uns_source": ctx.get("source"),
        "_uns_confidence": ctx.get("confidence"),
    }


async def write_trace(**kwargs: Any) -> None:
    """Write one decision_traces row. NEVER raises; bounded latency.

    Accepts the same kwargs as build_trace_row. Returns immediately (no-op) if
    NEON_DATABASE_URL is unset — trace storage is simply disabled then, exactly
    like conversation_logger.
    """
    try:
        row = build_trace_row(**kwargs)
        await _insert(row)
    except Exception as exc:  # noqa: BLE001
        # Fail-open: an observational write must not propagate to the reply path.
        logger.warning("decision_trace insert skipped: %s", exc)


async def _insert(row: dict[str, Any]) -> None:
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return  # trace storage disabled — no warning spam
    if not row.get("tenant_id"):
        logger.debug("decision_trace skipped: no tenant_id")
        return

    import asyncio

    db_row = {k: v for k, v in row.items() if not k.startswith("_")}

    def _run() -> None:
        from sqlalchemy import create_engine
        from sqlalchemy import text as sql_text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            # RLS tenant binding — same dual-setting form the table policy reads.
            conn.execute(
                sql_text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": db_row["tenant_id"]},
            )
            conn.execute(sql_text(_INSERT_SQL), db_row)
            conn.commit()

    loop = asyncio.get_running_loop()
    await asyncio.wait_for(loop.run_in_executor(None, _run), timeout=_TIMEOUT_SECONDS)
