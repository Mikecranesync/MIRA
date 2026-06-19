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
import re
import sys
from pathlib import Path

from . import __version__
from .compiler import compile_folder, write_outputs
from .correlate import correlate
from .i3x import render_i3x
from .pipeline import render_json, render_markdown, run
from .vqt_attach import attach_values, load_snapshot


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


def _cmd_correlate(ns: argparse.Namespace) -> int:
    """Fuse several exports about ONE asset into a single knowledge graph (<asset>.graph.json)."""
    sources = []
    for f in ns.files:
        p = Path(f)
        if not p.is_file():
            print("error: file not found: %s" % p, file=sys.stderr)
            return 1
        sources.append((p.name, _read_text(p)))

    graph = correlate(sources, asset_name=ns.asset, namespace_root=ns.namespace_root)
    out_dir = Path(ns.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / ("%s.graph.json" % _slug_for_file(graph["asset"]["name"]))
    out_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    if not ns.quiet:
        nc, ec = graph["counts"]["nodes"], graph["counts"]["edges"]
        fz = graph["fusion"]
        print("Asset: %s (%s)" % (graph["asset"]["name"], graph["asset"]["namespace"]))
        print("Sources: %d (%d parsed)" % (len(graph["sources"]),
                                           sum(1 for s in graph["sources"] if s["handled"])))
        print("Nodes: %s" % " ".join("%d %s" % (v, k) for k, v in sorted(nc.items())))
        print("Edges: %s" % " ".join("%d %s" % (v, k) for k, v in sorted(ec.items())))
        print("Fusion: %d signals | %d typed | %d typed-by-fusion | %d name-only"
              % (fz["signals"], fz["typed"], fz["type_filled_by_fusion"], fz["name_only"]))
        print("Wrote: %s" % out_path)
    return 0 if any(s["handled"] for s in graph["sources"]) else 1


def _slug_for_file(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").lower() or "asset"


def _cmd_compile(ns: argparse.Namespace) -> int:
    """Compile a FOLDER of PLC/SCADA exports into asset_graph.json + signals/registers/edges + report."""
    folder = Path(ns.folder)
    if not folder.is_dir():
        print("error: not a folder: %s" % folder, file=sys.stderr)
        return 1
    graph, items = compile_folder(folder, asset_name=ns.asset, namespace_root=ns.namespace_root)
    written = write_outputs(graph, ns.out)

    if not ns.quiet:
        disc = graph["discovery"]["counts"]
        fz = graph["fusion"]
        assets = graph["assets"]
        print("Assets: %d (%s)" % (len(assets), ", ".join(a["name"] for a in assets)))
        print("Discovered: %s" % (" ".join("%d %s" % (v, k) for k, v in disc.items()) or "(nothing)"))
        print("Signals: %d (%d typed, %d addressed, %d conflicts) | review: %d"
              % (fz["signals"], fz["typed"], fz["addressed"], fz["conflicts"],
                 sum(1 for n in graph["nodes"] if n["type"] == "Signal" and n["review"])))
        print("Wrote: %s" % ", ".join(written))
        print("  -> %s" % Path(ns.out).resolve())
    # exit 0 if at least one file compiled; else 1 (nothing parseable in the folder)
    return 0 if any(it["classification"] == "parseable" for it in items) else 1


def _cmd_attach(ns: argparse.Namespace) -> int:
    """Attach a values snapshot onto a compiled asset_graph.json -> asset_graph.live.json (VQT)."""
    gpath, spath = Path(ns.graph), Path(ns.snapshot)
    if not gpath.is_file():
        print("error: graph not found: %s" % gpath, file=sys.stderr)
        return 1
    if not spath.is_file():
        print("error: snapshot not found: %s" % spath, file=sys.stderr)
        return 1
    graph = json.loads(gpath.read_text(encoding="utf-8"))
    readings = load_snapshot(_read_text(spath), by=ns.by)
    live = attach_values(graph, readings, as_of=ns.as_of, max_age=ns.max_age, by=ns.by)

    out_dir = Path(ns.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "asset_graph.live.json"
    out_path.write_text(json.dumps(live, indent=2), encoding="utf-8")

    if not ns.quiet:
        s = live["live_summary"]
        print("Readings: %d | attached: %d | unsampled: %d | unmatched: %d"
              % (s["readings"], s["signals_attached"], s["signals_unsampled"],
                 len(s["unmatched_readings"])))
        print("Quality: %s | freshness: %s"
              % (s["quality"] or "(none)", s["freshness"] or "(none)"))
        print("Wrote: %s" % out_path)
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

    p_corr = sub.add_parser("correlate",
                            help="Fuse several exports about ONE asset into a knowledge graph.")
    p_corr.add_argument("files", nargs="+",
                        help="Two or more exports for the same asset (e.g. CCW .st + variables CSV "
                             "+ Modbus map CSV).")
    p_corr.add_argument("--out", default=".", help="Directory for <asset>.graph.json (default: cwd).")
    p_corr.add_argument("--asset", default=None,
                        help="Asset name (default: first parsed controller name).")
    p_corr.add_argument("--namespace-root", default="plc", dest="namespace_root",
                        help="Root for the proposed ISA-95 namespace (default: plc).")
    p_corr.add_argument("--quiet", action="store_true", help="Suppress the stdout summary.")
    p_corr.set_defaults(func=_cmd_correlate)

    p_comp = sub.add_parser("compile",
                            help="Compile a FOLDER of PLC/SCADA exports into an asset model "
                                 "(asset_graph.json + signals/registers/edges.csv + report).")
    p_comp.add_argument("folder", help="Folder of customer exports (scanned recursively, read-only).")
    p_comp.add_argument("--out", default="./out", help="Output directory (default: ./out).")
    p_comp.add_argument("--asset", default=None,
                        help="Asset name (default: first parsed controller name).")
    p_comp.add_argument("--namespace-root", default="plc", dest="namespace_root",
                        help="Root for the proposed ISA-95 namespace (default: plc).")
    p_comp.add_argument("--quiet", action="store_true", help="Suppress the stdout summary.")
    p_comp.set_defaults(func=_cmd_compile)

    p_att = sub.add_parser("attach",
                           help="Attach a values snapshot (address->value) onto a compiled "
                                "asset_graph.json, populating each mapped signal's VQT.")
    p_att.add_argument("graph", help="A compiled asset_graph.json (from `compile`).")
    p_att.add_argument("snapshot", help="Values snapshot CSV/JSON (address,value[,quality,timestamp]).")
    p_att.add_argument("--out", default="./out", help="Output directory (default: ./out).")
    p_att.add_argument("--by", choices=("address", "name"), default="address",
                       help="Bind readings by Modbus address (default) or by signal name.")
    p_att.add_argument("--as-of", default=None, dest="as_of",
                       help="ISO8601 reference time for freshness (default: max snapshot timestamp).")
    p_att.add_argument("--max-age", type=float, default=30.0, dest="max_age",
                       help="Seconds within --as-of that counts as 'current' (default: 30).")
    p_att.add_argument("--quiet", action="store_true", help="Suppress the stdout summary.")
    p_att.set_defaults(func=_cmd_attach)
    return parser


def main(argv: list[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    return ns.func(ns)


if __name__ == "__main__":
    raise SystemExit(main())
