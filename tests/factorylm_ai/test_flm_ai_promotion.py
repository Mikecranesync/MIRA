"""Tests for factorylm_ai.promotion — the benchmark-before-assist gate.

Every decision fixture is built from ``schemas/promotion_decision.schema.json``'s
own embedded ``examples`` array (schema-valid by construction) with targeted
overrides — the same "use the schema's own example" discipline as
test_flm_ai_schemas.py. Pure/deterministic: no network, no file I/O
(check_promotion() reads nothing but its argument).
"""

from __future__ import annotations

import copy
from typing import Any

from factorylm_ai.promotion import GateResult, check_promotion
from factorylm_ai.schemas.validate import load_schema

_SCHEMA = load_schema("promotion_decision")
_ALL_PASS_EXAMPLE = _SCHEMA["examples"][0]  # pd_0001: M05, geometry false, allowed true
_BLOCKED_EXAMPLE = _SCHEMA["examples"][1]  # pd_0002: M09, geometry true, allowed false

_ALL_GATE_NAMES = {
    "frozen_benchmark_pass",
    "json_validity_rate",
    "no_evidence_refusal_pass",
    "fabricated_coordinates_pass",
    "tool_call_accuracy",
    "cost_report_present",
    "latency_report_present",
    "rollback",
}


def _decision(**overrides: Any) -> dict[str, Any]:
    """Deep-copy the schema's own all-pass example with targeted overrides."""
    decision = copy.deepcopy(_ALL_PASS_EXAMPLE)
    decision.update(overrides)
    return decision


def _names(results: list[GateResult]) -> set[str]:
    return {r.name for r in results}


def _failed(results: list[GateResult]) -> set[str]:
    return {r.name for r in results if not r.passed}


# ---------------------------------------------------------------------------
# All-pass -> allowed (using the schema's own example, per the build contract)
# ---------------------------------------------------------------------------


def test_schema_all_pass_example_is_allowed():
    allowed, results = check_promotion(copy.deepcopy(_ALL_PASS_EXAMPLE))
    assert allowed is True
    assert results  # non-empty audit trail
    assert _failed(results) == set()


def test_all_pass_decision_reports_every_named_gate_as_passed():
    allowed, results = check_promotion(_decision())
    assert allowed is True
    assert _names(results) == _ALL_GATE_NAMES
    assert all(r.passed for r in results)


def test_check_promotion_does_not_mutate_input():
    decision = _decision()
    original = copy.deepcopy(decision)
    check_promotion(decision)
    assert decision == original


# ---------------------------------------------------------------------------
# The schema's own blocked example (pd_0002: M09 + geometry, both sub-gates fail)
# ---------------------------------------------------------------------------


def test_schema_blocked_example_is_blocked():
    allowed, results = check_promotion(copy.deepcopy(_BLOCKED_EXAMPLE))
    assert allowed is False
    failed = _failed(results)
    assert "fabricated_coordinates_pass" in failed
    assert "tool_call_accuracy" in failed


# ---------------------------------------------------------------------------
# frozen_benchmark_pass / no_evidence_refusal_pass / cost & latency reports
# ---------------------------------------------------------------------------


def test_frozen_benchmark_pass_false_blocked():
    allowed, results = check_promotion(_decision(frozen_benchmark_pass=False))
    assert allowed is False
    assert _failed(results) == {"frozen_benchmark_pass"}


def test_no_evidence_refusal_pass_false_blocked():
    allowed, results = check_promotion(_decision(no_evidence_refusal_pass=False))
    assert allowed is False
    assert _failed(results) == {"no_evidence_refusal_pass"}


def test_cost_report_missing_blocked():
    allowed, results = check_promotion(_decision(cost_report_present=False))
    assert allowed is False
    assert _failed(results) == {"cost_report_present"}


def test_latency_report_missing_blocked():
    allowed, results = check_promotion(_decision(latency_report_present=False))
    assert allowed is False
    assert _failed(results) == {"latency_report_present"}


# ---------------------------------------------------------------------------
# json_validity_rate >= 0.98
# ---------------------------------------------------------------------------


def test_json_validity_rate_below_threshold_blocked():
    allowed, results = check_promotion(_decision(json_validity_rate=0.97))
    assert allowed is False
    assert _failed(results) == {"json_validity_rate"}


def test_json_validity_rate_at_threshold_ok():
    allowed, results = check_promotion(_decision(json_validity_rate=0.98))
    assert allowed is True


# ---------------------------------------------------------------------------
# geometry_involved -> fabricated_coordinates_pass must be present AND true
# ---------------------------------------------------------------------------


