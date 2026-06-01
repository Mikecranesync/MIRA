"""
Conv_Simple machine-card anomaly rules (additive — does NOT touch the cv101 demo).

These are the invariants from `MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md`, applied to the
live tag stream published by `plc/live-plc-bridge` (UNS relative topics). Pure functions:
`evaluate(snap, derived, cfg) -> list[Anomaly]` — no I/O, fully unit-testable.

`snap`    : latest value keyed by the bridge's UNS-relative topic (see live-plc-bridge COIL_TOPICS / HR_SPECS).
`derived` : temporal facts the engine computes from history:
            {now, max_stale_s, freq_frozen_s, cmd_run_for_s}
`cfg`     : thresholds (see DEFAULT_CFG; bench values marked CONFIRM).

Covers A0,A1,A3,A4,A5,A6,A8,A9,A10. NOT covered (need a PLC Modbus-slave-map extension —
the deployed slave does not expose these): A2 GS10 fault-code (0x2100), A7 freq setpoint,
A12 photo-eye DI_05 / pe_latched. See README.
"""
from __future__ import annotations
from dataclasses import dataclass, field

CRITICAL, HIGH, MED, LOW, INFO = "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
_CONF = {CRITICAL: 1.0, HIGH: 0.9, MED: 0.75, LOW: 0.6, INFO: 0.5}


@dataclass
class Anomaly:
    rule_id: str
    severity: str
    title: str
    message: str
    evidence: list = field(default_factory=list)
    components: list = field(default_factory=list)

    @property
    def confidence(self) -> float:
        return _CONF.get(self.severity, 0.6)


# Bench-tunable thresholds. CONFIRM the starred ones against the motor nameplate / a golden run.
DEFAULT_CFG = {
    "motor_fla_a": 5.0,        # * motor full-load amps (A8 overcurrent)
    "dc_bus_lo_v": 250.0,      # * DC-bus undervoltage (A9); nominal ~327 V idle
    "dc_bus_hi_v": 410.0,      # * DC-bus overvoltage (A9)
    "freq_frozen_s": 5.0,      # A10 — Hz unchanged this long while commanded RUN
    "cmd_run_grace_s": 3.0,    # A6 — RUN commanded but not running this long
    "offline_s": 30.0,         # A0 — no fresh data this long
    "run_cmd_values": (18, 20),  # GS10 cmd word: 18=FWD+RUN, 20=REV+RUN (§4)
}

# bridge UNS-relative topics (from live-plc-bridge)
T_RUN = "motor/m101/running"
T_COMM = "vfd/vfd101/comm_ok"
T_ESTOP = "safety/estop"
T_WIRING = "safety/wiring"
T_CONTACTOR = "safety/contactor_q1"
T_DI00, T_DI01 = "plc/di/di00_fwd", "plc/di/di01_rev"
T_DI02, T_DI03 = "plc/di/di02_estop_nc", "plc/di/di03_estop_no"
T_FREQ, T_CUR, T_DCBUS, T_CMD = (
    "vfd/vfd101/freq", "vfd/vfd101/current_a", "vfd/vfd101/dc_bus_v", "vfd/vfd101/cmd_word")


def _ev(snap, *keys):
    return [{"topic": k, "value": snap.get(k)} for k in keys]


def _vfd_trustworthy(snap) -> bool:
    """The §7 trust gate: VFD analog/echo values are stale when comm_ok is explicitly False."""
    return snap.get(T_COMM) is not False


# ---- rules (each returns Anomaly | None) ----
def r_a0_offline(snap, d, cfg):
    if d.get("max_stale_s", 0.0) >= cfg["offline_s"]:
        return Anomaly("A0_OFFLINE", CRITICAL, "PLC/bridge offline",
                       f"No fresh PLC data for {d['max_stale_s']:.0f}s (>= {cfg['offline_s']:.0f}s).",
                       [{"topic": "_stale_s", "value": round(d.get("max_stale_s", 0.0), 1)}],
                       ["plc", "bridge"])
    return None


def r_a1_comm(snap, d, cfg):
    if snap.get(T_COMM) is False:
        return Anomaly("A1_COMM_STALE", CRITICAL, "GS10 RS-485 link down",
                       "vfd_comm_ok is FALSE — the PLC↔GS10 serial link is down; all VFD "
                       "values are stale (frozen from the last good poll).",
                       _ev(snap, T_COMM), ["gs10", "rs485"])
    return None


