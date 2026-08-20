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
- **PII-sanitised.** user_question + recommendation, plus the context manifest's
  question field, go through InferenceRouter.sanitize_text (IP/MAC/SN scrub) —
  same contract as 031_audit and conversation_logger. The manifest hash is
  calculated from the exact privacy-safe projection that is stored.
- **Lazy imports.** sqlalchemy imported inside the worker so bot containers
  without it still boot.

The row assembly (`build_trace_row`) is a pure function so the evidence-shaping
logic is unit-tested without a live NeonDB.
"""

from __future__ import annotations

import hashlib
import json
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
    citations_present, technician_confirmed, outcome, model_used, latency_ms,
    context_manifest, context_manifest_sha256,
    provider, route_reason, principal,
    input_tokens, cached_input_tokens, output_tokens,
    cost_usd_estimate, tool_call_count, status
) VALUES (
    -- tenant_id is TEXT (migration 070): bot surfaces produce slug tenants
    -- ('staging', 'default', chat_tenant slugs), not UUIDs. A CAST here threw
    -- InvalidTextRepresentation and, because the write is fire-and-forget,
    -- silently dropped every staging trace (#3003). session_id stays UUID —
    -- it is a real FK to troubleshooting_sessions(id).
    :tenant_id,
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
    :latency_ms,
    -- WS1 / PRD G6 (migration 071): the privacy-safe TechnicianContext audit
    -- projection preserving the prompt's evidence, plus a sha256 over the exact
    -- canonical JSON stored here. NULL on turns taken with MIRA_CONTEXT_CONTRACT
    -- off — which also makes the column the adoption counter for the flag's
    -- promotion decision.
    CAST(:context_manifest AS JSONB),
    :context_manifest_sha256,
    -- ADR-0037 / P0003 Part B (migration 078): per-turn spend telemetry. Counts,
    -- identifiers and status only -- never prompt text, retrieved data, or any
    -- credential. NULL on turns that did not reach a provider.
    :provider,
    :route_reason,
    :principal,
    :input_tokens,
    :cached_input_tokens,
    :output_tokens,
    :cost_usd_estimate,
    :tool_call_count,
    :status
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


def _audit_manifest(context_manifest: Optional[dict]) -> tuple[dict[str, Any] | None, str | None]:
    """Return the safe manifest projection and hash that will reach storage.

    The engine carries one context object from prompt assembly to tracing so
    evidence is never re-derived at the audit boundary. Its question is not
    part of the prior-decision prompt projection, but it may contain operator
    PII; sanitize that one persistence-only field and hash the exact result.
    """
    carrier = context_manifest if isinstance(context_manifest, dict) else {}
    payload = carrier.get("manifest")
    if not isinstance(payload, dict):
        return None, None

    audit_payload = dict(payload)
    question = audit_payload.get("question")
    if isinstance(question, str):
        audit_payload["question"] = _sanitize(question)

    canonical = json.dumps(audit_payload, sort_keys=True, ensure_ascii=False, default=str)
    return audit_payload, hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def trace_usage_kwargs(turn_usage: dict | None) -> dict[str, Any]:
    """Map a per-turn telemetry projection onto build_trace_row()'s kwargs.

    The engine holds the turn's snapshot as one opaque dict; this splits it into
    the named arguments the row builder takes, WITHOUT letting the dict widen the
    call — only these keys are forwarded, so a malformed or hostile snapshot
    cannot reach an unintended parameter (e.g. tenant_id).

    `model_used` is forwarded only when the snapshot actually carries one, so it
    never clobbers the engine's own `router.last_model_for()` attribution with a
    None on a turn that took the Open WebUI fallback.
    """
    u = turn_usage or {}
    out: dict[str, Any] = {
        "usage": {
            "provider": u.get("provider"),
            "input_tokens": u.get("input_tokens"),
            "cached_input_tokens": u.get("cached_input_tokens"),
            "output_tokens": u.get("output_tokens"),
        },
        "route_reason": u.get("route_reason"),
        "tool_call_count": u.get("tool_call_count"),
        "status": u.get("status"),
    }
    if u.get("model_used"):
        out["model_used"] = u["model_used"]
    return out


def _usage_columns(
    usage: Optional[dict],
    *,
    route_reason: Optional[str],
    principal: Optional[str],
    cost_usd_estimate: Optional[float],
    tool_call_count: Optional[int],
    status: Optional[str],
) -> dict[str, Any]:
    """Project a provider usage dict onto the migration-078 columns.

    Deliberately narrow: it copies counts and identifiers and nothing else. If a
    provider ever puts prompt text or a key into its usage dict, that field does
    NOT reach the database through here — the allowlist below is the whole
    contract (P0003 Part B: no prompts or sensitive payload in the billing
    columns).

    Every column is nullable. A turn that never reached a provider (a guardrail
    STOP, a cached answer, a refusal) writes NULLs rather than zeros, so "no
    provider call" stays distinguishable from "a call that cost nothing".
    """
    u = usage or {}
    return {
        "provider": u.get("provider"),
        "route_reason": route_reason,
        "principal": principal,
        "input_tokens": u.get("input_tokens"),
        # The free cascade does not report cache hits; Cloud Gold will.
        "cached_input_tokens": u.get("cached_input_tokens"),
        "output_tokens": u.get("output_tokens"),
        "cost_usd_estimate": cost_usd_estimate,
        "tool_call_count": tool_call_count,
        "status": status,
    }


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
    context_manifest: Optional[dict] = None,
    usage: Optional[dict] = None,
    route_reason: Optional[str] = None,
    principal: Optional[str] = None,
    cost_usd_estimate: Optional[float] = None,
    tool_call_count: Optional[int] = None,
    status: Optional[str] = None,
) -> dict[str, Any]:
    """Assemble the decision_traces row from engine-turn inputs (pure).

    uns_context is state["context"]["uns_context"] — we pull path / source /
    confidence from it. Evidence lists are stored as-is (tag/kg) or shaped
    (manual). citations_present is derived from the recommendation text.
    """
    ctx = uns_context or {}
    uns_path = ctx.get("uns_path") or ctx.get("path") or None

    # WS1/G6 — preserve the engine's evidence object instead of re-deriving it.
    # The sole transformation is the PII-safe question projection required at
    # the persistence boundary; its hash is calculated from those exact bytes.
    cm_payload, cm_sha = _audit_manifest(context_manifest)

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
        "context_manifest": json.dumps(cm_payload, sort_keys=True) if cm_payload else None,
        "context_manifest_sha256": cm_sha if cm_payload else None,
        # ADR-0037 spend telemetry. `usage` is the provider's own dict
        # (InferenceRouter shape: provider/model/input_tokens/output_tokens);
        # cached_input_tokens is read separately because the cascade does not
        # report it and Cloud Gold will (usage.input_tokens_details.cached_tokens).
        **_usage_columns(
            usage,
            route_reason=route_reason,
            principal=principal,
            cost_usd_estimate=cost_usd_estimate,
            tool_call_count=tool_call_count,
            status=status,
        ),
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
