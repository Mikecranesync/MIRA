"""AnswerTrace — the clinical record of one MIRA answer (pillar 2: Observability).

Every answer that flows through the observe harness produces exactly one
``AnswerTrace``: what the question was, which asset/tags/documents were used,
which model produced the reply, the citations, the confidence, the governance
warnings, and the seven orchestration steps it passed through.

Design constraints:

- **Dependency-light & simlab-free.** Stdlib only. No imports from ``simlab`` or
  ``mira-bots`` so the engine/adapters can adopt this dataclass later without a
  dependency cycle. (The *harness* depends on simlab; the *trace* does not.)
- **Boring JSON.** A trace serialises to a single JSON object and appends to a
  JSONL file. No database, no vendor SDK. ``cat`` and ``jq`` are the tools.
- **Observational only.** Building or writing a trace must never raise into the
  answer path. Callers schedule it after the reply is produced.

The seven orchestration steps (pillar 4) mirror the engine's real answer flow.
For the harness-owned steps (resolve_asset, retrieve_context, check_governance,
validate_answer) the durations are real. The engine internals are recorded as a
single ``generate_answer`` step carrying the *total* engine latency — the engine
does not expose per-internal-step timing, and we do not fabricate it.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# --- Orchestration step names (pillar 4) -----------------------------------

STEP_RECEIVE_QUESTION = "receive_question"
STEP_RESOLVE_ASSET = "resolve_asset"
STEP_RETRIEVE_CONTEXT = "retrieve_context"
STEP_CHECK_GOVERNANCE = "check_governance"
STEP_GENERATE_ANSWER = "generate_answer"
STEP_VALIDATE_ANSWER = "validate_answer"
STEP_RETURN_ANSWER = "return_answer"

ALL_STEPS = [
    STEP_RECEIVE_QUESTION,
    STEP_RESOLVE_ASSET,
    STEP_RETRIEVE_CONTEXT,
    STEP_CHECK_GOVERNANCE,
    STEP_GENERATE_ANSWER,
    STEP_VALIDATE_ANSWER,
    STEP_RETURN_ANSWER,
]

# Same citation token the RAG worker / citation_compliance / decision_trace use.
# Inlined (not imported) to keep this module dependency-light — same precedent as
# decision_trace._CITATION_TAG_RE.
_CITATION_TAG_RE = re.compile(r"\[(?:Source|Citation)[:\s][^\]]+\]|\[\d+\]", re.IGNORECASE)

# Severity bands for governance / incident warnings.
SEVERITY_INFO = "info"
SEVERITY_WARN = "warn"
SEVERITY_CRITICAL = "critical"


def citations_present_in(reply: Optional[str]) -> bool:
    """True iff the reply carries at least one ``[Source: …]`` / ``[N]`` citation."""
    return bool(_CITATION_TAG_RE.search(reply or ""))


def extract_citations(reply: Optional[str]) -> list[str]:
    """Return the raw citation tokens present in the reply (deduped, ordered)."""
    seen: list[str] = []
    for m in _CITATION_TAG_RE.findall(reply or ""):
        if m not in seen:
            seen.append(m)
    return seen


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Warning ----------------------------------------------------------------


@dataclass
class Warning:
    """One governance or incident-detection finding attached to a trace.

    ``code`` is a stable machine key (e.g. ``"missing_citation"``); ``pillar``
    ties it back to the five pillars; ``severity`` is one of info/warn/critical.
    """

    code: str
    message: str
    severity: str = SEVERITY_WARN
    pillar: str = "governance"
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- Step -------------------------------------------------------------------


@dataclass
class Step:
    """One named orchestration step with input/output/status/duration/error."""

    name: str
    status: str = "ok"  # ok | warn | error | skipped
    started_at: Optional[str] = None
    duration_ms: Optional[int] = None
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    # True when duration_ms is the engine's TOTAL latency, not this step's own
    # cost — set on generate_answer because the engine does not expose internal
    # per-step timing. Surfaced in the viewer so the number isn't misread.
    duration_is_total: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class _StepTimer:
    """Context manager that records a Step's wall-clock duration.

    Usage::

        with trace.step(STEP_RESOLVE_ASSET, input={...}) as s:
            s.output["asset"] = ...
            # s.status / s.error set on exception automatically
    """

    def __init__(self, trace: "AnswerTrace", step: Step) -> None:
        self._trace = trace
        self._step = step
        self._t0 = 0.0

    def __enter__(self) -> Step:
        self._t0 = time.monotonic()
        self._step.started_at = _now_iso()
        return self._step

    def __exit__(self, exc_type, exc, tb) -> bool:
        self._step.duration_ms = int((time.monotonic() - self._t0) * 1000)
        if exc is not None:
            self._step.status = "error"
            self._step.error = f"{exc_type.__name__}: {exc}"
        self._trace.steps.append(self._step)
        return False  # never swallow exceptions


# --- AnswerTrace ------------------------------------------------------------


@dataclass
class AnswerTrace:
    """The full record of one MIRA answer.

    Field set mirrors the goal's required trace fields. Lists default empty;
    optional scalars default ``None`` so a partial trace (e.g. an answer that
    errored mid-flow) still serialises cleanly.
    """

    trace_id: str
    question: str
    timestamp: str = field(default_factory=_now_iso)

    # Pillar 3 — data foundation: what context the answer stood on
    tenant_id: Optional[str] = None
    asset: Optional[str] = None
    asset_uns_path: Optional[str] = None
    uns_source: Optional[str] = None  # direct_connection | chat_resolver | …
    tags_used: list[str] = field(default_factory=list)
    documents_retrieved: list[dict[str, Any]] = field(default_factory=list)
    retrieval_source: Optional[str] = None  # bm25+pgvector | mock | none
    prompt_version: Optional[str] = None

    # Pillar 2 — observability: what the model produced
    model_used: Optional[str] = None
    answer: Optional[str] = None
    citations: list[str] = field(default_factory=list)
    confidence: Optional[str] = None  # none | low | medium | high
    used_approved_context_only: Optional[bool] = None

    # Orchestration + governance
    steps: list[Step] = field(default_factory=list)
    warnings: list[Warning] = field(default_factory=list)
    error: Optional[str] = None
    mode: str = "mock"  # mock | live
    total_latency_ms: Optional[int] = None

    # -- mutation helpers --------------------------------------------------

    def step(self, name: str, **input_kwargs: Any) -> _StepTimer:
        """Open a timed orchestration step. See ``_StepTimer``."""
        return _StepTimer(self, Step(name=name, input=dict(input_kwargs)))

    def add_warning(self, warning: Warning) -> None:
        self.warnings.append(warning)
        # Reflect the worst severity onto the owning step if one matches its pillar.
        for s in reversed(self.steps):
            if s.name == STEP_CHECK_GOVERNANCE and warning.pillar in (
                "governance",
                "data_foundation",
            ):
                if s.status == "ok":
                    s.status = "warn"
                break

    def warning_codes(self) -> list[str]:
        return [w.code for w in self.warnings]

    def has_warning(self, code: str) -> bool:
        return any(w.code == code for w in self.warnings)

    # -- serialisation -----------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # asdict already recursed into steps/warnings dataclasses.
        return d

    def to_json(self, *, indent: Optional[int] = None) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)

    def write_jsonl(self, path: str | Path) -> Path:
        """Append this trace as one line to a JSONL file (creates parent dir).

        Returns the path written. Never raises into the answer path — callers
        wanting fail-open should still wrap this, but a file append is cheap.
        """
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(self.to_dict(), default=str) + "\n")
        return p


# --- JSONL reading (used by the viewer) ------------------------------------


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    """Read a JSONL trace file into a list of plain dicts (skips blank lines)."""
    p = Path(path)
    out: list[dict[str, Any]] = []
    with p.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out
