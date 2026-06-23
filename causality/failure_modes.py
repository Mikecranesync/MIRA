"""The failure-mode catalog — a handful of realistic maintenance problems, not a hundred machines.

Each FailureMode is a HIDDEN component cause that produces a chain of effects ending in an observable
MES/OEE symptom (Blocked, OEE drop, counts flatline). MIRA reasons over this layer. The catalog is the
heart of Phase 2: it is what lets the engine say "the likely cause is a photoeye that appears blocked"
instead of just "the line is blocked".

Manual citations + technician checks for each mode live in the synthetic knowledge fixture
(`fixtures/maintenance_knowledge.json`), keyed by mode id, so the explanation can cite evidence.
"""
from __future__ import annotations

from dataclasses import dataclass

# Symptom vocabulary (the entry points a user / HMI asks about):
LINE_BLOCKED = "line_blocked"
LINE_STOPPED = "line_stopped"
QUALITY_REJECT = "quality_reject"
MULTI_MACHINE_DEGRADE = "multi_machine_degrade"


@dataclass(frozen=True)
class FailureMode:
    id: str
    title: str
    component_type: str             # the component the cause lives on (photoeye / vfd / motor / ...)
    asset_classes: tuple[str, ...]  # which asset classes can host this component (generic binding)
    symptoms: tuple[str, ...]       # observable symptom(s) this cause can present as
    chain: tuple[str, ...]          # cause -> intermediate effects -> observable symptom
    supporting_tag_roles: tuple[str, ...]  # role tokens resolved against the asset's signals
    base_confidence: str            # prior likelihood band (high/medium/low)


# Role tokens (resolved to real signals by explain._resolve_role):
#   photoeye, blocked, starved, not_running, counts, reject, state_down,
#   motor_current, air, analog_drift, fault, stale

CATALOG: tuple[FailureMode, ...] = (
    FailureMode(
        id="photoeye_blocked",
        title="Photoeye blocked / fouled",
        component_type="photoeye",
        asset_classes=("conveyor", "filler", "capper", "caploader", "labeler", "packager", "sealer"),
        symptoms=(LINE_BLOCKED,),
        chain=(
            "Photoeye is blocked or fouled (sees a permanent target)",
            "Conveyor logic believes product is present and stops feeding",
            "Product backs up / accumulation fills upstream",
            "Machine asserts Blocked state",
            "Outfeed counts flatline; OEE availability drops",
        ),
        supporting_tag_roles=("photoeye", "blocked", "counts", "state_down"),
        base_confidence="medium",
    ),
    FailureMode(
        id="conveyor_jam",
        title="Conveyor mechanical jam",
        component_type="conveyor_motor",
        asset_classes=("conveyor",),
        symptoms=(LINE_BLOCKED,),
        chain=(
            "Mechanical jam on the conveyor",
            "Drive sees rising load / overcurrent and faults or stalls",
            "Product backs up upstream",
            "Machine asserts Blocked state",
            "Outfeed counts flatline; OEE availability drops",
        ),
        supporting_tag_roles=("blocked", "motor_current", "counts", "state_down"),
        base_confidence="medium",
    ),
    FailureMode(
        id="vfd_not_enabled",
        title="VFD not enabled / drive disabled",
        component_type="vfd",
        asset_classes=("conveyor", "filler", "capper", "caploader", "labeler", "packager", "palletizer", "robot"),
        symptoms=(LINE_STOPPED,),
        chain=(
            "VFD enable is dropped (no run permissive / reset not cleared)",
            "Drive will not run; motor does not turn",
            "No motion; machine cannot produce",
            "Machine drops to a stopped/idle state",
            "Counts hold at zero; OEE availability drops",
        ),
        supporting_tag_roles=("not_running", "motor_current", "state_down"),
        base_confidence="medium",
    ),
    FailureMode(
        id="motor_overload",
        title="Motor overload / thermal trip",
        component_type="motor",
        asset_classes=("conveyor", "filler", "capper", "caploader", "labeler", "packager", "palletizer", "robot", "tank", "generic"),
        symptoms=(LINE_BLOCKED, LINE_STOPPED),
        chain=(
            "Motor draws excessive current (binding load / failing bearing)",
            "Overload relay / drive trips on thermal or overcurrent",
            "Motor stops; machine halts",
            "Machine asserts Blocked/Fault state",
            "Counts flatline; OEE availability drops",
        ),
        supporting_tag_roles=("motor_current", "blocked", "state_down", "fault"),
        base_confidence="low",
    ),
    FailureMode(
        id="sensor_drift",
        title="Process sensor drift / out of calibration",
        component_type="sensor",
        asset_classes=("tank", "vat", "filler"),
        symptoms=(QUALITY_REJECT,),
        chain=(
            "Analog sensor drifts out of calibration",
            "Process value reads wrong (level / temperature / pressure)",
            "Control regulates to the wrong setpoint",
            "Product goes out of spec",
            "Reject/defect counts rise; OEE quality drops",
        ),
        supporting_tag_roles=("analog_drift", "reject"),
        base_confidence="medium",
    ),
    FailureMode(
        id="low_air_pressure",
        title="Low plant air pressure",
        component_type="air_supply",
        asset_classes=("filler", "capper", "caploader", "labeler", "packager", "conveyor"),
        symptoms=(MULTI_MACHINE_DEGRADE, LINE_BLOCKED),
        chain=(
            "Plant air header pressure drops (compressor / dryer / leak)",
            "Pneumatic actuators move sluggishly or stall across machines",
            "Multiple machines degrade together",
            "Stations assert Blocked/Starved",
            "Counts fall across the line; OEE drops",
        ),
        supporting_tag_roles=("air", "blocked", "starved"),
        base_confidence="low",
    ),
    FailureMode(
        id="failed_interlock",
        title="Failed safety interlock / guard",
        component_type="interlock",
        asset_classes=("conveyor", "filler", "capper", "caploader", "labeler", "packager", "palletizer", "robot"),
        symptoms=(LINE_STOPPED,),
        chain=(
            "Safety interlock / guard switch reads open or faulted",
            "Machine is inhibited from starting (safe state)",
            "No motion; machine cannot produce",
            "Machine sits in a stopped/idle state",
            "Counts hold at zero; OEE availability drops",
        ),
        supporting_tag_roles=("not_running", "fault", "state_down"),
        base_confidence="low",
    ),
    FailureMode(
        id="comm_loss",
        title="Communication loss to the device",
        component_type="comms",
        asset_classes=("conveyor", "filler", "capper", "caploader", "labeler", "packager", "palletizer", "robot", "tank", "vat", "generic"),
        symptoms=(LINE_STOPPED,),
        chain=(
            "Network/fieldbus comm to the device is lost",
            "Tags go stale; control loses visibility",
            "Machine holds in a safe/idle state",
            "Production stops on the affected machine",
            "Counts hold; OEE availability drops",
        ),
        supporting_tag_roles=("stale", "not_running", "state_down"),
        base_confidence="low",
    ),
)

BY_ID = {m.id: m for m in CATALOG}


def modes_for_class(asset_class: str) -> list[FailureMode]:
    return [m for m in CATALOG if asset_class in m.asset_classes]
