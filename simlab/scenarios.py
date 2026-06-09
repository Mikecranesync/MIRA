"""Replayable fault scenarios for the SimLab Juice Bottling Line.

Six scenarios A–F, each keyed by a stable ``id`` string.
Scenario drift values are pure functions of tick (deterministic).

Scenario IDs
------------
A  filler_underfill_low_bowl_pressure
B  capper_torque_fault
C  labeler_registration_drift
D  casepacker_jam_upstream_block
E  palletizer_unavailable_backup
F  low_plant_air_multi_machine
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Union

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Phase:
    """One stretch of the simulation timeline."""

    start_tick: int
    label: str
    """'normal' | 'fault_onset' | 'degraded' | 'fault_active' | 'recovery' …"""
    drift: dict[str, Union[Any, Callable[[int], Any]]] = field(default_factory=dict)
    """Tag overrides for the primary asset.  Key = bare tag name; value = target
    value or callable(tick) -> value for more complex trajectories."""


@dataclass
class Scenario:
    """A complete replayable fault scenario with a ground-truth rubric."""

    id: str
    title: str
    asset_id: str
    """Primary affected asset (the one whose tags the engine drifts)."""
    normal_state: dict[str, Any]
    """Tag overrides applied when the scenario is loaded (healthy baseline)."""
    timeline: list[Phase]
    alarms_at_tick: dict[int, list[str]]
    """Expected alarm codes, keyed by the tick they should first fire."""
    expected_root_cause: str
    expected_asset: str
    expected_evidence_tags: list[str]
    """Canonical UNS paths that prove the diagnosis."""
    expected_actions: list[str]
    expected_citations: list[str]
    """Doc filenames MIRA should cite."""
    question: str
    """The operator question to pose to MIRA."""
    secondary_normal_state: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Cross-asset initial overrides: {asset_id: {tag_name: value}}.
    Applied at load time alongside ``normal_state``.  Models secondary cascading
    effects (e.g. an upstream conveyor blocking when the downstream casepacker jams).
    """


# ---------------------------------------------------------------------------
# UNS path helper (avoids circular import)
# ---------------------------------------------------------------------------

def _tp(asset_id: str, category: str, tag: str) -> str:
    """Short-hand for simlab.uns.tag_path — avoids module-level import cost."""
    from simlab.uns import tag_path

    return tag_path(asset_id, category, tag)


# ---------------------------------------------------------------------------
# Scenario A — Filler underfill (low bowl pressure)
# ---------------------------------------------------------------------------

def _scenario_a() -> Scenario:
    asset = "filler01"
    return Scenario(
        id="filler_underfill_low_bowl_pressure",
        title="Filler 01 — Underfill from Low Bowl Pressure",
        asset_id=asset,
        normal_state={
            "filler_bowl_pressure": 12.0,
            "fill_level_oz": 16.0,
            "underfill_reject_count": 0,
            "fill_level_variance": 0.05,
        },
        timeline=[
            Phase(
                start_tick=0,
                label="normal",
                drift={},
            ),
            Phase(
                start_tick=30,
                label="fault_onset",
                drift={
                    # Bowl pressure degrades from 12→5 psi over ~60 ticks
                    "filler_bowl_pressure": lambda t: max(5.0, 12.0 - (t - 30) * 0.12),
                },
            ),
            Phase(
                start_tick=60,
                label="fault_active",
                drift={
                    "filler_bowl_pressure": 5.2,
                    # Fill level low (underfill): ~13.5 oz instead of 16
                    "fill_level_oz": lambda t: 13.5 + (((t * 7) % 10) - 5) * 0.1,
                    "fill_level_variance": 0.6,
                    # Underfill reject count climbs ~1 per 10 ticks
                    "underfill_reject_count": lambda t: int((t - 60) / 10) + 1,
                    "fault_code": "F010",
                },
            ),
        ],
        alarms_at_tick={
            # Bowl pressure ramps smoothly 12→5.2 psi after fault_onset (tick 30);
            # it crosses the <8 psi F-LOW-BOWL threshold ~tick 63 and is decisively
            # below it (≈6.0 psi, margin ≫ ripple) by tick 75 — the robust upper bound.
            75: ["F-LOW-BOWL"],
            110: ["F-UNDERFILL"],
        },
        expected_root_cause="Low filler bowl pressure causing underfill",
        expected_asset=asset,
        expected_evidence_tags=[
            _tp(asset, "process", "filler_bowl_pressure"),
            _tp(asset, "process", "fill_level_oz"),
            _tp(asset, "quality", "underfill_reject_count"),
            _tp(asset, "process", "fill_level_variance"),
        ],
        expected_actions=[
            "Check compressed-air header pressure at AirSystem01",
            "Inspect and adjust filler bowl pressure regulator",
            "Verify fill-valve air supply manifold",
            "Inspect nozzle for clogging",
        ],
        expected_citations=[
            "troubleshooting.md",
            "fault_code_table.md",
            "operator_quick_guide.md",
        ],
        question="Why is Line 1 making bad bottles?",
    )


