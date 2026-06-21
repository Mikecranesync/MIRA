"""Siemens TIA Portal Openness XML (SimaticML) parser -> MIRA PLC IR.

TIA Portal projects are closed (.ap1x); the OPEN, parseable artifact is the Openness/SimaticML XML
you get from "Export block" (or `ExportItem`). Shape (abridged, namespaces vary by TIA version, so
we match by LOCAL element name):

  <Document>
    <Engineering version="V18"/>
    <SW.Blocks.FB ID="0">
      <AttributeList>
        <Name>ConveyorFB</Name>
        <ProgrammingLanguage>SCL</ProgrammingLanguage>
        <Interface><Sections>
          <Section Name="Input"><Member Name="StartPB" Datatype="Bool"><Comment>..</Comment></Member></Section>
          <Section Name="Output"><Member Name="MotorRun" Datatype="Bool"/></Section>
          <Section Name="Static"><Member Name="ConvFault" Datatype="Bool"/></Section>
        </Sections></Interface>
      </AttributeList>
      <ObjectList>
        <SW.Blocks.CompileUnit ID="1">
          <AttributeList>
            <NetworkSource>
              <StructuredText>           <!-- SCL body, TOKENIZED, not plain text -->
                <Token Text="IF"/><Blank/><Access Scope="LocalVariable"><Symbol>
                  <Component Name="StartPB"/></Symbol></Access> ... <Token Text=":="/> ...
              </StructuredText>
            </NetworkSource>
            <ProgrammingLanguage>SCL</ProgrammingLanguage>
          </AttributeList>
        </SW.Blocks.CompileUnit>
      </ObjectList>
    </SW.Blocks.FB>
    <SW.Tags.PlcTagTable><ObjectList>
      <SW.Tags.PlcTag><AttributeList><Name>Motor_Out</Name><LogicalAddress>%Q0.0</LogicalAddress>
        <DataTypeName>Bool</DataTypeName></AttributeList></SW.Tags.PlcTag>
    </ObjectList></SW.Tags.PlcTagTable>
  </Document>

Mapping:
  * each SW.Blocks.{FB,FC,OB}  -> a Program; interface <Member>s -> Tags (program scope).
  * an SCL CompileUnit body    -> an ST Routine; its tokenized <StructuredText> is reconstructed to
    text and lifted into rungs by the SHARED ST helper, so a Siemens SCL block analyses exactly like
    a raw .st file (output-dependencies, permissives, timer chains, sequences all work).
  * a LAD/FBD/GRAPH body       -> a Routine recorded with its language but NOT extracted (graphical).
  * SW.Tags.PlcTagTable        -> controller tags carrying the physical %Q/%I/%M address (a %Q point is
    a real output -- the kind the equipment-output classifier keys on).
  * SW.Blocks.GlobalDB         -> controller tags from the DB's interface members.

Read-only, stdlib-only (xml.etree). NEVER writes to a PLC.
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

FORMAT = "siemens_tia_xml"

_BLOCK_TYPES = {"SW.Blocks.FB", "SW.Blocks.FC", "SW.Blocks.OB"}
# interface sections that hold real signals (Temp/Constant are local scratch but still useful tags).
_SECTION_SCOPE = {
    "Input": TagScope.PROGRAM.value, "Output": TagScope.PROGRAM.value,
    "InOut": TagScope.PROGRAM.value, "Static": TagScope.PROGRAM.value,
    "Temp": TagScope.PROGRAM.value, "Constant": TagScope.PROGRAM.value, "Return": TagScope.PROGRAM.value,
}


def _ln(tag: str) -> str:
    """Local element name (drop the {namespace} prefix ElementTree prepends)."""
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in el if _ln(c.tag) == name), None)


def _descendants(root: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in root.iter() if _ln(e.tag) == name]


def _attrlist_text(el: ET.Element, field: str) -> str:
    """An AttributeList child's text (Name / ProgrammingLanguage / LogicalAddress / ...)."""
    al = _child(el, "AttributeList")
    holder = al if al is not None else el
    c = _child(holder, field)
    return (c.text or "").strip() if c is not None else ""


def _prov(src: str, locator: str) -> Provenance:
    return Provenance(source_file=src, source_format=FORMAT, locator=locator, confidence=Confidence.HIGH)


