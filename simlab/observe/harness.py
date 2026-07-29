"""Answer harness — wraps MIRA's answer path to emit one AnswerTrace (pillars 2 & 4).

This is an **external wrapper**, not an engine edit. It calls the answer path,
reads what the engine already exposes (the reply + confidence from
``process_full``, and the per-call retrieved sources from the result dict's
#1704-safe ``_citation_evidence`` snapshot), and assembles the seven-step
``AnswerTrace``. Two answerers:

- ``MockAnswerer``  — returns a deterministic canned reply + supplied context.
  No LLM, no Doppler, no network. The default — it makes the eval/ask commands
  runnable in CI and proves the *harness* (grader + checks) discriminates.
- ``LiveAnswerer``  — wraps a real ``Supervisor`` and runs ``process_full`` once,
  pre-seeding a direct-connection UNS context so the chat-gate is bypassed (the
  harness *is* the machine context). Proves the *engine* traces.

Honesty note on step timing: the engine does not expose per-internal-step
durations. So ``generate_answer`` carries the engine's TOTAL latency
(``duration_is_total=True``); the harness-owned steps (resolve/retrieve/govern/
validate) carry their own real, cheap durations. We never fabricate sub-step
timing to make the trace look more granular than it is.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from shared.observe.approval_registry import ApprovalRegistry
from shared.observe.checks import dedupe, run_governance, run_incidents
from shared.observe.trace import (
    ALL_STEPS,
    STEP_CHECK_GOVERNANCE,
    STEP_GENERATE_ANSWER,
    STEP_RECEIVE_QUESTION,
    STEP_RESOLVE_ASSET,
    STEP_RETRIEVE_CONTEXT,
    STEP_RETURN_ANSWER,
    STEP_VALIDATE_ANSWER,
    AnswerTrace,
    extract_citations,
)

# --- Context + result -------------------------------------------------------


@dataclass
class AskContext:
    """What the harness knows about the asset before answering (the UNS-certified
    context, since the harness is a direct connection by construction)."""

    asset: Optional[str] = None
    asset_uns_path: Optional[str] = None
    uns_source: str = "direct_connection"
    tenant_id: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    # tag_state preseed for live mode (bare-tag → value), e.g. from a SimLab scenario
    tag_state: dict[str, Any] = field(default_factory=dict)
    machine_type: Optional[str] = None
    # mock-mode pre-supplied retrieved documents (live mode reads them from the engine)
    documents: list[dict[str, Any]] = field(default_factory=list)
    expected_asset: Optional[str] = None


@dataclass
class AnswerResult:
    """What an answerer produced — the raw material the trace records."""

    reply: str
    model: Optional[str] = None
    confidence: Optional[str] = None
    documents: list[dict[str, Any]] = field(default_factory=list)
    tags_used: list[str] = field(default_factory=list)
    retrieval_source: Optional[str] = None
    prompt_version: Optional[str] = None
    total_latency_ms: Optional[int] = None
    error: Optional[str] = None


# An answerer is any callable (question, ctx) -> AnswerResult.
Answerer = Callable[[str, AskContext], AnswerResult]


# --- Mock answerer ----------------------------------------------------------


class MockAnswerer:
    """Deterministic, LLM-free answerer for CI + harness self-test.

    Returns a fixed reply (``answer``) and echoes the context's documents/tags as
    "retrieved". This proves the trace/grader/checks pipeline without an engine.
    It does NOT prove the engine — use ``LiveAnswerer`` for that.
    """

    def __init__(self, answer: str, *, model: str = "mock", confidence: str = "medium") -> None:
        self._answer = answer
        self._model = model
        self._confidence = confidence

    def __call__(self, question: str, ctx: AskContext) -> AnswerResult:
        return AnswerResult(
            reply=self._answer,
            model=self._model,
            confidence=self._confidence,
            documents=list(ctx.documents),
            tags_used=list(ctx.tags),
            retrieval_source="mock",
            prompt_version="mock",
            total_latency_ms=0,
        )


# --- Live answerer ----------------------------------------------------------


class LiveAnswerer:
    """Wraps a real ``Supervisor``; runs ``process_full`` once and reads its output.

    Construct via ``LiveAnswerer.build()`` which assembles a Supervisor the same
    way ``tests/simlab/runner._build_supervisor`` does (binding the SimLab demo
    tenant so KB recall surfaces the seeded docs). Requires the bot deps + env;
    that is why it is lazy and never imported in mock/test paths.
    """

    def __init__(self, supervisor: Any) -> None:
        self._sup = supervisor

    @classmethod
    def build(cls, *, tenant_id: Optional[str] = None) -> "LiveAnswerer":
        import os
        import sys
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[2]
        bots = str(repo_root / "mira-bots")
        if bots not in sys.path:
            sys.path.insert(0, bots)

        from shared.engine import Supervisor  # lazy import by design (heavy deps)

        if tenant_id is None:
            try:
                from simlab import SIMLAB_TENANT_ID

                tenant_id = SIMLAB_TENANT_ID
            except Exception:  # noqa: BLE001
                tenant_id = None

        sup = Supervisor(
            db_path=os.getenv("SIMLAB_DB_PATH", "/tmp/mira_observe.db"),
            openwebui_url=os.getenv("OPENWEBUI_URL", "http://localhost:3000"),
            api_key=os.getenv("OPENWEBUI_API_KEY", ""),
            collection_id=os.getenv("OPENWEBUI_COLLECTION_ID", ""),
            tenant_id=tenant_id,
        )
        return cls(sup)

    def __call__(self, question: str, ctx: AskContext) -> AnswerResult:
        import asyncio

        chat_id = f"observe_{uuid.uuid4().hex[:8]}"
        self._sup.reset(chat_id)
        self._sup._save_state(chat_id, self._initial_state(ctx))

        t0 = time.monotonic()
        error: Optional[str] = None
        reply, confidence = "", "none"
        result: dict[str, Any] = {}
        try:
            result = asyncio.run(
                self._sup.process_full(chat_id, question, photo_b64=None, uns_source=ctx.uns_source)
            )
            reply = result.get("reply", "")
            confidence = result.get("confidence", "none")
        except Exception as exc:  # noqa: BLE001 — surfaced as a trace error
            error = f"{type(exc).__name__}: {exc}"
        total_ms = int((time.monotonic() - t0) * 1000)

        # Retrieval: read THIS turn's snapshot from the result dict's
        # ``_citation_evidence`` (the #1704-safe channel the engine threads out of
        # _make_result), NOT the shared self.rag._last_sources a concurrent tenant
        # can overwrite after the await. Total latency only — engine internals
        # aren't sub-timed. ``model_used`` is not exposed per-call → None (honest).
        documents = self._documents_from_evidence(result.get("_citation_evidence"))
        return AnswerResult(
            reply=reply,
            model=None,
            confidence=confidence,
            documents=documents,
            # tags actually in scope for this turn = the certified machine context
            # we pre-seeded (NOT the eval's expected tags — that would be circular).
            tags_used=list(ctx.tag_state.keys()),
            retrieval_source="engine_citation_evidence",
            prompt_version=None,
            total_latency_ms=total_ms,
            error=error,
        )

    # -- internals --------------------------------------------------------

    def _initial_state(self, ctx: AskContext) -> dict[str, Any]:
        """Direct-connection preseed — mirrors tests/simlab/runner._build_initial_state."""
        return {
            "state": "Q1",
            "asset_identified": ctx.asset or "",
            "uns_context": {
                "source": ctx.uns_source,
                "confidence": "certified",
                "uns_path": ctx.asset_uns_path or "",
            },
            "context": {
                "session_context": {
                    "machine_type": ctx.machine_type,
                    "equipment_type": ctx.machine_type,
                    "tag_state": ctx.tag_state,
                }
            },
            "exchange_count": 0,
            "fault_category": None,
            "final_state": None,
        }

    @staticmethod
    def _documents_from_evidence(evidence: Optional[dict]) -> list[dict[str, Any]]:
        """Shape the engine's per-call ``_citation_evidence`` into trace documents.

        ``evidence`` = ``{kb_status, chunks, sources, no_kb}`` (#1704). ``sources``
        is a list of chunk strings or dicts. We bound to 5 and pull a filename
        where the chunk text or a dict field reveals one. Returns [] for a non-RAG
        turn (no snapshot) — honest about "no documents retrieved".
        """
        if not evidence:
            return []
        sources = evidence.get("sources") or evidence.get("chunks") or []
        out: list[dict[str, Any]] = []
        for i, src in enumerate(sources[:5]):
            if isinstance(src, dict):
                out.append(
                    {
                        "rank": i,
                        "doc": src.get("doc") or src.get("source") or src.get("filename"),
                        "page": src.get("page"),
                        "score": src.get("score") or src.get("distance"),
                        "excerpt": str(src.get("text") or src.get("excerpt") or "")[:300],
                    }
                )
            else:
                out.append({"rank": i, "excerpt": str(src)[:300], "doc": _doc_name(str(src))})
        return out


_DOC_TOKEN_RE = None


def _doc_name(src: str) -> Optional[str]:
    """Best-effort document filename pulled from a chunk string or its citation tag."""
    import re

    global _DOC_TOKEN_RE
    if _DOC_TOKEN_RE is None:
        _DOC_TOKEN_RE = re.compile(r"([\w\-]+\.(?:md|pdf|txt|csv|html))", re.IGNORECASE)
    m = _DOC_TOKEN_RE.search(src or "")
    return m.group(1) if m else None


# --- The orchestrator: build a trace from an answerer -----------------------


def trace_answer(
    question: str,
    ctx: AskContext,
    answerer: Answerer,
    registry: ApprovalRegistry,
    *,
    mode: str = "mock",
) -> AnswerTrace:
    """Run one answer through the seven orchestration steps and return its trace.

    The engine produces the answer during ``generate_answer`` (which carries the
    real total latency). The harness-owned steps record their own data with real,
    cheap durations. Governance gates run in ``check_governance``; incident
    detection + answer-quality checks run in ``validate_answer``.
    """
    trace = AnswerTrace(
        trace_id=uuid.uuid4().hex,
        question=question,
        mode=mode,
        tenant_id=ctx.tenant_id,
    )

    # 1 — receive_question
    with trace.step(STEP_RECEIVE_QUESTION, question=question) as s:
        s.output = {"length": len(question)}

    # 2 — resolve_asset (direct-connection certified — no chat gate)
    with trace.step(STEP_RESOLVE_ASSET, asset=ctx.asset, uns_path=ctx.asset_uns_path) as s:
        trace.asset = ctx.asset
        trace.asset_uns_path = ctx.asset_uns_path
        trace.uns_source = ctx.uns_source
        s.output = {"asset": ctx.asset, "uns_path": ctx.asset_uns_path, "source": ctx.uns_source}

    # 3 — generate_answer (the engine call; TOTAL latency, internals not sub-timed)
    result = answerer(question, ctx)
    gen = trace.step(STEP_GENERATE_ANSWER, model=result.model)
    with gen as s:
        trace.answer = result.reply
        trace.model_used = result.model
        trace.confidence = result.confidence
        trace.prompt_version = result.prompt_version
        trace.citations = extract_citations(result.reply)
        if result.error:
            s.status = "error"
            s.error = result.error
            trace.error = result.error
        s.output = {
            "answer_chars": len(result.reply or ""),
            "model": result.model,
            "confidence": result.confidence,
            "n_citations": len(trace.citations),
        }
    # Override the step's own wall-clock with the engine's reported total latency.
    if result.total_latency_ms is not None and trace.steps:
        gen_step = trace.steps[-1]
        gen_step.duration_ms = result.total_latency_ms
        gen_step.duration_is_total = True
    trace.total_latency_ms = result.total_latency_ms

    # 4 — retrieve_context (observed post-hoc from the engine; real documents)
    with trace.step(STEP_RETRIEVE_CONTEXT, query=question) as s:
        trace.documents_retrieved = result.documents
        trace.tags_used = result.tags_used
        trace.retrieval_source = result.retrieval_source
        s.output = {
            "n_documents": len(result.documents),
            "tags": result.tags_used,
            "retrieval_source": result.retrieval_source,
            "reconstructed": mode == "live",  # retrieval ran inside the engine
        }

    # 5 — check_governance (the trust gates; human approval central)
    with trace.step(STEP_CHECK_GOVERNANCE) as s:
        gov = run_governance(trace, registry)
        for w in gov:
            trace.add_warning(w)
        # used_approved_context_only: asset approved AND every retrieved doc approved
        all_docs_ok = all(
            registry.document_approved(d.get("doc") or d.get("name") or d.get("source"))
            for d in trace.documents_retrieved
            if (d.get("doc") or d.get("name") or d.get("source"))
        )
        trace.used_approved_context_only = (
            registry.asset_approved(trace.asset_uns_path or trace.asset) and all_docs_ok
        )
        s.output = {
            "gates_failed": [w.code for w in gov],
            "used_approved_context_only": trace.used_approved_context_only,
        }
        if gov:
            s.status = "warn"

    # 6 — validate_answer (incident detection + answer-quality)
    with trace.step(STEP_VALIDATE_ANSWER) as s:
        inc = run_incidents(trace, registry, expected_asset=ctx.expected_asset)
        for w in inc:
            trace.add_warning(w)
        trace.warnings = dedupe(trace.warnings)
        s.output = {"incidents": [w.code for w in inc]}
        if inc:
            s.status = "warn"

    # 7 — return_answer
    with trace.step(STEP_RETURN_ANSWER) as s:
        s.output = {
            "n_warnings": len(trace.warnings),
            "confidence": trace.confidence,
            "error": trace.error,
        }
        if trace.error:
            s.status = "error"

    # Present steps in canonical orchestration order (they execute in a
    # harness-determined order — generate runs before retrieve/govern because
    # those inspect the produced answer — but the durations recorded are real).
    _order = {name: i for i, name in enumerate(ALL_STEPS)}
    trace.steps.sort(key=lambda st: _order.get(st.name, len(ALL_STEPS)))

    return trace
