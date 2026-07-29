"""
Conv_Simple machine-card anomaly rules -- DUAL Python 2.7 + 3.12 clean CORE.

This is the single source of truth for the A0-A12 rules. It is written to import and
run identically under BOTH:
  * CPython 3.12 on the bench (via the rules.py shim; engine.py / live_check.py).
  * Jython 2.7 inside the Ignition gateway (vendored as diagnose_core.py for the
    /api/diagnose WebDev endpoint).

So it deliberately avoids Py3-only syntax: no `from __future__`, no type annotations,
no f-strings, no dict-unpacking literals, plain class instead of @dataclass, `%`
formatting, ASCII-only strings (Jython byte-string safe; clean JSON serialization).

Pure functions: `evaluate(snap, derived, cfg) -> list[Anomaly]` -- no I/O, fully
unit-testable. See tests/regime7_ignition/test_diagnose_parity.py.

`snap`    : latest value keyed by a UNS-relative topic (e.g. "vfd/vfd101/freq").
`derived` : temporal facts {now, max_stale_s, freq_frozen_s, cmd_run_for_s}.
`cfg`     : thresholds (see DEFAULT_CFG; bench values marked CONFIRM).

Covers A0,A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,A12. A2/A7/A12 read signals that may be
absent (snap.get -> None) and degrade silently when so.
"""

CRITICAL, HIGH, MED, LOW, INFO = "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
_CONF = {CRITICAL: 1.0, HIGH: 0.9, MED: 0.75, LOW: 0.6, INFO: 0.5}


class Anomaly(object):
    """Plain (no-dataclass) so it imports under Jython 2.7."""

    def __init__(self, rule_id, severity, title, message, evidence=None, components=None):
        self.rule_id = rule_id
        self.severity = severity
        self.title = title
        self.message = message
        self.evidence = evidence if evidence is not None else []
        self.components = components if components is not None else []

    @property
    def confidence(self):
        return _CONF.get(self.severity, 0.6)

    def to_dict(self):
        """JSON-serializable card for the /api/diagnose WebDev response."""
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "title": self.title,
            "message": self.message,
            "evidence": self.evidence,
            "components": self.components,
            "confidence": self.confidence,
        }

    def __repr__(self):
        return "Anomaly(%s, %s)" % (self.rule_id, self.severity)


# Bench-tunable thresholds. CONFIRM the starred ones against the motor nameplate / a golden run.
DEFAULT_CFG = {
    "motor_fla_a": 5.0,        # * motor full-load amps (A8 overcurrent)
    "dc_bus_lo_v": 250.0,      # * DC-bus undervoltage (A9); nominal ~327 V idle
    "dc_bus_hi_v": 410.0,      # * DC-bus overvoltage (A9)
    "freq_frozen_s": 5.0,      # A10 -- Hz unchanged this long while commanded RUN
    "cmd_run_grace_s": 3.0,    # A6 -- RUN commanded but not running this long
    "offline_s": 30.0,         # A0 -- no fresh data this long
    "run_cmd_values": (18, 34),  # GS10 cmd word: 18=FWD+RUN (0x12), 34=REV+RUN (0x22) -- bench-verified
    "freq_track_tol_hz": 3.0,  # A7 -- allowed |output Hz - setpoint Hz| at steady state
    "freq_track_grace_s": 5.0, # A7 -- accel grace after RUN before A7 may fire
    "torque_hi_pct": 150.0,    # * vfd_torque_pct high limit (jam precursor); GS10 oL = 150%/1 min
}

