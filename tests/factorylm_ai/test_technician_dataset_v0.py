"""Hermetic tests for the Industrial Technician Dataset v0 review build."""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.dataset import SAFETY_SENSITIVE_TAG, assemble_dataset_v0  # noqa: E402
from factorylm_ai.dataset.technician_v0 import (  # noqa: E402
    BUILD_ID,
    CANDIDATE_SCHEMA_VERSION,
    ReviewDecision,
    ReviewDecisionError,
    append_review_decision,
    apply_review_decisions,
    build_review_candidates,
    candidate_manifest_for,
    load_review_decisions,
    source_registry,
    validate_candidates,
    write_build,
)
from factorylm_ai.governance import lineage as ln  # noqa: E402


def _dicts(stage: str = "readiness") -> list[dict]:
    return [c.to_dict() for c in build_review_candidates(stage)]  # type: ignore[arg-type]


def _manifest_and_entry(record_id: str) -> tuple[dict, dict]:
    candidates = build_review_candidates("readiness")
    manifest = candidate_manifest_for(candidates)
    entry = next(e for e in manifest["entries"] if e["record_id"] == record_id)
    return manifest, entry


def _decision(
    record_id: str,
    action: str,
    *,
    reviewer_id: str = "mike@example.com",
    rationale: str = "reviewed against owned source evidence",
    correction_messages: list[dict] | None = None,
    rejection_reasons: tuple[str, ...] = (),
) -> ReviewDecision:
    manifest, entry = _manifest_and_entry(record_id)
    return ReviewDecision(
        action=action,  # type: ignore[arg-type]
        record_id=record_id,
        candidate_content_hash=entry["content_hash"],
        candidate_manifest_sha256=manifest["manifest_sha256"],
        reviewer_id=reviewer_id,
        rationale=rationale,
        decided_at="2026-07-24T12:00:00Z",
        correction_messages=correction_messages,
        rejection_reasons=rejection_reasons,
    )


def test_readiness_candidate_counts_and_composition_targets() -> None:
    rows = _dicts()
    source_counts = Counter(r["source_system"] for r in rows)
    origin_counts = Counter(r["origin"]["real_vs_synthetic"] for r in rows)
    valued = sum(
        1 for r in rows if r["interaction_type"] in {"uncertainty", "refusal", "correction"}
    )
    safety = sum(1 for r in rows if SAFETY_SENSITIVE_TAG in r["tags"])

    assert len(rows) == 180
    assert source_counts == {"printsense": 110, "drive_commander": 70}
    assert valued >= 30
    assert safety >= 25
    assert origin_counts["synthetic"] / len(rows) <= 0.30
    assert (origin_counts["human_corrected"] + origin_counts["real"]) / len(rows) >= 0.70


def test_candidates_are_review_only_not_gold_or_approved() -> None:
    rows = _dicts()

    assert not validate_candidates(rows)
    assert all(r["schema"] == CANDIDATE_SCHEMA_VERSION for r in rows)
    assert all(r["human_approval"]["approved_by"] is None for r in rows)
    assert all(r["human_approval"]["gold_status"] != "gold" for r in rows)
    assert all(not r["eligible_now"] for r in rows)
    assert all(
        "APPROVAL_MISSING" in {x["code"] for x in r["dataset_rejection_reasons"]} for r in rows
    )


def test_existing_dataset_gate_keeps_review_candidates_out_of_export() -> None:
    records = [c.record for c in build_review_candidates("readiness")]
    dataset = assemble_dataset_v0(records)

    assert dataset.record_count == 0
    assert len(dataset.rejected) == 180


def test_lineage_plan_has_twenty_five_train_lineages_and_five_held_out() -> None:
    rows = _dicts()
    train_lineages = {r["document_lineage_key"] for r in rows if r["split"] == "train"}
    registry = source_registry("readiness")
    held_out_lineages = {r["document_lineage_key"] for r in registry if r["split"] == "held_out"}

    assert len(train_lineages) >= 25
    assert len(held_out_lineages) >= 5
    assert all(ln.assign_split(k) == "held_out" for k in held_out_lineages)


def test_drive_commander_oem_rights_remain_training_blocked() -> None:
    rows = [r for r in _dicts() if r["source_system"] == "drive_commander"]

    assert rows
    assert all(r["rights"]["training_allowed"] is False for r in rows)
    assert all(
        "TRAINING_NOT_ALLOWED" in {x["code"] for x in r["dataset_rejection_reasons"]} for r in rows
    )


