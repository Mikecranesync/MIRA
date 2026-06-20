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

import os
import re
import xml.etree.ElementTree as ET

from . import placement

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
    """Identify a CCW file by content + name. Returns a kind or None."""
    name = file_name.lower()
    head = text[:400].lstrip()
    if name.endswith(".vssettings") or head.startswith("<UserSettings"):
        return "ccw_settings"
    if name.endswith(".ccwsln"):
        return "ccw_solution"
    if name.endswith(".acfproj"):
        return "ccw_project"
    if "<modbusServer" in head or "<modbusServer" in text[:2000]:
        return "ccw_modbus"                                  # MbSrvConf*.xml and *.ccwmod
    if head.startswith("[Version") and "FullName" in text[:200]:
        return "ccw_logicalvalues"
    if name.endswith((".st", ".stf", ".iecst")):
        return "ccw_st"
    if name.endswith("devicepref.xml"):
        return "ccw_devicepref"
    if name.endswith("logicview.xml"):
        return "ccw_logicview"
    if os.path.basename(name) == "rmcvariables":
        return "ccw_rmcvars"
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


# ── Structured Text (.st / .stf / .iecst) + other CCW project files ───────────
def _row(name: str, roles: list[str], confidence: float, evidence: dict) -> dict:
    return {"tag_name": name, "roles": roles, "uns_path_proposed": None,
            "i3x_element_id": None, "evidence_json": evidence, "confidence": confidence}


_RE_VAR_BLOCK = re.compile(r"(?is)\bVAR(?:_INPUT|_OUTPUT|_GLOBAL|_IN_OUT|_EXTERNAL)?\b(.*?)\bEND_VAR\b")
_RE_VAR_DECL = re.compile(
    r"^\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z0-9_]+)[^;(]*;?[ \t]*(?:\(\*(.*?)\*\))?", re.M)
_RE_CTRL_MODEL = re.compile(r"\b(2080-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b")     # Micro8xx catalog number
_RE_IP = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
_RE_TERMINAL = re.compile(r"\b([IOQ]-?\d{1,2})\s*[=:]\s*([A-Za-z_]\w+)")  # I-02 = EStopNC
_RE_IOREF = re.compile(r"\b(_IO_EM_[A-Z]+_\d+)\b")
_RE_ASSIGN = re.compile(r"\b([A-Za-z_]\w*)\s*:=")
_RE_COMMENT = re.compile(r"\(\*(.*?)\*\)", re.S)


def parse_st(text: str, file_name: str) -> tuple[list[dict], dict]:
    """Parse Structured Text. Returns (rows, meta). Handles both declared (.iecst VAR blocks with
    types + inline comments) and declaration-less (.stf logic-only) exports, and mines comments for
    controller model, IP, and physical terminal labels."""
    rows: list[dict] = []
    meta: dict = {}
    declared: set[str] = set()

    m = _RE_CTRL_MODEL.search(text)
    if m:
        meta["controller_model"] = m.group(1)
    ip = _RE_IP.search(text)
    if ip:
        meta["ip"] = ip.group(1)

    # 1) VAR declarations: name : TYPE; (* comment *)
    for block in _RE_VAR_BLOCK.findall(text):
        for d in _RE_VAR_DECL.finditer(block):
            name, dtype, comment = d.group(1), d.group(2), (d.group(3) or "").strip()
            if name.upper() in ("VAR", "END_VAR") or dtype.upper() in ("VAR", "END_VAR"):
                continue
            declared.add(name)
            ev = {"source": "ccw_st_decl", "data_type": dtype, "file": file_name}
            if comment:
                ev["comment"] = comment
            rows.append(_row(name, _roles_for(name), 0.85 if comment else 0.7, ev))

    # 2) physical terminal labels in comments: I-02 = EStopNC, O-00 = LightGreen
    for t in _RE_TERMINAL.finditer(text):
        term, name = t.group(1), t.group(2)
        if name in declared or name.startswith("__SYSVA"):
            continue
        declared.add(name)
        rows.append(_row(name, _roles_for(name) or ["io"], 0.7,
                         {"source": "ccw_st_terminal", "terminal": term, "file": file_name}))

    # 3) logic-referenced signals worth surfacing: embedded I/O + names with a recognized role
    refs = set(_RE_IOREF.findall(text)) | set(_RE_ASSIGN.findall(text))
    for name in refs:
        if name in declared or name.startswith("__SYSVA") or len(name) < 3:
            continue
        roles = _roles_for(name)
        if not (name.startswith("_IO_EM_") or roles):
            continue  # skip loop counters / temporaries with no factory meaning
        rows.append(_row(name, roles, 0.4, {"source": "ccw_st_logic", "file": file_name}))

    return rows, meta


