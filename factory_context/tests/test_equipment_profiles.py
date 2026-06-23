"""Equipment-class intelligence: typed assets get expected-signal gaps + failure-mode candidates."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for _p in (str(ROOT / "factory_context"),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import equipment_profiles as ep  # noqa: E402


def test_pump_profile_gap_and_failure_modes():
    # a pump with only flow present -> pressure + electrical are flagged as missing instrumentation
    intel = ep.assess_asset("pump", ["flow"])
    assert intel is not None
    assert set(intel["missing_dimensions"]) == {"pressure", "electrical"}
    assert intel["instrumentation_complete"] is False
    names = [fm["name"] for fm in intel["failure_mode_candidates"]]
    assert "cavitation" in names and any("dead-head" in n for n in names)


def test_fully_instrumented_pump_is_complete():
    intel = ep.assess_asset("pump", ["flow", "pressure", "electrical", "vibration"])
    assert intel["instrumentation_complete"] is True
    assert intel["missing_dimensions"] == []


def test_unknown_equipment_type_returns_none():
    assert ep.assess_asset("", ["flow"]) is None
    assert ep.assess_asset("widget", ["flow"]) is None


def test_candidates_are_framed_as_candidates_not_facts():
    intel = ep.assess_asset("conveyor", ["speed", "electrical"])
    assert "CANDIDATES" in intel["note"]
    # the conveyor library knows the photo-eye jam signature (matches the Conv_Simple flagship)
    assert any("photo-eye" in fm["name"] or "photoeye" in fm["evidence_signature"]
               for fm in intel["failure_mode_candidates"])


def test_library_covers_the_inferred_water_plant_types():
    for t in ("pump", "blower", "clarifier", "basin"):
        assert t in ep.covered_equipment_types()
