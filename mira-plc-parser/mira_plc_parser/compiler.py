"""Offline PLC Asset Compiler -- point at a folder of messy customer PLC/SCADA exports and emit a
reviewed asset model. Deterministic, offline, no LLM, no cloud, no live PLC, no input mutation.

Pipeline (all existing pieces, wired together):
    discover (discovery.scan)  ->  parse (pipeline.run per file)  ->  normalize (ir)
    ->  fuse by signal name (correlate)  ->  provenance + confidence + conflicts  ->  asset graph
    ->  human-review report.   Live VQT attachment happens LATER, elsewhere (mira-relay/mira-connect).

Outputs (written by write_outputs):
    asset_graph.json   the full graph (nodes + edges + fusion + discovery)
    signals.csv        one row per fused signal (type/address/role/confidence/provenance/review)
    registers.csv      one row per Modbus register and the signals mapped to it
    edges.csv          the graph edges (HAS_SIGNAL / MAPPED_TO / DEPENDS_ON / ...)
    compiler_report.md the human-readable review report
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from .correlate import correlate
from .discovery import scan


def compile_folder(folder, asset_name=None, namespace_root="plc"):
    """Discover -> parse -> fuse a folder of exports into one asset graph (augmented with discovery).

    Returns (graph, items): the asset-graph dict and the raw discovery items.
    """
    items = scan(folder)
    parseable = [(it["name"], it["text"]) for it in items if it["classification"] == "parseable"]
    graph = correlate(parseable, asset_name=asset_name, namespace_root=namespace_root)
    graph["discovery"] = _discovery_summary(items)
    return graph, items


def _discovery_summary(items) -> dict:
    by_class: dict[str, list] = {}
    for it in items:
        by_class.setdefault(it["classification"], []).append(
            {"file": it["rel"], "fmt": it["fmt"], "reason": it["reason"],
             "needs_export": it.get("needs_export", "")})
    return {"counts": {k: len(v) for k, v in sorted(by_class.items())},
            "files": {k: v for k, v in sorted(by_class.items())}}


# ---- tabular projections ----

def _node_index(graph):
    return {n["id"]: n for n in graph["nodes"]}


def signals_rows(graph):
    rows = [("name", "status", "data_type", "data_type_confidence", "address", "address_confidence",
             "scope", "categories", "roles", "vfd_role", "review",
             "name_from", "type_from", "address_from", "description")]
    for n in graph["nodes"]:
        if n["type"] != "Signal":
            continue
        a, c, p = n["attributes"], n["confidence"], n["provenance"]
        rows.append((
            n["name"], n["status"], a["data_type"], c["data_type"], a["address"], c["address"],
            a["scope"], "|".join(n["categories"]), "|".join(a["roles"]), a["vfd_role"],
            "yes" if n["review"] else "", "|".join(sorted(set(p["name_from"]))),
            "|".join(sorted(set(p["type_from"]))), "|".join(sorted(set(p["address_from"]))),
            a["description"],
        ))
    return rows


def registers_rows(graph):
    idx = _node_index(graph)
    mapped: dict[str, list[str]] = {}
    for e in graph["edges"]:
        if e["type"] == "MAPPED_TO":
            reg = idx[e["to"]]
            mapped.setdefault(reg["name"], []).append(idx[e["from"]]["name"])
    rows = [("address", "signal_count", "signals")]
    for address in sorted(mapped):
        sigs = sorted(mapped[address])
        rows.append((address, str(len(sigs)), "|".join(sigs)))
    return rows


def edges_rows(graph):
    idx = _node_index(graph)
    rows = [("type", "from_type", "from_name", "to_type", "to_name")]
    out = []
    for e in graph["edges"]:
        f, t = idx.get(e["from"]), idx.get(e["to"])
        if f and t:
            out.append((e["type"], f["type"], f["name"], t["type"], t["name"]))
    rows.extend(sorted(out))
    return rows


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)


# ---- report ----

def report_md(graph) -> str:
    asset = graph["asset"]
    fz = graph["fusion"]
    disc = graph["discovery"]
    L = ["# PLC Asset Compiler report", ""]
    L.append("**Asset:** %s  ·  **namespace:** `%s`" % (asset["name"], asset["namespace"]))
    L.append("")
    L.append("Deterministic offline compile -- no LLM, no cloud, no live PLC. Values (VQT) are NOT "
             "sampled here; live attachment happens later (mira-relay / mira-connect).")
    L.append("")

    L.append("## Sources discovered")
    L.append("")
    L.append("| file | classification | format |")
    L.append("|---|---|---|")
    for cls, files in disc["files"].items():
        for f in files:
            L.append("| `%s` | %s | %s |" % (f["file"], cls, f["fmt"]))
    L.append("")

    L.append("## Fusion summary")
    L.append("")
    L.append("- **%d** signals — %d typed, %d addressed, %d typed-by-cross-file-fusion, "
             "%d name-only, **%d conflicts**" % (fz["signals"], fz["typed"], fz["addressed"],
             fz["type_filled_by_fusion"], fz["name_only"], fz["conflicts"]))
    nc = graph["counts"]["nodes"]
    ec = graph["counts"]["edges"]
    L.append("- Graph: %s nodes (%s); %s edges (%s)" % (
        sum(nc.values()), ", ".join("%d %s" % (v, k) for k, v in sorted(nc.items())),
        sum(ec.values()), ", ".join("%d %s" % (v, k) for k, v in sorted(ec.items()))))
    L.append("")

    review = [n for n in graph["nodes"] if n["type"] == "Signal" and n["review"]]
    L.append("## Needs human review (%d safety / fault / control signals)" % len(review))
    L.append("")
    if review:
        L.append("| signal | categories | type | address | confidence |")
        L.append("|---|---|---|---|---|")
        for n in review:
            a, c = n["attributes"], n["confidence"]
            L.append("| `%s` | %s | %s | %s | type:%s addr:%s |" % (
                n["name"], ", ".join(n["categories"]), a["data_type"] or "?",
                a["address"] or "-", c["data_type"], c["address"]))
    else:
        L.append("_None flagged._")
    L.append("")

    conflicts = [n for n in graph["nodes"] if n["type"] == "Signal" and n["conflicts"]]
    L.append("## Conflicts (%d) — sources disagree, NOT silently overwritten" % len(conflicts))
    L.append("")
    if conflicts:
        for n in conflicts:
            for cf in n["conflicts"]:
                vals = "; ".join("%s (%s)" % (v, ",".join(srcs)) for v, srcs in cf["values"].items())
                L.append("- `%s` **%s**: %s" % (n["name"], cf["field"], vals))
    else:
        L.append("_None._")
    L.append("")

    ignored = disc["files"].get("value_dump", [])
    closed = disc["files"].get("closed_project", [])
    if ignored or closed:
        L.append("## Not compiled")
        L.append("")
        for f in ignored:
            L.append("- `%s` — ignored (runtime value dump, not a tag declaration)" % f["file"])
        for f in closed:
            L.append("- `%s` — closed vendor project; %s" % (f["file"], f["needs_export"]))
        L.append("")

    L.append("## Confidence / provenance")
    L.append("")
    L.append("Every signal field is labelled: **exact** (read from a declaration), **inferred** "
             "(from logic/name), **name_only** (referenced but undeclared), **missing**, or "
             "**conflict** (sources disagree). `signals.csv` carries the per-field source(s).")
    return "\n".join(L)


def write_outputs(graph, out_dir) -> list[str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "asset_graph.json").write_text(json.dumps(graph, indent=2), encoding="utf-8")
    _write_csv(out / "signals.csv", signals_rows(graph))
    _write_csv(out / "registers.csv", registers_rows(graph))
    _write_csv(out / "edges.csv", edges_rows(graph))
    (out / "compiler_report.md").write_text(report_md(graph), encoding="utf-8")
    return ["asset_graph.json", "signals.csv", "registers.csv", "edges.csv", "compiler_report.md"]
