"""Pure, fail-closed readiness contract for machine-memory operations."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


preflight = _load("machine_memory_preflight", "tools/machine_memory_preflight.py")
provenance = _load("machine_history_provenance", "tools/machine_history_provenance.py")


NOW = "2026-08-30T12:00:00Z"
CV101_PATH = "enterprise.home_garage.conveyor_lab.conveyor_1"
CV101_PATH_HASH = hashlib.sha256(CV101_PATH.encode()).hexdigest()
FAULT_TAG_HASH = hashlib.sha256(b"default_conveyor_fault_alarm").hexdigest()
CONFIG_HASH = "a" * 64
DATABASE_HASH = "b" * 64
DEPLOYMENT_SHA = "c" * 40


def _input(**overrides):
    values = {
        "expected_environment": "staging",
        "observed_environment": "staging",
        "expected_heartbeat_config_sha256": CONFIG_HASH,
        "observed_heartbeat_config_sha256": CONFIG_HASH,
        "expected_deployment_sha": DEPLOYMENT_SHA,
        "inspected_deployment_sha": DEPLOYMENT_SHA,
        "expected_database_identity_hash": DATABASE_HASH,
        "observed_database_identity_hash": DATABASE_HASH,
        "now": NOW,
        "latest_ingested_at": "2026-08-30T11:59:50Z",
        "latest_event_at": "2026-08-30T11:59:49Z",
        "heartbeat_started_at": "2026-08-30T11:59:30Z",
        "heartbeat_finished_at": "2026-08-30T11:59:40Z",
        "heartbeat_status": "ok",
        "heartbeat_software_version": DEPLOYMENT_SHA,
        "heartbeat_detail": {
            "config_sha256": CONFIG_HASH,
            "run_diff_enabled": True,
            "machine_memory_path_hashes": [CV101_PATH_HASH],
            "run_trigger_path_hashes": ["d" * 64],
            "fault_trigger_tag_hashes": [FAULT_TAG_HASH],
        },
        "fault_window_identity": "e" * 64,
        "fault_window_from": "2026-08-30T11:58:00Z",
        "fault_window_to": "2026-08-30T12:00:00Z",
        "replay_from": "2026-08-30T11:58:00Z",
        "replay_to": "2026-08-30T12:00:00Z",
        "fault_window_row_count": 5,
        "fault_window_physical_observation_count": 5,
        "fault_window_simulated_observation_count": 0,
        "fault_window_bad_quality_observation_count": 0,
        "fault_window_unknown_provenance_count": 0,
    }
    values.update(overrides)
    return preflight.MachineMemoryPreflightInput(**values)


def _codes(verdict):
    return [reason.code for reason in verdict.reasons]


def test_healthy_complete_input_is_a_deterministic_go():
    first = preflight.evaluate(_input())
    second = preflight.evaluate(_input())
    assert first.status == preflight.GO
    assert _codes(first) == []
    assert first.snapshot_json == second.snapshot_json


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"observed_environment": "production"}, "ENVIRONMENT_MISMATCH"),
        ({"observed_database_identity_hash": "f" * 64}, "DATABASE_IDENTITY_MISMATCH"),
        ({"heartbeat_detail": {**_input().heartbeat_detail, "run_diff_enabled": False}}, "RUN_DIFF_DISABLED"),
        ({"heartbeat_detail": {**_input().heartbeat_detail, "machine_memory_path_hashes": []}}, "CV101_UNS_NOT_CONFIGURED"),
        ({"heartbeat_detail": {**_input().heartbeat_detail, "fault_trigger_tag_hashes": []}}, "FAULT_TRIGGER_TAGS_NOT_CONFIGURED"),
        ({"latest_ingested_at": "2026-08-30T11:00:00Z"}, "INGEST_STALE"),
        ({"heartbeat_finished_at": "2026-08-30T11:00:00Z"}, "HISTORIAN_EXECUTION_STALE"),
        ({"heartbeat_status": "running", "heartbeat_finished_at": None}, "HISTORIAN_STUCK_RUNNING"),
        ({"heartbeat_status": "error"}, "HISTORIAN_LAST_RUN_FAILED"),
        ({"fault_window_identity": None}, "FAULT_WINDOW_UNOBSERVED"),
        ({"fault_window_row_count": 0, "fault_window_physical_observation_count": 0}, "FAULT_WINDOW_EMPTY"),
        ({"fault_window_physical_observation_count": 0, "fault_window_simulated_observation_count": 5}, "SIMULATED_ONLY"),
        ({"fault_window_bad_quality_observation_count": 5}, "GATEWAY_QUALITY_BAD"),
        ({"fault_window_physical_observation_count": 4, "fault_window_unknown_provenance_count": 1}, "UNKNOWN_PROVENANCE"),
        ({"observed_heartbeat_config_sha256": "f" * 64}, "HISTORIAN_CONFIG_MISMATCH"),
        ({"heartbeat_software_version": "f" * 40}, "HISTORIAN_CONFIG_MISMATCH"),
        ({"heartbeat_software_version": None}, "HISTORIAN_VERSION_UNKNOWN"),
    ],
)
def test_reason_families_are_no_go(changes, code):
    verdict = preflight.evaluate(_input(**changes))
    expected_status = (
        preflight.UNKNOWN
        if code in {"FAULT_WINDOW_UNOBSERVED", "HISTORIAN_VERSION_UNKNOWN"}
        else preflight.NO_GO
    )
    assert verdict.status == expected_status
    assert code in _codes(verdict)


@pytest.mark.parametrize(
    "changes",
    [
        {"latest_ingested_at": None},
        {"latest_event_at": "not-a-timestamp"},
        {"fault_window_row_count": "5"},
        {"fault_window_from": "not-a-timestamp"},
        {"heartbeat_detail": None},
    ],
)
def test_missing_or_malformed_critical_facts_are_unknown(changes):
    verdict = preflight.evaluate(_input(**changes))
    assert verdict.status == preflight.UNKNOWN
    assert "CRITICAL_FACT_UNKNOWN" in _codes(verdict)


def test_ingest_without_a_physical_fault_window_is_no_go():
    verdict = preflight.evaluate(
        _input(fault_window_row_count=0, fault_window_physical_observation_count=0, fault_window_simulated_observation_count=0)
    )
    assert verdict.status == preflight.NO_GO
    assert "FAULT_WINDOW_EMPTY" in _codes(verdict)


def test_missing_historian_execution_is_no_go():
    verdict = preflight.evaluate(_input(heartbeat_started_at=None, heartbeat_finished_at=None))
    assert verdict.status == preflight.NO_GO
    assert _codes(verdict) == ["HISTORIAN_EXECUTION_UNOBSERVED"]


def test_fault_window_observation_partition_must_equal_raw_event_rows():
    verdict = preflight.evaluate(
        _input(fault_window_row_count=5, fault_window_physical_observation_count=4)
    )
    assert verdict.status == preflight.UNKNOWN
    assert "CRITICAL_FACT_UNKNOWN" in _codes(verdict)


def test_inspected_deployment_must_match_the_expected_sha():
    unexpected_sha = "f" * 40
    verdict = preflight.evaluate(
        _input(inspected_deployment_sha=unexpected_sha, heartbeat_software_version=unexpected_sha)
    )
    assert verdict.status == preflight.NO_GO
    assert "HISTORIAN_CONFIG_MISMATCH" in _codes(verdict)


def test_fault_window_must_match_exact_replay_bounds():
    verdict = preflight.evaluate(_input(fault_window_to="2026-08-30T11:59:59Z"))
    assert verdict.status == preflight.NO_GO
    assert "FAULT_WINDOW_BOUNDS_MISMATCH" in _codes(verdict)


def test_matching_but_reversed_replay_bounds_are_no_go():
    verdict = preflight.evaluate(
        _input(
            fault_window_from="2026-08-30T12:00:00Z",
            fault_window_to="2026-08-30T11:58:00Z",
            replay_from="2026-08-30T12:00:00Z",
            replay_to="2026-08-30T11:58:00Z",
        )
    )
    assert verdict.status == preflight.NO_GO
    assert _codes(verdict) == ["FAULT_WINDOW_BOUNDS_MISMATCH"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("machine_memory_path_hashes", CV101_PATH_HASH),
        ("run_trigger_path_hashes", None),
        ("fault_trigger_tag_hashes", ["not-a-sha256"]),
    ],
)
def test_malformed_heartbeat_hash_collections_are_unknown_not_go(field, value):
    detail = {**_input().heartbeat_detail, field: value}
    verdict = preflight.evaluate(_input(heartbeat_detail=detail))
    assert verdict.status == preflight.UNKNOWN
    assert "CRITICAL_FACT_UNKNOWN" in _codes(verdict)


@pytest.mark.parametrize(
    "field",
    ["machine_memory_path_hashes", "fault_trigger_tag_hashes"],
)
def test_none_active_heartbeat_hash_collections_are_unknown_without_exception(field):
    detail = {**_input().heartbeat_detail, field: None}
    verdict = preflight.evaluate(_input(heartbeat_detail=detail))
    assert verdict.status == preflight.UNKNOWN
    assert _codes(verdict)[0] == "CRITICAL_FACT_UNKNOWN"


def test_reasons_have_stable_priority_order():
    verdict = preflight.evaluate(
        _input(
            observed_environment="production",
            observed_database_identity_hash="f" * 64,
            heartbeat_detail={**_input().heartbeat_detail, "run_diff_enabled": False},
            latest_ingested_at="2026-08-30T11:00:00Z",
        )
    )
    assert _codes(verdict) == [
        "ENVIRONMENT_MISMATCH",
        "DATABASE_IDENTITY_MISMATCH",
        "RUN_DIFF_DISABLED",
        "INGEST_STALE",
    ]


def test_snapshot_is_redacted_and_only_contains_safe_facts():
    raw_path = "enterprise.secret.tenant.machine"
    verdict = preflight.evaluate(
        _input(
            expected_environment="staging-secret",
            heartbeat_detail={**_input().heartbeat_detail, "raw_path": raw_path, "password": "nope"},
        )
    )
    assert raw_path not in verdict.snapshot_json
    assert "nope" not in verdict.snapshot_json
    assert "tenant" not in verdict.snapshot_json.lower()
    snapshot = json.loads(verdict.snapshot_json)
    assert snapshot["status"] == preflight.NO_GO
    assert "expected_environment" not in snapshot


def test_shared_fixture_rows_follow_positive_provenance_contract():
    fixture = json.loads((ROOT / "tests/fixtures/machine-history-provenance.v1.json").read_text())
    for row in fixture["events"]:
        result = provenance.classify_event(row)
        assert result.provenance == row["expected"]["provenance"], row["id"]
        assert result.admissible is row["expected"]["admissible"], row["id"]
        assert result.bad_quality is row["expected"]["badQuality"], row["id"]
        assert result.cv101_approved is row["expected"]["cv101Approved"], row["id"]


def test_diffs_never_count_as_observations_or_provenance():
    fixture = json.loads((ROOT / "tests/fixtures/machine-history-provenance.v1.json").read_text())
    coverage = provenance.summarize_fixture(fixture)
    assert coverage == fixture["expectedCoverage"]


@pytest.mark.parametrize(
    "row",
    [
        {"source_system": "IGNITION", "source_connection_id": "cv101-bench-gw", "simulated": False},
        {"source_system": "ignition ", "source_connection_id": "cv101-bench-gw", "simulated": False},
        {"source_system": "ignition", "source_connection_id": " cv101-bench-gw", "simulated": False},
    ],
)
def test_cv101_provenance_does_not_normalize_exact_pair(row):
    result = provenance.classify_event(row)
    assert not result.cv101_approved
