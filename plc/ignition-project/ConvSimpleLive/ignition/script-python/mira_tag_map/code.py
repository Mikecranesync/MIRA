# tag_topic_map.py -- Pure mapping logic (no system.* imports).
# Importable in standard Python 3 for unit tests, and from Jython 2.7 in doGet.py.
#
# Maps an Ignition tag's LEAF name (last path segment) to the diagnose-core snap topic
# plus a scale divisor, so the SAME map works no matter which tag folder the panel is
# bound to. Covers BOTH the [default]Conveyor/ engineering-unit tags AND the
# [default]MIRA_IOCheck/VFD/ raw V2.1 tags. Unknown leaf names are ignored; a missing
# topic just makes the corresponding rule degrade (snap.get -> None).
#
# NOTE (Phase 1): this is a hand-authored default for the Conv_Simple tag sets. Phase 3
# (auto-classify) generates this mapping per asset; the shape stays the same.
# Ref: docs/plans warm-wadler; live names verified vs ignition/project/approved_tags.json.

# Topic strings -- kept literal (mirror diagnose_core.T_*) to avoid an import cycle.
_RUN = "motor/m101/running"
_COMM = "vfd/vfd101/comm_ok"
_ESTOP = "safety/estop"
_WIRING = "safety/wiring"
_CONTACTOR = "safety/contactor_q1"
_DI00 = "plc/di/di00_fwd"
_DI01 = "plc/di/di01_rev"
_DI02 = "plc/di/di02_estop_nc"
_DI03 = "plc/di/di03_estop_no"
_DI05 = "plc/di/di05_photoeye"
_FREQ = "vfd/vfd101/freq"
_CUR = "vfd/vfd101/current_a"
_DCBUS = "vfd/vfd101/dc_bus_v"
_CMD = "vfd/vfd101/cmd_word"
_FAULT = "vfd/vfd101/fault_code"
_WARN = "vfd/vfd101/warn_code"
_SP = "vfd/vfd101/freq_setpoint"
_PE = "safety/pe_latched"

# leaf tag name -> (topic, divisor). divisor None = bool/raw passthrough; 1.0 = int passthrough.
LEAF_MAP = {
    # --- [default]Conveyor/ : engineering-unit Expression tags + bools (preferred) ---
    "Motor_Running": (_RUN, None),
    "VFD_Comm_OK": (_COMM, None),
    "EStop_Active": (_ESTOP, None),
    "EStop_Wiring_Fault": (_WIRING, None),
    "Dir_FWD": (_DI00, None),
    "Dir_REV": (_DI01, None),
    "Raw_I02": (_DI02, None),
    "Raw_I03": (_DI03, None),
    "Raw_O02": (_CONTACTOR, None),
    "VFD_Hz": (_FREQ, 1.0),
    "VFD_Amps": (_CUR, 1.0),
    "VFD_DCBus_V": (_DCBUS, 1.0),
    "VFD_Setpoint_Hz": (_SP, 1.0),
    "VFD_CmdWord": (_CMD, 1.0),
    "VFD_FaultCode": (_FAULT, 1.0),
    # --- [default]Conveyor/ raw fallbacks (scaled here) ---
    "VFD_OutputFreq_Raw": (_FREQ, 10.0),
    "VFD_OutputCurrent_Raw": (_CUR, 10.0),
    "VFD_DCBus_Raw": (_DCBUS, 10.0),
    "VFD_FreqSetpoint_Raw": (_SP, 10.0),
    # --- [default]MIRA_IOCheck/VFD/ raw V2.1 tags + IO (divisors per live_logger) ---
    "vfd_comm_ok": (_COMM, None),
    "vfd_current": (_CUR, 100.0),
    "vfd_dc_bus": (_DCBUS, 10.0),
    "vfd_frequency": (_FREQ, 100.0),
    "vfd_freq_cmd": (_SP, 100.0),   # commanded Hz -- the reliable V2.1 setpoint (not vfd_freq_sp)
    "vfd_cmd_word": (_CMD, 1.0),
    "vfd_fault_code": (_FAULT, 1.0),
    "vfd_warn_code": (_WARN, 1.0),
    "pe_latched": (_PE, None),
    "DI_02": (_DI02, None),
    "DI_03": (_DI03, None),
    "DI_05": (_DI05, None),
    "DO_02": (_CONTACTOR, None),
}

RELEVANT_LEAVES = list(LEAF_MAP.keys())


def leaf_name(tag_path):
    """Last path segment of an Ignition tag path, e.g. '[default]Conveyor/VFD_Hz' -> 'VFD_Hz'."""
    s = str(tag_path)
    if "/" in s:
        s = s.rsplit("/", 1)[1]
    return s


def coerce(value, divisor):
    if value is None or divisor is None:
        return value           # bool / raw passthrough
    if divisor == 1.0:
        return value           # int passthrough (codes, cmd word) -- keep type
    try:
        return float(value) / divisor
    except (TypeError, ValueError):
        return None


def build_snap(leaf_value_pairs):
    """leaf_value_pairs: iterable of (leaf_name_or_tag_path, value). Returns the snap dict
    the diagnose-core rules consume. Tag paths are accepted (reduced to their leaf)."""
    snap = {}
    for name, value in leaf_value_pairs:
        m = LEAF_MAP.get(name)
        if m is None:
            m = LEAF_MAP.get(leaf_name(name))   # accept a full tag path too
        if m is None:
            continue
        topic, divisor = m
        snap[topic] = coerce(value, divisor)
    return snap
