"""Rockwell Studio 5000 / RSLogix 5000 L5X parser -> MIRA PLC IR.

L5X is the documented XML export of a Logix Designer project (or a component). It is structured and
important in the US market, so it is the Phase-1 parser. Shape (abridged):

  <RSLogix5000Content SoftwareRevision="34.00" TargetName="Conveyor" TargetType="Controller">
    <Controller Name="Conveyor" ProcessorType="1756-L83E">
      <DataTypes>  <DataType Name="..."> <Members> <Member Name= DataType= .../> ...
      <Tags>
        <Tag Name="Start_PB" TagType="Base" DataType="BOOL" Radix="Decimal" ExternalAccess="Read/Write">
          <Description><![CDATA[Start pushbutton]]></Description>
        <Tag Name="Motor_Run" TagType="Alias" AliasFor="Local:1:O.Data.0" .../>
      <Programs>
        <Program Name="MainProgram" MainRoutineName="MainRoutine">
          <Tags> ...program-scoped... </Tags>
          <Routines>
            <Routine Name="MainRoutine" Type="RLL">
              <RLLContent>
                <Rung Number="0" Type="N">
                  <Comment><![CDATA[Start the conveyor]]></Comment>
                  <Text><![CDATA[XIC(Start_PB)XIO(Stop_PB)OTE(Motor_Run);]]></Text>
            <Routine Name="Faults" Type="ST">
              <STContent> <Line Number="0"><![CDATA[IF Overload THEN Fault := 1; END_IF;]]></Line>

Read-only: parses text, never writes. Confidence = HIGH for everything here (structured extract).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from ..ir import (
    AOIDefinition,
    Confidence,
    Controller,
    DataType,
    DataTypeMember,
    ModuleDefinition,
    ModulePort,
    PLCProject,
    Program,
    Provenance,
    Routine,
    Rung,
    Tag,
    TagScope,
)

FORMAT = "rockwell_l5x"

# Rockwell ladder OUTPUT instructions -- the tag in their first operand is energized/driven.
_OUTPUT_MNEMONICS = {
    "OTE", "OTL", "OTU",          # energize / latch / unlatch
    "MOV", "COP", "CPS",          # data move (dest is the 2nd operand for MOV -- handled below)
    "TON", "TOF", "RTO",          # timers (the timer tag is the "output")
    "CTU", "CTD",                 # counters
    "SET", "RES", "FLL", "OSR", "OSF",
}
# an instruction token: MNEMONIC(operand,operand,...)
_INSTR_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)")
# a tag operand (allow dotted/bit/array members), reject pure numbers/immediates
_TAG_OPERAND_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:[.\[][A-Za-z0-9_.\]\[]*)?")


def _txt(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def _first(parent: ET.Element, tag: str) -> ET.Element | None:
    return parent.find(tag)


def parse(text: str, source_file: str = "") -> PLCProject:
    """Parse L5X XML text into a PLCProject. Malformed XML -> a project with a warning, no crash."""
    proj = PLCProject(source_format=FORMAT, source_files=[source_file] if source_file else [])
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        proj.warnings.append("L5X XML parse error: %s" % e)
        return proj

    if root.tag != "RSLogix5000Content":
        proj.warnings.append("root is <%s>, expected <RSLogix5000Content>" % root.tag)

    software = "RSLogix 5000 v%s" % root.get("SoftwareRevision", "?")
    for ctrl_el in root.iter("Controller"):
        proj.controllers.append(_parse_controller(ctrl_el, software, source_file))
        break  # a project export has exactly one target Controller
    if not proj.controllers:
        proj.warnings.append("no <Controller> element found")
    return proj


def _prov(source_file: str, locator: str, conf: Confidence = Confidence.HIGH) -> Provenance:
    return Provenance(source_file=source_file, source_format=FORMAT, locator=locator, confidence=conf)


def _parse_controller(el: ET.Element, software: str, src: str) -> Controller:
    ctrl = Controller(
        name=el.get("Name", ""),
        processor_type=el.get("ProcessorType", ""),
        vendor="Rockwell Automation",
        software=software,
        provenance=_prov(src, "Controller[@Name='%s']" % el.get("Name", "")),
    )
    # data types
    dts = _first(el, "DataTypes")
    if dts is not None:
        for dt_el in dts.findall("DataType"):
            ctrl.datatypes.append(_parse_datatype(dt_el, src))
    # controller-scoped tags
    tags_el = _first(el, "Tags")
    if tags_el is not None:
        for tag_el in tags_el.findall("Tag"):
            ctrl.tags.append(_parse_tag(tag_el, TagScope.CONTROLLER.value, src))
    # programs
    progs_el = _first(el, "Programs")
    if progs_el is not None:
        for prog_el in progs_el.findall("Program"):
            ctrl.programs.append(_parse_program(prog_el, src))
    # add-on instruction definitions (skip Use="Context" — those are supporting references)
    aoi_defs_el = _first(el, "AddOnInstructionDefinitions")
    if aoi_defs_el is not None:
        for aoi_el in aoi_defs_el.findall("AddOnInstructionDefinition"):
            if aoi_el.get("Use") == "Context":
                continue
            ctrl.aoi_definitions.append(_parse_aoi_definition(aoi_el, src))
    # module definitions (I/O hardware topology)
    mods_el = _first(el, "Modules")
    if mods_el is not None:
        for mod_el in mods_el.findall("Module"):
            if mod_el.get("Use") == "Context":
                continue
            ctrl.module_definitions.append(_parse_module_definition(mod_el, src))
    return ctrl


def _parse_datatype(el: ET.Element, src: str) -> DataType:
    dt = DataType(name=el.get("Name", ""), provenance=_prov(src, "DataType[@Name='%s']" % el.get("Name", "")))
    members = _first(el, "Members")
    if members is not None:
        for m in members.findall("Member"):
            dt.members.append(DataTypeMember(name=m.get("Name", ""), data_type=m.get("DataType", "")))
    return dt


def _parse_tag(el: ET.Element, scope: str, src: str) -> Tag:
    name = el.get("Name", "")
    desc_el = _first(el, "Description")
    return Tag(
        name=name,
        data_type=el.get("DataType", ""),
        scope=scope,
        description=_txt(desc_el),
        alias_for=el.get("AliasFor", ""),
        external_access=el.get("ExternalAccess", ""),
        radix=el.get("Radix", ""),
        provenance=_prov(src, "Tag[@Name='%s']" % name),
    )


def _parse_program(el: ET.Element, src: str) -> Program:
    prog = Program(name=el.get("Name", ""), main_routine=el.get("MainRoutineName", ""))
    tags_el = _first(el, "Tags")
    if tags_el is not None:
        for tag_el in tags_el.findall("Tag"):
            prog.tags.append(_parse_tag(tag_el, TagScope.PROGRAM.value, src))
    routines_el = _first(el, "Routines")
    if routines_el is not None:
        for r_el in routines_el.findall("Routine"):
            prog.routines.append(_parse_routine(r_el, prog.name, src))
    return prog


def _parse_routine(el: ET.Element, prog_name: str, src: str) -> Routine:
    rtype = el.get("Type", "RLL")
    routine = Routine(
        name=el.get("Name", ""),
        type=rtype,
        provenance=_prov(src, "%s/Routine[@Name='%s']" % (prog_name, el.get("Name", ""))),
    )
    rll = _first(el, "RLLContent")
    if rll is not None:
        for rung_el in rll.findall("Rung"):
            routine.rungs.append(_parse_rung(rung_el, prog_name, routine.name, src))
    fbd = _first(el, "FBDContent")
    if fbd is not None:
        for sheet_el in fbd.findall("Sheet"):
            routine.rungs.append(_parse_fbd_sheet(sheet_el, prog_name, routine.name, src))
    st = _first(el, "STContent")
    if st is not None:
        lines = [(_txt(ln)) for ln in st.findall("Line")]
        routine.st_text = "\n".join(lines)
    return routine


def _parse_rung(el: ET.Element, prog_name: str, routine_name: str, src: str) -> Rung:
    number = int(el.get("Number", "0") or "0")
    text = _txt(_first(el, "Text"))
    comment = _txt(_first(el, "Comment"))
    refs, outputs, instrs = _extract_rung_logic(text)
    return Rung(
        number=number,
        text=text,
        comment=comment,
        refs=refs,
        outputs=outputs,
        instructions=instrs,
        provenance=_prov(src, "%s/%s/Rung[%d]" % (prog_name, routine_name, number)),
    )


def _parse_fbd_sheet(el: ET.Element, prog_name: str, routine_name: str, src: str) -> Rung:
    """Convert one FBD Sheet into a Rung-shaped record.

    IRef.Operand  -> refs (inputs)
    ORef.Operand  -> outputs (driven tags)
    Block.Operand -> refs (the tag the block instance is bound to)
    Block.Type    -> instructions (mnemonics like MAVE, TONR, ESEL)
    """
    number = int(el.get("Number", "0") or "0")
    refs: list[str] = []
    outputs: list[str] = []
    instrs: list[str] = []
    seen_ref: set[str] = set()
    seen_out: set[str] = set()

    for child in el:
        tag = child.tag
        if tag == "IRef":
            op = child.get("Operand", "").strip()
            if op and not _is_immediate(op) and op not in seen_ref:
                seen_ref.add(op)
                refs.append(op)
        elif tag == "ORef":
            op = child.get("Operand", "").strip()
            if op and not _is_immediate(op):
                if op not in seen_out:
                    seen_out.add(op)
                    outputs.append(op)
                if op not in seen_ref:
                    seen_ref.add(op)
                    refs.append(op)
        elif tag in ("Block", "Function"):
            btype = child.get("Type", "")
            if btype and btype not in instrs:
                instrs.append(btype)
            op = child.get("Operand", "").strip()
            if op and not _is_immediate(op) and op not in seen_ref:
                seen_ref.add(op)
                refs.append(op)
            # Nested Array operands (e.g. StorageArray, WeightArray on MAVE)
            for sub in child:
                sub_op = sub.get("Operand", "").strip()
                if sub_op and not _is_immediate(sub_op) and sub_op not in seen_ref:
                    seen_ref.add(sub_op)
                    refs.append(sub_op)

    return Rung(
        number=number,
        text="",
        refs=refs,
        outputs=outputs,
        instructions=instrs,
        provenance=_prov(src, "%s/%s/FBDSheet[%d]" % (prog_name, routine_name, number)),
    )


def _extract_rung_logic(text: str) -> tuple[list[str], list[str], list[str]]:
    """From rung text 'XIC(Start)XIO(Stop)OTE(Run);' -> (all tag refs, output tags, mnemonics).

    Outputs: for OTE/OTL/OTU/SET/RES/timers/counters the first operand is the driven tag; for MOV
    the DESTINATION is the 2nd operand. We capture the conservative, useful set; anything we are
    unsure about lands in refs (so nothing is lost) but not in outputs.
    """
    refs: list[str] = []
    outputs: list[str] = []
    instrs: list[str] = []
    seen_ref: set[str] = set()
    seen_out: set[str] = set()
    for m in _INSTR_RE.finditer(text or ""):
        mnem = m.group(1).upper()
        operands_raw = m.group(2)
        instrs.append(mnem)
        operands = [o.strip() for o in operands_raw.split(",")]
        tag_operands: list[str] = []
        for op in operands:
            mt = _TAG_OPERAND_RE.match(op)
            if mt and not _is_immediate(op):
                tag_operands.append(mt.group(0))
        for t in tag_operands:
            if t not in seen_ref:
                seen_ref.add(t)
                refs.append(t)
        if mnem in _OUTPUT_MNEMONICS and tag_operands:
            driven = tag_operands[1] if (mnem == "MOV" and len(tag_operands) > 1) else tag_operands[0]
            if driven not in seen_out:
                seen_out.add(driven)
                outputs.append(driven)
    return refs, outputs, instrs


def _parse_module_definition(el: ET.Element, src: str) -> ModuleDefinition:
    name = el.get("Name", "")
    mod = ModuleDefinition(
        name=name,
        catalog_number=el.get("CatalogNumber", ""),
        vendor=el.get("Vendor", ""),
        product_type=el.get("ProductType", ""),
        product_code=el.get("ProductCode", ""),
        major=el.get("Major", ""),
        minor=el.get("Minor", ""),
        parent_module=el.get("ParentModule", ""),
        parent_port=el.get("ParentModPortId", ""),
        inhibited=el.get("Inhibited", "false").lower() == "true",
        provenance=_prov(src, "Module[@Name='%s']" % name),
    )
    ports_el = _first(el, "Ports")
    if ports_el is not None:
        for p_el in ports_el.findall("Port"):
            mod.ports.append(ModulePort(
                id=p_el.get("Id", ""),
                address=p_el.get("Address", ""),
                type=p_el.get("Type", ""),
                upstream=p_el.get("Upstream", "false").lower() == "true",
            ))
    return mod


def _parse_aoi_definition(el: ET.Element, src: str) -> AOIDefinition:
    name = el.get("Name", "")
    desc_el = _first(el, "Description")
    aoi = AOIDefinition(
        name=name,
        revision=el.get("Revision", ""),
        description=_txt(desc_el),
        provenance=_prov(src, "AddOnInstructionDefinition[@Name='%s']" % name),
    )
    # parameters (the interface: Input / Output / InOut)
    params_el = _first(el, "Parameters")
    if params_el is not None:
        for p_el in params_el.findall("Parameter"):
            aoi.parameters.append(_parse_aoi_param(p_el, name, src))
    # local tags (internal state, not part of the interface)
    local_el = _first(el, "LocalTags")
    if local_el is not None:
        for lt_el in local_el.findall("LocalTag"):
            aoi.local_tags.append(_parse_aoi_local_tag(lt_el, name, src))
    # routines (Logic, Prescan, Postscan, EnableInFalse)
    routines_el = _first(el, "Routines")
    if routines_el is not None:
        for r_el in routines_el.findall("Routine"):
            aoi.routines.append(_parse_routine(r_el, name, src))
    return aoi


def _parse_aoi_param(el: ET.Element, aoi_name: str, src: str) -> Tag:
    name = el.get("Name", "")
    desc_el = _first(el, "Description")
    usage = el.get("Usage", "")   # Input, Output, InOut
    return Tag(
        name=name,
        data_type=el.get("DataType", ""),
        scope=TagScope.AOI_PARAMETER.value,
        description=_txt(desc_el),
        external_access=el.get("ExternalAccess", ""),
        radix=el.get("Radix", ""),
        usage=[usage] if usage else [],
        provenance=_prov(src, "AOI[%s]/Parameter[@Name='%s']" % (aoi_name, name)),
    )


def _parse_aoi_local_tag(el: ET.Element, aoi_name: str, src: str) -> Tag:
    name = el.get("Name", "")
    desc_el = _first(el, "Description")
    return Tag(
        name=name,
        data_type=el.get("DataType", ""),
        scope=TagScope.AOI_LOCAL.value,
        description=_txt(desc_el),
        radix=el.get("Radix", ""),
        provenance=_prov(src, "AOI[%s]/LocalTag[@Name='%s']" % (aoi_name, name)),
    )


def _is_immediate(op: str) -> bool:
    op = op.strip()
    if op == "":
        return True
    # numeric immediate (int/float/hex) or a string literal
    if re.match(r"^[-+]?(\d+\.?\d*|\.\d+|0x[0-9A-Fa-f]+)$", op):
        return True
    if op.startswith("'") or op.startswith('"'):
        return True
    return False
