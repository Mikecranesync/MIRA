"""Hermetic tests for the Industrial Technician Dataset v0 review build."""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.dataset import SAFETY_SENSITIVE_TAG, assemble_dataset_v0  # noqa: E402
from factorylm_ai.dataset.technician_v0 import (  # noqa: E402
    BUILD_ID,
    CANDIDATE_SCHEMA_VERSION,
    build_review_candidates,
    source_registry,
    validate_candidates,
    write_build,
)
from factorylm_ai.governance import lineage as ln  # noqa: E402


def _dicts(stage: str = "readiness") -> list[dict]:
    return [c.to_dict() for c in build_review_candidates(stage)]  # type: ignore[arg-type]


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
