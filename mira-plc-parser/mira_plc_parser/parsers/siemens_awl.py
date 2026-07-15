"""Siemens STEP 7 AWL source parser -> MIRA PLC IR.

This targets exported AWL/source text, not closed STEP 7 project binaries. The first useful shape
is a fault/alarm data block where declarations carry the HMI-facing alarm text in comments:

    Alarm0059 :BOOL:=0; // #59 Fault Block 1 -A1 VFD FAULT

Those comments are high-value maintenance text, so we preserve them as tag descriptions with line
provenance. Logic network parsing can grow here later without changing the public pipeline.
"""
from __future__ import annotations

import re
from pathlib import Path

from ..ir import Confidence, Controller, PLCProject, Provenance, Tag, TagScope

FORMAT = "siemens_awl"

_DB_NAME_RE = re.compile(r"^\s*(?:DATA_BLOCK|NAME)\s*[:=]?\s*\"?(?P<name>[A-Za-z_][\w$]*)\"?", re.I)
_ALARM_DECL_RE = re.compile(
    r"^\s*(?P<name>Alarm\d+)\s*:BOOL\s*(?::=\s*(?P<initial>[01]|TRUE|FALSE))?\s*;\s*//\s*(?P<comment>.+?)\s*$",
    re.I,
)


def parse(text: str, source_file: str = "") -> PLCProject:
    """Parse exported AWL alarm declarations into a single-controller PLCProject."""
    proj = PLCProject(source_format=FORMAT, source_files=[source_file] if source_file else [])
    block_name = _block_name(text) or Path(source_file).stem or "step7_awl"
    ctrl = Controller(
        name=block_name,
        vendor="Siemens",
        software="STEP 7 AWL source",
        provenance=Provenance(source_file=source_file, source_format=FORMAT, confidence=Confidence.HIGH),
    )

    for line_no, line in enumerate(text.splitlines(), start=1):
        match = _ALARM_DECL_RE.match(line)
        if not match:
            continue
        name = match.group("name")
        comment = _clean_comment(match.group("comment"))
        ctrl.tags.append(Tag(
            name=name,
            data_type="BOOL",
            scope=TagScope.CONTROLLER.value,
            description=comment,
            address=f"{block_name}.{name}",
            initial_value=_normal_initial(match.group("initial") or ""),
            provenance=Provenance(
                source_file=source_file,
                source_format=FORMAT,
                locator=f"line {line_no}",
                confidence=Confidence.HIGH,
            ),
        ))

    if not ctrl.tags:
        proj.warnings.append("siemens_awl: no Alarm#### BOOL declarations with comments found")
    proj.controllers.append(ctrl)
    return proj


def _block_name(text: str) -> str:
    for line in text.splitlines()[:40]:
        match = _DB_NAME_RE.match(line)
        if match:
            return match.group("name")
    return ""


def _clean_comment(comment: str) -> str:
    return " ".join(comment.replace("$N", " ").split())


def _normal_initial(value: str) -> str:
    if not value:
        return ""
    value = value.strip().upper()
    if value == "TRUE":
        return "1"
    if value == "FALSE":
        return "0"
    return value
