"""Equipment-class intelligence keyed to the inferred `equipment_type`.

Turns a typed asset (pump / blower / clarifier / conveyor / ...) into:
  * expected instrumentation (by physical dimension) -> instrumentation-GAP detection
  * grounded failure-mode CANDIDATES (generic reliability knowledge for the equipment class)

These are equipment-CLASS knowledge (textbook reliability), NOT customer-specific facts, and they are
emitted as approval-ready CANDIDATES a human confirms — never asserted about a specific plant. That keeps
the "no fact without evidence / human approves" contract while giving MIRA grounded diagnosis starting
points and the HMI a reason to flag missing sensors.

Pure, deterministic, stdlib-only.
"""
from __future__ import annotations

# equipment_type -> profile. `expected` = physical dimensions a healthy install of this class usually has.
# `failure_modes` = (name, the signal signature that points at it) — the evidence a tech/MIRA would check.
EQUIPMENT_PROFILES: dict = {
    "pump": {
        "expected": ["flow", "pressure", "electrical"],
        "failure_modes": [
            ("cavitation", "low/erratic discharge pressure + fluctuating flow + rising vibration/current"),
            ("dead-head (blocked discharge)", "high discharge pressure + low/zero flow"),
            ("loss of prime / dry run", "low flow + low motor current"),
            ("bearing wear", "rising vibration + rising current + rising temperature"),
            ("mechanical seal leak", "leak/level rise + gradual pressure loss"),
            ("impeller wear/clog", "reduced flow at normal current"),
        ],
    },
    "blower": {
        "expected": ["flow", "electrical", "pressure", "temperature"],
        "failure_modes": [
            ("inlet filter blockage", "low airflow + high motor current"),
            ("overheating", "high discharge temperature"),
            ("belt slip / drive fault", "low airflow + normal-or-low current"),
            ("bearing wear", "rising vibration + rising temperature"),
        ],
    },
    "clarifier": {
        "expected": ["torque", "level"],
        "failure_modes": [
            ("rake overload / sludge buildup", "rising rake torque"),
            ("high sludge blanket", "rising blanket level + rising effluent turbidity"),
            ("drive trip", "torque fault / not running"),
        ],
    },
    "basin": {
        "expected": ["concentration", "level", "temperature"],
        "failure_modes": [
            ("low dissolved oxygen", "DO below target (under-aeration)"),
            ("pH excursion", "pH outside band"),
            ("overflow / level high", "level above high setpoint"),
        ],
    },
    "conveyor": {
        "expected": ["speed", "electrical"],
        "failure_modes": [
            ("photo-eye jam / blockage", "photoeye blocked + stopped + no drive fault"),
            ("belt slip / overload", "high motor current / drive overload"),
            ("drive (VFD) fault", "VFD fault code + stopped"),
            ("motor bearing wear", "rising vibration + rising current"),
        ],
    },
    "filler": {
        "expected": ["pressure", "level"],
        "failure_modes": [
            ("infeed jam", "jam bit set + throughput to 0"),
            ("underfill", "low bowl pressure / low supply level"),
            ("valve fault", "fill-valve feedback mismatch"),
        ],
    },
    "capper": {
        "expected": ["torque"],
        "failure_modes": [
            ("torque out of spec", "cap torque below target + rising rejects"),
            ("cap starvation", "cap chute low / empty"),
            ("clutch/pad wear", "drifting torque + high variance"),
        ],
    },
    "tank": {
        "expected": ["level", "temperature", "pressure"],
        "failure_modes": [
            ("low level / starvation", "level below low setpoint"),
            ("overfill", "level above high setpoint"),
            ("temperature excursion", "temp outside band"),
        ],
    },
    "mixer": {
        "expected": ["speed", "electrical", "torque"],
        "failure_modes": [
            ("motor overload", "high current / drive overload"),
            ("agitator bind", "high torque + dropping speed"),
        ],
    },
    "motor": {
        "expected": ["electrical", "speed", "temperature"],
        "failure_modes": [
            ("overload", "current above FLA"),
            ("bearing wear", "rising vibration + rising temperature"),
            ("winding insulation", "rising temperature + trips"),
        ],
    },
}


def assess_asset(equipment_type: str, present_dimensions: list[str]) -> dict | None:
    """Given an asset's equipment_type and the physical dimensions actually present in its signals,
    return its intelligence: expected vs present vs MISSING dimensions + failure-mode candidates.
    Returns None when the equipment class is unknown (nothing to assert)."""
    prof = EQUIPMENT_PROFILES.get(equipment_type)
    if not prof:
        return None
    present = {d for d in present_dimensions if d}
    expected = prof["expected"]
    missing = [d for d in expected if d not in present]
    return {
        "equipment_type": equipment_type,
        "expected_dimensions": expected,
        "present_dimensions": sorted(present & set(expected)),
        "missing_dimensions": missing,           # instrumentation gaps to flag
        "instrumentation_complete": not missing,
        "failure_mode_candidates": [
            {"name": n, "evidence_signature": ev} for n, ev in prof["failure_modes"]
        ],
        "note": "Equipment-class CANDIDATES (generic reliability knowledge) — human confirms; "
                "not asserted about this specific plant.",
    }


def covered_equipment_types() -> list[str]:
    return sorted(EQUIPMENT_PROFILES)
