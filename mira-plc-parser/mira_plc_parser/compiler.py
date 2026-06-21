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

from .correlate import ASSET_GRAPH_SCHEMA, correlate
from .discovery import scan


def compile_folder(folder, asset_name=None, namespace_root="plc", asset_by="folder"):
    """Discover -> parse -> fuse a folder of exports into a (possibly multi-asset) graph.

    A folder may hold more than one machine. Files are partitioned into assets (default: by
    subfolder), each group is fused INDEPENDENTLY (so two machines that both have `motor_run` never
    collapse), and the per-asset graphs are combined. A flat single-asset folder behaves as before.

    Returns (graph, items): the combined asset-graph dict and the raw discovery items.
    """
    items = scan(folder)
    parseable = [it for it in items if it["classification"] == "parseable"]
    groups = _partition(parseable, asset_by)
    multi = len(groups) > 1
    graphs = []
    for key in sorted(groups):
        sources = [(it["name"], it["text"]) for it in groups[key]]
        graphs.append(correlate(sources, asset_name=_group_asset_name(key, asset_name, multi),
                                namespace_root=namespace_root))
    return _combine(graphs, items), items


def _partition(items, mode) -> dict:
    """Group parseable items into assets. mode 'folder' (default) groups by subdirectory; 'file'
    makes each file its own asset."""
    groups: dict[str, list] = {}
    for it in items:
        if mode == "file":
            key = it["rel"]
        else:
            parent = str(Path(it["rel"]).parent)
            key = "" if parent == "." else parent
        groups.setdefault(key, []).append(it)
    return groups or {"": []}


def _group_asset_name(key, asset_name, multi):
    """Per-group asset name: a subfolder's basename when splitting a multi-asset folder; otherwise
    the caller's --asset (or None, letting correlate use the parsed controller name)."""
    if not multi:
        return asset_name
    return (Path(key).name if key else "") or asset_name or None


def _combine(graphs, items) -> dict:
    nodes, edges, assets, sources = [], [], [], []
    for g in graphs:
        aname = g["asset"]["name"]
        for n in g["nodes"]:
            n["asset"] = aname
            nodes.append(n)
        edges.extend(g["edges"])
        sources.extend(g["sources"])
        assets.append({"name": aname, "namespace": g["asset"]["namespace"],
                       "element_id": g["asset"]["element_id"],
                       "counts": g["counts"], "fusion": g["fusion"]})
    return {"schema": ASSET_GRAPH_SCHEMA, "assets": assets, "sources": sources,
            "nodes": nodes, "edges": edges, "counts": _counts(nodes, edges),
            "fusion": _aggregate_fusion(graphs), "discovery": _discovery_summary(items)}


def _counts(nodes, edges) -> dict:
    nt, et = {}, {}
    for n in nodes:
        nt[n["type"]] = nt.get(n["type"], 0) + 1
    for e in edges:
        et[e["type"]] = et.get(e["type"], 0) + 1
    return {"nodes": nt, "edges": et}


def _aggregate_fusion(graphs) -> dict:
    keys = ("signals", "typed", "name_only", "addressed", "multi_source",
            "type_filled_by_fusion", "conflicts")
    agg = {k: 0 for k in keys}
    for g in graphs:
        for k in keys:
            agg[k] += g["fusion"].get(k, 0)
    return agg


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
    rows = [("asset", "name", "status", "data_type", "data_type_confidence", "address",
             "address_confidence", "scope", "categories", "roles", "vfd_role", "review",
             "name_from", "type_from", "address_from", "description")]
    for n in graph["nodes"]:
        if n["type"] != "Signal":
            continue
        a, c, p = n["attributes"], n["confidence"], n["provenance"]
        rows.append((
            n.get("asset", ""), n["name"], n["status"], a["data_type"], c["data_type"],
            a["address"], c["address"], a["scope"], "|".join(n["categories"]), "|".join(a["roles"]),
            a["vfd_role"], "yes" if n["review"] else "", "|".join(sorted(set(p["name_from"]))),
            "|".join(sorted(set(p["type_from"]))), "|".join(sorted(set(p["address_from"]))),
            a["description"],
        ))
    return rows


