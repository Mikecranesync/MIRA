"""Industry-standard projections — UCUM quantities + ISO 14224 fault records (deterministic)."""

from mira_contextualizer import standards


def test_ucum_maps_unit_to_code_and_kind():
    q = standards.ucum_quantity({"units": "A", "range": "0-9.6", "setpoint": "5 A"})
    assert q == {
        "unit": "A",
        "ucum_code": "A",
        "quantity_kind": "electric current",
        "standard": "UCUM",
        "range": "0-9.6",
        "setpoint": "5 A",
    }


def test_ucum_is_case_insensitive_on_lookup_but_emits_canonical():
    assert standards.ucum_quantity({"units": "hz"})["ucum_code"] == "Hz"
    assert standards.ucum_quantity({"units": "RPM"})["ucum_code"] == "{rpm}"
    assert standards.ucum_quantity({"units": "degC"})["quantity_kind"] == "temperature"


def test_ucum_none_when_no_or_unknown_unit():
    assert standards.ucum_quantity({}) is None
    assert standards.ucum_quantity({"range": "0-60"}) is None  # range but no unit
    assert standards.ucum_quantity({"units": "widgets"}) is None  # not a real unit


def test_iso14224_shape_from_cause_and_next_check():
    iso = standards.iso14224_fault(
        "F004", {"description": "Overcurrent", "cause": "motor short", "next_check": "check wiring"}
    )
    assert iso == {
        "standard": "ISO 14224",
        "fault_code": "F004",
        "failure_mode": "Overcurrent",
        "failure_mechanism": "motor short",
        "maintenance_action": "check wiring",
    }


def test_iso14224_falls_back_to_code_for_missing_mode():
    iso = standards.iso14224_fault("F004", {"cause": "motor short"})
    assert iso["failure_mode"] == "F004" and iso["maintenance_action"] is None


def test_iso14224_none_without_diagnostic_depth():
    # a bare code or description is entity-spotting, not reliability data
    assert standards.iso14224_fault("F004", {"description": "Overcurrent"}) is None
    assert standards.iso14224_fault("F004", {}) is None
