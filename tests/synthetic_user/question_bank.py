"""Equipment, fault codes, symptoms, and fill values for question generation.

All data is MIRA-specific: equipment brands and models match what's in the
knowledge base (or deliberately absent for out-of-KB adversarial tests).
"""

from __future__ import annotations

# ── Vendors in MIRA's KB ────────────────────────────────────────────────────

VENDORS_IN_KB: list[str] = [
    "Allen-Bradley",
    "AutomationDirect",
    "Siemens",
    "ABB",
    "Eaton",
]

VENDORS_OUT_OF_KB: list[str] = [
    "Danfoss",
    "Yaskawa",
    "Parker",
    "Mitsubishi",
    "Omron",
    "Lenze",
    "WEG",
]

# ── Equipment by type ────────────────────────────────────────────────────────

EQUIPMENT: dict[str, dict] = {
    "VFD": {
        "models": {
            "Allen-Bradley": ["PowerFlex 525", "PowerFlex 755"],
            "AutomationDirect": ["GS10", "GS20", "GS3", "DURApulse GS23"],
            "Siemens": ["SINAMICS G120", "SINAMICS V20"],
            "ABB": ["ACS580", "ACS880"],
            "Eaton": ["PowerXL DE1", "PowerXL DG1"],
        },
        "fault_codes": {
            "PowerFlex 525": ["F004", "F005", "F033", "F064", "F070", "F100"],
            "GS10": ["OC", "OV", "UV", "OH", "GF", "EF"],
            "GS20": ["OC", "OV", "UV", "OH", "OL", "EF", "CF1", "CF2"],
            "SINAMICS G120": ["F0001", "F0002", "F0003", "F0004", "F0011"],
            "ACS580": ["2310", "3210", "3220", "7121", "7122"],
        },
        "symptoms": [
            "overcurrent fault on startup",
            "not accelerating to setpoint",
            "erratic speed fluctuations",
            "tripping on overload",
            "ground fault alarm",
            "bus voltage too high",
            "output phase loss",
            "motor runs backwards",
        ],
        "components": [
            "DC bus capacitors",
            "IGBT module",
            "control board",
            "cooling fan",
            "keypad",
            "braking resistor",
            "line reactor",
            "output contactor",
        ],
    },
    "motor": {
        "models": {
            "general": ["3-phase induction", "single-phase", "DC motor", "servo motor"],
        },
        "fault_codes": {},
        "symptoms": [
            "overheating under load",
            "excessive vibration",
            "grinding noise from bearings",
            "not starting",
            "tripping the overload relay",
            "drawing high current on one phase",
            "shaft seal leaking",
            "running hot but no load change",
        ],
        "components": [
            "bearings",
            "stator windings",
            "rotor",
            "cooling fan",
            "terminal box",
            "coupling",
            "shaft seal",
            "insulation",
        ],
    },
    "PLC": {
        "models": {
            "Allen-Bradley": ["Micro820", "CompactLogix L33ER", "ControlLogix L71"],
            "Siemens": ["S7-1200", "S7-1500"],
            "AutomationDirect": ["BRX PLC", "CLICK PLC"],
        },
        "fault_codes": {
            "Micro820": ["ERR", "FAULT", "IO_FAULT", "COMM_FAULT"],
            "CompactLogix L33ER": ["Major Fault Type 1", "Major Fault Type 3", "Major Fault Type 6"],
        },
        "symptoms": [
            "communication loss to remote I/O",
            "intermittent EtherNet/IP drops",
            "program not running",
            "faulted state after power cycle",
            "analog input reading wrong value",
            "output module not energizing",
            "HMI showing stale data",
            "Modbus timeout errors",
        ],
        "components": [
            "power supply",
            "I/O module",
            "Ethernet switch",
            "communication cable",
            "backplane",
            "processor module",
            "memory card",
        ],
    },
    "compressor": {
        "models": {
            "general": ["rotary screw", "reciprocating", "centrifugal"],
        },
        "fault_codes": {},
        "symptoms": [
            "high discharge pressure alarm",
            "low oil pressure",
            "high air temperature",
            "won't load",
            "short cycling",
            "excessive moisture in air lines",
            "vibration increasing",
            "blowing safety valve",
        ],
        "components": [
            "intake valve",
            "minimum pressure valve",
            "oil separator",
            "air/oil filter",
            "solenoid valve",
            "pressure transducer",
            "motor bearings",
        ],
    },
    "conveyor": {
        "models": {
            "general": ["belt conveyor", "roller conveyor", "chain conveyor", "screw conveyor"],
        },
        "fault_codes": {},
        "symptoms": [
            "belt tracking off to one side",
            "belt slipping on drive pulley",
            "excessive belt sag between idlers",
            "rollers seized",
            "chain stretching",
            "speed sensor not reading",
            "emergency stop tripping during startup",
        ],
        "components": [
            "drive pulley",
            "tail pulley",
            "idler rollers",
            "belt",
            "take-up assembly",
            "speed sensor",
            "pull-cord switch",
        ],
    },
    "hydraulic": {
        "models": {
            "general": ["hydraulic press", "hydraulic cylinder", "power unit"],
        },
        "fault_codes": {},
        "symptoms": [
            "cylinder drifting under load",
            "slow cylinder movement",
            "hydraulic oil overheating",
            "pump making cavitation noise",
            "oil leaking from cylinder seal",
            "pressure not building to setpoint",
            "jerky movement",
        ],
        "components": [
            "cylinder seals",
            "hydraulic pump",
            "directional valve",
            "pressure relief valve",
            "hydraulic filter",
            "accumulator",
            "reservoir",
        ],
    },
    "sensor": {
        "models": {
            "general": [
                "proximity sensor",
                "photoelectric sensor",
                "pressure transmitter",
                "temperature RTD",
                "thermocouple",
                "level sensor",
                "flow meter",
            ],
        },
        "fault_codes": {},
        "symptoms": [
            "reading zero when it shouldn't",
            "intermittent signal",
            "reading full scale constantly",
            "slow response time",
            "false triggering",
            "reading drifting over time",
            "4-20mA output stuck at 4mA",
        ],
        "components": [
            "sensing element",
            "wiring",
            "transmitter electronics",
            "process connection",
            "cable gland",
        ],
    },
}