# GS10 fault/error codes -- low byte of register 0x2100 (DURApulse GS10 UM 1st Ed Rev B).
# Used by A2 to decode vfd/vfd101/fault_code.
GS10_FAULT_CODES = {
    1: "ocA (over-current accel)", 2: "ocd (over-current decel)", 3: "ocn (over-current run)",
    4: "GFF (ground fault)", 6: "ocS (over-current at stop)", 7: "ovA (over-voltage accel)",
    8: "ovd (over-voltage decel)", 9: "ovn (over-voltage run)", 10: "ovS (over-voltage stop)",
    11: "LvA (low-voltage accel)", 12: "Lvd (low-voltage decel)", 13: "Lvn (low-voltage run)",
    14: "LvS (low-voltage stop)", 15: "orP (phase loss)", 16: "oH1 (IGBT overheat)",
    18: "tH1o (IGBT temp sensor)", 21: "oL (overload)", 22: "EoL1 (thermal relay 1)",
    23: "EoL2 (thermal relay 2)", 24: "oH3 (motor PTC overheat)", 26: "ot1 (over-torque 1)",
    27: "ot2 (over-torque 2)", 28: "uC (under-current)", 31: "cF2 (EEPROM read)",
    33: "cd1 (U-phase)", 34: "cd2 (V-phase)", 35: "cd3 (W-phase)", 36: "Hd0 (cc hardware)",
    37: "Hd1 (oc hardware)", 40: "AUE (auto-tune)", 41: "AFE (PID loss AI-V)", 48: "ACE (AI-C loss)",
    49: "EF (external fault)", 50: "EF1 (emergency stop)", 51: "bb (base block)",
    52: "Pcod (password locked)", 54: "CE1 (illegal command)", 55: "CE2 (illegal data address)",
    56: "CE3 (illegal data value)", 57: "CE4 (write to read-only)", 58: "CE10 (Modbus timeout)",
    63: "oSL (over-slip)", 82: "oPL1 (output phase loss U)", 83: "oPL2 (output phase loss V)",
    84: "oPL3 (output phase loss W)", 87: "oL3 (low-freq overload)", 140: "Hd6 (oc hardware)",
    141: "b4GF (GFF before run)", 159: "Hd7 (gate driver)",
}
# Codes that trip the drive hard / risk damage -> CRITICAL; everything else HIGH.
_GS10_CRITICAL = set([1, 2, 3, 4, 6, 7, 8, 9, 10, 15, 16, 33, 34, 35, 36, 37, 82, 83, 84, 140, 141, 159])

# UNS-relative topics (the `snap` keys). The Ignition /api/diagnose endpoint maps its tag
# names onto these via tag_topic_map.py; the bench bridge publishes them directly.
T_RUN = "motor/m101/running"
T_COMM = "vfd/vfd101/comm_ok"
T_ESTOP = "safety/estop"
T_WIRING = "safety/wiring"
T_CONTACTOR = "safety/contactor_q1"
T_DI00, T_DI01 = "plc/di/di00_fwd", "plc/di/di01_rev"
T_DI02, T_DI03 = "plc/di/di02_estop_nc", "plc/di/di03_estop_no"
T_FREQ, T_CUR, T_DCBUS, T_CMD = (
    "vfd/vfd101/freq", "vfd/vfd101/current_a", "vfd/vfd101/dc_bus_v", "vfd/vfd101/cmd_word")
T_FAULT = "vfd/vfd101/fault_code"       # low byte of GS10 0x2100
T_WARN = "vfd/vfd101/warn_code"         # high byte of GS10 0x2100
T_FREQ_SP = "vfd/vfd101/freq_setpoint"  # commanded Hz (GS10 0x2001 echo)
T_PE_LATCH = "safety/pe_latched"        # photo-eye latching soft-stop engaged
T_DI05 = "plc/di/di05_photoeye"         # raw photo-eye beam state


def _ev(snap, *keys):
    out = []
    for k in keys:
        out.append({"topic": k, "value": snap.get(k)})
    return out


def _vfd_trustworthy(snap):
    """Trust gate: VFD analog/echo values are stale when comm_ok is explicitly False."""
    return snap.get(T_COMM) is not False