# ---------------------------------------------------------------------------
# Scenario B — Capper torque fault
# ---------------------------------------------------------------------------

def _scenario_b() -> Scenario:
    asset = "capper01"
    return Scenario(
        id="capper_torque_fault",
        title="Capper 01 — Cap Torque Out of Range",
        asset_id=asset,
        normal_state={
            "cap_torque_inlb": 8.5,
            "cap_torque_variance": 0.2,
            "reject_count": 0,
        },
        timeline=[
            Phase(start_tick=0, label="normal", drift={}),
            Phase(
                start_tick=20,
                label="fault_onset",
                drift={
                    # Torque decays as chuck wears
                    "cap_torque_inlb": lambda t: max(5.5, 8.5 - (t - 20) * 0.07),
                    "cap_torque_variance": lambda t: min(2.5, 0.2 + (t - 20) * 0.05),
                },
            ),
            Phase(
                start_tick=50,
                label="fault_active",
                drift={
                    "cap_torque_inlb": 5.5,
                    "cap_torque_variance": 2.5,
                    "reject_count": lambda t: int((t - 50) / 8) + 1,
                    "fault_code": "CA001",
                },
            ),
        ],
        alarms_at_tick={
            52: ["CA-TORQUE"],
        },
        expected_root_cause="Capper chuck wear causing under-torque cap application",
        expected_asset=asset,
        expected_evidence_tags=[
            _tp(asset, "process", "cap_torque_inlb"),
            _tp(asset, "process", "cap_torque_variance"),
            _tp(asset, "quality", "reject_count"),
        ],
        expected_actions=[
            "Inspect capping chuck",
            "Check and adjust clutch torque setting",
            "Verify chuck wear and replace if necessary",
        ],
        expected_citations=[
            "troubleshooting.md",
            "fault_code_table.md",
        ],
        question="Capper is producing loose caps — what is wrong?",
    )


# ---------------------------------------------------------------------------
# Scenario C — Labeler registration drift
# ---------------------------------------------------------------------------

def _scenario_c() -> Scenario:
    asset = "labeler01"
    return Scenario(
        id="labeler_registration_drift",
        title="Labeler 01 — Label Registration Drift",
        asset_id=asset,
        normal_state={
            "registration_error_mm": 0.0,
            "label_web_tension": 1.2,
            "reject_count": 0,
        },
        timeline=[
            Phase(start_tick=0, label="normal", drift={}),
            Phase(
                start_tick=15,
                label="fault_onset",
                drift={
                    "label_web_tension": lambda t: max(0.4, 1.2 - (t - 15) * 0.02),
                    "registration_error_mm": lambda t: min(3.0, (t - 15) * 0.08),
                },
            ),
            Phase(
                start_tick=50,
                label="fault_active",
                drift={
                    "registration_error_mm": lambda t: 2.8 + ((t * 3) % 5) * 0.1,
                    "label_web_tension": 0.4,
                    "reject_count": lambda t: int((t - 50) / 12) + 1,
                    "fault_code": "L001",
                },
            ),
        ],
        alarms_at_tick={
            53: ["L-REG-DRIFT"],
        },
        expected_root_cause="Label web tension loss causing registration drift",
        expected_asset=asset,
        expected_evidence_tags=[
            _tp(asset, "process", "registration_error_mm"),
            _tp(asset, "process", "label_web_tension"),
            _tp(asset, "quality", "reject_count"),
        ],
        expected_actions=[
            "Inspect web tension rollers",
            "Clean registration sensor",
            "Check label roll splice",
            "Recalibrate registration offset",
        ],
        expected_citations=[
            "troubleshooting.md",
            "fault_code_table.md",
        ],
        question="Labels are coming out crooked — why?",
    )


# ---------------------------------------------------------------------------
# Scenario D — Case packer jam blocks upstream
# ---------------------------------------------------------------------------

def _scenario_d() -> Scenario:
    asset = "casepacker01"
    return Scenario(
        id="casepacker_jam_upstream_block",
        title="Case Packer 01 — Jam Causes Upstream Backpressure",
        asset_id=asset,
        normal_state={
            "jam_detected": False,
            "case_count": 0,
            "reject_count": 0,
        },
        timeline=[
            Phase(start_tick=0, label="normal", drift={}),
            Phase(
                start_tick=10,
                label="fault_active",
                drift={
                    "jam_detected": True,
                    "fault_code": "CP001",
                },
            ),
        ],
        alarms_at_tick={
            10: ["CP-JAM"],
        },
        expected_root_cause="Case packer infeed jam causing upstream line stop",
        expected_asset=asset,
        expected_evidence_tags=[
            _tp(asset, "status", "jam_detected"),
            _tp("conveyorzone02", "status", "blocked"),
        ],
        expected_actions=[
            "Clear jam at case packer infeed",
            "Check downstream palletizer status",
            "Restart case packer after clearing jam",
        ],
        expected_citations=[
            "troubleshooting.md",
            "fault_code_table.md",
        ],
        question="Line stopped — case packer is down, what do I do?",
        secondary_normal_state={
            # Upstream jam causes conveyor zone 2 to back up
            "conveyorzone02": {"blocked": True},
        },
    )


