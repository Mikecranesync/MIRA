"""Equipment extractor — manufacturer, model, and equipment-type detection.

Extracts structured equipment metadata from free-form maintenance text using
regex patterns covering 50+ manufacturers and 15+ equipment types.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class EquipmentMatch:
    manufacturer: str = ""
    model: str = ""
    equipment_type: str = ""
    raw_mentions: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Manufacturer patterns
# Each entry: (compiled_regex, canonical_name)
# ---------------------------------------------------------------------------

_MFR_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Allen-Bradley / Rockwell Automation
    (re.compile(r"\ballen[\s\-]?bradley\b", re.I), "Allen-Bradley"),
    (re.compile(r"\brockwell\b", re.I), "Rockwell"),
    (re.compile(r"\bpowerflex\b", re.I), "Allen-Bradley"),
    (re.compile(r"\bcontrologix\b|\bcompactlogix\b|\bslc[\s\-]?500\b|\bmicrologix\b|\bpanelview\b", re.I), "Allen-Bradley"),
    (re.compile(r"\b1756\b|\b1769\b|\b1794\b|\b1747\b|\b1762\b|\b1763\b|\b1764\b|\b1766\b", re.I), "Allen-Bradley"),

    # Siemens
    (re.compile(r"\bsiemens\b", re.I), "Siemens"),
    (re.compile(r"\bsinamics\b|\bsimotics\b|\bsimatic\b|\bs7[\s\-]?\d{3,4}\b", re.I), "Siemens"),
    (re.compile(r"\bmicromaster\b|\bsinareg\b", re.I), "Siemens"),

    # ABB
    (re.compile(r"\babb\b(?!\s+road|\s+way|\s+street)", re.I), "ABB"),
    (re.compile(r"\bacs[\s\-]?\d{3,4}\b|\bacs\s?355\b|\bacs\s?550\b|\bacs\s?580\b|\bacs\s?800\b|\bacs\s?880\b", re.I), "ABB"),
    (re.compile(r"\bm2bax\b|\birb[\s\-]?\d{3,4}\b", re.I), "ABB"),

    # Yaskawa
    (re.compile(r"\byaskawa\b", re.I), "Yaskawa"),
    (re.compile(r"\bv1000\b|\ba1000\b|\be1000\b|\bg7\b(?!\s+[a-z])|\bj7\b|\be7\b|\bp7\b|\bf7\b", re.I), "Yaskawa"),
    (re.compile(r"\bga500\b|\bga700\b|\bga800\b|\bca700\b|\bba1000\b", re.I), "Yaskawa"),
    (re.compile(r"\bsigma[\s\-]?(?:ii|5|7)\b", re.I), "Yaskawa"),

    # Schneider Electric / Square D
    (re.compile(r"\bschneider\b", re.I), "Schneider"),
    (re.compile(r"\bsquare[\s\-]?d\b", re.I), "Schneider"),
    (re.compile(r"\baltivar\b|\bmodicon\b|\bpremium\b\s*plc|\bm221\b|\bm241\b|\bm340\b|\bm580\b", re.I), "Schneider"),
    (re.compile(r"\batv[\s\-]?\d{2,3}\b", re.I), "Schneider"),

    # Mitsubishi
    (re.compile(r"\bmitsubishi\b", re.I), "Mitsubishi"),
    (re.compile(r"\bfr[\s\-]?[aedf]\d{3}\b|\bmelservo\b|\biq[\s\-]?r\b|\bmelsec\b", re.I), "Mitsubishi"),

    # Danfoss
    (re.compile(r"\bdanfoss\b", re.I), "Danfoss"),
    (re.compile(r"\bfc[\s\-]?\d{3}\b|\bvlt\b", re.I), "Danfoss"),

    # Eaton
    (re.compile(r"\beaten\b", re.I), "Eaton"),
    (re.compile(r"\bpowerxl\b|\bdf1\b|\bcutler[\s\-]?hammer\b|\bmoeller\b", re.I), "Eaton"),

    # GE / General Electric
    (re.compile(r"\bgeneral[\s\-]?electric\b|\b(?<!\w)ge(?!\w)\s+(?:drive|motor|fanuc|plc|series)\b", re.I), "GE"),
    (re.compile(r"\baf[\s\-]?300\b|\b6ke\b|\bge[\s\-]?fanuc\b", re.I), "GE"),

    # Emerson / Control Techniques
    (re.compile(r"\bemerson\b", re.I), "Emerson"),
    (re.compile(r"\bcontrol[\s\-]?techniques\b|\bunidrive\b|\bsp[\s\-]?drive\b|\bdeltadrive\b", re.I), "Emerson"),
    (re.compile(r"\bfisher[\s\-]?rosemount\b|\bdelta[\s\-]?v\b", re.I), "Emerson"),

    # Parker
    (re.compile(r"\bparker\b", re.I), "Parker"),
    (re.compile(r"\bac890\b|\bac10\b(?!\s*[a-z0-9]{3})\b|\bpsd\d{3}\b", re.I), "Parker"),

    # Bosch Rexroth
    (re.compile(r"\bbosch[\s\-]?rexroth\b|\brexroth\b", re.I), "Bosch Rexroth"),
    (re.compile(r"\bindramat\b|\becodrive\b|\bservodyn\b|\bhydromatik\b", re.I), "Bosch Rexroth"),

    # SEW-Eurodrive
    (re.compile(r"\bsew[\s\-]?eurodrive\b|\bsew[\s\-]drive\b", re.I), "SEW-Eurodrive"),
    (re.compile(r"\bmovidrive\b|\bmovitrac\b|\bmoviaxis\b|\bmovifit\b", re.I), "SEW-Eurodrive"),

    # WEG
    (re.compile(r"\bweg\b", re.I), "WEG"),
    (re.compile(r"\bcfw[\s\-]?\d{3}\b", re.I), "WEG"),

    # Lenze
    (re.compile(r"\blenze\b", re.I), "Lenze"),
    (re.compile(r"\bi500\b|\bi700\b|\bg500\b|\b8200\b|\b8400\b", re.I), "Lenze"),

    # Nord
    (re.compile(r"\bnord\b(?!\s+(?:and|to|of|the|is|in|at))\b", re.I), "Nord"),
    (re.compile(r"\bsk\s?\d{3,4}\b", re.I), "Nord"),

    # Baldor / ABB (motors)
    (re.compile(r"\bbaldor\b", re.I), "Baldor"),
    (re.compile(r"\bmarathon[\s\-]?electric\b", re.I), "Marathon"),

    # Honeywell
    (re.compile(r"\bhoneywell\b", re.I), "Honeywell"),
    (re.compile(r"\budc[\s\-]?\d{4}\b|\bhc900\b|\bexperion\b|\bmultitrend\b", re.I), "Honeywell"),

    # Sullair
    (re.compile(r"\bsullair\b", re.I), "Sullair"),

    # Atlas Copco
    (re.compile(r"\batlas[\s\-]?copco\b", re.I), "Atlas Copco"),
    (re.compile(r"\bga\d{2,3}[cvw]?\b", re.I), "Atlas Copco"),

    # Grundfos
    (re.compile(r"\bpgrundge?fos\b|\bgrundfos\b", re.I), "Grundfos"),
    (re.compile(r"\bcr[\s\-]?\d{1,2}[\s\-]?\d{1,3}\b", re.I), "Grundfos"),

    # Beckhoff
    (re.compile(r"\bbeckhoff\b", re.I), "Beckhoff"),
    (re.compile(r"\btwincat\b|\bethercat\b|\bcx\d{4}\b|\bel\d{4}\b", re.I), "Beckhoff"),

    # Omron
    (re.compile(r"\bomron\b", re.I), "Omron"),
    (re.compile(r"\bsysmac\b|\bcj[\d]\b|\bnj\d\b|\bnx\d\b|\be5\w{2}\b", re.I), "Omron"),

    # SMC
    (re.compile(r"\bsmc[\s\-]?(?:pneumatics|corp|corporation)\b|\bsmc\s+valve\b|\bsmc\s+cylinder\b", re.I), "SMC"),

    # Festo
    (re.compile(r"\bfesto\b", re.I), "Festo"),

    # Banner Engineering
    (re.compile(r"\bbanner[\s\-]?(?:engineering|sensor|safety)\b", re.I), "Banner"),

    # Pepperl+Fuchs
    (re.compile(r"\bpepperl[\s\+&]?fuchs\b", re.I), "Pepperl+Fuchs"),

    # Turck
    (re.compile(r"\bturck\b", re.I), "Turck"),

    # Phoenix Contact
    (re.compile(r"\bphoenix[\s\-]?contact\b", re.I), "Phoenix Contact"),

    # Endress+Hauser
    (re.compile(r"\bendress[\s\+&]?hauser\b", re.I), "Endress+Hauser"),

    # Graco
    (re.compile(r"\bgraco\b", re.I), "Graco"),

    # Leeson / Regal Beloit
    (re.compile(r"\bleeson\b|\bregal[\s\-]?beloit\b", re.I), "Leeson"),
]


# ---------------------------------------------------------------------------
# Equipment type patterns
# Order matters — more specific first
# ---------------------------------------------------------------------------

_EQUIP_TYPE_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bvfd\b|\bvariable[\s\-]?frequency\s+drive\b|\bac[\s\-]?drive\b|\bfrequency\s+inverter\b|\binverter[\s\-]?drive\b", re.I), "VFD"),
    (re.compile(r"\bservo[\s\-]?(?:drive|motor|amp|amplifier)\b|\blinear[\s\-]?servo\b", re.I), "servo"),
    (re.compile(r"\bplc\b|\bprogrammable\s+logic\s+controller\b", re.I), "PLC"),
    (re.compile(r"\bhmi\b|\bhuman[\s\-]?machine\s+interface\b|\boperator\s+panel\b|\btouch[\s\-]?screen\s+panel\b", re.I), "HMI"),
    (re.compile(r"\bscada\b|\bdistributed\s+control\s+system\b|\bdcs\b", re.I), "SCADA"),
    (re.compile(r"\bmotor\s+starter\b|\bdol\s+starter\b|\bsoft\s+starter\b|\bsoft[\s\-]?start\b|\bstar[\s\-]?delta\b", re.I), "starter"),
    (re.compile(r"\bcontactor\b", re.I), "contactor"),
    (re.compile(r"\boverload\s+relay\b|\bthermal\s+overload\b|\boverload\b", re.I), "overload"),
    (re.compile(r"\bcircuit\s+breaker\b|\bmccb\b|\bmolded\s+case\b", re.I), "circuit breaker"),
    (re.compile(r"\btransformer\b|\bdry[\s\-]?type\s+transformer\b|\bliquid[\s\-]?filled\b", re.I), "transformer"),
    (re.compile(r"\bmotor\b", re.I), "motor"),
    (re.compile(r"\bcentrifugal\s+pump\b|\bsubmersible\s+pump\b|\breciprocating\s+pump\b|\bpump\b", re.I), "pump"),
    (re.compile(r"\bair\s+compressor\b|\bscrew\s+compressor\b|\breciprocating\s+compressor\b|\bcompressor\b", re.I), "compressor"),
    (re.compile(r"\bgearbox\b|\bgear\s+reducer\b|\bspeed\s+reducer\b|\bgear\s+drive\b", re.I), "gearbox"),
    (re.compile(r"\bbearing\b", re.I), "bearing"),
    (re.compile(r"\bconveyor\b", re.I), "conveyor"),
    (re.compile(r"\bvalve\b(?!\s+amplifier)", re.I), "valve"),
    (re.compile(r"\bactuator\b", re.I), "actuator"),
    (re.compile(r"\bsensor\b|\bproximity\s+switch\b|\binductive\s+sensor\b", re.I), "sensor"),
    (re.compile(r"\bencoder\b", re.I), "encoder"),
    (re.compile(r"\bpressure\s+transmitter\b|\bflow\s+meter\b|\btemperature\s+sensor\b|\binstrument\b", re.I), "instrument"),
    (re.compile(r"\bchiller\b", re.I), "chiller"),
    (re.compile(r"\bcooling\s+tower\b", re.I), "cooling tower"),
    (re.compile(r"\bair[\s\-]?handling\s+unit\b|\bahu\b", re.I), "AHU"),
    (re.compile(r"\bmotor\s+control\s+center\b|\bmcc\b", re.I), "MCC"),
    (re.compile(r"\bpanel\b|\belectrical\s+panel\b|\bcontrol\s+panel\b", re.I), "panel"),
    (re.compile(r"\brobot\b|\brobotic\b|\bcobot\b", re.I), "robot"),
    (re.compile(r"\bhydraulic\s+(?:cylinder|press|pump|system|unit)\b", re.I), "hydraulic"),
    (re.compile(r"\bpneumatic\b|\bair\s+cylinder\b|\bsolenoid\s+valve\b", re.I), "pneumatic"),
]


# ---------------------------------------------------------------------------
# Model number patterns (manufacturer-specific)
# ---------------------------------------------------------------------------

_MODEL_PATTERNS: list[re.Pattern] = [
    # PowerFlex series
    re.compile(r"\bpowerflex[\s\-]?\d{1,4}[a-z]?\b", re.I),
    # ACS drives (ABB)
    re.compile(r"\bacs[\s\-]?\d{3}\b", re.I),
    # Yaskawa CIMR
    re.compile(r"\bcimr[\s\-]?[a-z]{1,3}\d{4}\b", re.I),
    # Altivar
    re.compile(r"\batv[\s\-]?\d{2,4}[a-z]*\b", re.I),
    # SEW MOVIDRIVE
    re.compile(r"\bmd[xsp]\d{5}\b", re.I),
    # ControlLogix slot numbers
    re.compile(r"\b17[0-9]{2}[\s\-][a-z]{1,2}\d{2,4}[a-z]*\b", re.I),
    # Generic model pattern: letters followed by digits (5+ chars)
    re.compile(r"\b[A-Z]{2,5}[\s\-]?\d{3,6}[A-Z0-9\-]{0,6}\b"),
    # S7-xxx PLC
    re.compile(r"\bs7[\s\-]\d{3,4}\b", re.I),
    # FR-xxx (Mitsubishi)
    re.compile(r"\bfr[\s\-][aedf]\d{3,4}\b", re.I),
    # CFW (WEG)
    re.compile(r"\bcfw[\s\-]?\d{3}\b", re.I),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_equipment(text: str) -> EquipmentMatch:
    """Extract manufacturer, model, and equipment type from text."""
    combined = text[:2000]  # cap for performance
    result = EquipmentMatch()
    mentions: list[str] = []

    # Manufacturer detection
    for pattern, mfr_name in _MFR_PATTERNS:
        m = pattern.search(combined)
        if m:
            result.manufacturer = mfr_name
            mentions.append(m.group(0))
            break  # first match wins; patterns ordered by specificity

    # Equipment type detection (all matches, pick most specific)
    for pattern, eq_type in _EQUIP_TYPE_PATTERNS:
        m = pattern.search(combined)
        if m:
            result.equipment_type = eq_type
            mentions.append(m.group(0))
            break  # ordered most-to-least specific

    # Model number detection
    for pattern in _MODEL_PATTERNS:
        m = pattern.search(combined)
        if m:
            candidate = m.group(0).strip()
            # reject pure numbers and very short matches
            if len(candidate) >= 4 and re.search(r"[A-Za-z]", candidate):
                result.model = candidate
                mentions.append(candidate)
                break

    result.raw_mentions = list(dict.fromkeys(mentions))  # dedupe, preserve order
    return result


def has_equipment_mention(text: str) -> bool:
    """Quick check: does text mention any known equipment type?"""
    combined = text[:1000]
    return any(p.search(combined) for p, _ in _EQUIP_TYPE_PATTERNS)