# ---- rules (each returns Anomaly or None) ----
def r_a0_offline(snap, d, cfg):
    if d.get("max_stale_s", 0.0) >= cfg["offline_s"]:
        return Anomaly("A0_OFFLINE", CRITICAL, "PLC/bridge offline",
                       "No fresh PLC data for %.0fs (>= %.0fs)." % (d["max_stale_s"], cfg["offline_s"]),
                       [{"topic": "_stale_s", "value": round(d.get("max_stale_s", 0.0), 1)}],
                       ["plc", "bridge"])
    return None


def r_a1_comm(snap, d, cfg):
    if snap.get(T_COMM) is False:
        return Anomaly("A1_COMM_STALE", CRITICAL, "GS10 RS-485 link down",
                       "vfd_comm_ok is FALSE - the PLC<->GS10 serial link is down; all VFD "
                       "values are stale (frozen from the last good poll).",
                       _ev(snap, T_COMM), ["gs10", "rs485"])
    return None


def r_a3_estop_wiring(snap, d, cfg):
    a, b = snap.get(T_DI02), snap.get(T_DI03)              # healthy: DI_02 NC=True, DI_03 NO=False
    mismatch = a is not None and b is not None and a == b  # same state = broken/shorted wire
    if snap.get(T_WIRING) is True or mismatch:
        return Anomaly("A3_ESTOP_WIRING", HIGH, "E-stop wiring fault",
                       "Dual-channel e-stop disagreement (DI_02 NC and DI_03 NO read the SAME) "
                       "or the wiring-fault flag is set - broken/shorted e-stop wire; drive not permitted.",
                       _ev(snap, T_WIRING, T_DI02, T_DI03), ["estop", "wiring"])
    return None


def r_a4_direction(snap, d, cfg):
    if snap.get(T_DI00) and snap.get(T_DI01):
        return Anomaly("A4_DIRECTION_FAULT", MED, "Direction fault",
                       "FWD (DI_00) and REV (DI_01) are both commanded - the PLC commands STOP.",
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
                       "Command word is RUN (%s) for %.0fs but the motor is not running."
                       % (snap.get(T_CMD), d["cmd_run_for_s"]),
                       _ev(snap, T_CMD, T_RUN), ["gs10", "motor"])
    return None


def r_a8_overcurrent(snap, d, cfg):
    cur = snap.get(T_CUR)
    if _vfd_trustworthy(snap) and isinstance(cur, (int, float)) and cur > cfg["motor_fla_a"]:
        return Anomaly("A8_OVERCURRENT", HIGH, "VFD output over motor FLA",
                       "Output current %.2f A exceeds motor FLA %.2f A - "
                       "possible overload/jam (cf. GS10 oL fault 21)." % (cur, cfg["motor_fla_a"]),
                       _ev(snap, T_CUR), ["motor", "belt"])
    return None


def r_a9_dcbus(snap, d, cfg):
    v = snap.get(T_DCBUS)
    if (_vfd_trustworthy(snap) and isinstance(v, (int, float))
            and (v < cfg["dc_bus_lo_v"] or v > cfg["dc_bus_hi_v"])):
        return Anomaly("A9_DC_BUS", MED, "DC bus voltage out of range",
                       "DC bus %.0f V is outside [%.0f, %.0f] V (nominal ~327 V; low -> GS10 Lvd 12)."
                       % (v, cfg["dc_bus_lo_v"], cfg["dc_bus_hi_v"]),
                       _ev(snap, T_DCBUS), ["gs10", "power"])
    return None


def r_a10_freq_stuck_zero(snap, d, cfg):
    # Commanded RUN but output Hz stuck at ~0 -> drive not producing output.
    # (A constant NON-zero Hz at steady speed is normal and must NOT trip this.)
    # Gate on time SINCE the RUN command, so the idle period where Hz legitimately sat at 0
    # doesn't count.
    freq = snap.get(T_FREQ)
    if (snap.get(T_CMD) in cfg["run_cmd_values"] and _vfd_trustworthy(snap)
            and isinstance(freq, (int, float)) and freq <= 0.1
            and d.get("cmd_run_for_s", 0.0) >= cfg["freq_frozen_s"]):
        return Anomaly("A10_FREQ_STUCK_ZERO", MED, "Output frequency stuck at zero",
                       "Commanded RUN for %.0fs but output Hz is still 0 - "
                       "the drive is not following the run command." % (d["cmd_run_for_s"],),
                       _ev(snap, T_FREQ, T_CMD), ["gs10"])
    return None


