"""Lightweight structured agent-trace schema + export (observability).

A Phoenix / OpenInference-style per-turn record for MIRA's diagnostic engine.
One :class:`AgentTrace` ties together what a single technician turn actually
used — the question, the resolved asset / UNS context, the live PLC/VFD tag
snapshot **and its freshness**, the retrieved KB documents, the tool calls, the
final answer, citations, and the safety / refusal flag.

Why a new module instead of extending ``decision_trace.py``?

  * ``decision_trace.py``  — the durable NeonDB groundedness audit (Hub mig 032).
    Requires ``NEON_DATABASE_URL``; writes 14 fixed columns; adding the new
    gap-fields (freshness, groundedness, tool calls) would need a schema
    migration on a shared, RLS-protected prod table.
  * ``benchmark_db.py``    — SQLite offline regression scoring.

This module is the **local, dependency-light, cloud-free** trace. It serialises
to JSON / JSON-Lines so eval runs can be diffed and capture can be unit-tested
with no database, and it OPTIONALLY emits an OpenInference span to any
OTLP / Arize-Phoenix endpoint when ``MIRA_OTEL_ENDPOINT`` is set. Both exports
are **fail-open and OFF by default** — local tests and CI need no running
service, no migration, and no new required dependency.

Honesty notes (do NOT let these become silent dead fields — see
``docs/observability/mira-agent-eval-audit.md``):

  * **Freshness today = ``quality`` / ``stale_tag_count``, NOT ``live_tag_age_seconds``.**
    The authoritative staleness signal from the engine path is the per-tag
    ``quality`` band (``good`` / ``stale`` / ``unknown``), driven by the
    ``vfd_comm_ok`` comms-trust gate — that genuinely flags a lost/stale link.
    ``live_tag_age_seconds = now - snapshot_ts`` is honest arithmetic but, from
    the *engine* path, ``snapshot_ts`` is stamped at tag-*attach* time (not
    data-*capture* time), so it ≈ diagnostic latency (~turn duration), NOT how
    old the PLC reading is. It becomes a true age only when the builder is fed
    snapshots whose ``ts`` is a real capture time — e.g. once the relay's
    per-reading ``sample_age_seconds`` (clock-source provenance,
    ``mira-relay/clock_resolver.py``, today NeonDB-only) is plumbed into the
    turn. Treat the engine-path age as latency until then.
  * ``tool_calls`` is ``[]`` from the engine path today — the FSM dispatches
    DST / KG / CMMS / scrape inline without emitting discrete tool spans.
  * ``groundedness_score`` and ``model_used`` are populated only when a caller
    passes them; the engine hook does not forward them yet (the self-critique
    scores and the router's per-call model land in other tables).

Each is an Optional field that stays ``None``/``[]`` until wired, and the audit
doc states this plainly rather than implying coverage that doesn't exist.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

# Reuse the established groundedness helpers rather than re-implementing them —
# same package, dependency-light (decision_trace's heavy imports are all lazy).
from .decision_trace import (
    _CITATION_TAG_RE,
    _manual_evidence_from_sources,
    _sanitize,
    citations_present_in,
)

logger = logging.getLogger("mira-gsd.agent_trace")

# Quality bands mirror live_snapshot.py (inlined to avoid importing the engine).
_GOOD = "good"
_STALE = "stale"
_UNKNOWN = "unknown"


@dataclass
class AgentTrace:
    """One structured record of a single diagnostic turn.

    Fields map 1:1 to what an industrial-maintenance trace must answer: *what
    did the technician ask, on which asset, with what live data of what
    freshness, grounded in which documents, and did MIRA refuse on safety?*
    """

    # Identity / routing
    trace_id: str = ""
    ts: str = ""  # ISO-8601; caller-supplied so the record is deterministic
    session_id: Optional[str] = None
    tenant_id: Optional[str] = None
    platform: Optional[str] = None
    fsm_state: Optional[str] = None  # state AFTER the turn

    # The question
    user_question: str = ""

    # Asset / UNS context (the location-confirmation gate's resolved context)
    asset: dict[str, Any] = field(default_factory=dict)

    # Live PLC/VFD tag snapshot + derived freshness
    live_tags: list[dict[str, Any]] = field(default_factory=list)
    live_tag_count: int = 0
    stale_tag_count: int = 0
    live_tag_quality: Optional[str] = None  # worst-case across the snapshot
    live_tag_snapshot_ts: Optional[str] = None
    live_tag_age_seconds: Optional[float] = None  # now - snapshot_ts, if known

    # Retrieved KB documents (grounding evidence)
    retrieved_documents: list[dict[str, Any]] = field(default_factory=list)

    # Tool calls (see honesty note — empty from the engine path today)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)

    # The answer
    final_answer: str = ""
    confidence: Optional[str] = None

    # Citations / grounding
    citations_present: bool = False
    citation_count: int = 0

    # Safety / refusal
    safety_triggered: bool = False

    # Scores / provenance (not-yet-wired from the engine hook — see note)
    groundedness_score: Optional[float] = None
    model_used: Optional[str] = None

    # Outcome / timing
    outcome: Optional[str] = None
    latency_ms: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str, sort_keys=True)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _snapshot_to_dict(snap: Any) -> dict[str, Any]:
    """Shape a LiveTagSnapshot (or a plain dict) into the trace's tag shape."""
    if isinstance(snap, dict):
        get = snap.get
    else:  # frozen dataclass LiveTagSnapshot — read attributes
        get = lambda k, d=None: getattr(snap, k, d)  # noqa: E731
    return {
        "datapoint": get("datapoint"),
        "value": get("value"),
        "unit": get("unit"),
        "quality": get("quality"),
        "uns_path": get("uns_path"),
        "ts": get("ts"),
    }