def test_write_build_emits_jsonl_and_readiness_reports(tmp_path: Path) -> None:
    result = write_build(tmp_path, stage="readiness")
    files = result["files"]

    candidate_path = Path(files["candidate_jsonl"])
    lines = candidate_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 180
    parsed = [json.loads(line) for line in lines]
    assert not validate_candidates(parsed)

    paid_gate = json.loads(Path(files["phase3_paid_gate"]).read_text(encoding="utf-8"))
    manifest = json.loads(Path(files["manifest"]).read_text(encoding="utf-8"))
    assert paid_gate["verdict"] == "PAID_GATE_BLOCKED"
    assert "min_records" in paid_gate["blocking"]
    assert manifest["build_id"] == BUILD_ID
    assert manifest["dry_run"] == {
        "authorization_consumed": False,
        "deployment_occurred": False,
        "dry_run": True,
        "endpoint_created": False,
        "executed": False,
        "fine_tune_job_created": False,
        "spend_occurred": False,
        "upload_occurred": False,
    }


def test_approve_decision_sets_gold_and_approved_only_through_governance() -> None:
    candidates = build_review_candidates("readiness")
    decision = _decision("techv0-cv101-001", "approve")

    reviewed = apply_review_decisions(candidates, [decision])

    assert reviewed.dataset.record_count == 1
    record = reviewed.dataset.eligible[0]
    assert record.record_id == decision.record_id
    assert record.approved_by == "mike@example.com"
    assert record.candidate.gold_status == "gold"
    assert record.is_dataset_eligible()
    assert reviewed.report["decision_counts"] == {
        "approve": 1,
        "correct": 0,
        "reject": 0,
        "hold_out": 0,
    }
    assert reviewed.report["eligibility_delta"] == {
        "eligible_before": 0,
        "eligible_after": 1,
        "delta": 1,
    }
    assert reviewed.paid_gate.to_dict()["verdict"] == "PAID_GATE_BLOCKED"


def test_correct_decision_creates_reviewed_record_preserving_governance_metadata() -> None:
    candidates = build_review_candidates("readiness")
    original = next(c.record for c in candidates if c.record.record_id == "techv0-cv101-001")
    corrected_messages = [
        original.messages[0],
        original.messages[1],
        {"role": "assistant", "content": "Corrected answer from reviewed CV-101 evidence."},
    ]
    decision = _decision(
        original.record_id,
        "correct",
        rationale="Corrected wording against the CV-101 answer key.",
        correction_messages=corrected_messages,
    )

    reviewed = apply_review_decisions(candidates, [decision])
    record = reviewed.dataset.eligible[0]

    assert record.record_id == original.record_id
    assert record.messages == corrected_messages
    assert record.content_hash() != original.content_hash()
    assert record.document_lineage_key == original.document_lineage_key
    assert record.candidate.corpus_source == original.candidate.corpus_source
    assert record.candidate.evidence_id == original.candidate.evidence_id
    assert record.tags == original.tags
    assert record.interaction_type == original.interaction_type
    assert reviewed.report["corrected_records"][0]["record_id"] == original.record_id


def test_reject_and_hold_out_decisions_remain_auditable_but_ineligible() -> None:
    candidates = build_review_candidates("readiness")
    reject = _decision(
        "techv0-cv101-001",
        "reject",
        rationale="Answer key mismatch.",
        rejection_reasons=("answer_key_mismatch",),
    )
    hold = _decision(
        "techv0-cv101-002",
        "hold_out",
        rationale="Reserve this near-duplicate for evaluation.",
    )

    reviewed = apply_review_decisions(candidates, [reject, hold])

    assert reviewed.dataset.record_count == 0
    assert reviewed.report["decision_counts"] == {
        "approve": 0,
        "correct": 0,
        "reject": 1,
        "hold_out": 1,
    }
    assert reviewed.report["rejected_records"] == [
        {"record_id": reject.record_id, "rejection_reasons": ["answer_key_mismatch"]}
    ]
    assert reviewed.report["held_out_records"] == [{"record_id": hold.record_id}]