def r_a2_vfd_fault(snap, d, cfg):
    # GS10 active fault (low byte of 0x2100). Trust-gated: stale when comm is down.
    code = snap.get(T_FAULT)
    if _vfd_trustworthy(snap) and isinstance(code, (int, float)) and int(code) != 0:
        code = int(code)
        name = GS10_FAULT_CODES.get(code, "unknown")
        sev = CRITICAL if code in _GS10_CRITICAL else HIGH
        return Anomaly("A2_VFD_FAULT", sev, "GS10 drive fault active",
                       "GS10 reports fault code %d: %s - the drive has tripped "
                       "(0x2100 low byte). Clear the cause and reset the drive." % (code, name),
                       _ev(snap, T_FAULT, T_WARN), ["gs10"])
    return None


def r_a7_freq_not_tracking(snap, d, cfg):
    # Commanded RUN with a nonzero speed setpoint, but output Hz is not reaching it
    # (after the accel grace). Distinct from A10 (output stuck at ~0): A7 catches
    # "running but can't hold commanded speed" (drag / current-limit / load).
    sp, out = snap.get(T_FREQ_SP), snap.get(T_FREQ)
    if (snap.get(T_CMD) in cfg["run_cmd_values"] and _vfd_trustworthy(snap)
            and isinstance(sp, (int, float)) and sp > 0.1
            and isinstance(out, (int, float))
            and abs(out - sp) > cfg["freq_track_tol_hz"]
            and d.get("cmd_run_for_s", 0.0) >= cfg["freq_track_grace_s"]):
        return Anomaly("A7_FREQ_NOT_TRACKING", MED, "Output Hz not tracking setpoint",
                       "Commanded %.1f Hz but output is %.1f Hz (off by %.1f Hz > %.1f) for %.0fs - "
                       "drive not reaching commanded speed (mechanical drag, current-limit, or load)."
                       % (sp, out, abs(out - sp), cfg["freq_track_tol_hz"], d["cmd_run_for_s"]),
                       _ev(snap, T_FREQ_SP, T_FREQ, T_CUR), ["gs10", "motor", "belt"])
    return None


def r_a12_photoeye_jam(snap, d, cfg):
    # Photo-eye latching soft-stop engaged (DI_05 beam blocked -> PLC latched a STOP).
    # The authoritative signal is pe_latched (PLC latch); DI_05 is the raw beam.
    if snap.get(T_PE_LATCH) is True:
        return Anomaly("A12_PHOTOEYE_JAM", HIGH, "Photo-eye soft-stop (jam/blockage)",
                       "Photo-eye DI_05 latched a soft-stop - an object is blocking the infeed "
                       "beam (jam/backup); the belt is held stopped until Start re-arms it.",
                       _ev(snap, T_PE_LATCH, T_DI05), ["photoeye", "belt"])
    return None


RULES = [r_a0_offline, r_a1_comm, r_a2_vfd_fault, r_a3_estop_wiring, r_a4_direction,
         r_a5_illegal_run, r_a6_not_responding, r_a7_freq_not_tracking, r_a8_overcurrent,
         r_a9_dcbus, r_a10_freq_stuck_zero, r_a12_photoeye_jam]


def evaluate(snap, derived, cfg=None):
    """Run every rule against a snapshot; return the list of active Anomaly objects."""
    merged = dict(DEFAULT_CFG)
    if cfg:
        merged.update(cfg)
    out = []
    for rule in RULES:
        a = rule(snap, derived or {}, merged)
        if a is not None:
            out.append(a)
    return out
