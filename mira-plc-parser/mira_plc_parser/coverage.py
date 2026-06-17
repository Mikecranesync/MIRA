"""Parser coverage inspection — honest accounting of what any L5X file contains vs. what was extracted.

For any L5X file the user sends in, this module answers:
  1. What TargetType is it, and what is the actual export target (Use='Target')?
  2. What elements are present (by type and count)?
  3. What did the parser extract vs. what was available?
  4. Coverage percentage and status tier.
  5. What was silently skipped and which milestone would close the gap.

This is the "parser honesty" layer. It prevents the parser from silently returning zeros
and instead tells the user exactly what it can and cannot handle.

Usage:
    from mira_plc_parser.coverage import coverage_report, format_report
    report = coverage_report(open('file.L5X').read(), 'file.L5X')
    print(format_report(report))
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Element inventory (raw XML — no parser knowledge)
# ---------------------------------------------------------------------------

@dataclass
class RoutineInventory:
    name: str
    type: str            # "RLL" | "FBD" | "SFC" | "ST" | "unknown"
    rung_count: int = 0
    sheet_count: int = 0  # FBD sheets
    step_count: int = 0   # SFC steps
    line_count: int = 0   # ST lines
    has_content: bool = False


@dataclass
class FileInventory:
    """Everything present in the raw XML, grouped by semantic kind."""
    source_file: str = ""
    target_type: str = ""        # RSLogix5000Content/@TargetType
    target_name: str = ""        # the Use='Target' element's @Name
    software_rev: str = ""

    # Controller-level (when a full Controller is the export or the wrapper)
    ctrl_tags_context: int = 0   # Use='Context' tags (supporting cast)
    ctrl_tags_target: int = 0    # Use='Target' or untagged (the actual export)
    ctrl_datatypes: int = 0      # DataType elements
    ctrl_modules: int = 0        # Module elements

    # Programs
    programs: int = 0
    prog_tags: int = 0           # program-scoped tags across all programs

    # Routines (flat list across all programs + AOIs)
    routines: list[RoutineInventory] = field(default_factory=list)

    # AOI definitions (AddOnInstructionDefinition elements)
    aoi_defs: int = 0
    aoi_parameters: int = 0      # Parameter elements inside AOI defs
    aoi_local_tags: int = 0      # LocalTag elements inside AOI defs
    aoi_routines: int = 0        # Routines inside AOI defs

    # Special features present
    has_fbd: bool = False
    has_sfc: bool = False
    has_st: bool = False
    has_alarm_defs: bool = False
    has_produced_consumed: bool = False
    has_safety_tags: bool = False

    # Diagnostics
    parse_error: str = ""


def _count_tag_elements(tags_el: ET.Element | None) -> tuple[int, int]:
    """Return (context_count, target_count) from a <Tags> element."""
    if tags_el is None:
        return 0, 0
    context = target = 0
    for tag in tags_el.findall("Tag"):
        if tag.get("Use") == "Context":
            context += 1
        else:
            target += 1
    return context, target


def _inventory_routine(r_el: ET.Element) -> RoutineInventory:
    rtype = r_el.get("Type", "unknown")
    ri = RoutineInventory(name=r_el.get("Name", ""), type=rtype)
    rll = r_el.find("RLLContent")
    if rll is not None:
        ri.rung_count = len(rll.findall("Rung"))
        ri.has_content = True
    fbd = r_el.find("FBDContent")
    if fbd is not None:
        ri.sheet_count = len(fbd.findall("Sheet"))
        ri.has_content = True
    sfc = r_el.find("SFCContent")
    if sfc is not None:
        ri.step_count = len(sfc.findall("Step"))
        ri.has_content = True
    st = r_el.find("STContent")
    if st is not None:
        ri.line_count = len(st.findall("Line"))
        ri.has_content = ri.line_count > 0
    return ri


def inventory(text: str, source_file: str = "") -> FileInventory:
    """Walk raw XML and count everything present without interpreting semantics."""
    inv = FileInventory(source_file=source_file)
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        inv.parse_error = str(e)
        return inv

    inv.target_type = root.get("TargetType", "")
    inv.software_rev = root.get("SoftwareRevision", "")

    # Find the Use='Target' element
    for el in root.iter():
        if el.get("Use") == "Target":
            inv.target_name = el.get("Name", "")
            break

    # Produced/consumed/safety flags
    inv.has_produced_consumed = any(
        el.get("TagType") in ("Produced", "Consumed")
        for el in root.iter("Tag")
    )
    inv.has_safety_tags = any(
        el.get("Class") == "Safety"
        for el in root.iter("Tag")
    )
    inv.has_alarm_defs = root.find(".//AlarmDefinitions") is not None

    # Walk the Controller element (present in all export types)
    ctrl_el = root.find("Controller") or next(root.iter("Controller"), None)
    if ctrl_el is None:
        # True root-level AOI export (rare — older SW versions)
        ctrl_el = root

    # DataTypes
    dts_el = ctrl_el.find("DataTypes")
    if dts_el is not None:
        inv.ctrl_datatypes = len(dts_el.findall("DataType"))

    # Modules
    mods_el = ctrl_el.find("Modules")
    if mods_el is not None:
        inv.ctrl_modules = len(mods_el.findall("Module"))

    # Controller-scoped tags
    tags_el = ctrl_el.find("Tags")
    ctx, tgt = _count_tag_elements(tags_el)
    inv.ctrl_tags_context = ctx
    inv.ctrl_tags_target = tgt

    # Programs + program-scoped tags + routines
    progs_el = ctrl_el.find("Programs")
    if progs_el is not None:
        for prog_el in progs_el.findall("Program"):
            inv.programs += 1
            ptags = prog_el.find("Tags")
            # program tags are always target (not context) when inside a Program
            inv.prog_tags += len(ptags.findall("Tag")) if ptags is not None else 0
            routines_el = prog_el.find("Routines")
            if routines_el is not None:
                for r_el in routines_el.findall("Routine"):
                    ri = _inventory_routine(r_el)
                    inv.routines.append(ri)

    # AOI definitions (in-controller or at root level)
    aoi_defs_el = ctrl_el.find("AddOnInstructionDefinitions")
    if aoi_defs_el is None:
        aoi_defs_el = root.find("AddOnInstructionDefinitions")
    if aoi_defs_el is not None:
        for aoi_el in aoi_defs_el.findall("AddOnInstructionDefinition"):
            # Only count non-Context AOIs (Use='Target' or unset)
            if aoi_el.get("Use") == "Context":
                continue
            inv.aoi_defs += 1
            params_el = aoi_el.find("Parameters")
            if params_el is not None:
                inv.aoi_parameters += len(params_el.findall("Parameter"))
            local_el = aoi_el.find("LocalTags")
            if local_el is not None:
                inv.aoi_local_tags += len(local_el.findall("LocalTag"))
            routines_el = aoi_el.find("Routines")
            if routines_el is not None:
                for r_el in routines_el.findall("Routine"):
                    ri = _inventory_routine(r_el)
                    inv.aoi_routines += 1
                    inv.routines.append(ri)  # also in master list

    # Routine-level features
    for ri in inv.routines:
        if ri.type == "FBD" or ri.sheet_count > 0:
            inv.has_fbd = True
        if ri.type == "SFC" or ri.step_count > 0:
            inv.has_sfc = True
        if ri.type == "ST":
            inv.has_st = True

    return inv


# ---------------------------------------------------------------------------
# Coverage report (inventory vs. what the parser actually extracted)
# ---------------------------------------------------------------------------

# Status tiers
STATUS_FULL = "FULL"
STATUS_PARTIAL = "PARTIAL"
STATUS_MINIMAL = "MINIMAL"
STATUS_ZERO = "ZERO"
STATUS_UNSUPPORTED = "UNSUPPORTED"
STATUS_ERROR = "ERROR"


@dataclass
class Extraction:
    """What the parser actually pulled out."""
    tags: int = 0
    routines: int = 0
    rungs: int = 0
    datatypes: int = 0
    programs: int = 0
    aoi_defs: int = 0
    aoi_parameters: int = 0
    aoi_local_tags: int = 0
    modules: int = 0
    fbd_sheets: int = 0
    produced_consumed: int = 0
    sfc_steps: int = 0
    # False-positive flag: parser extracted Context tags instead of Target
    context_leak: int = 0    # number of Context tags incorrectly surfaced as output


@dataclass
class CoverageReport:
    source_file: str = ""
    target_type: str = ""
    target_name: str = ""
    software_rev: str = ""
    inventory: FileInventory = field(default_factory=FileInventory)
    extraction: Extraction = field(default_factory=Extraction)
    coverage_pct: float = 0.0
    status: str = STATUS_ZERO
    # What was present but not extracted
    gaps: list[str] = field(default_factory=list)
    # Context tags mistakenly extracted as if they were target content
    false_positives: list[str] = field(default_factory=list)
    # Which milestone/issue would close the primary gap
    next_milestone: str = ""
    warnings: list[str] = field(default_factory=list)


def _next_milestone(target_type: str, gaps: list[str]) -> str:
    if not gaps:
        return ""
    tt = target_type.lower()
    if "addoninstruction" in tt or "aoi" in tt or "AddOnInstruction" in target_type:
        return "Phase 1.1 — AOI parsing (issue #2086)"
    if "module" in tt:
        return "Phase 1.3 — Module parsing (issue #2087)"
    if "datatype" in tt:
        return "Phase 1.4 — DataType-only exports"
    if any("FBD" in g for g in gaps):
        return "Phase 1.2 — FBD routine parsing (issue #2088)"
    if any("SFC" in g for g in gaps):
        return "Phase 1.5 — SFC routine parsing"
    return ""


def coverage_report(text: str, source_file: str = "") -> CoverageReport:
    """Inventory the file, run the parser, and compute a coverage report."""
    from .analyze import analyze
    from .parsers.rockwell_l5x import parse

    inv = inventory(text, source_file)
    report = CoverageReport(
        source_file=source_file,
        target_type=inv.target_type,
        target_name=inv.target_name,
        software_rev=inv.software_rev,
        inventory=inv,
    )

    if inv.parse_error:
        report.status = STATUS_ERROR
        report.warnings.append(inv.parse_error)
        return report

    # Run the parser
    try:
        proj = parse(text, source_file)
        rep = analyze(proj)
    except Exception as e:
        report.status = STATUS_ERROR
        report.warnings.append("Parser error: %s" % e)
        return report

    report.warnings.extend(proj.warnings)

    # Build extraction summary
    ext = Extraction(
        tags=rep.counts.get("tags", 0),
        routines=rep.counts.get("routines", 0),
        rungs=rep.counts.get("rungs", 0),
        datatypes=sum(len(c.datatypes) for c in proj.controllers),
        programs=rep.counts.get("programs", 0),
        aoi_defs=rep.counts.get("aoi_definitions", 0),
        aoi_parameters=rep.counts.get("aoi_parameters", 0),
        aoi_local_tags=rep.counts.get("aoi_local_tags", 0),
        modules=rep.counts.get("module_definitions", 0),
        fbd_sheets=rep.counts.get("fbd_sheets", 0),
        produced_consumed=rep.counts.get("produced_consumed", 0),
        sfc_steps=rep.counts.get("sfc_steps", 0),
    )

    # Detect false positives: parser extracted Context tags when the Target
    # was something else (happens with Routine/Program/AOI/DataType/Module exports)
    non_controller_types = {"routine", "program", "datatype", "module",
                             "addoninstruction", "addoninstructiondefinition"}
    tt_lower = inv.target_type.lower().replace(" ", "").replace("_", "")
    is_non_ctrl_export = any(k in tt_lower for k in non_controller_types)
    if is_non_ctrl_export and ext.tags > 0 and inv.ctrl_tags_context > 0:
        # Parser found tags in a non-Controller export — those are Context tags
        ext.context_leak = min(ext.tags, inv.ctrl_tags_context)
        report.false_positives.append(
            "%d Context tags surfaced as output (supporting references, not the export target)" % ext.context_leak
        )

    report.extraction = ext

    # Compute coverage
    # Available = Target elements (what this export IS, not its context)
    available_tags = (inv.ctrl_tags_target + inv.prog_tags
                      + inv.aoi_parameters + inv.aoi_local_tags)
    available_routines = len(inv.routines)
    available_datatypes = inv.ctrl_datatypes
    available_modules = inv.ctrl_modules
    available_aois = inv.aoi_defs
    _ = available_modules  # reserved for Phase 1.3 Module extraction scoring

    # Weighted: tags 40%, routines 30%, datatypes 15%, aois 15%
    def _pct(got: int, avail: int) -> float:
        return min(100.0, (got / avail * 100)) if avail > 0 else 100.0

    if inv.target_type == "Controller" or inv.target_type == "":
        # Full controller export — everything is the target
        available_tags = inv.ctrl_tags_target + inv.prog_tags
        tag_pct = _pct(ext.tags, available_tags)
        rtn_pct = _pct(ext.routines, available_routines)
        dt_pct = _pct(ext.datatypes, available_datatypes) if available_datatypes else 100.0
        report.coverage_pct = (tag_pct * 0.4 + rtn_pct * 0.35 + dt_pct * 0.25)
    elif "addoninstruction" in tt_lower:
        # AOI export — parameters and local tags are the substance
        if available_tags == 0 and available_aois == 0:
            report.coverage_pct = 0.0
        else:
            aoi_pct = _pct(ext.aoi_defs, available_aois)
            tag_pct = _pct(ext.aoi_parameters + ext.aoi_local_tags, available_tags)
            rtn_pct = _pct(ext.routines, available_routines)
            report.coverage_pct = (aoi_pct * 0.3 + tag_pct * 0.5 + rtn_pct * 0.2)
    elif "datatype" in tt_lower:
        report.coverage_pct = _pct(ext.datatypes, available_datatypes)
    elif "module" in tt_lower:
        report.coverage_pct = _pct(ext.modules, available_modules)
    else:
        # Routine/Program/unknown — effective extraction after removing context leak.
        # Use only the program's own tags (ctrl_tags_target + prog_tags); exclude
        # aoi_parameters and aoi_local_tags which belong to context AOI definitions
        # bundled as supporting references, not as the export's target content.
        real_tags = max(0, ext.tags - ext.context_leak)
        prog_available = inv.ctrl_tags_target + inv.prog_tags
        report.coverage_pct = _pct(real_tags, prog_available) if prog_available > 0 else (
            _pct(ext.routines, available_routines)
        )

    # Identify gaps
    gaps: list[str] = []
    if inv.aoi_defs > 0 and ext.aoi_defs == 0:
        gaps.append("%d AOI definition%s (AddOnInstructionDefinitions) — not parsed"
                    % (inv.aoi_defs, "s" if inv.aoi_defs > 1 else ""))
    if inv.aoi_parameters > 0 and ext.aoi_parameters == 0:
        gaps.append("%d AOI parameter%s — not extracted"
                    % (inv.aoi_parameters, "s" if inv.aoi_parameters > 1 else ""))
    if inv.aoi_local_tags > 0 and ext.aoi_local_tags == 0:
        gaps.append("%d AOI local tag%s — not extracted"
                    % (inv.aoi_local_tags, "s" if inv.aoi_local_tags > 1 else ""))
    if inv.ctrl_modules > 0 and ext.modules == 0:
        gaps.append("%d Module element%s — not parsed (hardware topology invisible)"
                    % (inv.ctrl_modules, "s" if inv.ctrl_modules > 1 else ""))
    fbd_routines = [r for r in inv.routines if r.type == "FBD"]
    fbd_sheet_count = sum(r.sheet_count for r in fbd_routines)
    if fbd_routines and fbd_sheet_count > 0 and ext.fbd_sheets == 0:
        gaps.append("%d FBD routine%s (FBDContent) — silently skipped"
                    % (len(fbd_routines), "s" if len(fbd_routines) > 1 else ""))
    sfc_routines = [r for r in inv.routines if r.type == "SFC"]
    sfc_step_count = sum(r.step_count for r in sfc_routines)
    if sfc_routines and sfc_step_count > 0 and ext.sfc_steps == 0:
        gaps.append("%d SFC routine%s (SFCContent) — silently skipped"
                    % (len(sfc_routines), "s" if len(sfc_routines) > 1 else ""))
    if inv.has_produced_consumed and ext.produced_consumed == 0:
        gaps.append("Produced/Consumed tags present — not extracted (cross-controller data sharing invisible)")
    if inv.has_alarm_defs:
        gaps.append("AlarmDefinitions present — not extracted")
    report.gaps = gaps

    # Status tier
    pct = report.coverage_pct
    tt = inv.target_type.lower()
    if inv.parse_error or report.status == STATUS_ERROR:
        report.status = STATUS_ERROR
    elif ("addoninstruction" in tt or "module" in tt) and pct < 5:
        report.status = STATUS_UNSUPPORTED
    elif "datatype" in tt and available_datatypes > 0 and ext.datatypes == 0:
        report.status = STATUS_UNSUPPORTED
    elif pct >= 80:
        report.status = STATUS_FULL if not gaps else STATUS_PARTIAL
    elif pct >= 20:
        report.status = STATUS_PARTIAL
    elif pct > 0:
        report.status = STATUS_MINIMAL
    else:
        report.status = STATUS_ZERO

    report.next_milestone = _next_milestone(inv.target_type, gaps)
    return report


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------

_STATUS_ICON = {
    STATUS_FULL: "✓ FULL",
    STATUS_PARTIAL: "~ PARTIAL",
    STATUS_MINIMAL: "↓ MINIMAL",
    STATUS_ZERO: "✗ ZERO",
    STATUS_UNSUPPORTED: "✗ UNSUPPORTED",
    STATUS_ERROR: "✗ ERROR",
}

_STATUS_DESC = {
    STATUS_FULL: "Parser captures the primary content of this export.",
    STATUS_PARTIAL: "Parser captures core content but some elements are silently skipped.",
    STATUS_MINIMAL: "Parser extracts something but most content is missed.",
    STATUS_ZERO: "Parser returned zero — nothing extracted from this export type.",
    STATUS_UNSUPPORTED: "This export type is not yet supported by the parser.",
    STATUS_ERROR: "Parse error — the file could not be read.",
}


def format_report(r: CoverageReport, width: int = 72) -> str:
    inv = r.inventory
    ext = r.extraction
    lines: list[str] = []
    bar = "─" * width

    lines.append(bar)
    lines.append("MIRA PLC Parser — Coverage Report")
    lines.append(bar)
    lines.append("File:        %s" % (r.source_file or "(stdin)"))
    lines.append("TargetType:  %s" % (r.target_type or "(unknown)"))
    if r.target_name:
        lines.append("Target:      %s" % r.target_name)
    if r.software_rev:
        lines.append("SW Version:  Studio 5000 v%s" % r.software_rev)
    lines.append("")
    lines.append("Status:  %s (%.0f%% coverage)" % (_STATUS_ICON.get(r.status, r.status), r.coverage_pct))
    lines.append("         %s" % _STATUS_DESC.get(r.status, ""))
    lines.append("")

    # Inventory
    lines.append("What's in this file:")
    if inv.ctrl_tags_target or inv.prog_tags:
        t = inv.ctrl_tags_target + inv.prog_tags
        lines.append("  Tags (target scope)    : %d" % t)
    if inv.ctrl_tags_context:
        lines.append("  Tags (context/refs)    : %d  (supporting — not the export)" % inv.ctrl_tags_context)
    if inv.ctrl_datatypes:
        lines.append("  DataType definitions   : %d" % inv.ctrl_datatypes)
    if inv.ctrl_modules:
        lines.append("  Module definitions     : %d" % inv.ctrl_modules)
    if inv.programs:
        lines.append("  Programs               : %d" % inv.programs)
    if inv.aoi_defs:
        lines.append("  AOI definitions        : %d  (%d params, %d local tags, %d routines)"
                     % (inv.aoi_defs, inv.aoi_parameters, inv.aoi_local_tags, inv.aoi_routines))
    if inv.routines:
        by_type: dict[str, int] = {}
        for ri in inv.routines:
            by_type[ri.type] = by_type.get(ri.type, 0) + 1
        rtn_parts = ["%d %s" % (cnt, t) for t, cnt in sorted(by_type.items())]
        lines.append("  Routines               : %d  (%s)" % (len(inv.routines), ", ".join(rtn_parts)))
    features = []
    if inv.has_fbd:
        features.append("FBD (function block)")
    if inv.has_sfc:
        features.append("SFC (sequential function chart)")
    if inv.has_st:
        features.append("ST (structured text)")
    if inv.has_alarm_defs:
        features.append("AlarmDefinitions")
    if inv.has_produced_consumed:
        features.append("Produced/Consumed tags")
    if inv.has_safety_tags:
        features.append("Safety tags")
    if features:
        lines.append("  Special features       : %s" % ", ".join(features))
    if not any([inv.ctrl_tags_target, inv.prog_tags, inv.ctrl_datatypes,
                inv.ctrl_modules, inv.programs, inv.aoi_defs, inv.routines]):
        lines.append("  (empty export — no substantive elements found)")
    lines.append("")

    # Extraction
    lines.append("What the parser extracted:")
    if ext.tags:
        lines.append("  Tags extracted         : %d" % ext.tags)
    if ext.datatypes:
        lines.append("  DataTypes extracted    : %d" % ext.datatypes)
    if ext.programs:
        lines.append("  Programs               : %d" % ext.programs)
    if ext.routines:
        lines.append("  Routines               : %d  (%d rungs)" % (ext.routines, ext.rungs))
    if ext.aoi_defs:
        lines.append("  AOI defs               : %d  (%d params, %d local)" %
                     (ext.aoi_defs, ext.aoi_parameters, ext.aoi_local_tags))
    if ext.modules:
        lines.append("  Module defs            : %d" % ext.modules)
    if not any([ext.tags, ext.datatypes, ext.routines, ext.aoi_defs, ext.modules]):
        lines.append("  (nothing)")

    if r.false_positives:
        lines.append("")
        lines.append("⚠ False positives (extracted but NOT the export target):")
        for fp in r.false_positives:
            lines.append("  • %s" % fp)

    if r.gaps:
        lines.append("")
        lines.append("Gaps (present in file but not extracted):")
        for g in r.gaps:
            lines.append("  • %s" % g)

    if r.next_milestone:
        lines.append("")
        lines.append("Next:  %s" % r.next_milestone)

    if r.warnings:
        lines.append("")
        lines.append("Warnings:")
        for w in r.warnings:
            lines.append("  ! %s" % w)

    lines.append(bar)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------

@dataclass
class BenchmarkEntry:
    file: str
    target_type: str
    target_name: str
    status: str
    coverage_pct: float
    gaps: list[str]
    false_positives: list[str]
    next_milestone: str
    error: str = ""


def run_benchmark(directory: str, pattern: str = "*.L5X") -> list[BenchmarkEntry]:
    """Run coverage_report over every L5X in a directory. Returns sorted entries."""
    import glob
    import os
    entries: list[BenchmarkEntry] = []
    files = sorted(glob.glob(os.path.join(directory, pattern)))
    for fpath in files:
        try:
            text = open(fpath, encoding="utf-8", errors="replace").read()
            r = coverage_report(text, os.path.basename(fpath))
            entries.append(BenchmarkEntry(
                file=os.path.basename(fpath),
                target_type=r.target_type,
                target_name=r.target_name,
                status=r.status,
                coverage_pct=r.coverage_pct,
                gaps=r.gaps,
                false_positives=r.false_positives,
                next_milestone=r.next_milestone,
            ))
        except Exception as e:
            entries.append(BenchmarkEntry(
                file=os.path.basename(fpath),
                target_type="?", target_name="", status=STATUS_ERROR,
                coverage_pct=0.0, gaps=[], false_positives=[],
                next_milestone="", error=str(e),
            ))
    return entries


def format_benchmark(entries: list[BenchmarkEntry], title: str = "MIRA PLC Parser — Benchmark") -> str:
    """Format benchmark results as a markdown table + summary."""
    lines: list[str] = []
    lines.append("# %s" % title)
    lines.append("")
    lines.append("| Status | Cov% | TargetType | File |")
    lines.append("|--------|------|------------|------|")

    status_counts: dict[str, int] = {}
    for e in entries:
        icon = {"FULL": "✓", "PARTIAL": "~", "MINIMAL": "↓",
                "ZERO": "✗", "UNSUPPORTED": "✗", "ERROR": "💥"}.get(e.status, "?")
        lines.append("| %s %s | %.0f%% | %s | %s |"
                     % (icon, e.status, e.coverage_pct, e.target_type, e.file))
        status_counts[e.status] = status_counts.get(e.status, 0) + 1

    lines.append("")
    total = len(entries)
    lines.append("**Total: %d files**" % total)
    for status in [STATUS_FULL, STATUS_PARTIAL, STATUS_MINIMAL,
                   STATUS_ZERO, STATUS_UNSUPPORTED, STATUS_ERROR]:
        cnt = status_counts.get(status, 0)
        if cnt:
            lines.append("- %s: %d" % (status, cnt))

    # Gap frequency
    gap_freq: dict[str, int] = {}
    for e in entries:
        for g in e.gaps:
            # normalize to the first 40 chars for grouping
            key = g[:40]
            gap_freq[key] = gap_freq.get(key, 0) + 1
    if gap_freq:
        lines.append("")
        lines.append("## Most common gaps")
        for gap, cnt in sorted(gap_freq.items(), key=lambda x: -x[1])[:10]:
            lines.append("- (%dx) %s..." % (cnt, gap))

    # Milestones
    ms_freq: dict[str, int] = {}
    for e in entries:
        if e.next_milestone:
            ms_freq[e.next_milestone] = ms_freq.get(e.next_milestone, 0) + 1
    if ms_freq:
        lines.append("")
        lines.append("## Files unblocked per milestone")
        for ms, cnt in sorted(ms_freq.items(), key=lambda x: -x[1]):
            lines.append("- **%s**: %d file%s" % (ms, cnt, "s" if cnt > 1 else ""))

    return "\n".join(lines)