def test_geometry_involved_without_fabricated_coordinates_pass_blocked():
    decision = _decision(
        task="M03",
        geometry_involved=True,
        fabricated_coordinates_pass=None,
        tool_call_accuracy=None,
    )
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert _failed(results) == {"fabricated_coordinates_pass"}


def test_geometry_involved_with_fabricated_coordinates_pass_false_blocked():
    decision = _decision(
        task="M03",
        geometry_involved=True,
        fabricated_coordinates_pass=False,
        tool_call_accuracy=None,
    )
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert _failed(results) == {"fabricated_coordinates_pass"}


def test_geometry_involved_with_fabricated_coordinates_pass_true_ok():
    decision = _decision(
        task="M03",
        geometry_involved=True,
        fabricated_coordinates_pass=True,
        tool_call_accuracy=None,
    )
    allowed, results = check_promotion(decision)
    assert allowed is True
    assert _failed(results) == set()


def test_geometry_not_involved_ignores_fabricated_coordinates_pass():
    decision = _decision(geometry_involved=False, fabricated_coordinates_pass=None)
    allowed, results = check_promotion(decision)
    assert allowed is True


# ---------------------------------------------------------------------------
# task == "M09" -> tool_call_accuracy must be present AND >= 0.9
# ---------------------------------------------------------------------------


def test_m09_with_accuracy_below_threshold_blocked():
    decision = _decision(
        task="M09",
        geometry_involved=False,
        fabricated_coordinates_pass=None,
        tool_call_accuracy=0.8,
    )
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert _failed(results) == {"tool_call_accuracy"}


def test_m09_with_accuracy_at_threshold_ok():
    decision = _decision(
        task="M09",
        geometry_involved=False,
        fabricated_coordinates_pass=None,
        tool_call_accuracy=0.9,
    )
    allowed, results = check_promotion(decision)
    assert allowed is True


def test_m09_with_missing_tool_call_accuracy_blocked():
    decision = _decision(
        task="M09",
        geometry_involved=False,
        fabricated_coordinates_pass=None,
        tool_call_accuracy=None,
    )
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert _failed(results) == {"tool_call_accuracy"}


def test_non_m09_task_ignores_tool_call_accuracy():
    decision = _decision(task="M10", tool_call_accuracy=None)
    allowed, results = check_promotion(decision)
    assert allowed is True


# ---------------------------------------------------------------------------
# rollback.previous_default + rollback.revert_procedure non-empty
# ---------------------------------------------------------------------------


def test_rollback_present_but_blank_fields_blocked_by_rollback_gate():
    decision = _decision(rollback={"previous_default": "   ", "revert_procedure": "ok"})
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert _failed(results) == {"rollback"}


def test_rollback_whitespace_only_revert_procedure_blocked_by_rollback_gate():
    # A single space clears the schema's minLength=1 but is not a real revert
    # procedure — this is the defense-in-depth case the rollback gate exists
    # for (distinct from an empty string, which the schema itself rejects).
    decision = _decision(rollback={"previous_default": "mock/m05", "revert_procedure": " "})
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert _failed(results) == {"rollback"}


def test_rollback_empty_revert_procedure_blocked_via_schema_gate():
    decision = _decision(rollback={"previous_default": "mock/m05", "revert_procedure": ""})
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"


# ---------------------------------------------------------------------------
# Missing rollback -> blocked, via the schema gate (rollback is schema-required)
# ---------------------------------------------------------------------------


def test_missing_rollback_key_entirely_blocked_via_schema_gate():
    decision = _decision()
    del decision["rollback"]
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"
    assert results[0].passed is False
    assert "rollback" in results[0].detail


def test_rollback_missing_revert_procedure_key_blocked_via_schema_gate():
    decision = _decision(rollback={"previous_default": "mock/m05"})
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"


# ---------------------------------------------------------------------------
# Malformed decision -> blocked via the schema gate, fail closed
# ---------------------------------------------------------------------------


def test_malformed_decision_wrong_type_blocked_via_schema_gate():
    decision = _decision(json_validity_rate="not-a-number")
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"
    assert results[0].passed is False


def test_malformed_decision_missing_required_field_blocked_via_schema_gate():
    decision = _decision()
    del decision["candidate"]
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"


def test_malformed_decision_extra_field_blocked_via_schema_gate():
    decision = _decision(unexpected_field="nope")
    allowed, results = check_promotion(decision)
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"


def test_empty_dict_blocked_via_schema_gate():
    allowed, results = check_promotion({})
    assert allowed is False
    assert len(results) == 1
    assert results[0].name == "schema"
    assert results[0].passed is False
