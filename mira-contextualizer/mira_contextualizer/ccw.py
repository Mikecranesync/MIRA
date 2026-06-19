"""Connected Components Workbench (CCW / Micro8xx) export support — deterministic, offline.

CCW stores a project as a FOLDER, not a single export file. The text-based, contextualizable pieces
under ``<Project>/Controller/Controller/`` are:

  * ``MbSrvConf.xml``     — the Modbus server map: named variables -> address + data type. RICHEST
                            source (real engineering names like motor_running, fault_alarm).
  * ``LogicalValues.csv`` — the full variable/tag list (system vars, embedded I/O, user variables).

Plus two files users often grab by mistake (we detect and guide instead of failing silently):
  * ``*.vssettings``      — Visual Studio / CCW IDE settings (fonts, options) — NO factory content.
  * ``*.ccwsln``          — the solution reference file — point at the project folder instead.

This module classifies/parses those into extraction rows (store.add_extractions shape). No LLM.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

# role keyword vocab → role label (first match wins, multiple may apply)
_ROLE_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(?i)e[_-]?stop|emergency"), "safety"),
    (re.compile(r"(?i)fault|alarm|error|trip|fail"), "fault"),
    (re.compile(r"(?i)sensor|prox|photo|eye|switch|detect"), "sensor"),
    (re.compile(r"(?i)motor|vfd|drive|spindle"), "motor"),
    (re.compile(r"(?i)convey|conv\b"), "conveyor"),
    (re.compile(r"(?i)valve|pump|heater|fan|coil|relay|solenoid|output"), "output"),
    (re.compile(r"(?i)speed|freq|rpm|torque|current|amp|temp|press|level|count|setpoint|analog"), "analog"),
    (re.compile(r"(?i)run|start|stop|active|enable|status|state|ready|busy|done"), "status"),
]

# CCW embedded-I/O channel prefixes → role
_IO_RULES: list[tuple[str, str]] = [
    ("_IO_EM_DI_", "digital_input"), ("_IO_EM_DO_", "digital_output"),
    ("_IO_EM_AI_", "analog_input"), ("_IO_EM_AO_", "analog_output"),
]
_REGISTER_ROLE = {
    "COILS": "digital_output", "DISCRETE_INPUTS": "digital_input",
    "HOLDING_REGISTERS": "register", "INPUT_REGISTERS": "register",
}
_PREFIX = re.compile(r"^Controller\.[^.]+\.[^.]+\.")  # Controller.Micro820.Micro820.


def detect_ccw(file_name: str, text: str) -> str | None:
    """Identify a CCW file by content. Returns a kind or None."""
    head = text[:400].lstrip()
    if file_name.lower().endswith(".vssettings") or head.startswith("<UserSettings"):
        return "ccw_settings"
    if file_name.lower().endswith(".ccwsln"):
        return "ccw_solution"
    if "<modbusServer" in head or "<modbusServer" in text[:2000]:
        return "ccw_modbus"
    if head.startswith("[Version") and "FullName" in text[:200]:
        return "ccw_logicalvalues"
    return None


def _roles_for(name: str, *, register: str | None = None) -> list[str]:
    roles: list[str] = []
    for prefix, role in _IO_RULES:
        if name.startswith(prefix):
            roles.append(role)
    for rex, role in _ROLE_RULES:
        if rex.search(name) and role not in roles:
            roles.append(role)
    if not roles and register and register in _REGISTER_ROLE:
        roles.append(_REGISTER_ROLE[register])
    return roles


def _confidence(name: str, *, mapped: bool) -> float:
    if name.startswith("_IO_EM_"):
        return 0.6                      # a physical I/O channel
    return 0.9 if mapped else 0.6       # a named user variable (real engineering intent)


def parse_modbus(text: str) -> list[dict]:
    """MbSrvConf.xml → extraction rows with Modbus address + data type + roles."""
    root = ET.fromstring(text)
    rows: list[dict] = []
    for reg in root.iter("modbusRegister"):
        rtype = reg.get("name") or ""
        for m in reg.findall("mapping"):
            var = (m.get("variable") or "").strip()
            if not var or var.startswith("__SYSVA"):
                continue
            dt = m.get("dataType")
            addr = m.get("address")
            rows.append({
                "tag_name": var,
                "roles": _roles_for(var, register=rtype),
                "uns_path_proposed": None,
                "i3x_element_id": None,
                "evidence_json": {"source": "ccw_modbus", "register": rtype,
                                  "modbus_address": addr, "data_type": dt},
                "confidence": _confidence(var, mapped=True),
            })
    return rows


def parse_logicalvalues(text: str) -> list[dict]:
    """LogicalValues.csv → extraction rows for every non-system variable / I/O channel."""
    rows: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("[") or line.startswith("FullName"):
            continue
        full = line.split(",", 1)[0].strip()
        if not full:
            continue
        short = _PREFIX.sub("", full)
        if short.startswith("__SYSVA"):
            continue  # firmware system variable — not factory context
        rows.append({
            "tag_name": short,
            "roles": _roles_for(short),
            "uns_path_proposed": None,
            "i3x_element_id": None,
            "evidence_json": {"source": "ccw_logicalvalues", "full_name": full},
            "confidence": _confidence(short, mapped=False),
        })
    return rows


# Human guidance for files that are not contextualizable PLC content.
_GUIDANCE = {
    "ccw_settings": (
        "This is a Visual Studio / CCW IDE settings file (.vssettings) — editor preferences, not a "
        "PLC export. It has no tags or logic. In CCW, open your project's "
        "Controller\\Controller folder and upload MbSrvConf.xml (Modbus map) and/or "
        "LogicalValues.csv (variable list)."
    ),
    "ccw_solution": (
        "This is a CCW solution file (.ccwsln) — it only references the project. Upload the project's "
        "MbSrvConf.xml and LogicalValues.csv (under Controller\\Controller), or drag the whole "
        "Controller folder in."
    ),
}


def guidance(kind: str) -> str | None:
    return _GUIDANCE.get(kind)