def registers_rows(graph):
    idx = _node_index(graph)
    mapped: dict[tuple, list[str]] = {}
    for e in graph["edges"]:
        if e["type"] == "MAPPED_TO":
            reg, sig = idx[e["to"]], idx[e["from"]]
            mapped.setdefault((reg.get("asset", ""), reg["name"]), []).append(sig["name"])
    rows = [("asset", "address", "signal_count", "signals")]
    for (asset, address) in sorted(mapped):
        sigs = sorted(mapped[(asset, address)])
        rows.append((asset, address, str(len(sigs)), "|".join(sigs)))
    return rows


def edges_rows(graph):
    idx = _node_index(graph)
    rows = [("asset", "type", "from_type", "from_name", "to_type", "to_name")]
    out = []
    for e in graph["edges"]:
        f, t = idx.get(e["from"]), idx.get(e["to"])
        if f and t:
            out.append((f.get("asset", ""), e["type"], f["type"], f["name"], t["type"], t["name"]))
    rows.extend(sorted(out))
    return rows


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)


# ---- report ----

def report_md(graph) -> str:
    fz = graph["fusion"]
    disc = graph["discovery"]
    assets = graph["assets"]
    nc, ec = graph["counts"]["nodes"], graph["counts"]["edges"]
    L = ["# PLC Asset Compiler report", ""]
    L.append("**%d asset(s):** %s" % (len(assets), ", ".join("`%s`" % a["name"] for a in assets)))
    L.append("")
    L.append("Deterministic offline compile -- no LLM, no cloud, no live PLC. Values (VQT) are NOT "
             "sampled here; live attachment happens later (mira-relay / mira-connect).")
    L.append("")

    L.append("## Overview")
    L.append("")
    L.append("- **%d** signals — %d typed, %d addressed, %d typed-by-cross-file-fusion, "
             "%d name-only, **%d conflicts**" % (fz["signals"], fz["typed"], fz["addressed"],
             fz["type_filled_by_fusion"], fz["name_only"], fz["conflicts"]))
    L.append("- Graph: %d nodes (%s); %d edges (%s)" % (
        sum(nc.values()), ", ".join("%d %s" % (v, k) for k, v in sorted(nc.items())),
        sum(ec.values()), ", ".join("%d %s" % (v, k) for k, v in sorted(ec.items()))))
    L.append("")
    L.append("| file | classification | format |")
    L.append("|---|---|---|")
    for cls, files in disc["files"].items():
        for f in files:
            L.append("| `%s` | %s | %s |" % (f["file"], cls, f["fmt"]))
    L.append("")

    signals = [n for n in graph["nodes"] if n["type"] == "Signal"]
    for a in assets:
        aname = a["name"]
        af = a["fusion"]
        asigs = [n for n in signals if n.get("asset") == aname]
        L.append("## Asset: `%s`  (namespace `%s`)" % (aname, a["namespace"]))
        L.append("")
        L.append("%d signals — %d typed, %d addressed, %d conflicts." % (
            af["signals"], af["typed"], af["addressed"], af["conflicts"]))
        L.append("")
        review = [n for n in asigs if n["review"]]
        L.append("**Needs human review (%d safety / fault / control):**" % len(review))
        L.append("")
        if review:
            L.append("| signal | categories | type | address | confidence |")
            L.append("|---|---|---|---|---|")
            for n in review:
                at, c = n["attributes"], n["confidence"]
                L.append("| `%s` | %s | %s | %s | type:%s addr:%s |" % (
                    n["name"], ", ".join(n["categories"]), at["data_type"] or "?",
                    at["address"] or "-", c["data_type"], c["address"]))
        else:
            L.append("_None flagged._")
        L.append("")
        conflicts = [n for n in asigs if n["conflicts"]]
        if conflicts:
            L.append("**Conflicts (sources disagree, NOT silently overwritten):**")
            L.append("")
            for n in conflicts:
                for cf in n["conflicts"]:
                    vals = "; ".join("%s (%s)" % (v, ",".join(s)) for v, s in cf["values"].items())
                    L.append("- `%s` **%s**: %s" % (n["name"], cf["field"], vals))
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
             "**conflict** (sources disagree). `signals.csv` carries the per-field source(s) and the "
             "owning asset.")
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
