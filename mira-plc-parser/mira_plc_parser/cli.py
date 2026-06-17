"""Offline command-line interface for the MIRA PLC Parser.

Usage:
    mira-plc-parser analyze <FILE> [--out DIR] [--format {md,json,both}] [--quiet]

Reads a PLC program export, runs the read-only detect -> parse -> IR -> analysis pipeline, and
writes local report files (<stem>.report.md and/or <stem>.report.json) next to nothing on the
network -- this CLI is stdlib-only and never makes an LLM or network call.

Exit codes:
    0  parsed and analyzed (a real export)
    3  closed/binary vendor PROJECT file -- rejected with export instructions (still writes a report)
    1  unrecognized/unsupported format, or a read/write error
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .i3x import render_i3x
from .pipeline import render_json, render_markdown, run


def _read_text(path: Path) -> str:
    """Read a file as text, tolerating binary project files (detect() has a binary heuristic)."""
    return path.read_bytes().decode("utf-8", errors="replace")


def _summary(result, written: list[Path]) -> str:
    det = result.detection
    # ASCII-only console output: a stock Windows console (cp1252/cp437) garbles em-dash/middot,
    # so the printed summary stays 7-bit. The report FILES (render_markdown/json) keep full UTF-8.
    lines = ["Format: %s (%s) -- %s" % (det.fmt, det.confidence, det.reason)]
    if result.handled:
        c = result.report.counts
        lines.append("Controller: %s | Vendor: %s" % (result.report.controller or "(unnamed)",
                                                       result.report.vendor or "?"))
        lines.append("Counts: %d tags | %d routines | %d outputs | %d fault | %d asset | "
                     "%d vfd-signal | %d review"
                     % (c.get("tags", 0), c.get("routines", 0), c.get("outputs", 0),
                        c.get("fault_candidates", 0), c.get("asset_candidates", 0),
                        c.get("vfd_signal_candidates", 0), c.get("review_required", 0)))
    for p in written:
        lines.append("Wrote: %s" % p)
    return "\n".join(lines)


def _cmd_analyze(ns: argparse.Namespace) -> int:
    src = Path(ns.file)
    if not src.is_file():
        print("error: file not found: %s" % src, file=sys.stderr)
        return 1
    try:
        text = _read_text(src)
    except OSError as exc:
        print("error: cannot read %s: %s" % (src, exc), file=sys.stderr)
        return 1

    result = run(src.name, text)

    out_dir = Path(ns.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = src.stem
    written: list[Path] = []
    if ns.format in ("md", "both", "all"):
        md_path = out_dir / ("%s.report.md" % stem)
        md_path.write_text(render_markdown(result), encoding="utf-8")
        written.append(md_path)
    if ns.format in ("json", "both", "all"):
        json_path = out_dir / ("%s.report.json" % stem)
        json_path.write_text(json.dumps(render_json(result), indent=2), encoding="utf-8")
        written.append(json_path)
    if ns.format in ("i3x", "all"):
        i3x_path = out_dir / ("%s.i3x.json" % stem)
        i3x_path.write_text(json.dumps(render_i3x(result), indent=2), encoding="utf-8")
        written.append(i3x_path)

    if not ns.quiet:
        print(_summary(result, written))

    # closed/binary vendor PROJECT file -> reject with the export instructions, distinct exit code.
    if result.detection.needs_export:
        print("\nACTION NEEDED -- not a parseable export:\n%s" % result.detection.needs_export,
              file=sys.stderr)
        return 3
    # recognized-but-unsupported / unknown format
    if not result.handled:
        print("\nNot parsed: %s" % "; ".join(result.project.warnings), file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mira-plc-parser",
        description="Read-only, offline analysis of PLC program exports (no LLM, no network).",
    )
    parser.add_argument("--version", action="version", version="mira-plc-parser %s" % __version__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Analyze a PLC export into local report files.")
    p_analyze.add_argument("file", help="Path to a PLC program export (L5X, CSV, ...).")
    p_analyze.add_argument("--out", default=".",
                           help="Directory to write report files into (default: current dir).")
    p_analyze.add_argument("--format", choices=("md", "json", "i3x", "both", "all"), default="both",
                           help="Which report file(s) to write: md, json, i3x (i3X object graph), "
                                "both (md+json), or all (default: both).")
    p_analyze.add_argument("--quiet", action="store_true", help="Suppress the stdout summary.")
    p_analyze.set_defaults(func=_cmd_analyze)
    return parser


def main(argv: list[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    return ns.func(ns)


if __name__ == "__main__":
    raise SystemExit(main())
