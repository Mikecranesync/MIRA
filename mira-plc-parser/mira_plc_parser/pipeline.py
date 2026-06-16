"""End-to-end pipeline: bytes/text in -> detect -> parse -> IR -> deterministic analysis -> report.

This is the read-only Phase-1 entry point. It does NOT write to a PLC, translate between vendors, or
validate safety -- it extracts a maintenance-readable model from an exported program.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import analyze as _analyze
from .detect import Detection, detect
from .ir import PLCProject
from .parsers import csv_tags, rockwell_l5x

# format key -> parser module (each exposes parse(text, source_file) -> PLCProject)
_PARSERS = {
    "rockwell_l5x": rockwell_l5x,
    "csv_tags": csv_tags,
}
# recognized-but-not-yet-built parsers (routing is ready; extraction is a later phase)
_PLANNED = {"plcopen_xml", "siemens_tia_xml", "structured_text"}


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
