"""The Known Failure Mode Library.

A structured library over the Phase 2 catalog, adding what Phase 3 needs for auditable reasoning:
contradicting signals (evidence AGAINST), reference procedures, and a history key. Each entry exposes:
symptoms, supporting signal roles, contradicting signal roles, recommended checks, reference procedures.
Reuses the Phase 2 catalog + the synthetic knowledge checks -- it does not duplicate them.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # evidence_graph/
_ROOT = _HERE.parent
_CAUS = _ROOT / "causality"
for _p in (str(_HERE), str(_CAUS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import failure_modes as fm  # noqa: E402  (causality.failure_modes)

# Phase 3 overlay: signals that argue AGAINST a mode (healthy -> contradiction) + reference procedures.
# history_key == mode id.
_OVERLAY = {
    "photoeye_blocked": {"contradicting_roles": ("counts",), "procedures": ("clean_photoeye",)},
    "conveyor_jam": {"contradicting_roles": ("counts", "motor_current"), "procedures": ("clear_conveyor_jam",)},
    "vfd_not_enabled": {"contradicting_roles": ("not_running",), "procedures": ("reenable_vfd",)},
    "motor_overload": {"contradicting_roles": ("motor_current",), "procedures": ("clear_motor_overload",)},
    "sensor_drift": {"contradicting_roles": ("reject",), "procedures": ("recalibrate_sensor",)},
    "low_air_pressure": {"contradicting_roles": ("air",), "procedures": ("restore_plant_air",)},
    "failed_interlock": {"contradicting_roles": ("not_running",), "procedures": ("restore_interlock",)},
    "comm_loss": {"contradicting_roles": ("not_running",), "procedures": ("restore_comms",)},
}


@dataclass(frozen=True)
class KnownFailureMode:
    id: str
    title: str
    component_type: str
    symptoms: tuple[str, ...]
    chain: tuple[str, ...]
    supporting_roles: tuple[str, ...]
    contradicting_roles: tuple[str, ...]
    procedures: tuple[str, ...]
    history_key: str
    base_confidence: str


def by_id(mode_id: str) -> KnownFailureMode:
    m = fm.BY_ID[mode_id]
    ov = _OVERLAY.get(mode_id, {})
    return KnownFailureMode(
        id=m.id, title=m.title, component_type=m.component_type, symptoms=m.symptoms, chain=m.chain,
        supporting_roles=m.supporting_tag_roles,
        contradicting_roles=tuple(ov.get("contradicting_roles", ())),
        procedures=tuple(ov.get("procedures", ())),
        history_key=m.id, base_confidence=m.base_confidence,
    )


def library() -> list[KnownFailureMode]:
    return [by_id(m.id) for m in fm.CATALOG]
