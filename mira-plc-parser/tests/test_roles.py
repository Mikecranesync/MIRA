"""Deterministic role categorization tests (spec vocabulary, camelCase/underscore-aware, no LLM)."""
from mira_plc_parser.roles import categorize, needs_review


def test_category_vocabulary():
    assert "safety" in categorize("e_stop_active")
    assert "safety" in categorize("EStopOK")           # camelCase
    assert "fault" in categorize("vfd_comm_err")
    assert "motion" in categorize("MotorRun")
    assert "speed" in categorize("vfd_frequency")
    assert "torque" in categorize("vfd_torque")
    assert "current" in categorize("vfd_current")
    assert "voltage" in categorize("vfd_dc_bus")       # "bus"
    assert "sensor" in categorize("JamPhotoeye")
    assert "command" in categorize("vfd_cmd_word")
    assert "temperature" in categorize("zone_temp")
    assert "pressure" in categorize("line_pressure")


def test_review_gating():
    assert needs_review(["safety"]) is True
    assert needs_review(["fault"]) is True
    assert needs_review(["command"]) is True
    assert needs_review(["speed"]) is False
    assert needs_review([]) is False


def test_no_false_positive_plain_word():
    # a plain status bit shouldn't pick up a category from a buried substring
    assert categorize("heartbeat") == []
