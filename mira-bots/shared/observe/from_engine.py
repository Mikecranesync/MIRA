"""Build an AnswerTrace from a completed engine turn (Phase 1 — live tracing).

This is the bridge between ``Supervisor.process()`` and the local ``AnswerTrace``.
The engine already assembles the trace evidence at ``_schedule_decision_trace``
(uns_context, tag_evidence, the #1704-safe ``_citation_evidence`` snapshot, reply,
latency, platform, tenant) for the NeonDB ``decision_traces`` row. This module
shapes that SAME evidence into a local JSON ``AnswerTrace`` and appends it to a
JSONL file — so every adapter that routes through ``process()`` (Telegram, Slack,
mira-pipeline, Ignition) emits an inspectable local trace.

Two hard contracts (mirroring ``decision_trace.py``):

- **Fail-open. ALWAYS.** Building or writing the trace must never raise into the
  reply path. ``emit_local_trace`` swallows every error and logs at debug.
- **Off by default.** Nothing is written unless ``MIRA_LOCAL_TRACE=1``. The
  destination is ``MIRA_TRACE_DIR`` (default ``<repo>/.mira-traces`` for local
  dev, or ``/tmp/mira-traces`` if that is unwritable).

Honesty note: this is a **post-hoc reconstruction** of a finished turn, so the
engine-internal per-step durations are not available. ``generate_answer`` carries
the turn's TOTAL latency; the other steps record their evidence with no duration
and ``reconstructed: true``. We never fabricate sub-step timing.

Phase 3: governance + incident checks run when a ``registry`` is supplied (the
engine path supplies it via ``approval_sources.registry_or_none`` only when
``MIRA_TRACE_CHECKS=1``). The approval source is in-memory/cached — never a
per-turn DB read, because this runs in the reply path.
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from shared.observe.approval_registry import ApprovalRegistry

from shared.observe.trace import (
    STEP_CHECK_GOVERNANCE,
    STEP_GENERATE_ANSWER,
    STEP_RECEIVE_QUESTION,
    STEP_RESOLVE_ASSET,
    STEP_RETRIEVE_CONTEXT,
    STEP_RETURN_ANSWER,
    STEP_VALIDATE_ANSWER,
    AnswerTrace,
    Step,
    extract_citations,
)

logger = logging.getLogger("mira-gsd.observe")


def _doc_from_source(src: Any, rank: int) -> dict[str, Any]:
    """Shape one retrieved source (string chunk or dict) into a trace document."""
    if isinstance(src, dict):
        return {
            "rank": rank,
            "doc": src.get("doc") or src.get("source") or src.get("filename"),
            "page": src.get("page"),
            "score": src.get("score") or src.get("distance"),
            "excerpt": str(src.get("text") or src.get("excerpt") or "")[:300],
        }
    return {"rank": rank, "excerpt": str(src)[:300]}


def _tag_names(tag_evidence: Optional[list]) -> list[str]:
    """Best-effort tag identifiers from the engine's tag_evidence list."""
    out: list[str] = []
    for t in tag_evidence or []:
        if isinstance(t, dict):
            name = t.get("uns_path") or t.get("tag") or t.get("name") or t.get("path")
            if name:
                out.append(str(name))
        elif t:
            out.append(str(t))
    return out


def build_answer_trace(
    *,
    question: str,
    reply: str,
    platform: Optional[str] = None,
    tenant_id: Optional[str] = None,
    uns_context: Optional[dict] = None,
    tag_evidence: Optional[list] = None,
    manual_sources: Optional[list] = None,
    confidence: Optional[str] = None,
    model_used: Optional[str] = None,
    latency_ms: Optional[int] = None,
    outcome: Optional[str] = None,
    registry: Optional["ApprovalRegistry"] = None,
) -> AnswerTrace:
    """Assemble an ``AnswerTrace`` from a completed engine turn (pure function).

    All inputs are the values the engine already has at ``_schedule_decision_trace``.
    Returns a fully-populated trace with the seven steps reconstructed. Never raises
    on shape surprises — callers should still wrap, but this stays defensive.

    When ``registry`` is supplied (Phase 3, opt-in), governance + incident checks
    run against it and their warnings are attached; the ``check_governance`` and
    ``validate_answer`` steps then carry real results instead of the placeholder.
    When ``registry`` is None, checks are deferred (Phase-1 behavior).
    """
    ctx = uns_context or {}
    documents = [_doc_from_source(s, i) for i, s in enumerate(manual_sources or [])][:5]
    tags = _tag_names(tag_evidence)
    citations = extract_citations(reply)

    trace = AnswerTrace(
        trace_id=uuid.uuid4().hex,
        question=question or "",
        mode="live",
        tenant_id=tenant_id,
        asset=ctx.get("asset") or ctx.get("equipment") or None,
        asset_uns_path=ctx.get("uns_path") or ctx.get("path"),
        uns_source=ctx.get("source"),
        tags_used=tags,
        documents_retrieved=documents,
        retrieval_source="engine" if documents else None,
        model_used=model_used,
        answer=reply or "",
        citations=citations,
        confidence=confidence,
        total_latency_ms=latency_ms,
    )

    # Reconstructed steps — no per-step engine timing is available, so durations
    # are None except generate_answer (the turn's total latency). reconstructed:true
    # marks that these spans were assembled after the turn, not timed live.
    def _step(name: str, output: dict[str, Any], *, status: str = "ok") -> Step:
        out = dict(output)
        out["reconstructed"] = True
        return Step(name=name, status=status, output=out)

    trace.steps = [
        _step(STEP_RECEIVE_QUESTION, {"length": len(question or "")}),
        _step(
            STEP_RESOLVE_ASSET,
            {
                "asset": trace.asset,
                "uns_path": trace.asset_uns_path,
                "source": trace.uns_source,
                "confidence": ctx.get("confidence"),
            },
        ),
        _step(
            STEP_RETRIEVE_CONTEXT,
            {
                "n_documents": len(documents),
                "tags": tags,
                "retrieval_source": trace.retrieval_source,
            },
        ),
        # Governance/incident checks run in Phase 3; this step is a placeholder.
        _step(STEP_CHECK_GOVERNANCE, {"checks": "deferred_to_phase_3"}, status="skipped"),
        _step(
            STEP_GENERATE_ANSWER,
            {
                "answer_chars": len(reply or ""),
                "model": model_used,
                "confidence": confidence,
                "n_citations": len(citations),
            },
        ),
        _step(STEP_VALIDATE_ANSWER, {"outcome": outcome}),
        _step(STEP_RETURN_ANSWER, {"confidence": confidence, "outcome": outcome}),
    ]
    # Carry the turn's total latency on generate_answer (engine internals not sub-timed).
    if latency_ms is not None:
        for s in trace.steps:
            if s.name == STEP_GENERATE_ANSWER:
                s.duration_ms = latency_ms
                s.duration_is_total = True
                break

    if registry is not None:
        _apply_checks(trace, registry)

    return trace


