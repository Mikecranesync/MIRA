"""
Deterministic tests for the Fault -> Difference Bundle join (Fault Intelligence, Phase 2b).
Run: pytest tests/simlab/test_fault_bundle.py -q

Offline / read-only: pure function of a run_pipeline() result + the fault dictionary.
No DB, network, cloud, or live LLM.
"""
from demo.factory_difference_engine.fault_bundle import (
    build_fault_bundle, build_fault_bundle_for_scenario,
)
from demo.factory_difference_engine.pipeline import run_pipeline

_RESULT_A = run_pipeline("A", seed=42)


def test_f007_is_corroborated_by_live_differences():
    b = build_fault_bundle("F007", _RESULT_A)
    assert b["fault"]["found"] is True
    assert "low bowl pressure" in b["fault"]["label"].lower()
    assert b["corroboration"] == "corroborated"
    # the fault's referenced tags that are actually abnormal in the event
    assert "filler_bowl_pressure" in b["corroborating_tags"]
    assert "underfill_reject_count" in b["corroborating_tags"]


def test_f007_baseline_vs_current_attached():
    b = build_fault_bundle("F007", _RESULT_A)
    m = {x["tag"]: x for x in b["matched_tags"]}
    bvc = m["filler_bowl_pressure"]["baseline_vs_current"]
    assert bvc["status"] == "below"
    assert bvc["current"] < bvc["normal_lo"]        # 5.13 < 11.7
    assert m["underfill_reject_count"]["baseline_vs_current"]["status"] == "above"


def test_f007_present_but_normal_and_citations():
    b = build_fault_bundle("F007", _RESULT_A)
    assert "tank_level_percent" in b["referenced_present_but_normal"]   # referenced, not abnormal here
    assert b["referenced_absent_from_asset"] == []
    assert "simlab/docs/filler01/fault_code_table.md" in b["cited_sources"]
    assert b["missing_evidence"] == []              # F007 is a fully corroborable process fault
    assert b["suggested_checks"]                    # recommended action carried through
    assert b["review_state"] == "pending"


def test_uncorroborated_fault_is_honest():
    # F002 (Motor Overload) is not the active fault in scenario A
    b = build_fault_bundle("F002", _RESULT_A)
    assert b["fault"]["found"] is True
    assert b["corroboration"] == "uncorroborated"
    assert "motor_current_amps" in b["referenced_present_but_normal"]
    # and it honestly flags the diagnostic the sim cannot corroborate
    assert "overload_count" in {m["suggested_signal"] for m in b["missing_evidence"]}


def test_unknown_code_fails_safe():
    b = build_fault_bundle("NOPE", _RESULT_A)
    assert b["fault"]["found"] is False
    assert b["corroboration"] == "fault_not_found"
    assert b["matched_tags"] == [] and b["corroborating_tags"] == []


def test_deterministic():
    assert build_fault_bundle("F007", _RESULT_A) == build_fault_bundle("F007", _RESULT_A)
    assert build_fault_bundle_for_scenario("F007", "A") == build_fault_bundle_for_scenario("F007", "A")


def test_event_window_and_offline():
    b = build_fault_bundle("F007", _RESULT_A)
    assert b["event_window"]["start_ts"] is not None
    assert b["event_window"]["end_ts"] >= b["event_window"]["start_ts"]
    assert b["scenario"] == "filler_underfill_low_bowl_pressure"
