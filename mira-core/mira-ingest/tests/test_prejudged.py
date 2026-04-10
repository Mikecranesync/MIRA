"""Tests for Prejudged Benchmark — DB tables, CRUD, case parsing, scoring."""

import json
import os
import sys

import pytest

# Add paths before local imports
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.benchmark_db import (  # noqa: E402
    count_prejudged_cases,
    create_prejudged_run,
    ensure_tables,
    finish_prejudged_run,
    get_prejudged_case,
    get_prejudged_run,
    insert_prejudged_case,
    insert_prejudged_conversation,
    list_prejudged_cases,
    list_prejudged_conversations,
    list_prejudged_runs,
    update_prejudged_judge_scores,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_db(tmp_path):
    """Redirect DB to temp location for every test."""
    db_path = str(tmp_path / "test_prejudged.db")
    ensure_tables(db_path)
    yield db_path


SAMPLE_GROUND_TRUTH = {
    "root_cause": "Phase loss on input power",
    "fix": "Replace blown fuse on L2",
    "keywords": ["phase loss", "fuse", "voltage", "overcurrent"],
}


# ---------------------------------------------------------------------------
# 1. Insert + list prejudged cases
# ---------------------------------------------------------------------------


def test_insert_and_list_cases(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="seed-001",
        title="VFD overcurrent on startup",
        equipment_type="VFD",
        fault_category="power",
        evidence_packet="PowerFlex 525 throws F004 on startup",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    assert cid > 0
    cases = list_prejudged_cases(db_path=isolated_db)
    assert len(cases) == 1
    assert cases[0]["title"] == "VFD overcurrent on startup"
    assert cases[0]["source"] == "seed"
    assert cases[0]["equipment_type"] == "VFD"


# ---------------------------------------------------------------------------
# 2. Duplicate source_id is skipped
# ---------------------------------------------------------------------------


def test_duplicate_source_id_skipped(isolated_db):
    insert_prejudged_case(
        source="seed",
        source_id="dup-1",
        title="Case 1",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    dup_id = insert_prejudged_case(
        source="seed",
        source_id="dup-1",
        title="Case 2",
        evidence_packet="test2",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    assert dup_id == -1
    assert count_prejudged_cases(db_path=isolated_db) == 1


# ---------------------------------------------------------------------------
# 3. Count with source filter
# ---------------------------------------------------------------------------


def test_count_with_source_filter(isolated_db):
    insert_prejudged_case(
        source="seed",
        source_id="s1",
        title="Seed case",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    insert_prejudged_case(
        source="reddit_solved",
        source_id="r1",
        title="Reddit case",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    assert count_prejudged_cases(db_path=isolated_db) == 2
    assert count_prejudged_cases(source="seed", db_path=isolated_db) == 1
    assert count_prejudged_cases(source="reddit_solved", db_path=isolated_db) == 1


# ---------------------------------------------------------------------------
# 4. Get single case
# ---------------------------------------------------------------------------


def test_get_prejudged_case(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="get-1",
        title="Test get",
        evidence_packet="evidence",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    case = get_prejudged_case(cid, isolated_db)
    assert case is not None
    assert case["title"] == "Test get"
    gt = json.loads(case["ground_truth"])
    assert gt["root_cause"] == "Phase loss on input power"

    # Non-existent case
    assert get_prejudged_case(9999, isolated_db) is None


# ---------------------------------------------------------------------------
# 5. Ground truth stored as JSON string
# ---------------------------------------------------------------------------


def test_ground_truth_json_storage(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="gt-1",
        title="GT test",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    case = get_prejudged_case(cid, isolated_db)
    gt = json.loads(case["ground_truth"])
    assert isinstance(gt, dict)
    assert "keywords" in gt
    assert len(gt["keywords"]) == 4


# ---------------------------------------------------------------------------
# 6. Prejudged run lifecycle
# ---------------------------------------------------------------------------


def test_prejudged_run_lifecycle(isolated_db):
    run_id = create_prejudged_run(
        metadata={"test": True},
        db_path=isolated_db,
    )
    assert run_id > 0

    run = get_prejudged_run(run_id, isolated_db)
    assert run["status"] == "running"

    finish_prejudged_run(run_id, status="completed", case_count=5, db_path=isolated_db)
    run = get_prejudged_run(run_id, isolated_db)
    assert run["status"] == "completed"
    assert run["case_count"] == 5
    assert run["finished_at"] is not None


# ---------------------------------------------------------------------------
# 7. List runs
# ---------------------------------------------------------------------------


def test_list_prejudged_runs(isolated_db):
    create_prejudged_run(db_path=isolated_db)
    create_prejudged_run(db_path=isolated_db)
    runs = list_prejudged_runs(db_path=isolated_db)
    assert len(runs) == 2


# ---------------------------------------------------------------------------
# 8. Insert conversation + update scores
# ---------------------------------------------------------------------------


def test_insert_conversation_and_scores(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="conv-1",
        title="Conv test",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    run_id = create_prejudged_run(db_path=isolated_db)

    transcript = [
        {"role": "mira", "content": "What equipment?", "state": "Q1", "turn": 0},
        {"role": "technician", "content": "VFD PowerFlex 525", "turn": 0},
        {"role": "mira", "content": "Check input power phases", "state": "DIAGNOSIS", "turn": 1},
    ]

    conv_id = insert_prejudged_conversation(
        run_id=run_id,
        case_id=cid,
        transcript=transcript,
        turn_count=2,
        reached_diagnosis=True,
        final_state="DIAGNOSIS",
        total_latency_ms=3500,
        db_path=isolated_db,
    )
    assert conv_id > 0

    # Update judge scores
    update_prejudged_judge_scores(
        conv_id=conv_id,
        evidence_utilization=8.0,
        path_efficiency=9.0,
        gsd_compliance=7.5,
        root_cause_alignment=8.5,
        expert_comparison=8.0,
        verdict="good",
        judge_reasoning="Good diagnostic path, reached correct area quickly.",
        db_path=isolated_db,
    )

    convs = list_prejudged_conversations(run_id, isolated_db)
    assert len(convs) == 1
    c = convs[0]
    assert c["evidence_utilization"] == 8.0
    assert c["path_efficiency"] == 9.0
    assert c["verdict"] == "good"
    assert c["case_title"] == "Conv test"
    assert c["reached_diagnosis"] == 1


# ---------------------------------------------------------------------------
# 9. Composite score calculation
# ---------------------------------------------------------------------------


def test_composite_score_calculation(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="comp-1",
        title="Composite test",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    run_id = create_prejudged_run(db_path=isolated_db)
    conv_id = insert_prejudged_conversation(
        run_id=run_id,
        case_id=cid,
        transcript=[],
        turn_count=3,
        reached_diagnosis=True,
        db_path=isolated_db,
    )

    # All 8.0 scores → composite should be 8.0
    update_prejudged_judge_scores(
        conv_id=conv_id,
        evidence_utilization=8.0,
        path_efficiency=8.0,
        gsd_compliance=8.0,
        root_cause_alignment=8.0,
        expert_comparison=8.0,
        verdict="good",
        db_path=isolated_db,
    )

    convs = list_prejudged_conversations(run_id, isolated_db)
    assert len(convs) == 1
    # 8.0 * (0.20 + 0.20 + 0.25 + 0.25 + 0.10) = 8.0
    assert abs(convs[0]["composite_score"] - 8.0) < 0.01


# ---------------------------------------------------------------------------
# 10. Transcript stored as JSON array
# ---------------------------------------------------------------------------


def test_transcript_json_storage(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="tx-1",
        title="Transcript test",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    run_id = create_prejudged_run(db_path=isolated_db)
    transcript = [
        {"role": "mira", "content": "hello", "state": "IDLE"},
        {"role": "technician", "content": "hi"},
    ]
    insert_prejudged_conversation(
        run_id=run_id,
        case_id=cid,
        transcript=transcript,
        turn_count=1,
        reached_diagnosis=False,
        db_path=isolated_db,
    )

    convs = list_prejudged_conversations(run_id, isolated_db)
    parsed = json.loads(convs[0]["transcript"])
    assert isinstance(parsed, list)
    assert len(parsed) == 2
    assert parsed[0]["role"] == "mira"
    assert parsed[1]["role"] == "technician"


# ---------------------------------------------------------------------------
# 11. Seed cases file parsing
# ---------------------------------------------------------------------------


def test_seed_cases_file_valid():
    """Verify seed_cases.json is valid and has expected structure."""
    seed_path = os.path.join(REPO_ROOT, "mira-core", "data", "seed_cases.json")
    assert os.path.exists(seed_path), f"seed_cases.json not found at {seed_path}"

    with open(seed_path) as f:
        cases = json.load(f)

    assert isinstance(cases, list)
    assert len(cases) == 10

    for i, case in enumerate(cases):
        assert "id" in case, f"Case {i} missing id"
        assert "title" in case, f"Case {i} missing title"
        assert "evidence_packet" in case, f"Case {i} missing evidence_packet"
        assert "ground_truth" in case, f"Case {i} missing ground_truth"

        gt = case["ground_truth"]
        assert "root_cause" in gt, f"Case {i} ground_truth missing root_cause"
        assert "fix" in gt, f"Case {i} ground_truth missing fix"
        assert "keywords" in gt, f"Case {i} ground_truth missing keywords"
        assert isinstance(gt["keywords"], list), f"Case {i} keywords not a list"
        assert len(gt["keywords"]) >= 5, f"Case {i} has fewer than 5 keywords"


# ---------------------------------------------------------------------------
# 12. Verdict thresholds
# ---------------------------------------------------------------------------


def test_verdict_thresholds():
    """Verify verdict computation logic matches spec."""
    # Import from the benchmark runner
    scripts_path = os.path.join(REPO_ROOT, "mira-bots", "scripts")
    sys.path.insert(0, scripts_path)
    from prejudged_benchmark_run import _compute_verdict  # noqa: E402

    assert _compute_verdict(9.0) == "excellent"
    assert _compute_verdict(8.5) == "excellent"
    assert _compute_verdict(8.4) == "good"
    assert _compute_verdict(7.0) == "good"
    assert _compute_verdict(6.9) == "acceptable"
    assert _compute_verdict(5.0) == "acceptable"
    assert _compute_verdict(4.9) == "poor"
    assert _compute_verdict(3.0) == "poor"
    assert _compute_verdict(2.9) == "failed"
    assert _compute_verdict(0.0) == "failed"


# ---------------------------------------------------------------------------
# 13. Error conversation record
# ---------------------------------------------------------------------------


def test_error_conversation_record(isolated_db):
    cid = insert_prejudged_case(
        source="seed",
        source_id="err-1",
        title="Error test",
        evidence_packet="test",
        ground_truth=SAMPLE_GROUND_TRUTH,
        db_path=isolated_db,
    )
    run_id = create_prejudged_run(db_path=isolated_db)

    conv_id = insert_prejudged_conversation(
        run_id=run_id,
        case_id=cid,
        transcript=[{"role": "mira", "content": "partial", "state": "Q1"}],
        turn_count=1,
        reached_diagnosis=False,
        error="LLM timeout after 30s",
        db_path=isolated_db,
    )
    assert conv_id > 0

    convs = list_prejudged_conversations(run_id, isolated_db)
    assert convs[0]["error"] == "LLM timeout after 30s"
    assert convs[0]["reached_diagnosis"] == 0
