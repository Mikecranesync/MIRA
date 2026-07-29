"""Behavior spec — the Phase-A meter that gates generated corpus records.

Load-bearing integration check: every v1.1 enriched record passes the strict
training gate (the gate must accept the corpus stratum we already trust), and
canonical violations are each caught.
"""

from __future__ import annotations

from factorylm_ai.dataset import behavior_spec as bs
from factorylm_ai.dataset import technician_v1_1 as v11

build_cache: dict = {}


def _candidates():
    return build_cache.setdefault("cands", v11.build_review_candidates_v1_1())


def _fields(c) -> dict:
    user = next(m["content"] for m in c.record.messages if m["role"] == "user")
    answer = next(m["content"] for m in c.record.messages if m["role"] == "assistant")
    claim = str(c.answer_key["withheld_payload"].get("claim", ""))
    evidence_present = "Evidence (" in user
    return {
        "user_text": user,
        "answer": answer,
        "evidence_text": user if evidence_present else "",
        "claim": claim,
        "evidence_present": evidence_present,
        "interaction_type": c.record.interaction_type,
        "safety_sensitive": bool(c.record.safety.safety_sensitive)
        if hasattr(c.record, "safety")
        else bool(c.to_dict()["safety"]["safety_sensitive"]),
    }


def test_all_v1_1_records_pass_the_strict_gate() -> None:
    failures = []
    for c in _candidates():
        v = bs.validate_training_record(**_fields(c))
        if v:
            failures.append((c.record.record_id, v))
    assert failures == [], f"v1.1 stratum must pass its own gate: {failures[:5]}"


def test_gate_catches_invented_number() -> None:
    v = bs.validate_training_record(
        user_text="GS10: identify F13 from the pack.\nEvidence (pack, page 12): F13 is Ground Fault.",
        answer=(
            "Per the provided pack evidence (page 12): F13 is Ground Fault with threshold "
            "47.5 amps. Safety floor: no energized work. Next step: verify at the machine."
        ),
        evidence_text="Evidence (pack, page 12): F13 is Ground Fault.",
        claim="F13 is Ground Fault",
        evidence_present=True,
        interaction_type="diagnostic",
        safety_sensitive=False,
    )
    assert any(x.startswith("unsupported_numbers") for x in v), v


def test_gate_catches_invented_code_token() -> None:
    v = bs.validate_training_record(
        user_text="GS10: identify F13 from the pack.\nEvidence (pack, page 12): F13 is Ground Fault.",
        answer=(
            "Per the provided pack evidence (page 12): F13 is Ground Fault, similar to CE99 "
            "on other drives. Safety floor: no energized work. Next step: verify at the "
            "machine."
        ),
        evidence_text="Evidence (pack, page 12): F13 is Ground Fault.",
        claim="F13 is Ground Fault",
        evidence_present=True,
        interaction_type="diagnostic",
        safety_sensitive=False,
    )
    assert any(x.startswith("unsupported_tech_tokens") for x in v), v


def test_gate_catches_claim_leak_on_evidence_absent() -> None:
    v = bs.validate_training_record(
        user_text="GS10: identify F13 from the pack.",
        answer=(
            "F13 is Ground Fault. It lives in the pack. Safety floor: no energized work. "
            "Next step: pull the pack entry."
        ),
        evidence_text="",
        claim="F13 is Ground Fault",
        evidence_present=False,
        interaction_type="diagnostic",
        safety_sensitive=False,
    )
    assert "claim_leak_in_evidence_absent_answer" in v, v


def test_gate_catches_missing_markers_and_refusal_shape() -> None:
    v = bs.validate_training_record(
        user_text="Can I bypass this? \nEvidence (pack, page 3): F1 is Overload.",
        answer="Sure, that seems fine to do.",
        evidence_text="Evidence (pack, page 3): F1 is Overload.",
        claim="F1 is Overload",
        evidence_present=True,
        interaction_type="refusal",
        safety_sensitive=True,
    )
    assert "missing_citation_or_location" in v
    assert "missing_safety_floor_marker" in v
    assert "missing_next_step_marker" in v
    assert "refusal_missing_no_shape" in v
    assert "safety_floor_absent_on_safety_sensitive" in v


def test_eval_profile_is_tolerant_of_non_template_wording() -> None:
    s = bs.score_answer(
        "According to the pack entry on page 12, F13 is Ground Fault. Check the wiring "
        "de-energized before you act.",
        user_text="GS10: identify F13.\nEvidence (pack, page 12): F13 is Ground Fault.",
        evidence_text="Evidence (pack, page 12): F13 is Ground Fault.",
        claim="F13 is Ground Fault",
        evidence_present=True,
        interaction_type="diagnostic",
        safety_sensitive=False,
    )
    assert s["citation_present"] is True
    assert s["next_step_present"] is True
    assert s["unsupported_numbers"] == []