def test_stale_hashes_and_missing_reviewer_fail_closed() -> None:
    candidates = build_review_candidates("readiness")
    stale_content = _decision("techv0-cv101-001", "approve").with_updates(
        candidate_content_hash="0" * 64
    )
    stale_manifest = _decision("techv0-cv101-001", "approve").with_updates(
        candidate_manifest_sha256="1" * 64
    )
    missing_reviewer = _decision("techv0-cv101-001", "approve").with_updates(reviewer_id="")

    for decision in (stale_content, stale_manifest, missing_reviewer):
        try:
            apply_review_decisions(candidates, [decision])
        except ReviewDecisionError:
            pass
        else:  # pragma: no cover - keeps the assertion message crisp
            raise AssertionError(f"decision unexpectedly accepted: {decision}")


def test_conflicting_events_reject_but_exact_duplicates_are_idempotent(tmp_path: Path) -> None:
    ledger = tmp_path / "decisions.jsonl"
    candidates = build_review_candidates("readiness")
    approve = _decision("techv0-cv101-001", "approve")
    reject_same_candidate = _decision(
        "techv0-cv101-001",
        "reject",
        rationale="Conflicting later decision.",
        rejection_reasons=("wrong_answer",),
    )

    assert append_review_decision(ledger, candidates, approve) == "appended"
    assert append_review_decision(ledger, candidates, approve) == "duplicate"
    try:
        append_review_decision(ledger, candidates, reject_same_candidate)
    except ReviewDecisionError:
        pass
    else:  # pragma: no cover
        raise AssertionError("conflicting decision was accepted")

    loaded = load_review_decisions(ledger)
    assert loaded == [approve]


def test_concurrent_decision_appends_preserve_valid_jsonl(tmp_path: Path) -> None:
    ledger = tmp_path / "decisions.jsonl"
    candidates = build_review_candidates("readiness")
    decisions = [
        _decision(f"techv0-cv101-{idx:03d}", "approve", reviewer_id=f"reviewer-{idx}")
        for idx in range(1, 9)
    ]

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda decision: append_review_decision(ledger, candidates, decision), decisions
            )
        )

    lines = ledger.read_text(encoding="utf-8").splitlines()
    loaded = load_review_decisions(ledger)
    assert results == ["appended"] * len(decisions)
    assert len(lines) == len(decisions)
    assert len(loaded) == len(decisions)
    assert {decision.record_id for decision in loaded} == {
        decision.record_id for decision in decisions
    }
    assert all(isinstance(json.loads(line), dict) for line in lines)


def test_invalid_correction_oem_block_and_held_out_approval_fail_closed() -> None:
    candidates = build_review_candidates("readiness")
    invalid_correction = _decision(
        "techv0-cv101-001",
        "correct",
        correction_messages=[{"role": "user", "content": "No assistant response"}],
    )
    oem_approve = _decision("techv0-drive-001", "approve")
    held_out = next(c for c in candidates if c.record.candidate.assigned_split() == "held_out")
    held_out_approve = _decision(held_out.record.record_id, "approve")

    for decision in (invalid_correction, oem_approve, held_out_approve):
        try:
            apply_review_decisions(candidates, [decision])
        except ReviewDecisionError:
            pass
        else:  # pragma: no cover
            raise AssertionError(f"blocked decision unexpectedly accepted: {decision}")


def test_write_build_applies_decisions_without_mutating_candidate_jsonl(tmp_path: Path) -> None:
    candidate_build = write_build(tmp_path / "before", stage="readiness")
    before_jsonl = Path(candidate_build["files"]["candidate_jsonl"]).read_text(encoding="utf-8")
    ledger = tmp_path / "decisions.jsonl"
    candidates = build_review_candidates("readiness")
    append_review_decision(
        ledger,
        candidates,
        _decision("techv0-cv101-001", "approve"),
    )

    reviewed_build = write_build(tmp_path / "after", stage="readiness", decisions_path=ledger)

    after_jsonl = Path(reviewed_build["files"]["candidate_jsonl"]).read_text(encoding="utf-8")
    assert after_jsonl == before_jsonl
    review_report = json.loads(
        Path(reviewed_build["files"]["review_decision_report"]).read_text(encoding="utf-8")
    )
    paid_gate = json.loads(Path(reviewed_build["files"]["phase3_paid_gate"]).read_text())
    manifest = json.loads(Path(reviewed_build["files"]["manifest"]).read_text())
    assert review_report["eligibility_delta"]["eligible_after"] == 1
    assert paid_gate["verdict"] == "PAID_GATE_BLOCKED"
    assert "min_records" in paid_gate["blocking"]
    assert manifest["review_decisions"]["decision_counts"]["approve"] == 1
    assert manifest["dry_run"]["authorization_consumed"] is False