def _worst_quality(tags: list[dict[str, Any]]) -> Optional[str]:
    """stale > unknown > good — the most conservative band present, or None."""
    qualities = {t.get("quality") for t in tags}
    if _STALE in qualities:
        return _STALE
    if _UNKNOWN in qualities:
        return _UNKNOWN
    if _GOOD in qualities:
        return _GOOD
    return None


def build_agent_trace(
    *,
    user_question: str,
    final_answer: str,
    ts: str,
    trace_id: str = "",
    session_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    platform: Optional[str] = None,
    fsm_state: Optional[str] = None,
    uns_context: Optional[dict] = None,
    live_snapshots: Optional[list] = None,
    manual_sources: Optional[list] = None,
    tool_calls: Optional[list] = None,
    confidence: Optional[str] = None,
    safety_triggered: bool = False,
    groundedness_score: Optional[float] = None,
    model_used: Optional[str] = None,
    outcome: Optional[str] = None,
    latency_ms: Optional[int] = None,
    now: Optional[str] = None,
) -> AgentTrace:
    """Assemble an :class:`AgentTrace` from one engine turn's evidence (pure).

    ``live_snapshots`` are ``LiveTagSnapshot`` objects (or dicts) as produced by
    ``mira-bots/shared/live_snapshot.normalize``. Tag freshness is derived from
    them: per-tag ``quality`` plus ``live_tag_age_seconds`` = ``now`` minus the
    snapshot timestamp (when both parse). ``now`` defaults to ``ts`` so the
    function stays clock-free and deterministic for tests; the engine passes the
    real current time.

    ``manual_sources`` is the RAG worker's ``_last_sources`` list; it is shaped
    by the shared ``decision_trace`` helper so the manual-evidence shape matches
    the durable audit row.
    """
    ctx = uns_context or {}
    tags = [_snapshot_to_dict(s) for s in (live_snapshots or [])]
    snapshot_ts = next((t["ts"] for t in tags if t.get("ts")), None)

    age_seconds: Optional[float] = None
    now_dt = _parse_iso(now or ts)
    snap_dt = _parse_iso(snapshot_ts)
    if now_dt and snap_dt:
        age_seconds = max(0.0, (now_dt - snap_dt).total_seconds())

    sanitized_answer = _sanitize(final_answer)
    return AgentTrace(
        # Every turn gets a unique id. The engine passes the Langfuse trace_id,
        # but that is None/"" in prod (keys unset) — fall back to a fresh uuid so
        # the record is always individually addressable (never an empty id).
        trace_id=trace_id or uuid4().hex,
        ts=ts,
        session_id=session_id,
        tenant_id=tenant_id,
        platform=platform,
        fsm_state=fsm_state,
        user_question=_sanitize(user_question),
        asset={
            "uns_path": ctx.get("uns_path") or ctx.get("path"),
            "uns_source": ctx.get("source"),
            "uns_confidence": ctx.get("confidence"),
            "manufacturer": ctx.get("manufacturer"),
            "model": ctx.get("model"),
            "fault_code": ctx.get("fault_code"),
        },
        live_tags=tags,
        live_tag_count=len(tags),
        stale_tag_count=sum(1 for t in tags if t.get("quality") == _STALE),
        live_tag_quality=_worst_quality(tags),
        live_tag_snapshot_ts=snapshot_ts,
        live_tag_age_seconds=age_seconds,
        retrieved_documents=_manual_evidence_from_sources(manual_sources),
        tool_calls=list(tool_calls or []),
        final_answer=sanitized_answer,
        confidence=confidence,
        citations_present=citations_present_in(final_answer),
        citation_count=len(_CITATION_TAG_RE.findall(final_answer or "")),
        safety_triggered=bool(safety_triggered),
        groundedness_score=groundedness_score,
        model_used=model_used,
        outcome=outcome,
        latency_ms=latency_ms,
    )