# ---------------------------------------------------------------------------
# Scenario E — Palletizer unavailable, cases back up
# ---------------------------------------------------------------------------

def _scenario_e() -> Scenario:
    asset = "palletizer01"
    return Scenario(
        id="palletizer_unavailable_backup",
        title="Palletizer 01 — Unavailable, Cases Accumulate",
        asset_id=asset,
        normal_state={
            "robot_ready": True,
            "jam_detected": False,
            "pallet_present": True,
        },
        timeline=[
            Phase(start_tick=0, label="normal", drift={}),
            Phase(
                start_tick=5,
                label="fault_active",
                drift={
                    "robot_ready": False,
                    "fault_code": "PA001",
                },
            ),
        ],
        alarms_at_tick={},
        expected_root_cause="Palletizer robot e-stop causes case accumulation upstream",
        expected_asset=asset,
        expected_evidence_tags=[
            _tp(asset, "status", "robot_ready"),
            _tp("casepacker01", "status", "jam_detected"),
        ],
        expected_actions=[
            "Clear palletizer safety zone",
            "Acknowledge e-stop and restart robot",
            "Stage empty pallet if needed",
        ],
        expected_citations=[
            "troubleshooting.md",
            "fault_code_table.md",
        ],
        question="Cases are piling up and the palletizer is stopped — why?",
        secondary_normal_state={
            # Palletizer e-stop causes case accumulation — casepacker backs up
            "casepacker01": {"jam_detected": True},
        },
    )


# ---------------------------------------------------------------------------
# Scenario F — Low plant air → multi-machine symptoms
# ---------------------------------------------------------------------------

def _scenario_f() -> Scenario:
    # Root cause is AirSystem01 — secondary symptoms appear at Depalletizer, Capper, CasePacker
    asset = "airsystem01"
    return Scenario(
        id="low_plant_air_multi_machine",
        title="AirSystem 01 — Low Plant Air Pressure (Multi-Machine Impact)",
        asset_id=asset,
        normal_state={
            "header_pressure_psi": 90.0,
            "compressor_running": True,
            "low_air_alarm": False,
        },
        timeline=[
            Phase(start_tick=0, label="normal", drift={}),
            Phase(
                start_tick=10,
                label="fault_onset",
                drift={
                    "header_pressure_psi": lambda t: max(55.0, 90.0 - (t - 10) * 1.2),
                    "compressor_running": True,
                },
            ),
            Phase(
                start_tick=30,
                label="fault_active",
                drift={
                    "header_pressure_psi": 55.0,
                    "low_air_alarm": True,
                },
            ),
        ],
        alarms_at_tick={
            30: ["AS-LOW-PRESS"],
        },
        expected_root_cause="Low plant compressed-air pressure from AirSystem01",
        expected_asset=asset,
        expected_evidence_tags=[
            _tp(asset, "process", "header_pressure_psi"),
            _tp(asset, "alarms", "low_air_alarm"),
            # Secondary symptoms — air-driven devices drop with supply pressure
            _tp("depalletizer01", "process", "vacuum_pressure"),
            _tp("filler01", "process", "filler_bowl_pressure"),
        ],
        expected_actions=[
            "Check compressor run status",
            "Walk the distribution headers for audible leaks",
            "Verify all isolation valves are fully open",
            "Check demand load across the line",
        ],
        expected_citations=[
            "troubleshooting.md",
            "fault_code_table.md",
            "operator_quick_guide.md",
        ],
        question="Multiple machines are faulting simultaneously — is there a common cause?",
        secondary_normal_state={
            # When plant air drops to 55 psi (from 90), air-driven machines show
            # proportional pressure loss.  These values reflect ~40% supply reduction.
            "depalletizer01": {"vacuum_pressure": 12.0},  # normal=22.0, >10% below baseline
            "filler01": {"filler_bowl_pressure": 7.0},   # normal=12.0, >10% below baseline
        },
    )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

SCENARIOS: dict[str, Scenario] = {
    s.id: s
    for s in [
        _scenario_a(),
        _scenario_b(),
        _scenario_c(),
        _scenario_d(),
        _scenario_e(),
        _scenario_f(),
    ]
}


def get_scenario(scenario_id: str) -> Scenario:
    """Return the ``Scenario`` for the given id, raising ``KeyError`` if unknown."""
    if scenario_id not in SCENARIOS:
        raise KeyError(
            f"Unknown scenario {scenario_id!r}. Available: {sorted(SCENARIOS)}"
        )
    return SCENARIOS[scenario_id]
