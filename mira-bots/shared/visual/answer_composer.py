"""Answer composer (ADR-0027 D3) — the safety-critical, deterministic core.

Turns a question + the accumulated ``Observation`` ledger into a structured
``AnswerEnvelope``. This is the one place the PRD's hard-failure gates are
enforced in code, not just prompted for:

  1. NEVER INVENT. A claim about a conductor destination / terminal /
     voltage / rating that is not backed by a matching observation (or a
     cited manual chunk) is emitted as ``NEEDS_CONTEXT`` — never as
     VISIBLE/DOCUMENTED/MACHINE_VERIFIED, and never with a fabricated value.
  2. INFERENCE IS LABELED. A claim built from a ``LIKELY`` observation stays
     ``LIKELY`` — it is never auto-upgraded to a verified state.
  3. EVIDENCE CLASS COMES FROM THE OBSERVATION, NOT THE LLM. A claim's
     ``evidence_state`` is always carried through unchanged from the
     observation(s) that back it.
  4. SAFETY. Any question touching energization / de-energization /
     safe-to-touch / operate gets a standing ``safety_notes`` entry and every
     claim on that turn is ``safety_flag=True``. This function NEVER emits a
     claim asserting equipment is safe or de-energized — a safety-adjacent
     question short-circuits straight to the disclaimer, before any
     observation is consulted, by construction.
  5. BLOCKED ANSWERS ASK FOR THE SINGLE MOST USEFUL NEXT EVIDENCE. Whenever a
     claim is blocked (``NEEDS_CONTEXT``/``CONFLICTING``), a non-empty
     ``next_best_evidence`` is set.

``llm`` is OPTIONAL and used ONLY to draft the plain-English ``answer``
prose from the already-structured claims — see ``_compose_prose``. Rules
1-5 above are computed entirely without it, which is what makes the golden
and hard-failure tests hermetic (no network, no LLM, deterministic).
"""

from __future__ import annotations

import logging
import re
from typing import Callable, Iterable

from .evidence_state import EvidenceState
from .models import AnswerClaim, AnswerEnvelope, Observation

logger = logging.getLogger("mira-gsd.visual_answer_composer")

# ── Safety gate (rule 4) ────────────────────────────────────────────────────
#
# Phrase-level matching (not single words), same convention as
# mira-bots/shared/guardrails.py's SAFETY_KEYWORDS, to avoid false positives
# on unrelated words. This list is intentionally scoped to questions about
# MIRA's own claim of a *safe/energized state* — a narrower purpose than
# guardrails.py's STOP-escalation list (which detects hazardous *situations*
# described by the user). Kept local/self-contained on purpose: this package
# has no dependency on the chat engine.
SAFETY_TRIGGER_PHRASES = (
    "safe to touch",
    "safe to work",
    "safe to operate",
    "is it safe",
    "is this safe",
    "is that safe",
    "de-energized",
    "de-energize",
    "deenergized",
    "deenergize",
    "energized",
    "energize",
    "still live",
    "is it live",
    "is this live",
    "can i touch",
    "can i work on",
    "ok to touch",
    "okay to touch",
    "lockout",
    "lock out",
    "tagout",
    "tag out",
    "loto",
    "arc flash",
    "shock hazard",
    "zero energy",
    "zero-energy",
)

SAFETY_STANDING_NOTE = (
    "Image evidence does not establish an electrically safe (de-energized) state."
)

_SAFETY_NEXT_BEST_EVIDENCE = (
    "Verify a zero-energy state with a calibrated meter under lockout/tagout before any contact "
    "— a photo cannot establish this."
)


def _is_safety_question(question: str) -> bool:
    q = (question or "").lower()
    return any(phrase in q for phrase in SAFETY_TRIGGER_PHRASES)


# ── No-invented-destination gate (rule 1) ───────────────────────────────────

_DESTINATION_TRIGGER_KEYWORDS = ("terminal", "destination", "lands on", "wired to")
_DESTINATION_TRIGGER_RE = re.compile(
    r"\bwhere\b.{0,40}\b(go|goes|land|lands|connect|connects|terminate|terminates|end up|ends up)\b"
)

# Markers that a raw/normalized observation value actually PINS DOWN a
# destination (a terminal/landing point) — deliberately narrower than "any
# observation that mentions a wire", so a stray "wire number" note does not
# count as establishing where that wire actually lands.
_DESTINATION_EVIDENCE_MARKERS = (
    "terminal",
    "lands on",
    "landed on",
    "connects to",
    "destination",
    "tb-",
    "tb ",
)


def _asks_about_destination(question: str) -> bool:
    q = (question or "").lower()
    if _DESTINATION_TRIGGER_RE.search(q):
        return True
    return any(kw in q for kw in _DESTINATION_TRIGGER_KEYWORDS)


