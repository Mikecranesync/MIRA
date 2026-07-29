# signal_roles.py -- canonical VFD-Analyzer signal-role catalog (no system.* imports).
#
# Single source of truth for the roles the analyzer understands. A role KEY is a
# diagnose-core `snap` topic (the T_* constants in plc/conv_simple_anomaly/rules_core.py);
# the per-asset config map (asset_config.py) points a customer's real tag at one of these
# keys + a scale divisor. The UI (TagMapper Perspective view) renders this catalog; the
# consumers (mira_diagnose, TrendChart) validate the config against it.
#
# Standalone by design: like rules_core.py / tag_topic_map.py, this module imports nothing
# from its siblings. asset_config.py does NOT import this -- it takes valid/required key
# sets as params -- so the two stay decoupled and the gateway wiring (code.py) composes them.
#
# Dual Python 2.7 + 3.12-clean: no from __future__, no annotations, no f-strings, plain
# dicts/lists, % formatting, ASCII only (Jython byte-string safe).
# Ref: docs/specs/vfd-analyzer-auto-map-spec.md SS2; roles verified vs rules_core.py T_*.

# kind -- drives the picker datatype filter + scaling semantics.
ANALOG, BOOL, CODE = "analog", "bool", "code"
# requirement -- the analyzer's minimum-useful set vs nice-to-have.
REQUIRED, RECOMMENDED, OPTIONAL = "required", "recommended", "optional"

# Drive families (selects the default analog divisor). generic = pre-scaled engineering tags.
GS10, GENERIC = "GS10", "generic"

# Catalog order = display order (required first, then recommended, then optional).
# "div" = {family: default divisor}; None = bool/raw passthrough, 1.0 = int passthrough (codes).
ROLES = [
    {"key": "vfd/vfd101/freq", "display": "Output frequency", "kind": ANALOG, "unit": "Hz",
     "div": {GS10: 100.0, GENERIC: 1.0}, "requirement": REQUIRED, "rules": ["A7", "A10"],
     "about": "How fast the motor is actually spinning right now. When running it should be near the setpoint; 0 means stopped.",
     "typical": "0-60 Hz"},
    {"key": "vfd/vfd101/current_a", "display": "Output current", "kind": ANALOG, "unit": "A",
     "div": {GS10: 100.0, GENERIC: 1.0}, "requirement": REQUIRED, "rules": ["A8"],
     "about": "How hard the motor is working -- the amps it's drawing. A jump can mean a jam or overload; 0 means stopped.",
     "typical": "0 to the motor's rated amps"},
    {"key": "vfd/vfd101/fault_code", "display": "Fault code", "kind": CODE, "unit": "",
     "div": {GS10: 1.0, GENERIC: 1.0}, "requirement": REQUIRED, "rules": ["A2"],
     "about": "The drive's error number. 0 means no fault; any other number is a specific problem to look up.",
     "typical": "0 when healthy"},

    {"key": "vfd/vfd101/freq_setpoint", "display": "Frequency setpoint", "kind": ANALOG, "unit": "Hz",
     "div": {GS10: 100.0, GENERIC: 1.0}, "requirement": RECOMMENDED, "rules": ["A7"],
     "about": "The speed the drive is being TOLD to run -- the target. Output frequency should chase this value.",
     "typical": "0-60 Hz"},
    {"key": "vfd/vfd101/dc_bus_v", "display": "DC-bus voltage", "kind": ANALOG, "unit": "V",
     "div": {GS10: 10.0, GENERIC: 1.0}, "requirement": RECOMMENDED, "rules": ["A9"],
     "about": "The DC voltage inside the drive. Steady is normal; sudden sags or spikes point to power problems.",
     "typical": "around 300 V (GS10)"},
    {"key": "vfd/vfd101/comm_ok", "display": "Drive comm OK", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": RECOMMENDED, "rules": ["A1"],
     "about": "Is the drive actually talking to the PLC right now? If this is off, fix the connection before anything else.",
     "typical": "ON / true"},
    {"key": "vfd/vfd101/cmd_word", "display": "Command word", "kind": CODE, "unit": "",
     "div": {GS10: 1.0, GENERIC: 1.0}, "requirement": RECOMMENDED, "rules": ["A6", "A10"],
     "about": "The raw run/stop/direction command sent to the drive (a bit-packed number). Advanced -- safe to skip.",
     "typical": "a whole number"},

    {"key": "vfd/vfd101/warn_code", "display": "Warn code", "kind": CODE, "unit": "",
     "div": {GS10: 1.0, GENERIC: 1.0}, "requirement": OPTIONAL, "rules": ["A2"]},
    {"key": "motor/m101/running", "display": "Motor running", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A5", "A6"]},
    {"key": "safety/estop", "display": "E-stop active", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A5"]},
    {"key": "safety/wiring", "display": "E-stop wiring fault", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A3", "A5"]},
    {"key": "safety/contactor_q1", "display": "Contactor closed", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A5"]},
    {"key": "safety/pe_latched", "display": "Photo-eye latch", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A12"]},
    {"key": "plc/di/di00_fwd", "display": "DI: FWD command", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A4"]},
    {"key": "plc/di/di01_rev", "display": "DI: REV command", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A4"]},
    {"key": "plc/di/di02_estop_nc", "display": "DI: E-stop NC", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A3"]},
    {"key": "plc/di/di03_estop_no", "display": "DI: E-stop NO", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A3"]},
    {"key": "plc/di/di05_photoeye", "display": "DI: photo-eye beam", "kind": BOOL, "unit": "",
     "div": {GS10: None, GENERIC: None}, "requirement": OPTIONAL, "rules": ["A12"]},
]

ROLE_BY_KEY = {}
for _r in ROLES:
    ROLE_BY_KEY[_r["key"]] = _r


def role(key):
    """The catalog entry for a role key, or None if unknown."""
    return ROLE_BY_KEY.get(key)


def valid_keys():
    """The set of role keys a config may legally map onto."""
    return set(ROLE_BY_KEY.keys())


def required_keys():
    """Role keys the analyzer needs before it is 'ready' (the train-before-deploy gate)."""
    out = []
    for r in ROLES:
        if r["requirement"] == REQUIRED:
            out.append(r["key"])
    return out


def default_divisor(key, family):
    """Default scale divisor for a role under a drive family. None = passthrough.
    Unknown family falls back to GENERIC; unknown key returns 1.0 (safe int passthrough)."""
    r = ROLE_BY_KEY.get(key)
    if r is None:
        return 1.0
    divs = r["div"]
    if family in divs:
        return divs[family]
    return divs.get(GENERIC, 1.0)