def parse(text: str, source_file: str = "") -> PLCProject:
    """Parse Openness XML into a PLCProject. Malformed XML / no block -> a warning, never a crash."""
    proj = PLCProject(source_format=FORMAT, source_files=[source_file] if source_file else [])
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        proj.warnings.append("Siemens Openness XML parse error: %s" % e)
        return proj

    eng = _child(root, "Engineering")
    version = eng.get("version", "") if eng is not None else ""
    ctrl = Controller(
        name="", vendor="Siemens",
        software=("TIA Portal Openness %s" % version).strip(),
        provenance=_prov(source_file, "Document"),
    )

    blocks = [e for e in root.iter() if _ln(e.tag) in _BLOCK_TYPES]
    for blk in blocks:
        _parse_block(blk, ctrl, source_file)

    for db in [e for e in root.iter() if _ln(e.tag) == "SW.Blocks.GlobalDB"]:
        _parse_global_db(db, ctrl, source_file)

    for tagtab in [e for e in root.iter() if _ln(e.tag) == "SW.Tags.PlcTagTable"]:
        _parse_tag_table(tagtab, ctrl, source_file)

    if not blocks and not ctrl.tags:
        proj.warnings.append("no SW.Blocks.* or SW.Tags.* found in Openness XML")
        return proj

    if not ctrl.name:
        ctrl.name = ctrl.programs[0].name if ctrl.programs else (source_file or "Siemens")
    proj.controllers.append(ctrl)
    return proj


def _parse_block(blk: ET.Element, ctrl: Controller, src: str) -> None:
    name = _attrlist_text(blk, "Name") or blk.get("Name", "")
    lang = _attrlist_text(blk, "ProgrammingLanguage")
    prog = Program(name=name, description=("%s block" % _ln(blk.tag).split(".")[-1]))

    iface = next((e for e in blk.iter() if _ln(e.tag) == "Interface"), None)
    if iface is not None:
        for section in _descendants(iface, "Section"):
            scope = _SECTION_SCOPE.get(section.get("Name", ""), TagScope.PROGRAM.value)
            for member in [c for c in section if _ln(c.tag) == "Member"]:
                tag = _parse_member(member, scope, name, src)
                (ctrl.tags if scope == TagScope.CONTROLLER.value else prog.tags).append(tag)

    units = [e for e in blk.iter() if _ln(e.tag) == "SW.Blocks.CompileUnit"]
    if units:
        for i, unit in enumerate(units):
            r = _parse_compile_unit(unit, name, lang, i, src)
            if r is not None:
                prog.routines.append(r)
    elif lang:
        # block with a known language but no compile unit we could read -> record it exists
        prog.routines.append(Routine(name=name, type=_routine_type(lang),
                                      provenance=_prov(src, "%s/Body" % name)))
    ctrl.programs.append(prog)


def _parse_member(member: ET.Element, scope: str, pou: str, src: str) -> Tag:
    name = member.get("Name", "")
    comment = _comment_text(_child(member, "Comment"))
    return Tag(
        name=name,
        data_type=member.get("Datatype", "") or member.get("DataType", ""),
        scope=scope,
        description=comment,
        initial_value=_member_start_value(member),
        provenance=_prov(src, "%s/Member[%s]" % (pou, name)),
    )


def _member_start_value(member: ET.Element) -> str:
    sv = _child(member, "StartValue")
    if sv is not None and (sv.text or "").strip():
        return sv.text.strip()
    return member.get("StartValue", "") or member.get("Informative.StartValue", "")


def _comment_text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return " ".join(t.strip() for t in el.itertext() if t.strip())


def _routine_type(lang: str) -> str:
    lu = (lang or "").upper()
    if lu in ("SCL", "STL"):
        return RoutineType.ST.value
    if lu in ("LAD",):
        return RoutineType.RLL.value
    if lu in ("FBD",):
        return RoutineType.FBD.value
    if lu in ("GRAPH", "SFC"):
        return RoutineType.SFC.value
    return RoutineType.UNKNOWN.value


def _parse_compile_unit(unit: ET.Element, block_name: str, lang: str, idx: int, src: str) -> Routine | None:
    src_el = next((e for e in unit.iter() if _ln(e.tag) == "NetworkSource"), None)
    title = _attrlist_text(unit, "Title")
    rname = "%s/Net%d%s" % (block_name, idx, ("_" + title.replace(" ", "_")) if title else "")
    unit_lang = _attrlist_text(unit, "ProgrammingLanguage") or lang

    st = next((e for e in (src_el.iter() if src_el is not None else []) if _ln(e.tag) == "StructuredText"), None)
    if st is not None:
        text = _reconstruct_scl(st)
        routine = Routine(name=rname, type=RoutineType.ST.value, st_text=text,
                          provenance=_prov(src, "%s/CompileUnit[%d]/SCL" % (block_name, idx)))
        routine.rungs = _statements_to_rungs(text, rname, src)
        return routine
    if src_el is None:
        return None
    # a graphical (LAD/FBD/GRAPH) body -- record it exists, language known, logic not extracted
    return Routine(name=rname, type=_routine_type(unit_lang),
                   provenance=_prov(src, "%s/CompileUnit[%d]/%s" % (block_name, idx, unit_lang or "graphical")))