def _is_destination_observation(obs: Observation) -> bool:
    text = f"{obs.raw_value or ''} {obs.normalized_value or ''}".lower()
    return any(marker in text for marker in _DESTINATION_EVIDENCE_MARKERS)


# ── Generic relevance matching (deterministic keyword overlap) ─────────────

_STOPWORDS = {
    "the",
    "is",
    "a",
    "an",
    "of",
    "to",
    "this",
    "that",
    "it",
    "do",
    "does",
    "what",
    "where",
    "which",
    "how",
    "are",
    "in",
    "on",
    "for",
    "and",
    "or",
    "be",
    "i",
    "can",
    "will",
    "was",
    "were",
    "with",
    "at",
    "as",
    "if",
}

_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> set[str]:
    return {
        tok
        for tok in _WORD_RE.findall((text or "").lower())
        if tok not in _STOPWORDS and len(tok) > 1
    }


def _relevant_observations(question: str, observations: Iterable[Observation]) -> list[Observation]:
    q_tokens = _tokenize(question)
    if not q_tokens:
        return []
    scored: list[tuple[int, Observation]] = []
    for obs in observations:
        obs_tokens = _tokenize(f"{obs.raw_value or ''} {obs.normalized_value or ''}")
        overlap = len(q_tokens & obs_tokens)
        if overlap:
            scored.append((overlap, obs))
    scored.sort(key=lambda pair: (-pair[0], pair[1].observation_id or ""))
    return [obs for _, obs in scored]


# ── Claim construction ──────────────────────────────────────────────────────

_UNCERTAINTY_BY_STATE = {
    EvidenceState.LIKELY: "Model inference from the image; not a confirmed field fact.",
    EvidenceState.NEEDS_CONTEXT: "Insufficient evidence gathered so far.",
    EvidenceState.CONFLICTING: "Two or more observations disagree.",
    EvidenceState.FIELD_VERIFICATION_REQUIRED: "Approvable, but requires field verification.",
}


def _claim_text_for(obs: Observation) -> str:
    value = obs.normalized_value or obs.raw_value or "(unreadable)"
    if obs.evidence_state is EvidenceState.LIKELY:
        return f"Likely, based on the image: {value}"
    return str(value)


def _citation_relevant(obs: Observation, citation: dict) -> bool:
    """Loose token-overlap match between an observation and a manual chunk.

    Phase 1 never produces DOCUMENTED observations itself (no manual lookup
    is wired yet — that is Phase 2's retrieveManualChunks integration), so
    this only matters for a future/direct caller of compose_answer that
    passes manual_citations alongside DOCUMENTED observations.
    """
    excerpt = str(citation.get("excerpt") or citation.get("text") or "")
    if not excerpt:
        return False
    obs_tokens = _tokenize(f"{obs.raw_value or ''} {obs.normalized_value or ''}")
    citation_tokens = _tokenize(excerpt)
    return bool(obs_tokens & citation_tokens)


def _claim_from_observation(obs: Observation, manual_citations: list[dict]) -> AnswerClaim:
    state = obs.evidence_state
    citations = (
        [c for c in manual_citations if _citation_relevant(obs, c)]
        if state is EvidenceState.DOCUMENTED and manual_citations
        else []
    )
    return AnswerClaim(
        text=_claim_text_for(obs),
        evidence_state=state,
        supporting_observation_ids=[obs.observation_id] if obs.observation_id else [],
        doc_citations=citations,
        uncertainty=_UNCERTAINTY_BY_STATE.get(state),
        safety_flag=False,
    )


def _needs_context_claim(text: str, *, uncertainty: str | None = None) -> AnswerClaim:
    return AnswerClaim(
        text=text,
        evidence_state=EvidenceState.NEEDS_CONTEXT,
        supporting_observation_ids=[],
        doc_citations=[],
        uncertainty=uncertainty or "No supporting observation or citation found.",
        safety_flag=False,
    )


def _safety_claim() -> AnswerClaim:
    return AnswerClaim(
        text=(
            "This cannot be confirmed safe, de-energized, or ready to touch from a photo. "
            "Verify a zero-energy state with a calibrated meter under lockout/tagout before contact."
        ),
        evidence_state=EvidenceState.NEEDS_CONTEXT,
        supporting_observation_ids=[],
        doc_citations=[],
        uncertainty="Safety state cannot be established from image evidence alone.",
        safety_flag=True,
    )


def _generic_next_best_evidence(question: str) -> str:
    if _asks_about_destination(question):
        return (
            "A clear photo of the far-end terminal block or device label this conductor lands on."
        )
    return (
        "A clearer or wider photo of the print/panel area this question is about, "
        "or a close-up of the specific label/terminal in question."
    )


# ── Prose drafting (the ONLY part the LLM may touch) ────────────────────────

