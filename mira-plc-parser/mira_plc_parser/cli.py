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
from .coverage import coverage_report, format_benchmark, format_report, run_benchmark
from .pipeline import render_json, render_markdown, run


def _read_text(path: Path) -> str:
    """Read a file as text, tolerating binary project files (detect() has a binary heuristic)."""
    return path.read_bytes().decode("utf-8", errors="replace")


def _summary(result, written: list[Path]) -> str:
    det = result.detection
    lines = ["Format: %s (%s) — %s" % (det.fmt, det.confidence, det.reason)]
    if result.handled:
        c = result.report.counts
        lines.append("Controller: %s · Vendor: %s" % (result.report.controller or "(unnamed)",
                                                       result.report.vendor or "?"))
        lines.append("Counts: %d tags · %d routines · %d outputs · %d fault · %d asset · "
                     "%d vfd-signal · %d review"
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
    if ns.format in ("md", "both"):
        md_path = out_dir / ("%s.report.md" % stem)
        md_path.write_text(render_markdown(result), encoding="utf-8")
        written.append(md_path)
    if ns.format in ("json", "both"):
        json_path = out_dir / ("%s.report.json" % stem)
        json_path.write_text(json.dumps(render_json(result), indent=2), encoding="utf-8")
        written.append(json_path)

    if not ns.quiet:
        print(_summary(result, written))

    # closed/binary vendor PROJECT file -> reject with the export instructions, distinct exit code.
    if result.detection.needs_export:
        print("\nACTION NEEDED — not a parseable export:\n%s" % result.detection.needs_export,
              file=sys.stderr)
        return 3
    # recognized-but-unsupported / unknown format
    if not result.handled:
        print("\nNot parsed: %s" % "; ".join(result.project.warnings), file=sys.stderr)
        return 1
    return 0


def _cmd_inspect(ns: argparse.Namespace) -> int:
    src = Path(ns.file)
    if not src.is_file():
        print("error: file not found: %s" % src, file=sys.stderr)
        return 1
    try:
        text = src.read_bytes().decode("utf-8", errors="replace")
    except OSError as exc:
        print("error: cannot read %s: %s" % (src, exc), file=sys.stderr)
        return 1
    report = coverage_report(text, src.name)
    print(format_report(report))
    if ns.out:
        out_path = Path(ns.out) / ("%s.coverage.json" % src.stem)
        import dataclasses
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(dataclasses.asdict(report), indent=2), encoding="utf-8")
        print("Wrote: %s" % out_path)
    return 0 if report.status not in ("ERROR",) else 1


def _cmd_benchmark(ns: argparse.Namespace) -> int:
    import os
    directory = ns.directory
    if not os.path.isdir(directory):
        print("error: not a directory: %s" % directory, file=sys.stderr)
        return 1
    entries = run_benchmark(directory)
    report_text = format_benchmark(entries, title="MIRA PLC Parser — Benchmark: %s" % directory)
    print(report_text)
    if ns.out:
        out_path = Path(ns.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report_text, encoding="utf-8")
        print("\nWrote: %s" % out_path)
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
    p_analyze.add_argument("--format", choices=("md", "json", "both"), default="both",
                           help="Which report file(s) to write (default: both).")
    p_analyze.add_argument("--quiet", action="store_true", help="Suppress the stdout summary.")
    p_analyze.set_defaults(func=_cmd_analyze)

    p_inspect = sub.add_parser("inspect",
        help="Show coverage report: what the parser can and cannot extract from a file.")
    p_inspect.add_argument("file", help="Path to an L5X file.")
    p_inspect.add_argument("--out", default="", metavar="DIR",
                           help="Optional directory to also write a JSON coverage report.")
    p_inspect.set_defaults(func=_cmd_inspect)

    p_bench = sub.add_parser("benchmark",
        help="Run coverage report over every L5X in a directory and print a summary table.")
    p_bench.add_argument("directory", help="Directory containing L5X files.")
    p_bench.add_argument("--out", default="", metavar="FILE",
                         help="Optional path to write the markdown benchmark report.")
    p_bench.set_defaults(func=_cmd_benchmark)

    return parser


def main(argv: list[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    return ns.func(ns)


if __name__ == "__main__":
    raise SystemExit(main())
