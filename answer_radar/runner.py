"""Run MIRA against one Answer Radar question (PRS §12 "MIRA solves it").

A thin adapter over `tests/eval/local_pipeline.py::LocalPipeline`, which is the canonical
in-process MIRA runner. It is deliberately thin: MIRA must be exercised through its normal
product workflow, so a second engine path here would mean the benchmark measures something
customers never touch.

Two rules this module exists to enforce
---------------------------------------
**Blind attempt (PRS §5).** MIRA sees only the normalized question. Not the community
replies, not the ground truth, not the grader's expected solution. Reading a forum thread
and then reporting that MIRA "solved" the question is benchmark leakage, and it is the
failure mode §5 was written to prevent.

**No forged UNS context.** Several seed questions name a manufacturer and model but no
site/area/line, so the engine's chat-surface UNS gate fires and asks which asset this is.
That is required behaviour. It would be trivial to set
`uns_context["source"]="direct_connection"` and skip it — and that is precisely what
`.claude/rules/direct-connection-uns-certified.md` prohibits, because these are not direct
connections. A forum post is a chat surface. We record the gate as its own outcome instead.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

from answer_radar.schema import (
    AnswerStatus,
    EvaluationRecord,
    EvidenceTier,
    QuestionRecord,
)

REPO_ROOT = Path(__file__).resolve().parents[1]

#: Phrases the engine uses when it is asking which asset/site the technician is on, rather
#: than answering. Matched case-insensitively against the reply.
_UNS_GATE_MARKERS = (
    "which machine",
    "which asset",
    "confirm the asset",
    "is that right",
    "am i looking at",
    "which line",
    "which site",
    "what equipment are you",
    "can you confirm",
)

#: The engine's "still working" placeholder, sent when a turn outlives its budget.
_TIMEOUT_MARKERS = ("this is taking longer than usual",)

#: Italic parenthetical notes the engine appends (`_(Note: …)_`). They annotate the reply;
#: they never ask the technician a question.
_NOTE_RE = re.compile(r"_\(note:.*?\)_", re.S)

#: Phrases indicating MIRA declined to guess and asked for specific missing information.
#: PRS §7 treats this as potentially CORRECT.
_ABSTENTION_MARKERS = (
    "i don't have enough",
    "i do not have enough",
    "not enough information",
    "does not contain enough",
    "don't have documentation",
    "no documentation",
    "send me the",
    "what is the model",
    "need the model",
    "need more information",
    "cannot safely",
    "can't safely",
)

_SAFETY_REFUSAL_MARKERS = (
    "cannot provide",
    "can't provide",
    "contact the manufacturer",
    "authorised service",
    "authorized service",
    "qualified",
    "safety",
)

#: The engine bounced the turn back without attempting it ("could you rephrase?"). Distinct
#: from an abstention: an abstention names what it needs, a bounce just declines to engage.
#: Observed on seed 005 in the first run, where a substantively correct Modbus-session
#: diagnosis was discarded by the answer-QC gate and replaced with a rephrase prompt — so
#: without this class that turn would have been scored as an attempted answer and simply
#: failed, hiding the fact that MIRA had produced the right diagnosis and then dropped it.
_BOUNCE_MARKERS = (
    "could you rephrase",
    "can you rephrase",
    "rephrase your question",
    "let me think about that differently",
    "i'm not sure what you're asking",
)


def _git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        return out.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return "unknown"


def classify_answer(reply: str, http_status: int) -> AnswerStatus:
    """Bucket the reply before any judgement of correctness.

    Order matters: the UNS gate is checked first because a gate turn often *also* contains
    abstention-shaped language ("I need to know which..."), and misfiling it as an
    abstention would hide a surface mismatch inside the correctness numbers.
    """
    if http_status != 200 or reply.startswith("[ENGINE ERROR"):
        return AnswerStatus.ERROR

    low = reply.lower()
    # The engine's slow-turn placeholder is not an answer (2026-09-27: seed 001 timed out
    # and was scored as `answered`).
    if any(m in low for m in _TIMEOUT_MARKERS):
        return AnswerStatus.ERROR
    # The citation-removal footnote ("_(Note: I removed a citation because I haven't
    # established which machine…)_") says "which machine" without asking the technician
    # anything; matching it filed three real replies as UNS-gate turns on 2026-09-27 and
    # dropped them from the denominator. Gate markers are matched on the reply without it.
    gate_text = _NOTE_RE.sub("", low)
    if any(m in gate_text for m in _UNS_GATE_MARKERS):
        return AnswerStatus.UNS_GATE
    if any(m in low for m in _SAFETY_REFUSAL_MARKERS) and any(
        m in low for m in ("cannot provide", "can't provide", "contact the manufacturer")
    ):
        return AnswerStatus.REFUSED_SAFETY
    if any(m in low for m in _BOUNCE_MARKERS):
        return AnswerStatus.BOUNCED
    if any(m in low for m in _ABSTENTION_MARKERS):
        return AnswerStatus.ABSTAINED
    return AnswerStatus.ANSWERED


def _import_local_pipeline():
    """Import the canonical offline MIRA runner.

    `tests/eval` is not an installed package, so the repo root must be on `sys.path` —
    exactly and only what `offline_run.py` does.

    **Order matters, and getting it wrong fails confusingly.** `mira-bots/tests/` is also a
    package named `tests`, so if `mira-bots` precedes the repo root on the path it wins the
    name and `tests.eval` disappears (`ModuleNotFoundError: No module named 'tests.eval'`).
    That is the same collision `ci.yml` documents when it explains why root `tests/` and
    `mira-bots/tests/` cannot be collected in one pytest process. Repo root goes first;
    `mira-bots` is not added at all, because `local_pipeline` resolves `shared.*` itself.
    """
    root = str(REPO_ROOT)
    if sys.path and sys.path[0] == root:
        pass
    else:
        while root in sys.path:
            sys.path.remove(root)
        sys.path.insert(0, root)
    from tests.eval.local_pipeline import LocalPipeline  # noqa: PLC0415

    return LocalPipeline


def prompt_version() -> str:
    """Content hash of the active diagnostic prompt, not its filename.

    `"active.yaml"` never changes, so recording it would make the reproducibility claim on
    `EvaluationRecord` false: two runs months apart would carry the same "version" while the
    prompt underneath had been rewritten. The hash changes when the prompt does.
    """
    # Codex #4062 rounds 3–4: identify the system prompt the engine actually SELECTS
    # for the turn (direct-answer mode, active.yaml, or the built-in fallback), hashed
    # from its text. If that cannot be determined the run fails rather than stamping
    # a version that may describe a different prompt.
    try:
        _import_local_pipeline()  # puts mira-bots/ on sys.path, as the run itself does
        from shared.workers import rag_worker  # noqa: PLC0415

        text = rag_worker._active_system_prompt()
        if rag_worker._direct_answer_mode():
            mode = "direct-answer"
        elif rag_worker._yaml_system_prompt():
            mode = "active.yaml"
        else:
            mode = "gsd-builtin"
    except Exception as exc:  # noqa: BLE001 - any failure means the version is unknowable
        raise RuntimeError(f"cannot record the prompt version: {exc}") from exc
    digest = hashlib.sha256(text.encode()).hexdigest()[:12]
    return f"{mode}@{digest}"


async def run_question(
    question: QuestionRecord,
    *,
    pipeline=None,
    prompt_version_override: str | None = None,
    retrieval_version: str = "neon-bm25",
) -> EvaluationRecord:
    """Ask MIRA one question, blind, and record what it said.

    `pipeline` is injectable so tests can exercise the adapter without an engine, NeonDB, or
    a provider key.
    """
    run_id = f"ar-{uuid.uuid4().hex[:12]}"
    chat_id = f"answer-radar-{question.question_id}"

    if pipeline is None:
        pipeline = _import_local_pipeline()(
            db_path=os.getenv("ANSWER_RADAR_DB", "/tmp/mira-answer-radar.db"),
            neon_fallback=True,
        )

    # A fresh session per question: prior turns would leak context between unrelated
    # questions and make a run unreproducible.
    pipeline.reset(chat_id)

    t0 = time.monotonic()
    reply, status, latency_ms = await pipeline.call(chat_id, question.normalized_question)
    total_ms = int((time.monotonic() - t0) * 1000)

    chunks: list[str] = []
    getter = getattr(pipeline, "last_retrieved_chunks", None)
    if callable(getter):
        try:
            chunks = list(getter() or [])
        except Exception:  # noqa: BLE001 - retrieval introspection must never fail a run
            chunks = []

    return EvaluationRecord(
        question_id=question.question_id,
        mira_run_id=run_id,
        mira_version=_git_sha(),
        prompt_version=prompt_version_override or prompt_version(),
        retrieval_version=retrieval_version,
        answer_text=reply,
        answer_status=classify_answer(reply, status),
        retrieved_chunk_count=len(chunks),
        source_documents=chunks[:10],
        best_evidence_tier=EvidenceTier.NONE if not chunks else EvidenceTier.TRUSTED_INDEPENDENT,
        total_answer_time_ms=total_ms,
        time_to_first_answer_ms=latency_ms,
    )


def run_question_sync(question: QuestionRecord, **kwargs) -> EvaluationRecord:
    return asyncio.run(run_question(question, **kwargs))