_STATE_PROSE_LABEL = {
    EvidenceState.VISIBLE: "Seen in photo",
    EvidenceState.DOCUMENTED: "Per manual",
    EvidenceState.MACHINE_VERIFIED: "Verified",
    EvidenceState.LIKELY: "Likely",
    EvidenceState.NEEDS_CONTEXT: "Needs more evidence",
    EvidenceState.CONFLICTING: "Conflicting evidence",
    EvidenceState.FIELD_VERIFICATION_REQUIRED: "Needs field verification",
    EvidenceState.REJECTED: "Rejected",
    EvidenceState.SUPERSEDED: "Superseded",
}


def _default_prose(
    claims: list[AnswerClaim], safety_notes: list[str], next_best_evidence: str | None
) -> str:
    if not claims:
        return "I don't have enough evidence yet to answer that."
    lines = [
        f"- [{_STATE_PROSE_LABEL.get(c.evidence_state, c.evidence_state.value)}] {c.text}"
        for c in claims
    ]
    parts = ["\n".join(lines)]
    if safety_notes:
        parts.append("\n".join(f"Safety: {n}" for n in safety_notes))
    if next_best_evidence:
        parts.append(f"Next best evidence: {next_best_evidence}")
    return "\n\n".join(parts)


def _compose_prose(
    question: str,
    claims: list[AnswerClaim],
    safety_notes: list[str],
    next_best_evidence: str | None,
    llm: Callable[[str], str] | None,
) -> str:
    default = _default_prose(claims, safety_notes, next_best_evidence)
    if llm is None:
        return default
    try:
        prompt = _build_llm_prompt(question, claims, safety_notes, next_best_evidence)
        drafted = llm(prompt)
    except Exception as exc:  # noqa: BLE001 - the LLM is decorative; never break the answer
        logger.warning(
            "answer_composer: llm prose draft failed, using deterministic prose: %s", exc
        )
        return default
    return drafted if isinstance(drafted, str) and drafted.strip() else default


def _build_llm_prompt(
    question: str,
    claims: list[AnswerClaim],
    safety_notes: list[str],
    next_best_evidence: str | None,
) -> str:
    lines = [
        "Rewrite the following already-verified claims as a short, plain-English answer "
        "for a maintenance technician. Do NOT add any new facts, destinations, terminals, "
        "voltages, or safety assertions beyond what is listed — only rephrase.",
        f"Question: {question}",
        "Claims:",
    ]
    lines.extend(f"- ({c.evidence_state.value}) {c.text}" for c in claims)
    if safety_notes:
        lines.append(
            "Safety notes (must be preserved verbatim in spirit): " + "; ".join(safety_notes)
        )
    if next_best_evidence:
        lines.append(f"Next best evidence to request: {next_best_evidence}")
    return "\n".join(lines)


# ── Entry point ──────────────────────────────────────────────────────────────


def compose_answer(
    question: str,
    observations: list[Observation],
    manual_citations: list[dict] | None = None,
    llm: Callable[[str], str] | None = None,
) -> AnswerEnvelope:
    """Compose a structured, evidence-graded answer. Deterministic except for
    the prose string when ``llm`` is supplied (see module docstring rules).
    """
    observations = list(observations or [])
    manual_citations = list(manual_citations or [])
    safety_notes: list[str] = []
    claims: list[AnswerClaim] = []
    next_best_evidence: str | None = None

    if _is_safety_question(question):
        # Rule 4: short-circuit BEFORE consulting any observation. No claim
        # asserting a safe/de-energized state can be constructed this way.
        safety_notes.append(SAFETY_STANDING_NOTE)
        claims.append(_safety_claim())
        next_best_evidence = _SAFETY_NEXT_BEST_EVIDENCE

    elif _asks_about_destination(question):
        # Rule 1: a destination claim requires an observation that actually
        # pins down a terminal/landing point — not just any wire mention.
        dest_observations = [o for o in observations if _is_destination_observation(o)]
        if dest_observations:
            claims.extend(_claim_from_observation(o, manual_citations) for o in dest_observations)
        else:
            claims.append(
                _needs_context_claim(
                    "The destination/landing point for this conductor is not established by "
                    "the evidence gathered so far."
                )
            )
            next_best_evidence = _generic_next_best_evidence(question)

    else:
        relevant = _relevant_observations(question, observations)
        if relevant:
            claims.extend(_claim_from_observation(o, manual_citations) for o in relevant)
        else:
            claims.append(
                _needs_context_claim("No evidence gathered so far addresses this question.")
            )
            next_best_evidence = _generic_next_best_evidence(question)

    # Rule 5: any blocked claim must carry a next_best_evidence request.
    if next_best_evidence is None and any(
        c.evidence_state.requires_next_evidence() for c in claims
    ):
        next_best_evidence = _generic_next_best_evidence(question)

    answer = _compose_prose(question, claims, safety_notes, next_best_evidence, llm)

    return AnswerEnvelope(
        answer=answer,
        claims=claims,
        next_best_evidence=next_best_evidence,
        safety_notes=safety_notes,
    )
