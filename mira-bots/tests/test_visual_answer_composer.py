"""Golden + hard-failure tests for shared.visual.answer_composer.compose_answer.

This is the safety-critical core of Visual Technician Phase 1: claim
evidence_states, no-invention, next_best_evidence, and safety_notes MUST be
computed deterministically WITHOUT an LLM. Every test here calls
compose_answer with llm=None (the default) so it is hermetic -- no network,
no LLM, no DB.

Covers the Phase-1 spec's four required cases:
  (a) grounded: an observation backs a VISIBLE claim carrying its id.
  (b) no invented destination: a destination question with no destination
      evidence yields NEEDS_CONTEXT + next_best_evidence, never a
      fabricated terminal/destination.
  (c) inference stays LIKELY -- never auto-upgraded to a verified state.
  (d) safety: a safety-adjacent question always gets a standing safety note
      and never a claim asserting a safe/de-energized state.
Plus defensive regression coverage (empty ledger, irrelevant ledger, LLM
prose-only substitution, LLM failure fail-open, DOCUMENTED citation match).
"""

from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.visual.answer_composer import compose_answer  # noqa: E402
from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.models import Observation  # noqa: E402


def _obs(**kwargs) -> Observation:
    kwargs.setdefault("observation_id", str(uuid.uuid4()))
    kwargs.setdefault("session_id", "s1")
    kwargs.setdefault("tenant_id", "t1")
    kwargs.setdefault("obs_kind", "entity")
    return Observation(**kwargs)


# ── (a) golden: grounded observation -> VISIBLE claim with its id ──────────


def test_grounded_question_yields_visible_claim_with_observation_id():
    obs = _obs(raw_value="contact CR3 normally open", evidence_state=EvidenceState.VISIBLE, extractor="ocr")

    envelope = compose_answer("What does CR3 do?", [obs])

    assert len(envelope.claims) == 1
    claim = envelope.claims[0]
    assert claim.evidence_state == EvidenceState.VISIBLE
    assert claim.supporting_observation_ids == [obs.observation_id]
    assert "CR3" in claim.text
    assert not envelope.safety_notes


# ── (b) hard failure: no invented destination ───────────────────────────────


def test_no_invented_destination_when_evidence_lacks_one():
    # This observation DOES mention "wire" (so a naive keyword-overlap
    # matcher would be tempted to use it) but does NOT establish a
    # destination/terminal -- the composer must not manufacture one.
    obs = _obs(
        raw_value="wire number 100 visible entering top of panel",
        evidence_state=EvidenceState.VISIBLE,
        extractor="ocr",
    )

    envelope = compose_answer("Where does this wire go?", [obs])

    assert len(envelope.claims) == 1
    claim = envelope.claims[0]
    assert claim.evidence_state == EvidenceState.NEEDS_CONTEXT
    assert envelope.next_best_evidence
    for c in envelope.claims:
        lowered = c.text.lower()
        assert "terminal" not in lowered
        assert "tb-" not in lowered
        assert "lands on" not in lowered
        assert "landed on" not in lowered


def test_destination_question_with_supporting_evidence_is_allowed():
    # The mirror-image positive case: when evidence DOES pin down a
    # destination, the composer is allowed to surface it (carrying the
    # observation's own evidence_state, never upgraded).
    obs = _obs(
        raw_value="wire number 100 lands on terminal TB1-4",
        evidence_state=EvidenceState.VISIBLE,
        extractor="ocr",
    )

    envelope = compose_answer("Where does this wire go?", [obs])

    assert len(envelope.claims) == 1
    claim = envelope.claims[0]
    assert claim.evidence_state == EvidenceState.VISIBLE
    assert claim.supporting_observation_ids == [obs.observation_id]
    assert "TB1-4" in claim.text


# ── (c) inference is labeled LIKELY, never auto-verified ───────────────────


def test_inference_observation_stays_likely_never_auto_verified():
    obs = _obs(
        raw_value="likely a normally-open auxiliary contact on K2",
        evidence_state=EvidenceState.LIKELY,
        extractor="schematic_intelligence",
    )

    envelope = compose_answer("What is K2?", [obs])

    assert len(envelope.claims) == 1
    claim = envelope.claims[0]
    assert claim.evidence_state == EvidenceState.LIKELY
    assert claim.evidence_state not in (EvidenceState.MACHINE_VERIFIED, EvidenceState.VISIBLE)
    assert claim.uncertainty  # inference must be flagged, not presented as fact


# ── (d) safety: never assert a safe/de-energized state ──────────────────────


def test_safety_question_never_asserts_safe_state():
    # A tempting trap: an observation that COULD be misread as "proof" the
    # equipment is de-energized. The composer must not take the bait.
    obs = _obs(
        raw_value="disconnect handle appears to be in the open position",
        evidence_state=EvidenceState.VISIBLE,
        extractor="vision_worker",
    )

    envelope = compose_answer("Is it safe to touch?", [obs])

    assert envelope.safety_notes, "safety_notes must be non-empty for a safety-adjacent question"
    assert any(c.safety_flag for c in envelope.claims)
    for c in envelope.claims:
        lowered = c.text.lower()
        assert "it is safe" not in lowered
        assert "is now safe" not in lowered
        assert "confirmed de-energized" not in lowered
        assert not (
            c.evidence_state in (EvidenceState.VISIBLE, EvidenceState.MACHINE_VERIFIED)
            and "safe" in lowered
        )


