"""End-to-end pipeline: bytes/text in -> detect -> parse -> IR -> deterministic analysis -> report.

This is the read-only Phase-1 entry point. It does NOT write to a PLC, translate between vendors, or
validate safety -- it extracts a maintenance-readable model from an exported program.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import analyze as _analyze
from . import uns as _uns
from .detect import Detection, detect
from .ir import PLCProject
from .parsers import csv_tags, ignition_json, plcopen_xml, rockwell_l5x, structured_text

# format key -> parser module (each exposes parse(text, source_file) -> PLCProject)
_PARSERS = {
    "rockwell_l5x": rockwell_l5x,
    "csv_tags": csv_tags,
    "structured_text": structured_text,
    "plcopen_xml": plcopen_xml,
    "ignition_json": ignition_json,
}
# recognized-but-not-yet-built parsers (routing is ready; extraction is a later phase)
_PLANNED = {"siemens_tia_xml"}


@dataclass
class ParseResult:
    detection: Detection
    project: PLCProject
    report: object              # analyze.AnalysisReport (None if not parsed)
    handled: bool               # True if a parser ran


def run(filename: str, text: str) -> ParseResult:
    """Detect the format, parse to IR, and run deterministic analysis. Always returns a result;
    unsupported/unknown formats come back with handled=False and an explanatory warning."""
    det = detect(filename, text)
    parser = _PARSERS.get(det.fmt)
    if parser is None:
        proj = PLCProject(source_format=det.fmt, source_files=[filename] if filename else [])
        if det.needs_export:
            # closed/binary project file -- don't say "great"; tell them what to export
            proj.warnings.append("cannot parse this file directly. " + det.needs_export)
        elif det.fmt in _PLANNED:
            proj.warnings.append("format '%s' recognized but its parser is a later phase" % det.fmt)
        else:
            proj.warnings.append("unrecognized format (%s): %s" % (det.fmt, det.reason))
        return ParseResult(detection=det, project=proj, report=_analyze.analyze(proj), handled=False)

    proj = parser.parse(text, source_file=filename)
    report = _analyze.analyze(proj)
    return ParseResult(detection=det, project=proj, report=report, handled=True)


def render_markdown(result: ParseResult) -> str:
    """A human-readable maintenance report from a ParseResult (for the Hub / a PDF / Ask MIRA)."""
    r = result.report
    det = result.detection
    lines: list[str] = []
    lines.append("# MIRA PLC Parser report")
    lines.append("")
    lines.append("**Format:** %s (%s confidence) — %s" % (det.fmt, det.confidence, det.reason))
    if not result.handled:
        lines.append("")
        if det.needs_export:
            lines.append("## ⛔ Not a parseable export — action needed")
            lines.append(det.needs_export)
        else:
            lines.append("> Not parsed: " + "; ".join(result.project.warnings))
        return "\n".join(lines)

    # Hierarchical source (Ignition tag tree etc.): explain the factory STRUCTURE, not ladder logic.
    if r.namespace:
        lines.extend(_render_namespace_md(r))
        return "\n".join(lines)

    lines.append("**Controller:** %s  ·  **Vendor:** %s" % (r.controller or "(unnamed)", r.vendor or "?"))
    lines.append("")
    c = r.counts
    lines.append("**Counts:** %d tags · %d programs · %d routines · %d rungs · %d outputs · "
                 "%d fault-candidates · %d asset-candidates · %d VFD-signal-candidates · "
                 "%d need review"
                 % (c.get("tags", 0), c.get("programs", 0), c.get("routines", 0), c.get("rungs", 0),
                    c.get("outputs", 0), c.get("fault_candidates", 0), c.get("asset_candidates", 0),
                    c.get("vfd_signal_candidates", 0), c.get("review_required", 0)))

    if r.review_required:
        lines.append("")
        lines.append("## ⚠ Human review required (safety / e-stop / bypass)")
        for f in r.review_required:
            lines.append("- **%s** — %s" % (f.name, f.detail))

    if r.output_dependencies:
        lines.append("")
        lines.append("## Output dependency candidates")
        for f in r.output_dependencies[:40]:
            where = ", ".join(f.evidence[:4])
            lines.append("- **%s** energized in %s — %s" % (f.name, where, f.detail or "(no conditions parsed)"))

    if r.fault_candidates:
        lines.append("")
        lines.append("## Fault candidates")
        for f in r.fault_candidates[:40]:
            lines.append("- **%s** (%s) — %s" % (f.name, f.confidence, f.detail))

    if r.asset_candidates:
        lines.append("")
        lines.append("## Asset candidates")
        for f in r.asset_candidates[:40]:
            lines.append("- **%s** — %s [%s]" % (f.name, f.detail, ", ".join(f.evidence[:8])))

    if r.vfd_signal_candidates:
        lines.append("")
        lines.append("## VFD signal candidates (feeds the VFD-Analyzer auto-map)")
        for f in r.vfd_signal_candidates[:40]:
            lines.append("- **%s** — %s" % (f.name, f.detail))

    if r.routine_summaries:
        lines.append("")
        lines.append("## Routines")
        for s in r.routine_summaries:
            lines.append("- **%s / %s** (%s, %d rungs) — %s"
                         % (s["program"], s["routine"], s["type"], s["rungs"], s["purpose_hint"] or ""))
    return "\n".join(lines)


def _render_namespace_md(r) -> list[str]:
    """Explain an imported ISA-95 namespace (Ignition tag tree) in human-readable form -- the
    'MIRA can explain the factory structure' surface. Lists per-level counts, the asset roster with
    UDT type + MES binding, and a depth-capped containment tree."""
    c = r.counts
    lines: list[str] = []
    enterprises = [n for n in r.namespace if n["level"] == "enterprise"]
    ent = enterprises[0]["name"] if enterprises else "(unnamed enterprise)"
    lines.append("")
    lines.append("## Factory namespace — %s" % ent)
    lines.append("")
    lines.append("**ISA-95 hierarchy:** %d sites · %d areas · %d lines · %d assets · %d signals "
                 "(%d nodes)"
                 % (c.get("sites", 0), c.get("areas", 0), c.get("lines", 0), c.get("assets", 0),
                    c.get("signals", 0), c.get("namespace_nodes", 0)))

    assets = [n for n in r.namespace if n["level"] == "asset"]
    if assets:
        lines.append("")
        lines.append("### Equipment assets")
        for a in assets[:60]:
            where = " / ".join(a["path"][:-1])
            udt = (a["udt_type"].rsplit("/", 1)[-1]) if a["udt_type"] else "?"
            nameplate = ""
            if a.get("manufacturer") or a.get("model"):
                nameplate = " — nameplate: %s %s" % (a.get("manufacturer", ""), a.get("model", ""))
            mes = "  ·  MES: yes" if a.get("mes_path") else ""
            lines.append("- **%s** (%s) under %s%s%s" % (a["name"], udt, where, mes, nameplate))

    # depth-capped containment tree (enterprise -> site -> area -> line -> asset)
    containers = [n for n in r.namespace if n["level"] != "signal"]
    if containers:
        lines.append("")
        lines.append("### Containment tree")
        lines.append("```")
        for n in containers[:120]:
            indent = "  " * (len(n["path"]) - 1)
            tag = "" if n["level"] in ("enterprise",) else " [%s]" % n["level"]
            lines.append("%s%s%s" % (indent, n["name"], tag))
        lines.append("```")
    return lines


def _finding(f) -> dict:
    """One analyze.Finding -> a plain JSON-safe dict (confidence is already a .value string)."""
    return {"kind": f.kind, "name": f.name, "detail": f.detail,
            "confidence": f.confidence, "evidence": list(f.evidence)}


def render_json(result: ParseResult) -> dict:
    """A machine-consumable report from a ParseResult -- the structured sibling of render_markdown().

    Built explicitly from known fields (NOT dataclasses.asdict, which would choke on the Confidence
    enum). Stdlib-only and json.dumps-safe; downstream tools / the Hub consume this shape."""
    det = result.detection
    detection = {"fmt": det.fmt, "confidence": det.confidence, "reason": det.reason,
                 "needs_export": det.needs_export}
    if not result.handled:
        return {"schema": "mira-plc-parser/report@1", "detection": detection, "handled": False,
                "warnings": list(result.project.warnings)}
    r = result.report
    report = {
        "schema": "mira-plc-parser/report@1",
        "detection": detection,
        "handled": True,
        "controller": r.controller,
        "vendor": r.vendor,
        "counts": dict(r.counts),
        "review_required": [_finding(f) for f in r.review_required],
        "output_dependencies": [_finding(f) for f in r.output_dependencies],
        "fault_candidates": [_finding(f) for f in r.fault_candidates],
        "asset_candidates": [_finding(f) for f in r.asset_candidates],
        "vfd_signal_candidates": [_finding(f) for f in r.vfd_signal_candidates],
        "routine_summaries": r.routine_summaries,
        "tag_dictionary": r.tag_dictionary,
        "warnings": list(r.warnings),
    }
    # Additive: only hierarchical sources (Ignition tag tree) carry an ISA-95 namespace. Logic
    # parsers (L5X/CSV/ST) omit the key entirely, so their report shape is unchanged.
    if r.namespace:
        report["namespace"] = list(r.namespace)
    # UNS / ISA-95 proposal layer: one candidate path per tag (deterministic, offline). The upper
    # levels come from `uns_prefix` (seeded from the controller name; user-overridable downstream).
    report["uns_prefix"] = _uns.default_prefix(report)
    report["uns_candidates"] = _uns.propose_uns(report)
    report["counts"]["uns_candidates"] = len(report["uns_candidates"])
    return report