# --- Export sinks (both fail-open, both OFF by default) ----------------------


def export_jsonl(trace: AgentTrace, path: Optional[str] = None) -> bool:
    """Append the trace as one JSON line. No-op unless a destination is set.

    Destination resolution: explicit ``path`` arg, else ``MIRA_AGENT_TRACE_FILE``
    env. With neither set this is a silent no-op (returns ``False``) — so prod
    and CI write nothing unless a developer opts in. Never raises.
    """
    dest = path or os.environ.get("MIRA_AGENT_TRACE_FILE")
    if not dest:
        return False
    try:
        parent = os.path.dirname(dest)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(dest, "a", encoding="utf-8") as fh:
            fh.write(trace.to_json() + "\n")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("agent_trace jsonl export skipped: %s", exc)
        return False


# OpenInference semantic-convention attribute names (Arize Phoenix / OTLP).
_OI_SPAN_KIND = "openinference.span.kind"
_OI_INPUT = "input.value"
_OI_OUTPUT = "output.value"


def export_otel(trace: AgentTrace) -> bool:
    """Emit an OpenInference span to ``MIRA_OTEL_ENDPOINT`` (OTLP/HTTP).

    No-op (returns ``False``) when the endpoint is unset or the optional
    ``opentelemetry`` packages are not installed — so this never becomes a
    required dependency and CI/local prove the no-op automatically. Never raises.
    Point ``MIRA_OTEL_ENDPOINT`` at a self-hosted Arize-Phoenix collector to get
    a Phoenix-native trace UI; nothing here couples MIRA to a cloud service.
    """
    endpoint = os.environ.get("MIRA_OTEL_ENDPOINT")
    if not endpoint:
        return False
    try:
        from opentelemetry import trace as ot_trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        logger.debug("opentelemetry not installed — OTel export disabled")
        return False
    try:
        provider = ot_trace.get_tracer_provider()
        if not isinstance(provider, TracerProvider):
            # BatchSpanProcessor exports on a background thread, so ending the
            # span below never blocks the caller on a network round-trip — the
            # "event loop never blocked" discipline decision_trace.py honors.
            provider = TracerProvider()
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint))
            )
            ot_trace.set_tracer_provider(provider)
        tracer = ot_trace.get_tracer("mira.agent")
        with tracer.start_as_current_span("mira.diagnostic_turn") as span:
            span.set_attribute(_OI_SPAN_KIND, "AGENT")
            span.set_attribute(_OI_INPUT, trace.user_question)
            span.set_attribute(_OI_OUTPUT, trace.final_answer)
            span.set_attribute("retrieval.documents.count", len(trace.retrieved_documents))
            span.set_attribute("mira.uns_path", str(trace.asset.get("uns_path") or ""))
            span.set_attribute("mira.live_tag_count", trace.live_tag_count)
            span.set_attribute("mira.stale_tag_count", trace.stale_tag_count)
            if trace.live_tag_age_seconds is not None:
                span.set_attribute("mira.live_tag_age_seconds", trace.live_tag_age_seconds)
            span.set_attribute("mira.citations_present", trace.citations_present)
            span.set_attribute("mira.safety_triggered", trace.safety_triggered)
            if trace.confidence:
                span.set_attribute("mira.confidence", trace.confidence)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("agent_trace otel export skipped: %s", exc)
        return False


def emit(trace: AgentTrace, *, path: Optional[str] = None) -> None:
    """Best-effort emit to all configured sinks. Never raises."""
    export_jsonl(trace, path=path)
    export_otel(trace)
