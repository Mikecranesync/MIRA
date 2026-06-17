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


def _cmd_i3x_check(ns: argparse.Namespace) -> int:
    """Handshake a live i3X server: GET /info + list its namespaces. Network, opt-in."""
    from . import i3x_client as client
    try:
        srv = client.info(ns.server)
        namespaces = client.list_namespaces(ns.server)
    except client.I3XError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    print("i3X server: %s" % ns.server.rstrip("/"))
    print("  spec %s | server %s | %s"
          % (srv.get("specVersion", "?"), srv.get("serverVersion", "?"), srv.get("serverName", "?")))
    print("  namespaces: %d" % len(namespaces))
    for n in namespaces[:20]:
        print("    - %s (%s)" % (n.get("uri", ""), n.get("displayName", "")))
    return 0


def _cmd_i3x_reconcile(ns: argparse.Namespace) -> int:
    """Check a report's proposed i3X namespace against a live server (which nodes already exist)."""
    from . import i3x as i3xmod
    from . import i3x_client as client
    src = Path(ns.report)
    if not src.is_file():
        print("error: report not found: %s" % src, file=sys.stderr)
        return 1
    try:
        report = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("error: cannot read report JSON %s (%s)" % (src, exc), file=sys.stderr)
        return 1
    prefix = {k: getattr(ns, k) for k in ("enterprise", "site", "area", "line") if getattr(ns, k)}
    payload = i3xmod.to_i3x(report, prefix or None)
    try:
        rec = client.reconcile(ns.server, payload)
    except client.I3XError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    print("Reconcile %s against %s" % (src.name, rec["server"]))
    print("  proposed nodes:    %d" % rec["total"])
    print("  already on server: %d" % rec["existing_count"])
    print("  new (to provision): %d" % rec["new_count"])
    for nid in rec["new"][:30]:
        print("    + %s" % nid)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mira-plc-parser",
        description="Read-only, offline PLC-export analysis (no LLM). The optional i3x-* commands "
                    "are the only networked part -- they reconcile against a live i3X server.",
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

    p_check = sub.add_parser("i3x-check",
                             help="Handshake a live i3X server (GET /info + namespaces). [network]")
    p_check.add_argument("--server", required=True,
                         help="i3X base URL, e.g. https://api.i3x.dev/v1")
    p_check.set_defaults(func=_cmd_i3x_check)

    p_rec = sub.add_parser("i3x-reconcile",
                           help="Check a report's proposed namespace against a live i3X server. [network]")
    p_rec.add_argument("report", help="A *.report.json produced by `analyze`.")
    p_rec.add_argument("--server", required=True, help="i3X base URL.")
    p_rec.add_argument("--enterprise", help="Override the enterprise namespace level.")
    p_rec.add_argument("--site", help="Override the site level.")
    p_rec.add_argument("--area", help="Override the area level.")
    p_rec.add_argument("--line", help="Override the line level.")
    p_rec.set_defaults(func=_cmd_i3x_reconcile)
    return parser


def main(argv: list[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    return ns.func(ns)


if __name__ == "__main__":
    raise SystemExit(main())