def test_safety_question_short_circuits_even_with_no_observations():
    envelope = compose_answer("Can I touch this terminal now?", [])
    assert envelope.safety_notes
    assert len(envelope.claims) == 1
    assert envelope.claims[0].safety_flag is True
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT


# ── Blocked-answer / next-best-evidence coverage ─────────────────────────────


def test_empty_ledger_yields_needs_context_and_next_best_evidence():
    envelope = compose_answer("What does CR3 do?", [])
    assert len(envelope.claims) == 1
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert envelope.next_best_evidence
    assert not envelope.safety_notes


def test_irrelevant_ledger_yields_needs_context():
    obs = _obs(
        raw_value="totally unrelated note about a completely different topic",
        evidence_state=EvidenceState.VISIBLE,
    )
    envelope = compose_answer("What color is the enclosure paint?", [obs])
    assert len(envelope.claims) == 1
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert envelope.next_best_evidence


# ── DOCUMENTED citation matching ─────────────────────────────────────────────


def test_documented_observation_attaches_only_relevant_citation():
    obs = _obs(
        raw_value="per manual, terminal TB1-4 is the neutral landing point",
        normalized_value="TB1-4 neutral landing point",
        evidence_state=EvidenceState.DOCUMENTED,
        extractor="ocr",
    )
    relevant_citation = {
        "doc": "GS10 manual",
        "page": 12,
        "excerpt": "terminal TB1-4 is the neutral landing point",
    }
    unrelated_citation = {
        "doc": "unrelated manual",
        "page": 1,
        "excerpt": "nothing to do with this at all",
    }

    envelope = compose_answer(
        "Where does the neutral wire land?",
        [obs],
        manual_citations=[relevant_citation, unrelated_citation],
    )

    claim = envelope.claims[0]
    assert claim.evidence_state == EvidenceState.DOCUMENTED
    assert relevant_citation in claim.doc_citations
    assert unrelated_citation not in claim.doc_citations


# ── LLM only drafts prose; never changes claims/states ──────────────────────


def test_llm_none_is_fully_deterministic():
    obs = _obs(raw_value="contact CR3 normally open", evidence_state=EvidenceState.VISIBLE)
    first = compose_answer("What does CR3 do?", [obs])
    second = compose_answer("What does CR3 do?", [obs])
    assert first.answer == second.answer
    assert first.claims == second.claims
    assert first.next_best_evidence == second.next_best_evidence
    assert first.safety_notes == second.safety_notes


def test_llm_drafts_prose_but_claims_are_unchanged():
    obs = _obs(raw_value="contact CR3 normally open", evidence_state=EvidenceState.VISIBLE)

    def fake_llm(prompt: str) -> str:
        assert "CR3" in prompt
        return "CR3 is a normally-open auxiliary contact, per the print."

    without_llm = compose_answer("What does CR3 do?", [obs])
    with_llm = compose_answer("What does CR3 do?", [obs], llm=fake_llm)

    assert with_llm.answer == "CR3 is a normally-open auxiliary contact, per the print."
    assert with_llm.answer != without_llm.answer
    assert with_llm.claims == without_llm.claims
    assert with_llm.next_best_evidence == without_llm.next_best_evidence
    assert with_llm.safety_notes == without_llm.safety_notes


def test_llm_failure_falls_back_to_deterministic_prose():
    obs = _obs(raw_value="contact CR3 normally open", evidence_state=EvidenceState.VISIBLE)

    def exploding_llm(prompt: str) -> str:
        raise RuntimeError("provider down")

    without_llm = compose_answer("What does CR3 do?", [obs])
    with_broken_llm = compose_answer("What does CR3 do?", [obs], llm=exploding_llm)

    assert with_broken_llm.answer == without_llm.answer
    assert with_broken_llm.claims == without_llm.claims


def test_llm_empty_response_falls_back_to_deterministic_prose():
    obs = _obs(raw_value="contact CR3 normally open", evidence_state=EvidenceState.VISIBLE)

    without_llm = compose_answer("What does CR3 do?", [obs])
    with_blank_llm = compose_answer("What does CR3 do?", [obs], llm=lambda _prompt: "   ")

    assert with_blank_llm.answer == without_llm.answer


# ── Never emit safety_flag=True on an unrelated, non-safety question ───────


def test_non_safety_question_does_not_set_safety_flag_or_notes():
    obs = _obs(raw_value="contact CR3 normally open", evidence_state=EvidenceState.VISIBLE)
    envelope = compose_answer("What does CR3 do?", [obs])
    assert not envelope.safety_notes
    assert all(c.safety_flag is False for c in envelope.claims)
