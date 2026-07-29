"""Technician dataset v1 — evidence-contract invariants + gate reachability.

The load-bearing guarantees (plan: docs/zta/2026-07-27-technician-dataset-v1-plan.md):

1. The v0 hold-out eval's root cause cannot recur: any record whose assistant
   answer states the pack claim carries that claim in its USER turn
   (Pattern A / C-with-evidence), and any record whose user turn lacks the
   claim has an assistant answer that does NOT state it (Pattern B /
   C-without-evidence).
2. Determinism: two builds produce the same manifest hash.
3. The frozen v0 build is untouched by importing/building v1.
4. The paid gate is REACHABLE from the v1 pool (the missing check from
   PR #2911, now a real test): simulating human approval of the trainable
   candidates yields PAID_GATE_PASS.
"""

from __future__ import annotations

import json

from factorylm_ai.dataset import technician_v0 as v0
from factorylm_ai.dataset import technician_v1 as v1


def _candidates():
    return build_cache.setdefault("cands", v1.build_review_candidates_v1())


build_cache: dict = {}


def _claim_of(candidate) -> str:
    return str(candidate.answer_key["withheld_payload"]["claim"]).strip().rstrip(".")


def _user_of(candidate) -> str:
    return next(m["content"] for m in candidate.record.messages if m["role"] == "user")


def _answer_of(candidate) -> str:
    return next(m["content"] for m in candidate.record.messages if m["role"] == "assistant")


def _pattern_of(candidate) -> str:
    tags = candidate.record.tags
    return next(t for t in tags if t.startswith("pattern_")).removeprefix("pattern_")


def test_pool_size_and_composition() -> None:
    cands = _candidates()
    # 211 = v0's 219 minus the 8 cycled durapulse_gs10 duplicates the v1
    # hard-cap removes (12 real gs10 facts vs the v0 target of 20).
    assert len(cands) == 211
    from collections import Counter

    patterns = Counter(_pattern_of(c) for c in cands)
    # ~7/5/7 cycle over the pool — A and C lead, B substantial.
    assert patterns["a"] >= 60
    assert patterns["b"] >= 45
    assert patterns["c"] >= 60


def test_evidence_contract_holds_on_every_record() -> None:
    """The answer is derivable from the user turn: claim-in-answer => claim-in-user."""
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
    """A/B disjointness is structural: one record per distinct fact."""
    seen: dict[str, str] = {}
    dupes = []
    for c in _candidates():
        key = c.answer_key["key_ref"]
        if key in seen:
            dupes.append((key, seen[key], c.record.record_id))
        seen[key] = c.record.record_id
    assert dupes == [], f"duplicated facts: {dupes[:3]}"


def test_build_is_deterministic() -> None:
    m1 = v1.candidate_manifest_v1()
    m2 = v1.candidate_manifest_v1()
    assert m1["manifest_sha256"] == m2["manifest_sha256"]
    assert m1["dataset_version"] == v1.DATASET_VERSION


def test_v0_untouched_after_v1_build() -> None:
    before = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    v1.candidate_manifest_v1()  # runs the override context
    after = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    assert before == after
    assert v0.DATASET_VERSION == "factorylm-industrial-technician-v0"
    assert v0.BUILD_ID == "2026-07-23-technician-dataset-v0"


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
    """Simulate Mike approving every trainable candidate -> gate must PASS.

    This is the reachability proof PR #2911 ran ad hoc and never checked in.
    TEMP ledger only; the real ledger is untouched.
    """
    cands = v1.build_review_candidates_v1()
    manifest = v1.candidate_manifest_v1()
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
                "decided_at": "2026-07-27T00:00:00Z",
                "rationale": "gate-reachability simulation (test-only, temp ledger)",
            }
        )
    # 125 approvable (train-side + rights-granted). The gate needs >=100
    # eligible, so the sitting has 25 rejections of headroom — comparable to
    # v0's real sitting (120 decisions -> 119 eligible).
    assert len(decisions) >= 120, f"trainable pool too small: {len(decisions)}"

    decisions_file = tmp_path / "sim_decisions.jsonl"
    decisions_file.write_text("\n".join(json.dumps(d) for d in decisions) + "\n", encoding="utf-8")
    ledger = tmp_path / "sim_ledger.jsonl"
    imported = v1.import_review_decisions_v1(ledger, decisions_file)
    assert imported["appended"] == len(decisions)
    assert imported["duplicate"] == 0

    receipt = v0.REPO_ROOT / "docs/zta/2026-07-25-together-qwen35-9b-model-support-receipt.md"
    result = v1.write_build(
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
