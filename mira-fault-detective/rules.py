"""Diagnostic rules for the conveyor fault map.

Pure functions over a snapshot of UNS topic state. Each rule examines the
snapshot and returns either None (does not fire) or a :class:`Diagnosis`
describing what's wrong, why we think so, and which physical components
to highlight on the HMI.

Rules are evaluated in priority order — the first that fires wins. That
priority is the engine's job; this module just defines the rules.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class Snapshot:
    """Rolling state of every UNS topic the engine cares about.

    Values default to safe "system healthy" baselines so the engine can
    evaluate before every topic has reported in. Times are unix seconds.
    """

    now: float = 0.0

    # Photoeyes / prox — debounced, raw, and how long they've been blocked.
    pe101_blocked: bool = False
    pe102_blocked: bool = False
    px101_present: bool = False
    pe101_blocked_since: Optional[float] = None
    pe102_blocked_since: Optional[float] = None

    # Raw chatter counters (delta per evaluation window).
    pe101_dropouts: int = 0
    pe102_dropouts: int = 0
    px101_dropouts: int = 0

    # Power
    fuse_f2_ok: bool = True
    fuse_f3_ok: bool = True

    # Vision (Zone 2 camera)
    vision_object_present: bool = False
    vision_object_motion: bool = False

    # VFD / motor / PLC
    vfd_running: bool = False
    motor_running: bool = False
    vfd_comm_ok: bool = True
    plc_online: bool = True

    # Safety
    estop_active: bool = False
    contactor_q1: bool = True

    # Sim/PLC source label, used in evidence.
    sim_mode: str = "unknown"


@dataclass
class Evidence:
    topic: str
    value: object
    note: str = ""


@dataclass
class Diagnosis:
    fault: str
    confidence: float
    evidence: list[Evidence] = field(default_factory=list)
    affected_components: list[str] = field(default_factory=list)
    recommended_first_check: str = ""
    safety_note: str = ""


Rule = Callable[[Snapshot], Optional[Diagnosis]]


JAM_THRESHOLD_S = 5.0
CHATTER_THRESHOLD = 5  # drops per evaluation window (engine sets the window)
DIRTY_HOLD_S = 2.0     # min PE-blocked duration before "dirty" fires
                       # (longer than the normal-cycle PE-blocked window)
WIRING_HOLD_S = 1.5    # min steady-state before wiring diagnoses fire


# --------------------------------------------------------------------------- #
# Rule 1 — Safety / E-stop short-circuit
# --------------------------------------------------------------------------- #
def rule_estop(s: Snapshot) -> Optional[Diagnosis]:
    if not s.estop_active:
        return None
    return Diagnosis(
        fault="e_stop_active",
        confidence=1.0,
        evidence=[Evidence("safety/estop", True, "E-stop circuit open")],
        affected_components=["E-stop", "Contactor Q1", "Motor M-101"],
        recommended_first_check="Confirm E-stop button is pulled out and dual-channel inputs match.",
        safety_note="DO NOT bypass the E-stop. Verify the cause before reset.",
    )


# --------------------------------------------------------------------------- #
# Rule 2 — Fuse F2 branch loss
# (highest non-safety priority because it disables three sensors at once)
# --------------------------------------------------------------------------- #
def rule_f2_branch_loss(s: Snapshot) -> Optional[Diagnosis]:
    # All three F2-fed sensors currently silent. We accept "dropouts > 0" because
    # cumulative counters tick up under normal product traversal too — the
    # cumulative count doesn't tell us anything about "is the branch dead now".
    all_three_dark = not s.pe101_blocked and not s.pe102_blocked and not s.px101_present
    branch_appears_dead = all_three_dark and s.plc_online
    if not branch_appears_dead:
        return None
    # Strong evidence if the sim explicitly tells us F2 is blown, OR if vision
    # confirms there is product the sensors should see.
    explicit = not s.fuse_f2_ok
    vision_says_product = s.vision_object_present
    if not (explicit or vision_says_product):
        return None
    confidence = 0.95 if explicit else 0.70
    return Diagnosis(
        fault="branch_fuse_loss",
        confidence=confidence,
        evidence=[
            Evidence("power/fuse_f2/status", "blown" if explicit else "unknown"),
            Evidence("sensors/pe101/debounced", False),
            Evidence("sensors/pe102/debounced", False),
            Evidence("sensors/px101/debounced", False),
            Evidence("vision/zone2/object_present", vision_says_product,
                     "Camera sees product but no sensor reacts"),
        ],
        affected_components=["Fuse F2", "PE-101", "PE-102", "PX-101"],
        recommended_first_check=(
            "Measure 24V at Fuse F2 input vs output. If output is 0V, "
            "replace fuse and check branch for shorts before re-energizing."
        ),
        safety_note="De-energize 24V branch before pulling F2. Verify with meter.",
    )


# --------------------------------------------------------------------------- #
# Rule 3 — Mechanical jam
# --------------------------------------------------------------------------- #
def rule_jam(s: Snapshot) -> Optional[Diagnosis]:
    pe_long_block = (
        s.pe102_blocked_since is not None
        and (s.now - s.pe102_blocked_since) >= JAM_THRESHOLD_S
    )
    if not pe_long_block:
        return None
    if not (s.vision_object_present and not s.vision_object_motion):
        return None
    if not s.vfd_running:
        return None
    return Diagnosis(
        fault="mechanical_jam",
        confidence=0.90,
        evidence=[
            Evidence("sensors/pe102/debounced", True,
                     f"Blocked for {s.now - (s.pe102_blocked_since or s.now):.1f}s (>= {JAM_THRESHOLD_S}s)"),
            Evidence("vision/zone2/object_present", True),
            Evidence("vision/zone2/object_motion", False),
            Evidence("vfd/vfd101/status", "running"),
        ],
        affected_components=["PE-102", "Zone 2", "Belt", "Motor M-101"],
        recommended_first_check="Stop the conveyor. Visually inspect Zone 2 for stuck product or debris.",
        safety_note="LOTO motor M-101 before reaching into belt path. Belt may snap forward when load releases.",
    )


# --------------------------------------------------------------------------- #
# Rule 4 — VFD running, no motion detected
# --------------------------------------------------------------------------- #
def rule_vfd_no_motion(s: Snapshot) -> Optional[Diagnosis]:
    if not s.vfd_running:
        return None
    # We need *some* evidence of "no motion". The simplest is vision saying
    # there is an object on the belt that is not moving — which also covers
    # the empty-belt case if a downstream encoder is added later.
    if not s.vision_object_present:
        return None
    if s.vision_object_motion:
        return None
    # Differs from jam in that no PE is held blocked for >5s.
    if s.pe102_blocked_since and (s.now - s.pe102_blocked_since) >= JAM_THRESHOLD_S:
        return None
    return Diagnosis(
        fault="vfd_motion_mismatch",
        confidence=0.75,
        evidence=[
            Evidence("vfd/vfd101/status", "running"),
            Evidence("vision/zone2/object_motion", False),
            Evidence("vision/zone2/object_present", True),
        ],
        affected_components=["VFD-101", "Motor M-101", "Belt"],
        recommended_first_check="Inspect coupling, belt tension, and motor shaft for slip.",
        safety_note="Disconnect VFD output before touching the motor shaft or coupling.",
    )


# --------------------------------------------------------------------------- #
# Rule 5 — Sensor reports product, vision empty (dirty / misaligned)
# --------------------------------------------------------------------------- #
def rule_dirty_or_misaligned(s: Snapshot) -> Optional[Diagnosis]:
    if not (s.pe101_blocked or s.pe102_blocked):
        return None
    if s.vision_object_present:
        return None
    # Only fires when the F2 branch as a whole is healthy.
    if not s.fuse_f2_ok:
        return None
    # Require the block to have persisted past normal product transit so the
    # leading edge of a real product doesn't trip the rule.
    blocked_since = (
        s.pe102_blocked_since if s.pe102_blocked else s.pe101_blocked_since
    )
    if blocked_since is None or (s.now - blocked_since) < DIRTY_HOLD_S:
        return None
    bad = "PE-102" if s.pe102_blocked else "PE-101"
    return Diagnosis(
        fault="sensor_dirty_or_misaligned",
        confidence=0.80,
        evidence=[
            Evidence(f"sensors/{bad.lower().replace('-', '')}/debounced", True),
            Evidence("vision/zone2/object_present", False, "Camera sees an empty belt"),
        ],
        affected_components=[bad, "Zone 1" if bad == "PE-101" else "Zone 2"],
        recommended_first_check=f"Wipe {bad} lens / reflector. Re-aim if needed. Check sensing distance.",
        safety_note="Do not adjust sensors while belt is running. Stop conveyor first.",
    )


# --------------------------------------------------------------------------- #
# Rule 6 — PE-101 wire / connector break (peers healthy)
# --------------------------------------------------------------------------- #
def rule_pe101_local_wire(s: Snapshot) -> Optional[Diagnosis]:
    # PE-101 silent (no blocks at all this window, no chatter), yet other devices
    # on the same fuse branch are reporting normally.
    pe101_seems_dead = (not s.pe101_blocked) and s.pe101_dropouts == 0
    peers_alive = s.pe102_blocked or s.px101_present or s.pe102_dropouts > 0 or s.px101_dropouts > 0
    if not (pe101_seems_dead and peers_alive and s.fuse_f2_ok):
        return None
    # We also want to make sure we're not just in a moment where there's no product
    # in Zone 1 — vision can confirm if it ever sees product reach the line. We
    # treat this as a soft fault until vision_no_sensor confirms (see Rule 7).
    return Diagnosis(
        fault="pe101_local_wiring",
        confidence=0.65,
        evidence=[
            Evidence("sensors/pe101/debounced", False),
            Evidence("sensors/pe102/debounced", s.pe102_blocked, "Branch peer healthy"),
            Evidence("sensors/px101/debounced", s.px101_present, "Branch peer healthy"),
            Evidence("power/fuse_f2/status", "ok"),
        ],
        affected_components=["PE-101", "TB2", "PLC I0.3"],
        recommended_first_check="Meter PE-101 at the sensor (brown/blue/black) and at TB2. Verify continuity to PLC I0.3.",
        safety_note="Sensor branch is 24VDC — low risk, but de-energize before pulling wires from TB2.",
    )


# --------------------------------------------------------------------------- #
# Rule 7 — Vision sees product, PE-101 silent (output wire / PLC input)
# --------------------------------------------------------------------------- #
def rule_vision_no_sensor(s: Snapshot) -> Optional[Diagnosis]:
    # Vision claims a product passed through Zone 2; therefore one must have
    # crossed Zone 1 / PE-101 first. If PE-101 never reported, that's an
    # output-wire / TB2 / PLC-input-channel issue. Requires at least one
    # peer to show activity — otherwise it's a branch outage, not a wire.
    if not s.vision_object_present:
        return None
    if s.pe101_blocked or s.pe101_dropouts > 0:
        return None
    if not s.fuse_f2_ok:
        return None
    peers_active = (
        s.pe102_blocked or s.px101_present
        or s.pe102_dropouts > 0 or s.px101_dropouts > 0
    )
    if not peers_active:
        return None
    return Diagnosis(
        fault="pe101_output_wire_or_plc_input",
        confidence=0.78,
        evidence=[
            Evidence("vision/zone2/object_present", True),
            Evidence("sensors/pe101/debounced", False, "Sensor LED may show detect but PLC sees nothing"),
            Evidence("power/fuse_f2/status", "ok"),
        ],
        affected_components=["PE-101", "TB2", "PLC I0.3"],
        recommended_first_check=(
            "With product under PE-101, check sensor output LED. If lit, verify 24V at PLC I0.3 "
            "while LED is lit. If 0V, the output wire / TB2 jumper / PLC input channel is the suspect."
        ),
        safety_note="Low-voltage I/O work — still de-energize TB2 before reseating jumpers.",
    )


# --------------------------------------------------------------------------- #
# Rule 8 — Debounce / intermittent chatter on PE-101
# --------------------------------------------------------------------------- #
def rule_pe101_chatter(s: Snapshot) -> Optional[Diagnosis]:
    if s.pe101_dropouts < CHATTER_THRESHOLD:
        return None
    if s.pe102_dropouts >= CHATTER_THRESHOLD or s.px101_dropouts >= CHATTER_THRESHOLD:
        # Branch-wide chatter is a different problem (noise / shared common).
        return None
    return Diagnosis(
        fault="pe101_intermittent_chatter",
        confidence=0.85,
        evidence=[
            Evidence("sensors/pe101/dropout_count", s.pe101_dropouts,
                     f">= {CHATTER_THRESHOLD} dropouts in window"),
            Evidence("sensors/pe102/dropout_count", s.pe102_dropouts, "Peer stable"),
            Evidence("sensors/px101/dropout_count", s.px101_dropouts, "Peer stable"),
        ],
        affected_components=["PE-101", "TB2", "PE-101 cable", "Sensor connector"],
        recommended_first_check=(
            "Wiggle test: gently flex PE-101 cable and connector while watching the raw signal. "
            "If chatter follows the wiggle, replace the connector or cable."
        ),
        safety_note="Belt running is fine for the wiggle test — keep hands clear of pinch points.",
    )


PRIORITY: list[tuple[str, Rule]] = [
    ("estop", rule_estop),
    ("fuse_f2_branch", rule_f2_branch_loss),
    ("jam", rule_jam),
    ("vfd_motion_mismatch", rule_vfd_no_motion),
    ("dirty_or_misaligned", rule_dirty_or_misaligned),
    ("pe101_chatter", rule_pe101_chatter),
    ("pe101_vision_no_sensor", rule_vision_no_sensor),
    ("pe101_local_wiring", rule_pe101_local_wire),
]


def evaluate(s: Snapshot) -> Optional[Diagnosis]:
    """Return the highest-priority diagnosis that fires, or None."""
    for _name, rule in PRIORITY:
        diag = rule(s)
        if diag is not None:
            return diag
    return None
