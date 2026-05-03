"""Fix proposal generator — deterministic rule engine.

Maps each QualityFlag code to a FixProposal with:
  - affected_file: exact path relative to mira-bots/
  - proposed_change: specific enough to execute with the Edit tool
  - confidence: 0.0–1.0 (how likely this fix resolves the flag)

No LLM calls — all proposals are deterministic based on flag + session data.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from .schema import FixProposal, QualityFlag, SessionQuality

_MIRA_BOTS = Path(os.getenv("MIRA_BOTS_PATH", str(Path(__file__).resolve().parent.parent)))

_FSM_LOOP_N = "3"
_HALLUCINATION_MS = 800
_LATENCY_THRESH_MS = 5000


def _rel(path: str) -> str:
    return str(_MIRA_BOTS / path)


def propose_fixes(session: SessionQuality, flags: list[QualityFlag]) -> list[FixProposal]:
    """Generate one FixProposal per flag, sorted by input severity order."""
    proposals: list[FixProposal] = []
    for flag in flags:
        fn: Callable[[SessionQuality, QualityFlag], FixProposal | None] | None = _RULES.get(flag.code)
        if fn:
            proposal = fn(session, flag)
            if proposal:
                proposals.append(proposal)
    return proposals


# ── Proposal builders ─────────────────────────────────────────────────────────


def _fsm_loop(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    state = "Q2"
    if "'" in flag.description:
        try:
            state = flag.description.split("'")[1]
        except IndexError:
            pass
    return FixProposal(
        flag_code="FSM_LOOP",
        fix_category="fsm_redesign",
        severity="P0",
        title=f"FSM stuck in {state} — add exchange-count fallback branch",
        description=(
            f"Session {session.chat_id} looped in state '{state}' for {_FSM_LOOP_N}+ turns "
            "without progressing. The clarifying question for this state is not eliciting "
            "enough information to advance."
        ),
        affected_file=_rel("shared/engine.py"),
        proposed_change=(
            f"In the {state} handler (search for 'state == \"{state}\"'), add a fallback branch: "
            f"if exchange_count >= 3 and current state is still {state}, "
            "force-transition to DIAGNOSIS using partial fault context rather than re-asking. "
            "Also add the looping utterance(s) as new training phrases in the prompt examples."
        ),
        confidence=0.82,
    )


def _thumbs_down(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    start = session.started_at.isoformat()
    end = (session.ended_at or session.started_at).isoformat()
    return FixProposal(
        flag_code="THUMBS_DOWN",
        fix_category="benchmark_case",
        severity="P0",
        title=f"Add session {session.chat_id[:8]} to prejudged_conversations as regression",
        description=(
            f"User rated session negative. Outcome was '{session.outcome}' with "
            f"avg confidence {session.avg_confidence:.2f}. Locking as regression test."
        ),
        affected_file=_rel("shared/benchmark_db.py"),
        proposed_change=(
            "Call BenchmarkDB.insert_prejudged_conversation() with: "
            f"chat_id='{session.chat_id}', outcome='{session.outcome}', "
            f"expected_outcome='resolved', session_id='{session.session_id}'. "
            f"Fetch full turn transcript from interactions WHERE chat_id='{session.chat_id}' "
            f"AND created_at BETWEEN '{start}' AND '{end}', attach as conversation_json."
        ),
        confidence=0.95,
    )


def _hallucination(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    turns_str = ", ".join(str(t) for t in flag.turns_affected[:3])
    return FixProposal(
        flag_code="HALLUCINATION_RISK",
        fix_category="guardrail_rule",
        severity="P0",
        title="Add guardrail: zero-confidence fast responses must return KB fallback",
        description=(
            f"Turn(s) {turns_str}: bot responded in <{_HALLUCINATION_MS}ms with confidence=none "
            "— no RAG retrieval likely occurred. Response may be hallucinated."
        ),
        affected_file=_rel("shared/guardrails.py"),
        proposed_change=(
            "In check_output() add a new check before returning response: "
            f"if confidence == 'none' and response_time_ms < {_HALLUCINATION_MS} and len(response) > 50: "
            "    return 'I don\\'t have that in my knowledge base. Can you share the fault "
            "code or equipment model number?' "
            "Define KB_NO_COVERAGE_FALLBACK as a module-level constant for reuse."
        ),
        confidence=0.78,
    )


def _low_confidence(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    pct = f"{len(flag.turns_affected)}/{session.total_turns}"
    turns_str = str(flag.turns_affected)
    return FixProposal(
        flag_code="LOW_CONFIDENCE_PERSISTENT",
        fix_category="nlu_training",
        severity="P1",
        title=f"Add {pct} low-confidence turns as NLU training cases",
        description=(
            f"{pct} turns had low/none confidence in session {session.chat_id[:8]}. "
            "The confidence heuristic isn't finding diagnostic keywords in the user's phrasing."
        ),
        affected_file=_rel("shared/benchmark_db.py"),
        proposed_change=(
            f"For each turn in {turns_str}, fetch user_message from interactions "
            "and insert into prejudged_cases with expected_intent='diagnose_equipment', "
            "expected_confidence='medium'. "
            "Then audit HIGH_CONFIDENCE_KEYWORDS in shared/engine.py — add any new "
            "phrasing patterns that describe faults without using standard keywords."
        ),
        confidence=0.71,
    )


def _abandoned(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    last_state = "unknown"
    if "'" in flag.description:
        try:
            last_state = flag.description.split("'")[1]
        except IndexError:
            pass
    return FixProposal(
        flag_code="ABANDONED",
        fix_category="fsm_redesign",
        severity="P1",
        title=f"Session abandoned in '{last_state}' — add recovery prompt",
        description=(
            f"Session {session.chat_id[:8]} ended without resolution "
            f"({session.total_turns} turns, FSM progress {session.fsm_progress_rate:.0%}). "
            "User likely left due to unhelpful or circular responses."
        ),
        affected_file=_rel("shared/engine.py"),
        proposed_change=(
            "In Supervisor._advance_state() or the final-state handler, add a session rescue: "
            "if exchange_count >= 5 and state not in RESOLVED_STATES, send proactively: "
            "'Still working on this? Try sending a photo of the fault display or the model "
            "number — I can look up the manual.' "
            "Also review the prompt for the last active FSM state to check if the question "
            "was too vague or required too much context from the user."
        ),
        confidence=0.65,
    )


def _repetition(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    return FixProposal(
        flag_code="REPETITION",
        fix_category="fsm_redesign",
        severity="P1",
        title="Rewrite clarifying question — user repeated themselves",
        description=(
            f"User sent semantically similar messages {len(flag.turns_affected)} times "
            f"in session {session.chat_id[:8]}. "
            "The clarifying question failed to elicit new information."
        ),
        affected_file=_rel("shared/engine.py"),
        proposed_change=(
            f"In the FSM state handler for turns {flag.turns_affected}, rewrite the "
            "clarifying question to offer 2-3 multiple-choice options instead of open-ended "
            "(e.g., 'Is it (A) not starting, (B) tripping on fault code, or (C) running but "
            "underperforming?'). Ask for a concrete data point: fault code, LED color, rpm. "
            "Add a photo prompt if asset_identified is still None."
        ),
        confidence=0.75,
    )


def _missing_slots(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    return FixProposal(
        flag_code="MISSING_SLOTS",
        fix_category="fsm_redesign",
        severity="P1",
        title=f"Asset not identified after {session.total_turns} exchanges — add disambiguation",
        description=(
            f"Session {session.chat_id[:8]}: {session.total_turns} turns without identifying "
            "the asset. Without asset context RAG retrieval cannot pull the right manual sections."
        ),
        affected_file=_rel("shared/engine.py"),
        proposed_change=(
            "In Q1 or Q2 handler, add an explicit asset disambiguation step: "
            "if exchange_count >= 3 and asset_identified is None, pivot to: "
            "'What\\'s the make/model or asset tag? (e.g. AB PowerFlex 525, Schneider ATV71, tag#)' "
            "as the ONLY question in the turn. "
            "Also check _try_asset_match() — add missing manufacturer abbreviations to "
            "MAINTENANCE_ABBREVIATIONS in guardrails.py (AB=Allen Bradley, SE=Schneider, etc.)."
        ),
        confidence=0.80,
    )


def _high_latency(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    return FixProposal(
        flag_code="HIGH_LATENCY",
        fix_category="threshold_adjustment",
        severity="P2",
        title=f"P95 latency {session.p95_response_time_ms}ms — reduce cascade timeout",
        description=(
            f"Session {session.chat_id[:8]}: P95 response time {session.p95_response_time_ms}ms "
            f"(threshold: {_LATENCY_THRESH_MS}ms). Slow responses increase abandonment rate."
        ),
        affected_file=_rel("shared/inference/router.py"),
        proposed_change=(
            "In InferenceRouter, reduce per-provider timeout to 8s. "
            "Check cascade order: if Gemini is first and timing out, it delays Groq fallback. "
            "In RAGWorker (shared/workers/rag_worker.py), verify the pgvector query uses an "
            "ivfflat or hnsw index — run EXPLAIN on the vector similarity query in NeonDB."
        ),
        confidence=0.60,
    )


def _intent_mismatch(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    turns_str = str(flag.turns_affected)
    return FixProposal(
        flag_code="INTENT_MISMATCH",
        fix_category="nlu_training",
        severity="P2",
        title="Add negative examples — chitchat misclassified during active diagnostic",
        description=(
            f"Turn(s) {flag.turns_affected}: intent='greeting_or_chitchat' during active "
            "diagnostic. This causes FSM to treat a real diagnostic message as small talk."
        ),
        affected_file=_rel("shared/conversation_router.py"),
        proposed_change=(
            f"Fetch misclassified user_message(s) from interactions WHERE id IN {turns_str}. "
            "Add to the conversation_router.py system prompt as negative examples for "
            "greeting_or_chitchat: 'These should NOT be greeting_or_chitchat when session "
            "is mid-diagnostic: [list messages]'. "
            "Also verify detect_session_followup() in guardrails.py intercepts "
            "follow-up messages before router classification when fsm_state is not IDLE."
        ),
        confidence=0.68,
    )


def _low_judge(session: SessionQuality, flag: QualityFlag) -> FixProposal:
    return FixProposal(
        flag_code="LOW_JUDGE_SCORE",
        fix_category="prompt_edit",
        severity="P2",
        title="Low judge score — review response prompt for failing dimension",
        description=(
            f"Judge scored below 3/5 in session {session.chat_id[:8]}. "
            f"Details: {flag.description}"
        ),
        affected_file=_rel("shared/engine.py"),
        proposed_change=(
            "Review judge output in tests/eval/fixtures/auto/ for this session. "
            "Groundedness failures: check rag_worker includes source chunks in system prompt. "
            "Helpfulness failures: review shared/prompts/diagnose/active.yaml — ensure it "
            "asks for fault codes, measurements, and next-step actions explicitly. "
            "Conversational_flow failures: check _advance_state() for the FSM state in "
            "question — verify it isn't skipping or re-asking questions out of order."
        ),
        confidence=0.55,
    )


# ── Dispatch table (defined after all builders) ───────────────────────────────

_RULES: dict[str, Callable[[SessionQuality, QualityFlag], FixProposal | None]] = {
    "FSM_LOOP": _fsm_loop,
    "THUMBS_DOWN": _thumbs_down,
    "HALLUCINATION_RISK": _hallucination,
    "LOW_CONFIDENCE_PERSISTENT": _low_confidence,
    "ABANDONED": _abandoned,
    "REPETITION": _repetition,
    "MISSING_SLOTS": _missing_slots,
    "HIGH_LATENCY": _high_latency,
    "INTENT_MISMATCH": _intent_mismatch,
    "LOW_JUDGE_SCORE": _low_judge,
}