def _reconstruct_scl(st: ET.Element) -> str:
    """Rebuild SCL source text from TIA's tokenized <StructuredText>.

    TIA does not store SCL as text -- it stores an ordered stream of <Token Text="..."/>,
    <Access> (a variable / constant / FB-call), <Blank/>, and <NewLine/>. We walk that stream in
    document order and emit text, so the result feeds the shared ST statement-lift unchanged. Tolerant
    by design: if there are no Token/Access children (a plain-text body), fall back to itertext().
    """
    pieces: list[str] = []
    _walk_scl(st, pieces)
    text = "".join(pieces)
    if text.strip():
        return text
    return " ".join(t.strip() for t in st.itertext() if t.strip())


# elements whose own subtree we render specially (do not recurse generically into them)
_SCL_LEAF = {"Token", "Blank", "NewLine", "Access", "Comment", "LineComment", "NewLineConstant"}


def _walk_scl(el: ET.Element, out: list[str]) -> None:
    for child in el:
        name = _ln(child.tag)
        if name == "Token":
            out.append(child.get("Text", ""))
        elif name == "Blank":
            out.append(" " * max(1, int(child.get("Num", "1") or "1")))
        elif name == "NewLine":
            out.append("\n")
        elif name in ("Comment", "LineComment"):
            continue                       # drop comments -- not needed for the logic lift
        elif name == "Access":
            out.append(_render_access(child))
        else:
            _walk_scl(child, out)          # structural wrapper -> recurse


def _render_access(access: ET.Element) -> str:
    """An <Access> is a variable, a literal constant, or an FB/FC call -- render each to SCL text."""
    call = next((e for e in access.iter() if _ln(e.tag) == "CallInfo"), None)
    if call is not None:
        return _render_call(call)
    const = next((e for e in access.iter() if _ln(e.tag) == "ConstantValue"), None)
    if const is not None:
        return (const.text or "").strip()
    # a symbolic variable: join its Component@Name parts into a dotted path (DB.Member / Timer.Q)
    comps = [c.get("Name", "") for c in access.iter() if _ln(c.tag) == "Component" and c.get("Name")]
    if comps:
        return ".".join(comps)
    return (access.findtext(".//") or "").strip()


def _render_call(call: ET.Element) -> str:
    """Render <CallInfo Name=".."> with its <Parameter Name="IN">..<Access/>.. as `Name(IN := x, ..)`.

    This is what makes a Siemens watchdog (`vfd_err_timer(IN := comm_err, PT := T#5s)`) reconstruct
    into the same `name(.. PT := ..)` shape the timer->fault analyzer detects -- so timer chains work
    on Siemens SCL, not just Rockwell/ST.
    """
    name = call.get("Name", "")
    inst = next((e for e in call if _ln(e.tag) == "Instance"), None)
    if inst is not None:
        comps = [c.get("Name", "") for c in inst.iter() if _ln(c.tag) == "Component" and c.get("Name")]
        if comps:
            name = ".".join(comps)
    args = []
    for param in [c for c in call if _ln(c.tag) == "Parameter"]:
        pname = param.get("Name", "")
        acc = next((e for e in param.iter() if _ln(e.tag) == "Access"), None)
        val = _render_access(acc) if acc is not None else ""
        if pname:
            args.append("%s := %s" % (pname, val))
    return "%s(%s)" % (name, ", ".join(args))


def _parse_global_db(db: ET.Element, ctrl: Controller, src: str) -> None:
    name = _attrlist_text(db, "Name") or "DB"
    iface = next((e for e in db.iter() if _ln(e.tag) == "Interface"), None)
    if iface is None:
        return
    for section in _descendants(iface, "Section"):
        for member in [c for c in section if _ln(c.tag) == "Member"]:
            mname = member.get("Name", "")
            ctrl.tags.append(Tag(
                name="%s.%s" % (name, mname), data_type=member.get("Datatype", ""),
                scope=TagScope.CONTROLLER.value, description=_comment_text(_child(member, "Comment")),
                initial_value=_member_start_value(member),
                provenance=_prov(src, "%s/Member[%s]" % (name, mname)),
            ))


def _parse_tag_table(tagtab: ET.Element, ctrl: Controller, src: str) -> None:
    for plctag in [e for e in tagtab.iter() if _ln(e.tag) == "SW.Tags.PlcTag"]:
        name = _attrlist_text(plctag, "Name")
        if not name:
            continue
        ctrl.tags.append(Tag(
            name=name,
            data_type=_attrlist_text(plctag, "DataTypeName"),
            scope=TagScope.CONTROLLER.value,
            address=_attrlist_text(plctag, "LogicalAddress"),
            description=_comment_text(next((e for e in plctag.iter() if _ln(e.tag) == "Comment"), None)),
            provenance=_prov(src, "PlcTag[%s]" % name),
        ))