# ── General fill values ──────────────────────────────────────────────────────

ACTIONS: list[str] = [
    "calibrate",
    "replace",
    "adjust",
    "clean",
    "lubricate",
    "align",
    "wire",
    "program",
    "inspect",
    "troubleshoot",
]

ALARMS: list[str] = [
    "high temperature",
    "low pressure",
    "overcurrent",
    "ground fault",
    "communication loss",
    "emergency stop",
    "overload",
    "phase loss",
    "overvoltage",
    "undervoltage",
]

CONCEPTS: list[str] = [
    "VFD",
    "PID loop",
    "ladder logic",
    "MTBF",
    "MTTR",
    "OEE",
    "lockout tagout",
    "arc flash",
    "function block",
    "EtherNet/IP",
    "Modbus",
    "DeviceNet",
]

# ── Abbreviation pairs (shorthand → full form) ─────────────────────────────
# These are abbreviations a senior tech WOULD use (many are in guardrails.py
# MAINTENANCE_ABBREVIATIONS). Used by the senior_tech and night_shift personas.

ABBREVIATIONS: dict[str, str] = {
    "mtr": "motor",
    "trpd": "tripped",
    "vfd": "variable frequency drive",
    "oc": "overcurrent",
    "ov": "overvoltage",
    "uv": "undervoltage",
    "oh": "overheating",
    "gf": "ground fault",
    "pmp": "pump",
    "brgn": "bearing",
    "ckt brkr": "circuit breaker",
    "xfmr": "transformer",
    "flt": "fault",
    "hmi": "HMI",
    "plc": "PLC",
    "io": "I/O",
    "comms": "communications",
    "psi": "PSI",
    "rpm": "RPM",
}

# Abbreviations NOT in guardrails MAINTENANCE_ABBREVIATIONS —
# used by adversarial A5 to test abbreviation expansion failure.
UNKNOWN_ABBREVIATIONS: dict[str, str] = {
    "drv": "drive",
    "fltd": "faulted",
    "pwr": "power",
    "sply": "supply",
    "seezd": "seized",
    "cmpssr": "compressor",
    "cnvyr": "conveyor",
    "hyd": "hydraulic",
    "prox": "proximity",
    "thrmcpl": "thermocouple",
    "rly": "relay",
    "cntctr": "contactor",
    "bttn": "button",
    "sw": "switch",
}
