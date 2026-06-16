"""Fault code extractor — detects and maps manufacturer fault codes in text.

Covers Allen-Bradley, Siemens, ABB, Yaskawa, Danfoss, SEW, WEG, generic E-codes.
Each pattern maps to (manufacturer, code, description).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class FaultCodeMatch:
    code: str
    manufacturer: str
    description: str


# ---------------------------------------------------------------------------
# Known fault code lookup table
# Format: code_upper -> (manufacturer, description)
# ---------------------------------------------------------------------------

_KNOWN_CODES: dict[str, tuple[str, str]] = {
    # Allen-Bradley PowerFlex 4xx/7xx/750x
    "F002": ("Allen-Bradley", "Output current phase loss"),
    "F003": ("Allen-Bradley", "Overcurrent trip"),
    "F004": ("Allen-Bradley", "Motor overload (thermal model)"),
    "F005": ("Allen-Bradley", "Resistive braking overload"),
    "F006": ("Allen-Bradley", "Motor thermistor overload"),
    "F007": ("Allen-Bradley", "Motor thermal overload"),
    "F008": ("Allen-Bradley", "Heatsink overtemperature"),
    "F009": ("Allen-Bradley", "Software overtemperature"),
    "F010": ("Allen-Bradley", "Drive overtemperature"),
    "F011": ("Allen-Bradley", "Motor stall detected"),
    "F012": ("Allen-Bradley", "Drive overcurrent"),
    "F013": ("Allen-Bradley", "Ground fault detected"),
    "F020": ("Allen-Bradley", "Input phase loss"),
    "F021": ("Allen-Bradley", "DC bus undervoltage"),
    "F022": ("Allen-Bradley", "Low bus undervoltage"),
    "F025": ("Allen-Bradley", "DC bus overvoltage"),
    "F026": ("Allen-Bradley", "Main current sensor fuse"),
    "F027": ("Allen-Bradley", "Motor current sensor fault"),
    "F033": ("Allen-Bradley", "Auto-tune failure"),
    "F038": ("Allen-Bradley", "Common mode filter fault"),
    "F039": ("Allen-Bradley", "Output frequency fault"),
    "F040": ("Allen-Bradley", "Parameter not set"),
    "F041": ("Allen-Bradley", "Parameter over limit"),
    "F042": ("Allen-Bradley", "Parameter under limit"),
    "F043": ("Allen-Bradley", "Parameter read-only"),
    "F044": ("Allen-Bradley", "Write failure"),
    "F045": ("Allen-Bradley", "Loss of synchronisation"),
    "F046": ("Allen-Bradley", "Drive communications loss"),
    "F047": ("Allen-Bradley", "CAN communications loss"),
    "F048": ("Allen-Bradley", "DSI communications loss"),
    "F050": ("Allen-Bradley", "Encoder loss"),
    "F051": ("Allen-Bradley", "Encoder signal failure"),
    "F059": ("Allen-Bradley", "Network communications loss"),
    "F061": ("Allen-Bradley", "Logic voltage hardware fault"),
    "F062": ("Allen-Bradley", "Logic voltage software fault"),
    "F063": ("Allen-Bradley", "Fan failure"),
    "F064": ("Allen-Bradley", "Wrong unit type"),
    "F068": ("Allen-Bradley", "Power module fault"),
    "F069": ("Allen-Bradley", "Inverter gate drive fault"),
    "F072": ("Allen-Bradley", "Motor type mismatch"),
    "F074": ("Allen-Bradley", "Phase current imbalance"),
    "F075": ("Allen-Bradley", "Sync transfer failure"),
    "F081": ("Allen-Bradley", "Precharge failure"),
    "F100": ("Allen-Bradley", "Encoder feedback fault"),
    "F107": ("Allen-Bradley", "Rating mismatch"),
    "F111": ("Allen-Bradley", "Inverter saturation"),
    "F112": ("Allen-Bradley", "Temperature sensor failure"),
    "F125": ("Allen-Bradley", "Precharge relay fault"),
    "F126": ("Allen-Bradley", "IGBT gate driver fault"),
    "F127": ("Allen-Bradley", "Bus capacitor pre-charge"),
    "F128": ("Allen-Bradley", "Thermal model fault"),
    "F134": ("Allen-Bradley", "Active current limit"),
    "F135": ("Allen-Bradley", "Motor overtemperature (sensor)"),
    "F150": ("Allen-Bradley", "Motor overtemperature (NTC)"),

    # Yaskawa CIPR (letter codes)
    "OC": ("Yaskawa", "Overcurrent"),
    "OV": ("Yaskawa", "Overvoltage — DC bus"),
    "UV": ("Yaskawa", "Undervoltage — DC bus"),
    "UV1": ("Yaskawa", "DC bus undervoltage"),
    "UV2": ("Yaskawa", "Control power supply low"),
    "UV3": ("Yaskawa", "MC answerback fault"),
    "OH": ("Yaskawa", "Heatsink overtemperature"),
    "OH1": ("Yaskawa", "Drive overtemperature"),
    "OH2": ("Yaskawa", "Motor overtemperature 1"),
    "OH3": ("Yaskawa", "Motor overtemperature 2"),
    "OL": ("Yaskawa", "Motor overload (trip)"),
    "OL1": ("Yaskawa", "Motor overload"),
    "OL2": ("Yaskawa", "Drive overload"),
    "OL3": ("Yaskawa", "Overtorque detection 1"),
    "OL4": ("Yaskawa", "Overtorque detection 2"),
    "EF": ("Yaskawa", "External fault"),
    "EF0": ("Yaskawa", "External fault input S1"),
    "EF1": ("Yaskawa", "External fault input S2"),
    "EF3": ("Yaskawa", "External fault input S4"),
    "GF": ("Yaskawa", "Ground fault"),
    "PF": ("Yaskawa", "Input power supply fault"),
    "LF": ("Yaskawa", "Output phase loss"),
    "RH": ("Yaskawa", "Braking resistor overload"),
    "BUS": ("Yaskawa", "Option communications fault"),
    "CPF": ("Yaskawa", "Control circuit fault"),
    "DEV": ("Yaskawa", "Speed deviation"),
    "PGO": ("Yaskawa", "Encoder open circuit"),
    "STO": ("Yaskawa", "Safe torque off"),

    # ABB ACS fault codes
    "2310": ("ABB", "Overcurrent"),
    "2311": ("ABB", "Overcurrent trip"),
    "3210": ("ABB", "DC link overvoltage"),
    "3211": ("ABB", "DC link overvoltage trip"),
    "3220": ("ABB", "DC link undervoltage"),
    "3221": ("ABB", "DC link undervoltage trip"),
    "4210": ("ABB", "Output earth fault (alarm)"),
    "4211": ("ABB", "Output earth fault (trip)"),
    "5010": ("ABB", "Motor overtemperature (alarm)"),
    "5011": ("ABB", "Motor thermal protection (trip)"),
    "5020": ("ABB", "Drive overtemperature (alarm)"),
    "5021": ("ABB", "Drive thermal protection (trip)"),
    "7010": ("ABB", "Input phase loss"),
    "7020": ("ABB", "Output phase loss"),
    "9002": ("ABB", "Communication loss"),

    # Siemens SINAMICS fault codes
    "F0001": ("Siemens", "Overcurrent — converter"),
    "F0002": ("Siemens", "DC link overvoltage"),
    "F0003": ("Siemens", "DC link undervoltage"),
    "F0004": ("Siemens", "Drive temperature high"),
    "F0005": ("Siemens", "Drive overload I2T"),
    "F0006": ("Siemens", "Drive Ixt overload"),
    "F0010": ("Siemens", "DC link overvoltage (line)"),
    "F0011": ("Siemens", "DC link undervoltage (line)"),
    "F0012": ("Siemens", "DC link overcurrent"),
    "F0015": ("Siemens", "Motor temperature high"),
    "F0021": ("Siemens", "Ground fault"),
    "F0025": ("Siemens", "Load monitoring fault"),
    "F0030": ("Siemens", "Fan fault"),
    "F0035": ("Siemens", "Power section defective"),
    "F0042": ("Siemens", "Frequency setpoint missing"),
    "F0051": ("Siemens", "Parameter error"),
    "F0052": ("Siemens", "Power module data error"),
    "F0060": ("Siemens", "PROFIBUS/PROFINET fault"),
    "F0070": ("Siemens", "Setpoint timeout"),
    "F0080": ("Siemens", "Input signal fault"),
    "F0085": ("Siemens", "External fault"),
    "F0090": ("Siemens", "Encoder fault"),
    "F0100": ("Siemens", "Motor blocked"),
    "F0101": ("Siemens", "Motor overcurrent"),
    "F0222": ("Siemens", "Power section overcurrent"),
    "F0450": ("Siemens", "Motor identification fault"),
    "A0501": ("Siemens", "Drive temperature warning"),
    "A0511": ("Siemens", "Drive overload warning"),
    "A0910": ("Siemens", "DC link voltage ripple"),
    "A0920": ("Siemens", "Parameter error (warning)"),

    # Danfoss VLT FC-302
    "E00": ("Danfoss", "No fault"),
    "E01": ("Danfoss", "10V supply low"),
    "E02": ("Danfoss", "Live zero fault"),
    "E03": ("Danfoss", "Motor stall"),
    "E04": ("Danfoss", "Mains phase loss"),
    "E05": ("Danfoss", "DC link overvoltage"),
    "E06": ("Danfoss", "DC link undervoltage"),
    "E07": ("Danfoss", "DC overvoltage"),
    "E08": ("Danfoss", "Overcurrent"),
    "E09": ("Danfoss", "Inverter overloaded"),
    "E10": ("Danfoss", "Motor ETR overtemperature"),
    "E11": ("Danfoss", "Motor thermistor overtemperature"),
    "E13": ("Danfoss", "Overcurrent, short circuit"),
    "E14": ("Danfoss", "Earth fault"),
    "E15": ("Danfoss", "Hardware mismatch"),
    "E16": ("Danfoss", "Short circuit"),
    "E17": ("Danfoss", "Control word timeout"),
    "E29": ("Danfoss", "Heatsink temperature"),
    "E30": ("Danfoss", "Missing input phase"),
    "E31": ("Danfoss", "Motor phase U loss"),
    "E32": ("Danfoss", "Motor phase V loss"),
    "E33": ("Danfoss", "Motor phase W loss"),
    "E34": ("Danfoss", "Fieldbus communication fault"),
    "E45": ("Danfoss", "Earth fault 2"),
    "E47": ("Danfoss", "AMA fault"),
    "E48": ("Danfoss", "AMA timeout"),

    # Mitsubishi FR-A740/F700 series
    "E.OC1": ("Mitsubishi", "Overcurrent acceleration"),
    "E.OC2": ("Mitsubishi", "Overcurrent deceleration"),
    "E.OC3": ("Mitsubishi", "Overcurrent constant speed"),
    "E.OV1": ("Mitsubishi", "Overvoltage acceleration"),
    "E.OV2": ("Mitsubishi", "Overvoltage deceleration"),
    "E.OV3": ("Mitsubishi", "Overvoltage constant speed"),
    "E.UVT": ("Mitsubishi", "Undervoltage trip"),
    "E.THT": ("Mitsubishi", "Transistor overheat"),
    "E.THM": ("Mitsubishi", "Motor overheat"),
    "E.FIN": ("Mitsubishi", "Heatsink overheat"),
    "E.GF": ("Mitsubishi", "Ground fault"),
    "E.LF": ("Mitsubishi", "Output phase loss"),

    # Generic / multi-brand
    "E-OC": ("Generic", "Overcurrent fault"),
    "E-OV": ("Generic", "Overvoltage fault"),
    "E-UV": ("Generic", "Undervoltage fault"),
    "E-OH": ("Generic", "Overtemperature / overheat"),
    "E-GF": ("Generic", "Ground fault"),
    "E-LF": ("Generic", "Output phase loss"),
    "E-PH": ("Generic", "Input phase loss"),
    "E-SP": ("Generic", "Speed deviation fault"),
    "E-IT": ("Generic", "Overcurrent I²T"),
    "OL TRIP": ("Generic", "Overload relay trip"),
}

# Normalize key lookups
_KNOWN_CODES_UPPER = {k.upper().replace(" ", "").replace(".", ""): v for k, v in _KNOWN_CODES.items()}


# ---------------------------------------------------------------------------
# Regex patterns for fault code detection
# ---------------------------------------------------------------------------

_FAULT_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Allen-Bradley PowerFlex F-codes: F002, F025, F125 etc.
    (re.compile(r"\bF(\d{3,4})\b"), "Allen-Bradley"),
    # Siemens F5-digit: F0001, F0085
    (re.compile(r"\bF(0\d{4})\b"), "Siemens"),
    # ABB alarm/fault codes: 4-digit standalone
    (re.compile(r"\b([2-9]\d{3})\b"), "ABB"),
    # Yaskawa letter codes: OC, OV, UV, OH, GF, LF, OL etc.
    (re.compile(r"\b(OC|OV\d?|UV\d?|OH\d?|GF|LF|OL\d?|EF\d?|PF|RH|BUS|CPF|DEV|PGO|STO)\b", re.I), "Yaskawa"),
    # Danfoss E-code: E01, E08 etc.
    (re.compile(r"\bE(\d{2})\b"), "Danfoss"),
    # Generic E-prefix: E-OC, E-OV, E-UV, E-OH
    (re.compile(r"\bE[\s\-](OC|OV|UV|OH|GF|LF|PH|IT|SP)\b", re.I), "Generic"),
    # Generic AL-xx alarm format
    (re.compile(r"\bAL[\s\-]?(\d{2,3})\b", re.I), "Generic"),
    # Generic ERR-xxx
    (re.compile(r"\bERR[\s\-]?(\d{2,3})\b", re.I), "Generic"),
    # Generic fault code
    (re.compile(r"\b(?:fault|error|alarm|code)[\s\-:]?\s*([A-Z]\d{2,5})\b", re.I), "Generic"),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_fault_codes(text: str) -> list[FaultCodeMatch]:
    """Extract all fault codes from text, returning deduplicated matches."""
    seen: set[str] = set()
    results: list[FaultCodeMatch] = []
    combined = text[:3000]

    for pattern, default_mfr in _FAULT_PATTERNS:
        for m in pattern.finditer(combined):
            raw_code = m.group(0).upper().replace(" ", "").replace(".", "").replace("-", "")
            if raw_code in seen:
                continue
            seen.add(raw_code)

            # Look up in known codes table
            known = _KNOWN_CODES_UPPER.get(raw_code)
            if known:
                mfr, desc = known
            else:
                mfr = default_mfr
                desc = "Unknown fault code"

            results.append(FaultCodeMatch(
                code=m.group(0).strip(),
                manufacturer=mfr,
                description=desc,
            ))

    return results


def has_fault_code(text: str) -> bool:
    """Quick check: does text contain any recognizable fault code?"""
    return any(p.search(text[:1000]) for p, _ in _FAULT_PATTERNS)