def parse_rmcvars(text: str) -> list[dict]:
    """RmcVariables — one fully-qualified variable name per line (monitor/recipe subset)."""
    rows = []
    for line in text.splitlines():
        full = line.strip()
        if not full or full.startswith("["):
            continue
        short = _PREFIX.sub("", full)
        if short.startswith("__SYSVA") or not short:
            continue
        rows.append(_row(short, _roles_for(short), _confidence(short, mapped=False),
                         {"source": "ccw_rmcvars", "full_name": full}))
    return rows


def _meta_from_devicepref(text: str) -> dict:
    ip = _RE_IP.search(text)
    return {"ip": ip.group(1)} if ip else {}


# ── Whole-project merge ────────────────────────────────────────────────────────
_MERGE_KEYS = ("data_type", "modbus_address", "register", "comment", "terminal", "full_name", "ip")


def merge_rows(rowlists: list[list[dict]]) -> list[dict]:
    """Combine rows from several CCW files into one set, deduped by tag name: union roles, keep the
    highest confidence, and merge evidence (type from the Modbus map, comment from ST, address, …)."""
    merged: dict[str, dict] = {}
    for rows in rowlists:
        for r in rows:
            key = r["tag_name"]
            if key not in merged:
                ev = dict(r["evidence_json"])
                ev["sources"] = [ev["source"]] if ev.get("source") else []
                merged[key] = {**r, "evidence_json": ev}
                continue
            cur = merged[key]
            cur["roles"] = list(dict.fromkeys(cur["roles"] + r["roles"]))
            cur["confidence"] = max(cur["confidence"], r["confidence"])
            cev, rev = cur["evidence_json"], r["evidence_json"]
            for k in _MERGE_KEYS:
                if rev.get(k) and not cev.get(k):
                    cev[k] = rev[k]
            src = rev.get("source")
            if src and src not in cev["sources"]:
                cev["sources"].append(src)
    return list(merged.values())


def parse_project(files: dict[str, str]) -> dict:
    """Parse every recognized CCW file in a project and merge into one tag set + project metadata.

    files: {file_name: text_content}. Returns {rows, meta, files: [{name, kind, count}], notes}.
    """
    rowlists: list[list[dict]] = []
    meta: dict = {}
    file_report: list[dict] = []
    notes: list[str] = []

    for name, text in files.items():
        kind = detect_ccw(name, text)
        rows: list[dict] = []
        if kind == "ccw_modbus":
            rows = parse_modbus(text)
        elif kind == "ccw_logicalvalues":
            rows = parse_logicalvalues(text)
        elif kind == "ccw_st":
            rows, m = parse_st(text, name)
            meta.update({k: v for k, v in m.items() if v and not meta.get(k)})
        elif kind == "ccw_rmcvars":
            rows = parse_rmcvars(text)
        elif kind == "ccw_devicepref":
            meta.update({k: v for k, v in _meta_from_devicepref(text).items() if not meta.get(k)})
        elif kind in ("ccw_settings", "ccw_solution"):
            g = guidance(kind)
            if g:
                notes.append(g)
        file_report.append({"name": name, "kind": kind or "skipped", "count": len(rows)})
        if rows:
            rowlists.append(rows)

    merged = merge_rows(rowlists)
    # Surface the controller itself as a context entity.
    if meta.get("controller_model"):
        ev = {"source": "ccw_controller", "sources": ["ccw_controller"]}
        if meta.get("ip"):
            ev["ip"] = meta["ip"]
        merged.insert(0, _row(meta["controller_model"], ["controller"], 0.9, ev))
    # Deterministic UNS placement: give every CCW signal a UNS path (asset-prefix + standardized leaf
    # + controller-derived prefix), the same way the L5X path gets one — so uns.json / i3x.json /
    # HAS_SIGNAL are populated for a CCW project, not empty.
    placement.place_rows(merged, meta)
    return {"rows": merged, "meta": meta, "files": file_report, "notes": notes}


# Recognized CCW filenames worth uploading from a project folder (the GUI filters to these).
def is_ccw_project_file(file_name: str) -> bool:
    n = file_name.lower()
    base = os.path.basename(n)
    return (
        n.endswith((".st", ".stf", ".iecst", ".ccwmod", ".acfproj", ".ccwsln"))
        or base == "rmcvariables"
        or base == "logicalvalues.csv"
        or (base.startswith("mbsrvconf") and base.endswith(".xml"))
        or base in ("logicview.xml", "devicepref.xml")
    )
