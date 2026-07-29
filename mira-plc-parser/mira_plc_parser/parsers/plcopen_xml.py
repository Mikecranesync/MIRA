"""PLCopen XML (TC6, tc6_0200 / tc6_0201) parser -> MIRA PLC IR.

PLCopen XML is the vendor-neutral interchange format that CODESYS, OpenPLC/Beremiz, and others
export. Shape (abridged, namespaced under http://www.plcopen.org/xml/tc6_0201):

  <project>
    <fileHeader companyName="..." productName="..."/>
    <contentHeader name="ProjectName"/>
    <types><pous>
      <pou name="ConveyorControl" pouType="program">
        <interface>
          <localVars><variable name="MotorRun"><type><BOOL/></type>
            <documentation><xhtml>...</xhtml></documentation></variable> ... </localVars>
          <globalVars> ... </globalVars>
        </interface>
        <body><ST><xhtml>IF ... THEN MotorRun := TRUE; END_IF;</xhtml></ST></body>
      </pou>
    </pous></types>

Mapping: each <pou> -> a Program; interface variables -> Tags (globalVars -> controller scope,
the rest -> program scope); an <ST> body -> an ST Routine whose statements are lifted into rungs
via the shared ST helper (so a PLCopen ST body and a raw .st file analyze identically).

Namespace-agnostic: we match by local element name, so tc6_0200 and tc6_0201 both parse.
Read-only, stdlib-only (xml.etree).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

from ..ir import (
    Confidence,
    Controller,
    PLCProject,
    Program,
    Provenance,
    Routine,
    RoutineType,
    Tag,
    TagScope,
)
from .structured_text import _statements_to_rungs

FORMAT = "plcopen_xml"

# interface var sections -> IR scope. globalVars are controller-wide; everything else is POU-local.
_VAR_SECTIONS = {
    "localVars": TagScope.PROGRAM.value,
    "tempVars": TagScope.PROGRAM.value,
    "inputVars": TagScope.PROGRAM.value,
    "outputVars": TagScope.PROGRAM.value,
    "inOutVars": TagScope.PROGRAM.value,
    "externalVars": TagScope.PROGRAM.value,
    "globalVars": TagScope.CONTROLLER.value,
}


def _ln(tag: str) -> str:
    """Local element name (drop the {namespace} prefix ElementTree prepends)."""
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in el if _ln(c.tag) == name), None)


def _descendants(root: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in root.iter() if _ln(e.tag) == name]


def _prov(src: str, locator: str) -> Provenance:
    return Provenance(source_file=src, source_format=FORMAT, locator=locator, confidence=Confidence.HIGH)


def parse(text: str, source_file: str = "") -> PLCProject:
    """Parse PLCopen XML into a PLCProject. Malformed XML / no pou -> a warning, never a crash."""
    proj = PLCProject(source_format=FORMAT, source_files=[source_file] if source_file else [])
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        proj.warnings.append("PLCopen XML parse error: %s" % e)
        return proj

    header = _child(root, "fileHeader")
    content = _child(root, "contentHeader")
    vendor = (header.get("companyName") if header is not None else "") or ""
    software = (header.get("productName") if header is not None else "") or "PLCopen XML"
    proj_name = (content.get("name") if content is not None else "") or ""

    pous = _descendants(root, "pou")
    if not pous:
        proj.warnings.append("no <pou> element found in PLCopen XML")
        return proj

    ctrl = Controller(
        name=proj_name or pous[0].get("name", ""),
        vendor=vendor or "PLCopen",
        software=software,
        provenance=_prov(source_file, "project[%s]" % proj_name),
    )
    for pou in pous:
        _parse_pou(pou, ctrl, source_file)
    proj.controllers.append(ctrl)
    return proj


def _parse_pou(pou: ET.Element, ctrl: Controller, src: str) -> None:
    name = pou.get("name", "")
    prog = Program(name=name)
    iface = _child(pou, "interface")
    if iface is not None:
        for section in iface:
            scope = _VAR_SECTIONS.get(_ln(section.tag))
            if scope is None:
                continue
            for var_el in _descendants(section, "variable"):
                tag = _parse_variable(var_el, scope, name, src)
                (ctrl.tags if scope == TagScope.CONTROLLER.value else prog.tags).append(tag)

    routine = _parse_body(pou, name, src)
    if routine is not None:
        prog.routines.append(routine)
    ctrl.programs.append(prog)


def _parse_variable(var_el: ET.Element, scope: str, pou: str, src: str) -> Tag:
    name = var_el.get("name", "")
    return Tag(
        name=name,
        data_type=_type_name(_child(var_el, "type")),
        scope=scope,
        description=_doc_text(_child(var_el, "documentation")),
        initial_value=_initial_value(_child(var_el, "initialValue")),
        provenance=_prov(src, "%s/Var[%s]" % (pou, name)),
    )


def _type_name(type_el: ET.Element | None) -> str:
    """A <type> wraps one child: an elementary marker (<BOOL/>) or <derived name="UDT"/>."""
    if type_el is None:
        return ""
    child = next(iter(type_el), None)
    if child is None:
        return (type_el.text or "").strip()
    local = _ln(child.tag)
    return child.get("name", "") if local == "derived" else local


def _doc_text(doc_el: ET.Element | None) -> str:
    if doc_el is None:
        return ""
    return " ".join(t.strip() for t in doc_el.itertext() if t.strip())


def _initial_value(iv_el: ET.Element | None) -> str:
    if iv_el is None:
        return ""
    simple = _child(iv_el, "simpleValue")
    if simple is not None:
        return simple.get("value", "")
    return " ".join(t.strip() for t in iv_el.itertext() if t.strip())


def _parse_body(pou: ET.Element, name: str, src: str) -> Routine | None:
    body = _child(pou, "body")
    if body is None:
        return None
    # PLCopen bodies: ST (text) | LD | FBD | SFC (graphical). We extract ST fully; for graphical
    # bodies we record the language so the report still reflects the routine exists.
    for lang in ("ST", "IL", "LD", "FBD", "SFC"):
        el = _child(body, lang)
        if el is None:
            continue
        if lang in ("ST", "IL"):
            st_text = "\n".join(t for t in (s.strip("\n") for s in el.itertext()) if t.strip())
            routine = Routine(
                name=name, type=RoutineType.ST.value, st_text=st_text,
                provenance=_prov(src, "%s/Body/ST" % name),
            )
            routine.rungs = _statements_to_rungs(st_text, name, src)
            return routine
        rtype = {"LD": RoutineType.RLL, "FBD": RoutineType.FBD, "SFC": RoutineType.SFC}[lang]
        return Routine(name=name, type=rtype.value, provenance=_prov(src, "%s/Body/%s" % (name, lang)))
    return None