def _step_by_name(trace: AnswerTrace, name: str) -> Optional[Step]:
    for s in trace.steps:
        if s.name == name:
            return s
    return None


def _apply_checks(trace: AnswerTrace, registry: "ApprovalRegistry") -> None:
    """Phase 3 — run governance + incident checks and fold them into the trace.

    Observational only: attaches warnings and fills the check_governance /
    validate_answer steps. Never raises (the caller is fail-open regardless).
    """
    from shared.observe.checks import dedupe, run_governance, run_incidents

    gov = run_governance(trace, registry)
    inc = run_incidents(trace, registry)
    for w in gov + inc:
        trace.add_warning(w)
    trace.warnings = dedupe(trace.warnings)

    # used_approved_context_only: asset approved AND every retrieved doc approved.
    all_docs_ok = all(
        registry.document_approved(d.get("doc") or d.get("name") or d.get("source"))
        for d in trace.documents_retrieved
        if (d.get("doc") or d.get("name") or d.get("source"))
    )
    trace.used_approved_context_only = (
        registry.asset_approved(trace.asset_uns_path or trace.asset) and all_docs_ok
    )

    gov_step = _step_by_name(trace, STEP_CHECK_GOVERNANCE)
    if gov_step is not None:
        gov_step.status = "warn" if gov else "ok"
        gov_step.output = {
            "gates_failed": [w.code for w in gov],
            "used_approved_context_only": trace.used_approved_context_only,
            "reconstructed": True,
        }
    val_step = _step_by_name(trace, STEP_VALIDATE_ANSWER)
    if val_step is not None:
        val_step.status = "warn" if inc else "ok"
        out = dict(val_step.output)
        out["incidents"] = [w.code for w in inc]
        val_step.output = out


def _trace_dir() -> Path:
    """Resolve the trace output dir from MIRA_TRACE_DIR, with safe fallbacks."""
    env = os.getenv("MIRA_TRACE_DIR")
    if env:
        return Path(env)
    # repo-root/.mira-traces in dev; from_engine.py lives at mira-bots/shared/observe/
    return Path(__file__).resolve().parents[3] / ".mira-traces"


def emit_local_trace(**kwargs: Any) -> Optional[Path]:
    """Build + append a local AnswerTrace JSONL for this turn. NEVER raises.

    No-op (returns None) unless ``MIRA_LOCAL_TRACE=1``. Writes one JSONL line per
    day to ``<MIRA_TRACE_DIR>/turns-YYYYMMDD.jsonl``. Accepts the same kwargs as
    ``build_answer_trace``. Any failure is logged at debug and dropped — this is
    observational and must never affect the reply.

    Phase 3: when ``MIRA_TRACE_CHECKS=1``, governance + incident checks run against
    the cached approval registry (``MIRA_APPROVALS_PATH``) and their warnings are
    attached. The registry is in-memory/cached — no per-turn DB read in the reply
    path. An explicit ``registry`` kwarg overrides the resolved one.
    """
    if os.getenv("MIRA_LOCAL_TRACE") != "1":
        return None
    try:
        if "registry" not in kwargs:
            from shared.observe.approval_sources import registry_or_none

            kwargs["registry"] = registry_or_none()
        trace = build_answer_trace(**kwargs)
        # Day-bucketed file keeps each file small and greppable.
        day = trace.timestamp[:10].replace("-", "")
        path = _trace_dir() / f"turns-{day}.jsonl"
        return trace.write_jsonl(path)
    except Exception as exc:  # noqa: BLE001 — fail-open, never touch the reply
        logger.debug("emit_local_trace skipped: %s", exc)
        return None
