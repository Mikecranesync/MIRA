"""Simulated PLCs for the ProveIt bottling plant.

Each simulated asset behaves like a simple PLC: its own tag set, a cyclic state update, a
running/offline/fault status, counters/process values, and fault bits. Deterministic — no wall clock,
no randomness. The virtual clock is BASE_EPOCH + tick*TICK_SECONDS so telemetry is byte-reproducible.

Tag values are JSON-safe (bool/int/float/str). This module is pure model; transport/IO lives in
telemetry.py and ignition_export.py.
"""
from __future__ import annotations

# Fixed virtual clock — deterministic. (2025-06-15T12:26:40+00:00; value is arbitrary but constant.)
BASE_EPOCH = 1750000000
TICK_SECONDS = 1

# Per-kind PLC spec. tags[] drives both emission order and the Ignition export.
#   process = (tag_name, normal_value, fault_value)
#   fault_stops = does the fault stop the machine (jam/blockage) or just degrade quality (torque)?
#   rejects = does a fault accumulate a reject counter?
KIND_SPECS: dict = {
    "tank": {
        "counter_tag": "fill_cycles", "rate": 1, "process": ("level_pct", 62.0, 6.0),
        "fault_tag": "low_level", "fault_stops": True, "rejects": False,
        "tags": [
            {"name": "status", "data_type": "STRING", "role": "status", "normal": "running", "fault": "fault"},
            {"name": "running", "data_type": "BOOL", "role": "running", "normal": True, "fault": False},
            {"name": "level_pct", "data_type": "REAL", "role": "process", "normal": 62.0, "fault": "<10% low level"},
            {"name": "fill_cycles", "data_type": "DINT", "role": "counter", "normal": "increments/cycle", "fault": "holds"},
            {"name": "low_level", "data_type": "BOOL", "role": "fault", "normal": False, "fault": "TRUE = low-level fault"},
        ],
    },
    "mixer": {
        "counter_tag": "batches", "rate": 1, "process": ("rpm", 1750.0, 0.0),
        "fault_tag": "overload", "fault_stops": True, "rejects": False,
        "tags": [
            {"name": "status", "data_type": "STRING", "role": "status", "normal": "running", "fault": "fault"},
            {"name": "running", "data_type": "BOOL", "role": "running", "normal": True, "fault": False},
            {"name": "rpm", "data_type": "REAL", "role": "process", "normal": 1750.0, "fault": "0 (stopped)"},
            {"name": "batches", "data_type": "DINT", "role": "counter", "normal": "increments/batch", "fault": "holds"},
            {"name": "overload", "data_type": "BOOL", "role": "fault", "normal": False, "fault": "TRUE = motor overload"},
        ],
    },
    "filler": {
        "counter_tag": "bottles_filled", "rate": 2, "process": ("bottles_per_min", 120.0, 0.0),
        "fault_tag": "jam_detected", "fault_stops": True, "rejects": False,
        "tags": [
            {"name": "status", "data_type": "STRING", "role": "status", "normal": "running", "fault": "fault"},
            {"name": "running", "data_type": "BOOL", "role": "running", "normal": True, "fault": False},
            {"name": "bottles_per_min", "data_type": "REAL", "role": "process", "normal": 120.0, "fault": "0 (jammed)"},
            {"name": "bottles_filled", "data_type": "DINT", "role": "counter", "normal": "+2/tick", "fault": "holds"},
            {"name": "jam_detected", "data_type": "BOOL", "role": "fault", "normal": False, "fault": "TRUE = infeed jam"},
        ],
    },
    "capper": {
        "counter_tag": "caps_applied", "rate": 2, "process": ("cap_torque_inlb", 12.0, 9.0),
        "fault_tag": "torque_fault", "fault_stops": False, "rejects": True,
        "tags": [
            {"name": "status", "data_type": "STRING", "role": "status", "normal": "running", "fault": "fault"},
            {"name": "running", "data_type": "BOOL", "role": "running", "normal": True, "fault": True},
            {"name": "cap_torque_inlb", "data_type": "REAL", "role": "process", "normal": 12.0, "fault": "9 (below 12 target)"},
            {"name": "caps_applied", "data_type": "DINT", "role": "counter", "normal": "+2/tick", "fault": "still runs"},
            {"name": "reject_count", "data_type": "DINT", "role": "counter", "normal": "0", "fault": "rises while faulted"},
            {"name": "torque_fault", "data_type": "BOOL", "role": "fault", "normal": False, "fault": "TRUE = torque out of spec"},
        ],
    },
    "labeler": {
        "counter_tag": "labels_applied", "rate": 2, "process": ("label_speed", 120.0, 0.0),
        "fault_tag": "label_low", "fault_stops": True, "rejects": False,
        "tags": [
            {"name": "status", "data_type": "STRING", "role": "status", "normal": "running", "fault": "fault"},
            {"name": "running", "data_type": "BOOL", "role": "running", "normal": True, "fault": False},
            {"name": "label_speed", "data_type": "REAL", "role": "process", "normal": 120.0, "fault": "0 (stopped)"},
            {"name": "labels_applied", "data_type": "DINT", "role": "counter", "normal": "+2/tick", "fault": "holds"},
            {"name": "label_low", "data_type": "BOOL", "role": "fault", "normal": False, "fault": "TRUE = label stock low"},
        ],
    },
    "case_packer": {
        "counter_tag": "cases_packed", "rate": 1, "process": ("pack_rate", 20.0, 0.0),
        "fault_tag": "downstream_blocked", "fault_stops": True, "rejects": False,
        "tags": [
            {"name": "status", "data_type": "STRING", "role": "status", "normal": "running", "fault": "fault"},
            {"name": "running", "data_type": "BOOL", "role": "running", "normal": True, "fault": False},
            {"name": "pack_rate", "data_type": "REAL", "role": "process", "normal": 20.0, "fault": "0 (blocked)"},
            {"name": "cases_packed", "data_type": "DINT", "role": "counter", "normal": "+1/tick", "fault": "holds"},
            {"name": "downstream_blocked", "data_type": "BOOL", "role": "fault", "normal": False, "fault": "TRUE = downstream blocked"},
        ],
    },
}