def r_a3_estop_wiring(snap, d, cfg):
    a, b = snap.get(T_DI02), snap.get(T_DI03)            # healthy: DI_02 NC=True, DI_03 NO=False
    mismatch = a is not None and b is not None and a == b  # same state = broken/shorted wire
    if snap.get(T_WIRING) is True or mismatch:
        return Anomaly("A3_ESTOP_WIRING", HIGH, "E-stop wiring fault",
                       "Dual-channel e-stop disagreement (DI_02 NC and DI_03 NO read the SAME) "
                       "or the wiring-fault flag is set — broken/shorted e-stop wire; drive not permitted.",
                       _ev(snap, T_WIRING, T_DI02, T_DI03), ["estop", "wiring"])
    return None


def r_a4_direction(snap, d, cfg):
    if snap.get(T_DI00) and snap.get(T_DI01):
        return Anomaly("A4_DIRECTION_FAULT", MED, "Direction fault",
                       "FWD (DI_00) and REV (DI_01) are both commanded — the PLC commands STOP.",
                       _ev(snap, T_DI00, T_DI01), ["selector"])
    return None


def r_a5_illegal_run(snap, d, cfg):
    if not snap.get(T_RUN):
        return None
    reasons = []
    if snap.get(T_ESTOP):
        reasons.append("e-stop active")
    if snap.get(T_WIRING):
        reasons.append("wiring fault")
    if snap.get(T_CONTACTOR) is False:
        reasons.append("contactor open")
    if reasons:
        return Anomaly("A5_ILLEGAL_RUN", HIGH, "Belt running while not permitted",
                       "Motor reports RUNNING but it should not be: " + ", ".join(reasons) + ".",
                       _ev(snap, T_RUN, T_ESTOP, T_WIRING, T_CONTACTOR), ["motor", "safety"])
    return None


def r_a6_not_responding(snap, d, cfg):
    if (snap.get(T_CMD) in cfg["run_cmd_values"] and _vfd_trustworthy(snap)
            and not snap.get(T_RUN) and d.get("cmd_run_for_s", 0.0) >= cfg["cmd_run_grace_s"]):
        return Anomaly("A6_DRIVE_NOT_RESPONDING", MED, "Drive not responding to RUN",
                       f"Command word is RUN ({snap.get(T_CMD)}) for {d['cmd_run_for_s']:.0f}s "
                       "but the motor is not running.",
                       _ev(snap, T_CMD, T_RUN), ["gs10", "motor"])
    return None


def r_a8_overcurrent(snap, d, cfg):
    cur = snap.get(T_CUR)
    if _vfd_trustworthy(snap) and isinstance(cur, (int, float)) and cur > cfg["motor_fla_a"]:
        return Anomaly("A8_OVERCURRENT", HIGH, "VFD output over motor FLA",
                       f"Output current {cur:.2f} A exceeds motor FLA {cfg['motor_fla_a']:.2f} A — "
                       "possible overload/jam (cf. GS10 oL fault 21).",
                       _ev(snap, T_CUR), ["motor", "belt"])
    return None


def r_a9_dcbus(snap, d, cfg):
    v = snap.get(T_DCBUS)
    if _vfd_trustworthy(snap) and isinstance(v, (int, float)) and (v < cfg["dc_bus_lo_v"] or v > cfg["dc_bus_hi_v"]):
        return Anomaly("A9_DC_BUS", MED, "DC bus voltage out of range",
                       f"DC bus {v:.0f} V is outside [{cfg['dc_bus_lo_v']:.0f}, {cfg['dc_bus_hi_v']:.0f}] V "
                       "(nominal ~327 V; low → GS10 Lvd 12).",
                       _ev(snap, T_DCBUS), ["gs10", "power"])
    return None


def r_a10_freq_frozen(snap, d, cfg):
    if (snap.get(T_CMD) in cfg["run_cmd_values"] and _vfd_trustworthy(snap)
            and d.get("freq_frozen_s", 0.0) >= cfg["freq_frozen_s"]):
        return Anomaly("A10_FREQ_FROZEN", MED, "Output frequency frozen",
                       f"Commanded RUN but output Hz unchanged for {d['freq_frozen_s']:.0f}s — "
                       "stale read or the drive is not following.",
                       _ev(snap, T_FREQ, T_CMD), ["gs10"])
    return None


RULES = [r_a0_offline, r_a1_comm, r_a3_estop_wiring, r_a4_direction, r_a5_illegal_run,
         r_a6_not_responding, r_a8_overcurrent, r_a9_dcbus, r_a10_freq_frozen]


def evaluate(snap: dict, derived: dict, cfg: dict | None = None) -> list[Anomaly]:
    """Run every rule against a snapshot; return the list of active anomalies."""
    merged = {**DEFAULT_CFG, **(cfg or {})}
    out = []
    for rule in RULES:
        a = rule(snap, derived or {}, merged)
        if a is not None:
            out.append(a)
    return out
