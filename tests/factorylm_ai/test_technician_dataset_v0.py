"""Hermetic tests for the Industrial Technician Dataset v0 review build."""

from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
DECISION_TEMPLATES_DIR = (
    REPO / "docs" / "zta" / "technician-dataset-v0" / "review-decisions" / "templates"
)
CV101_FIRST_PASS = (
    REPO / "docs" / "zta" / "technician-dataset-v0" / "review-decisions" / "cv101-first-pass.md"
)

from factorylm_ai.dataset import SAFETY_SENSITIVE_TAG, assemble_dataset_v0  # noqa: E402
from factorylm_ai.dataset.paid_gate import MIN_LINEAGES  # noqa: E402
from factorylm_ai.dataset.technician_v0 import (  # noqa: E402
    BUILD_ID,
    CANDIDATE_SCHEMA_VERSION,
    ReviewDecision,
    ReviewDecisionError,
    append_review_decision,
    apply_review_decisions,
    build_review_candidates,
    candidate_manifest_for,
    import_review_decisions,
    load_model_support_receipt,
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


def _fill_decision_template(value: Any) -> Any:
    replacements = {
        "__REVIEWER_ID__": "mike@example.com",
        "__RATIONALE__": "reviewed against owned CV-101 source evidence",
        "__DECIDED_AT_ISO__": "2026-07-24T18:00:00Z",
        "__CORRECTED_ASSISTANT_MESSAGE__": ("Corrected answer from reviewed CV-101 evidence."),
        "__REJECTION_REASON__": "answer_key_mismatch",
    }
    if isinstance(value, dict):
        return {k: _fill_decision_template(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill_decision_template(v) for v in value]
    if isinstance(value, str):
        for placeholder, replacement in replacements.items():
            value = value.replace(placeholder, replacement)
    return value


def _template_decision(template_name: str) -> ReviewDecision:
    row = json.loads((DECISION_TEMPLATES_DIR / template_name).read_text(encoding="utf-8"))
    return ReviewDecision.from_dict(_fill_decision_template(row))


def _fill_decision_template_top_level(row: dict[str, Any]) -> dict[str, Any]:
    updated = dict(row)
    updated["reviewer_id"] = "mike@example.com"
    updated["rationale"] = "reviewed against owned CV-101 source evidence"
    updated["decided_at"] = "2026-07-24T18:00:00Z"
    return updated


def test_readiness_candidate_counts_and_composition_targets() -> None:
    rows = _dicts()
    source_counts = Counter(r["source_system"] for r in rows)
    origin_counts = Counter(r["origin"]["real_vs_synthetic"] for r in rows)
    valued = sum(
        1 for r in rows if r["interaction_type"] in {"uncertainty", "refusal", "correction"}
    )
    safety = sum(1 for r in rows if SAFETY_SENSITIVE_TAG in r["tags"])

    # 219 = 149 printsense (132 cv101 one-per-owned-fact + 17 style) + 70 drive.
    # cv101 grew from a padded 70 once sheet E-003's 61 unused owned facts were
    # drawn and the over-drawn sheets were capped at their real fact counts.
    # Style shrank from a padded 40 to one record per distinct owned fact (17):
    # the per-source _repeat_to_count restarted at facts[0] every source, so 40
    # records carried only 8 distinct pairs — same defect class, same fix.
    assert len(rows) == 219
    assert source_counts == {"printsense": 149, "drive_commander": 70}
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
    assert len(dataset.rejected) == 219


def test_lineage_plan_keeps_train_lineages_above_the_gate_floor() -> None:
    """Train-side lineage count, held honestly.

    This asserted >= 25 when sheet E-009 contributed a 25th train lineage — but
    E-009 has NO owned facts, so its records were duplicates of E-001 recycled by
    `_repeat_to_count`. Dropping that fabricated lineage costs one real count and
    is the correct trade; 24 still clears `paid_gate.MIN_LINEAGES == 20` with
    margin. Lower this floor only if a lineage is removed for an equally honest
    reason.
    """

    rows = _dicts()
    train_lineages = {r["document_lineage_key"] for r in rows if r["split"] == "train"}
    registry = source_registry("readiness")
    held_out_lineages = {r["document_lineage_key"] for r in registry if r["split"] == "held_out"}

    assert len(train_lineages) >= 24
    assert len(train_lineages) > MIN_LINEAGES, "train lineages must clear the gate floor"
    assert len(held_out_lineages) >= 5
    assert all(ln.assign_split(k) == "held_out" for k in held_out_lineages)


def test_drive_commander_oem_training_rights_are_granted_exactly_as_scoped() -> None:
    """The 2026-07-25 OEM rights grant is narrow, and PowerFlex 40 stays blocked.

    Supersedes the blanket "all drive sources blocked" assertion by pinning the
    grant's exact scope. The PowerFlex 40 exclusion is a gate invariant, not a
    preference: its lineage is one of five `_HELD_OUT_DOCS` and
    `MIN_HELD_OUT_LINEAGES == 5`, so granting it would shrink the evaluation
    reserve below the floor.
    """

    rows = [r for r in _dicts() if r["source_system"] == "drive_commander"]
    assert rows

    granted = {"automationdirect:gs10-um", "rockwell-automation:520-um001o-en-e"}
    blocked = {"rockwell-automation:22b-um001j-en-e"}
    assert {r["document_lineage_key"] for r in rows} == granted | blocked

    for row in rows:
        codes = {x["code"] for x in row["dataset_rejection_reasons"]}
        if row["document_lineage_key"] in granted:
            assert row["rights"]["training_allowed"] is True
            assert row["rights"]["license_class"] == "public-eval-and-train"
            assert "TRAINING_NOT_ALLOWED" not in codes
            # The grant removes the RIGHTS block only — never the human gate.
            assert {"NOT_GOLD", "APPROVAL_MISSING"} <= codes
        else:
            assert row["rights"]["training_allowed"] is False
            assert row["rights"]["license_class"] == "public-eval-only"
            assert "TRAINING_NOT_ALLOWED" in codes


def test_powerflex_40_stays_out_of_training_and_preserves_held_out_reserve() -> None:
    """Regression guard for the one flip that would silently break the gate."""

    from factorylm_ai.dataset.technician_v0 import _DRIVE_TRAINING_GRANTED, _HELD_OUT_DOCS

    assert "powerflex_40" not in _DRIVE_TRAINING_GRANTED
    assert ("Rockwell Automation", "22B-UM001J-EN-E") in _HELD_OUT_DOCS
    assert len(_HELD_OUT_DOCS) >= 5, "held-out reserve must satisfy MIN_HELD_OUT_LINEAGES"

    pf40 = [
        r for r in _dicts() if r["document_lineage_key"] == "rockwell-automation:22b-um001j-en-e"
    ]
    assert pf40
    assert all(r["split"] == "held_out" for r in pf40)
    assert all(r["rights"]["training_allowed"] is False for r in pf40)


def test_cv101_draws_one_record_per_distinct_owned_fact() -> None:
    """No padding: `_repeat_to_count` must never recycle a sheet's facts.

    Targets previously over-drew badly (E-008 held 1 fact but targeted 12), which
    inflated the record count the paid gate measures while teaching the adapter
    the same fact repeatedly.
    """

    from factorylm_ai.dataset.technician_v0 import _CV101_SHEET_TARGETS, _cv101_facts

    available: dict[str, int] = {}
    for fact in _cv101_facts():
        available[fact["sheet"]] = available.get(fact["sheet"], 0) + 1

    for sheet, target in _CV101_SHEET_TARGETS.items():
        assert target <= available.get(sheet, 0), (
            f"{sheet}: target {target} exceeds {available.get(sheet, 0)} owned facts "
            "— would duplicate training rows"
        )

    cv101 = [r for r in _dicts() if r["review_batch"] == "cv101"]
    hashes = [r["answer_key"]["provenance"]["evidence_hash"] for r in cv101]
    assert len(hashes) == len(set(hashes)), "cv101 records must each cite a distinct fact"


def test_style_batch_draws_one_record_per_distinct_owned_fact() -> None:
    """The style batch had the same padding defect, worse: per-source
    `_repeat_to_count` restarted at `facts[0]` for EVERY source, so the first
    sources all drew the same leading facts — 40 records, 8 distinct pairs.
    One record per fact, dealt round-robin, keeps every style lineage alive
    with zero duplicates.
    """

    style = [r for r in _dicts() if r["review_batch"] == "printsense"]
    hashes = [r["answer_key"]["provenance"]["evidence_hash"] for r in style]
    assert len(hashes) == len(set(hashes)), "style records must each cite a distinct fact"

    from factorylm_ai.dataset.technician_v0 import _printsense_style_sources, _style_facts

    assert len(style) == len(_style_facts()), "one record per owned style fact"
    covered = {r["source_provenance"]["source_id"] for r in style}
    assert covered == {s["source_id"] for s in _printsense_style_sources()}, (
        "every style source keeps at least one record — a vanished source is a "
        "vanished lineage, and lineage count is a paid-gate threshold"
    )


def test_no_review_harness_marker_in_any_training_message() -> None:
    """The `[review case NNN]` suffix was a review-harness artifact inside the
    TRAINING INPUT: it taught the model to expect a marker no real technician
    will ever type, and its per-record uniqueness silently defeated duplicate
    detection (156 "distinct" pairs collapsed to 118 without it). Sequence
    identity belongs in record_id only.
    """

    import re

    marker = re.compile(r"\[review case \d+\]")
    for row in _dicts():
        for message in row["messages"]:
            assert not marker.search(message["content"]), (
                f"{row['record_id']}: harness marker leaked into a {message['role']} message"
            )
    # And the duplicate-detection consequence: user messages that are byte-equal
    # are now VISIBLE as duplicates instead of being masked by unique tails —
    # so within each batch, evidence hashes stay the honest uniqueness signal.


def test_write_build_emits_jsonl_and_readiness_reports(tmp_path: Path) -> None:
    result = write_build(tmp_path, stage="readiness")
    files = result["files"]

    candidate_path = Path(files["candidate_jsonl"])
    lines = candidate_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 219
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


def test_cv101_review_decision_templates_are_placeholder_guarded() -> None:
    candidates = build_review_candidates("readiness")

    for template_path in sorted(DECISION_TEMPLATES_DIR.glob("*.json")):
        raw = json.loads(template_path.read_text(encoding="utf-8"))
        timestamp_only = dict(raw)
        timestamp_only["decided_at"] = "2026-07-24T18:00:00Z"

        for row in (raw, timestamp_only):
            decision = ReviewDecision.from_dict(row)
            try:
                apply_review_decisions(candidates, [decision])
            except ReviewDecisionError as exc:
                assert exc.code == "DECISION_TEMPLATE_PLACEHOLDER"
            else:  # pragma: no cover
                raise AssertionError(f"template was appendable without edits: {template_path.name}")

        if template_path.name.startswith(("correct.", "reject.")):
            decision = ReviewDecision.from_dict(_fill_decision_template_top_level(raw))
            try:
                apply_review_decisions(candidates, [decision])
            except ReviewDecisionError as exc:
                assert exc.code == "DECISION_TEMPLATE_PLACEHOLDER"
            else:  # pragma: no cover
                raise AssertionError(
                    f"template was appendable with action placeholder: {template_path.name}"
                )


def test_cv101_review_decision_templates_bind_to_current_manifest() -> None:
    candidates = build_review_candidates("readiness")
    decisions = [
        _template_decision("approve.techv0-cv101-001.json"),
        _template_decision("correct.techv0-cv101-002.json"),
        _template_decision("reject.techv0-cv101-003.json"),
        _template_decision("hold_out.techv0-cv101-004.json"),
    ]

    reviewed = apply_review_decisions(candidates, decisions)

    assert reviewed.dataset.record_count == 2
    assert {record.record_id for record in reviewed.dataset.eligible} == {
        "techv0-cv101-001",
        "techv0-cv101-002",
    }
    assert reviewed.report["decision_counts"] == {
        "approve": 1,
        "correct": 1,
        "reject": 1,
        "hold_out": 1,
    }
    assert reviewed.report["corrected_records"][0]["record_id"] == "techv0-cv101-002"
    assert reviewed.report["rejected_records"] == [
        {"record_id": "techv0-cv101-003", "rejection_reasons": ["answer_key_mismatch"]}
    ]
    assert reviewed.report["held_out_records"] == [{"record_id": "techv0-cv101-004"}]


def test_cv101_first_pass_review_sheet_references_current_templates_and_records() -> None:
    text = CV101_FIRST_PASS.read_text(encoding="utf-8")
    manifest = candidate_manifest_for(build_review_candidates("readiness"))
    manifest_record_ids = {entry["record_id"] for entry in manifest["entries"]}
    template_names = {path.name for path in DECISION_TEMPLATES_DIR.glob("*.json")}

    linked_templates = set(re.findall(r"templates/([a-z_]+\.techv0-cv101-\d{3}\.json)", text))
    mentioned_records = set(re.findall(r"\btechv0-cv101-\d{3}\b", text))

    assert linked_templates == {
        "approve.techv0-cv101-001.json",
        "correct.techv0-cv101-002.json",
        "reject.techv0-cv101-003.json",
        "hold_out.techv0-cv101-004.json",
    }
    assert linked_templates <= template_names
    assert mentioned_records <= manifest_record_ids
    assert {
        "techv0-cv101-001",
        "techv0-cv101-002",
        "techv0-cv101-003",
        "techv0-cv101-004",
    } <= mentioned_records


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
    # Pick approvable records rather than the first 8 ids: cv101 now spans sheets
    # whose lineages assign to non-train splits (E-003 -> test), and approving one
    # of those is correctly refused as DECISION_GOVERNANCE_BLOCKED.
    approvable = [
        c
        for c in candidates
        if c.to_dict()["review_batch"] == "cv101"
        and c.to_dict()["split"] == "train"
        and c.to_dict()["rights"]["training_allowed"] is True
    ][:8]
    assert len(approvable) == 8
    decisions = [
        _decision(c.record.record_id, "approve", reviewer_id=f"reviewer-{idx}")
        for idx, c in enumerate(approvable, start=1)
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
    # Selected by rights, not by a hardcoded id: the 2026-07-25 grant made
    # techv0-drive-001 (GS10) legitimately approvable, so pin the record that is
    # still rights-blocked rather than one that merely used to be.
    oem_blocked = next(
        c
        for c in candidates
        if c.to_dict()["source_system"] == "drive_commander"
        and c.to_dict()["rights"]["training_allowed"] is False
    )
    oem_approve = _decision(oem_blocked.record.record_id, "approve")
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


def test_import_decisions_appends_a_batch_and_is_idempotent(tmp_path: Path) -> None:
    """Bulk import is the only route that scales to a 100+ record review sitting."""

    ledger = tmp_path / "decisions.jsonl"
    candidates = build_review_candidates("readiness")
    approvable = _approvable_cv101(candidates)[:5]
    batch = tmp_path / "batch.jsonl"
    batch.write_text(
        "\n".join(
            json.dumps(_decision(c.record.record_id, "approve").to_dict(), sort_keys=True)
            for c in approvable
        )
        + "\n",
        encoding="utf-8",
    )

    result = import_review_decisions(ledger, candidates, batch)
    assert result["received"] == 5
    assert result["appended"] == 5
    assert result["duplicate"] == 0
    assert len(load_review_decisions(ledger)) == 5

    # Re-importing the same batch must be a no-op, not a conflict.
    again = import_review_decisions(ledger, candidates, batch)
    assert again["appended"] == 0
    assert again["duplicate"] == 5
    assert len(load_review_decisions(ledger)) == 5


def test_import_decisions_rejects_the_whole_batch_on_one_bad_row(tmp_path: Path) -> None:
    """Fail-closed: a bad row must not leave a half-applied ledger behind."""

    ledger = tmp_path / "decisions.jsonl"
    candidates = build_review_candidates("readiness")
    good = _decision(_approvable_cv101(candidates)[0].record.record_id, "approve").to_dict()
    stale = dict(good)
    stale["record_id"] = good["record_id"]
    stale["candidate_manifest_sha256"] = "0" * 64  # stale manifest
    stale.pop("decision_id", None)
    batch = tmp_path / "batch.jsonl"
    batch.write_text(
        json.dumps(good, sort_keys=True) + "\n" + json.dumps(stale, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ReviewDecisionError):
        import_review_decisions(ledger, candidates, batch)
    assert not ledger.exists() or ledger.read_text(encoding="utf-8").strip() == ""


def test_model_support_receipt_flips_the_gate_check(tmp_path: Path) -> None:
    """`model_support_confirmed` is unreachable by review; the receipt supplies it."""

    receipt = Path("docs/zta/2026-07-25-together-qwen35-9b-model-support-receipt.md")
    evidence = load_model_support_receipt(receipt)
    assert evidence.is_confirmed(), evidence.rejection_reason()
    assert evidence.model_id == "Qwen/Qwen3.5-9B"
    assert evidence.provider == "together"
    assert evidence.receipt_ref

    without = write_build(tmp_path / "without", stage="readiness")
    gate_without = json.loads(Path(without["files"]["phase3_paid_gate"]).read_text())
    assert "model_support_confirmed" in gate_without["blocking"]

    with_evidence = write_build(tmp_path / "with", stage="readiness", model_support=evidence)
    gate_with = json.loads(Path(with_evidence["files"]["phase3_paid_gate"]).read_text())
    assert "model_support_confirmed" not in gate_with["blocking"]


def test_model_support_receipt_is_fail_closed_on_a_wrong_target() -> None:
    """A receipt for some other model must never satisfy the check."""

    import tempfile

    body = (
        "- model_id: `some/other-model`\n"
        "- provider: `together`\n"
        "- checked_at: `2026-07-25T00:00:00Z`\n"
        "- method: `serverless-catalog`\n"
        "- supported: `true`\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as fh:
        fh.write(body)
        path = fh.name
    with pytest.raises(ValueError, match="model_id"):
        load_model_support_receipt(path)


def _approvable_cv101(candidates: list) -> list:
    return [
        c
        for c in candidates
        if c.to_dict()["review_batch"] == "cv101"
        and c.to_dict()["split"] == "train"
        and c.to_dict()["rights"]["training_allowed"] is True
    ]