# Scenario -> which asset faults, the fault tag, and the tick window [start, clear).
SCENARIOS: dict = {
    "normal": {},
    "filler_jam": {"asset": "filler01", "start": 20},
    "capper_fault": {"asset": "capper01", "start": 20},
    "downstream_blocked": {"asset": "casepacker01", "start": 20},
    "recovery": {"asset": "filler01", "start": 15, "clear": 35},
}


def scenario_def(scenario_id: str) -> dict:
    if scenario_id not in SCENARIOS:
        raise ValueError(f"unknown scenario '{scenario_id}' (choose: {', '.join(SCENARIOS)})")
    return SCENARIOS[scenario_id]


def _faulted(asset_key: str, scn: dict, n: int) -> bool:
    if scn.get("asset") != asset_key:
        return False
    if n < scn.get("start", 0):
        return False
    clear = scn.get("clear")
    return clear is None or n < clear


class SimPLC:
    """A single simulated asset/PLC with cyclic state."""

    def __init__(self, asset: dict):
        self.asset = asset
        self.kind = asset["kind"]
        self.spec = KIND_SPECS[self.kind]
        self.counter = 0
        self.reject = 0

    def tick(self, n: int, scn: dict) -> dict:
        """Advance one cycle and return the current {tag_name: value} snapshot."""
        faulted = _faulted(self.asset["key"], scn, n)
        running = not (faulted and self.spec["fault_stops"])
        if running:
            self.counter += self.spec["rate"]
        if faulted and self.spec["rejects"]:
            self.reject += 1

        pname, pnorm, pfault = self.spec["process"]
        # fault deviation: capper drops to a numeric low torque; others go to 0/low.
        if faulted:
            proc_val = 9.0 if self.kind == "capper" else (6.0 if self.kind == "tank" else 0.0)
        else:
            proc_val = pnorm

        vals = {
            "status": "fault" if faulted else "running",
            "running": running,
            self.spec["counter_tag"]: self.counter,
            pname: proc_val,
            self.spec["fault_tag"]: faulted,
        }
        if self.spec["rejects"]:
            vals["reject_count"] = self.reject
        return vals


def build_plcs(assets: list) -> list:
    """One SimPLC per simulated asset (layer == 'simulated')."""
    return [SimPLC(a) for a in assets if a.get("layer") == "simulated" and a["kind"] in KIND_SPECS]
