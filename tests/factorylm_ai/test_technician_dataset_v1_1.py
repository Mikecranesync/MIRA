"""Technician dataset v1.1 — enriched-answer invariants + gate reachability.

Everything the v1 suite guarantees, plus the v1.1 enrichment contract from
the two hold-out scorecards: every assistant answer carries a citation-or-
location phrase, a literal "Safety floor:" sentence, and a literal
"Next step:" line — while Pattern B / C-without-evidence answers still never
contain the claim.
"""

from __future__ import annotations

import json

from factorylm_ai.dataset import technician_v0 as v0
from factorylm_ai.dataset import technician_v1 as v1
from factorylm_ai.dataset import technician_v1_1 as v11

build_cache: dict = {}


def _candidates():
    return build_cache.setdefault("cands", v11.build_review_candidates_v1_1())


def _claim_of(candidate) -> str:
    return str(candidate.answer_key["withheld_payload"]["claim"]).strip().rstrip(".")


def _user_of(candidate) -> str:
    return next(m["content"] for m in candidate.record.messages if m["role"] == "user")


def _answer_of(candidate) -> str:
    return next(m["content"] for m in candidate.record.messages if m["role"] == "assistant")


def _pattern_of(candidate) -> str:
    tags = candidate.record.tags
    return next(t for t in tags if t.startswith("pattern_")).removeprefix("pattern_")


def test_pool_size_composition_and_ids() -> None:
    cands = _candidates()
    assert len(cands) == 211
    assert all(c.record.record_id.startswith("techv11-") for c in cands), (
        "v1.1 ids must not collide with replayed techv1- console decisions"
    )
    from collections import Counter

    patterns = Counter(_pattern_of(c) for c in cands)
    assert patterns["a"] >= 60
    assert patterns["b"] >= 45
    assert patterns["c"] >= 60


def test_enrichment_markers_on_every_answer() -> None:
    """The v1.1 recipe: citation/location + Safety floor + Next step, always."""
    missing = []
    for c in _candidates():
        a = _answer_of(c)
        low = a.lower()
        cited = ("per the provided" in low) or ("it lives in" in low)
        if not (cited and "Safety floor:" in a and "Next step:" in a):
            missing.append(c.record.record_id)
    assert missing == [], f"answers missing enrichment markers: {missing[:5]}"


def test_evidence_contract_holds_on_every_record() -> None:
    violations = []
    for c in _candidates():
        claim = _claim_of(c)
        user, answer = _user_of(c), _answer_of(c)
        if claim and claim.lower() in answer.lower() and claim.lower() not in user.lower():
            violations.append(c.record.record_id)
    assert violations == [], f"answers state unprovided claims: {violations[:5]}"


def test_pattern_b_never_leaks_the_claim() -> None:
    for c in _candidates():
        if _pattern_of(c) != "b":
            continue
        claim = _claim_of(c)
        assert claim.lower() not in _user_of(c).lower(), c.record.record_id
        assert claim.lower() not in _answer_of(c).lower(), c.record.record_id


def test_pattern_a_carries_evidence_in_user_turn() -> None:
    for c in _candidates():
        if _pattern_of(c) != "a":
            continue
        assert "Evidence (" in _user_of(c), c.record.record_id
        assert _claim_of(c).lower() in _user_of(c).lower(), c.record.record_id


def test_each_fact_appears_in_exactly_one_record() -> None:
    seen: dict[str, str] = {}
    dupes = []
    for c in _candidates():
        key = c.answer_key["key_ref"]
        if key in seen:
            dupes.append((key, seen[key], c.record.record_id))
        seen[key] = c.record.record_id
    assert dupes == [], f"duplicated facts: {dupes[:3]}"


def test_build_is_deterministic() -> None:
    m1 = v11.candidate_manifest_v1_1()
    m2 = v11.candidate_manifest_v1_1()
    assert m1["manifest_sha256"] == m2["manifest_sha256"]
    assert m1["dataset_version"] == v11.DATASET_VERSION


def test_v0_and_v1_untouched_after_v1_1_build() -> None:
    v0_before = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    v1_before = v1.candidate_manifest_v1()["manifest_sha256"]
    v11.candidate_manifest_v1_1()  # runs the override context
    v0_after = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    v1_after = v1.candidate_manifest_v1()["manifest_sha256"]
    assert v0_before == v0_after
    assert v1_before == v1_after
    assert v0.DATASET_VERSION == "factorylm-industrial-technician-v0"


def test_powerflex_40_stays_held_out_and_untrainable() -> None:
    for c in _candidates():
        d = c.to_dict()
        if "powerflex_40" in d["tags"]:
            assert d["split"] == "held_out", d["record_id"]
            assert d["rights"]["training_allowed"] is False, d["record_id"]


def test_refusal_answers_keep_the_no_shape() -> None:
    for c in _candidates():
        if c.record.interaction_type != "refusal":
            continue
        assert _answer_of(c).lstrip().lower().startswith("no"), c.record.record_id


def test_paid_gate_reachable_by_simulated_approval(tmp_path) -> None:
    cands = v11.build_review_candidates_v1_1()
    manifest = v11.candidate_manifest_v1_1()
    entries = {e["record_id"]: e for e in manifest["entries"]}
    decisions = []
    for c in cands:
        d = c.to_dict()
        if d["split"] != "train" or not d["rights"]["training_allowed"]:
            continue
        decisions.append(
            {
                "schema": v0.REVIEW_DECISION_SCHEMA_VERSION,
                "candidate_manifest_sha256": manifest["manifest_sha256"],
                "record_id": d["record_id"],
                "candidate_content_hash": entries[d["record_id"]]["content_hash"],
                "action": "approve",
                "reviewer_id": "mikecranesync",
                "decided_at": "2026-07-28T00:00:00Z",
                "rationale": "gate-reachability simulation (test-only, temp ledger)",
            }
        )
    assert len(decisions) >= 120, f"trainable pool too small: {len(decisions)}"

    decisions_file = tmp_path / "sim_decisions.jsonl"
    decisions_file.write_text("\n".join(json.dumps(d) for d in decisions) + "\n", encoding="utf-8")
    ledger = tmp_path / "sim_ledger.jsonl"
    imported = v11.import_review_decisions_v1_1(ledger, decisions_file)
    assert imported["appended"] == len(decisions)
    assert imported["duplicate"] == 0

    receipt = v0.REPO_ROOT / "docs/zta/2026-07-25-together-qwen35-9b-model-support-receipt.md"
    result = v11.write_build(
        tmp_path / "out",
        decisions_path=ledger,
        model_support=v0.load_model_support_receipt(receipt),
    )
    gate = json.loads(
        (tmp_path / "out" / "reports" / "phase3_paid_gate_report.json").read_text(encoding="utf-8")
    )
    assert gate["blocking"] == [], f"gate blocked: {gate['blocking']}"
    assert all(c["passed"] for c in gate["checks"]), [
        c["name"] for c in gate["checks"] if not c["passed"]
    ]
    assert result["stage"] == "readiness"
