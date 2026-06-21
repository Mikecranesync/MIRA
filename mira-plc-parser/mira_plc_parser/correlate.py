"""Correlate multiple exports about ONE asset into a single knowledge graph (asset-graph@1).

The PLC program is one source among several. A real asset's knowledge is split across files, and no
single file is complete -- especially for Allen-Bradley CCW, where the `.st` carries logic + variable
NAMES (no types, no VAR block) while the Controller-Variables CSV carries types/comments and the
Modbus map CSV carries addresses (see the ccw-no-var-block fact). This module fuses them:

  * run every source through the normal detect -> parse -> analyze pipeline,
  * fuse Signals by variable name -- type / address / scope / description / role filled from whichever
    source has them, with per-field provenance and a completeness flag,
  * lift the control logic into Signal --DependsOn--> Signal edges (from the IR rungs),
  * carry Components (asset candidates) and Fault Events, all hung off one Asset.

The result is a vendor-neutral graph (nodes + edges) for the asset, plus a fusion summary that shows
how cross-file correlation fills gaps no single export could. Read-only, stdlib-only.
"""
from __future__ import annotations

from . import roles as _roles
from .i3x import _eid, _severity, _slug
from .pipeline import run

ASSET_GRAPH_SCHEMA = "mira-plc-parser/asset-graph@1"


def correlate(sources, asset_name=None, namespace_root="plc"):
    """Fuse `sources` (list of (filename, text)) about one asset into a knowledge graph (dict).

    `asset_name` defaults to the first parsed controller name. `namespace_root` roots the proposed
    ISA-95 namespace (not a canonical UNS path -- that is assigned engine-side).
    """
    results = [(fn, run(fn, text)) for fn, text in sources]
    handled = [(fn, r) for fn, r in results if r.handled]

    if not asset_name:
        asset_name = next((r.report.controller for _fn, r in handled if r.report.controller), "asset")
    asset_ns = "%s.%s" % (_slug(namespace_root), _slug(asset_name))
    asset_eid = _eid(asset_ns)

    signals = _fuse_signals(handled, asset_ns)
    components = _union_components(handled)
    events = _union_events(handled)
    depends = _dependency_edges(handled, set(signals))

    nodes = [{
        "id": asset_eid, "type": "Asset", "name": asset_name, "namespace": asset_ns,
        "attributes": {"vendors": sorted({r.report.vendor for _f, r in handled if r.report.vendor})},
    }]
    edges = []

    for name in sorted(components):
        ns = "%s.%s" % (asset_ns, _slug(name))
        nid = _eid(ns)
        nodes.append({"id": nid, "type": "Component", "name": name, "namespace": ns,
                      "attributes": {"detail": components[name]["detail"]},
                      "sources": components[name]["sources"]})
        edges.append({"type": "HAS_COMPONENT", "from": asset_eid, "to": nid})

    registers = {}  # address -> register node id (Modbus registers as first-class graph nodes)
    for name in sorted(signals):
        s = signals[name]
        ns = "%s.%s" % (asset_ns, _slug(name))
        nid = s["id"]
        categories = _roles.categorize(name, s["description"])
        nodes.append({
            "id": nid, "type": "Signal", "name": name, "namespace": ns,
            "attributes": {
                "data_type": s["data_type"], "address": s["address"], "scope": s["scope"],
                "roles": sorted(s["roles"]), "vfd_role": s["vfd_role"],
                "description": s["description"], "used_count": s["used_count"],
            },
            "categories": categories,
            "review": _roles.needs_review(categories),
            "status": s["status"],
            "confidence": s["confidence"],
            "conflicts": s["conflicts"],
            "provenance": {"name_from": s["sources"], "type_from": s["type_sources"],
                           "address_from": s["addr_sources"]},
        })
        edges.append({"type": "HAS_SIGNAL", "from": asset_eid, "to": nid})
        if s["address"]:
            rid = registers.get(s["address"])
            if rid is None:
                rid = _eid("%s.modbus.%s" % (asset_ns, _slug(s["address"])))
                registers[s["address"]] = rid
            edges.append({"type": "MAPPED_TO", "from": nid, "to": rid})

    for address in sorted(registers):
        nodes.append({"id": registers[address], "type": "Register",
                      "name": address, "namespace": "%s.modbus.%s" % (asset_ns, _slug(address)),
                      "attributes": {"address": address}})

    for ev in events:
        ns = "%s.event.%s.%s" % (asset_ns, ev["kind"], _slug(ev["name"]))
        nid = _eid(ns)
        nodes.append({"id": nid, "type": "Event", "name": ev["name"], "namespace": ns,
                      "severity": _severity(ev["confidence"]),
                      "attributes": {"kind": ev["kind"], "detail": ev["detail"]}})
        target = signals[ev["name"]]["id"] if ev["name"] in signals else asset_eid
        edges.append({"type": "RELATES_TO", "from": nid, "to": target})

    for out, ref in depends:
        edges.append({"type": "DEPENDS_ON", "from": signals[out]["id"], "to": signals[ref]["id"]})

    return {
        "schema": ASSET_GRAPH_SCHEMA,
        "asset": {"name": asset_name, "namespace": asset_ns, "element_id": asset_eid},
        "sources": [{"file": fn, "fmt": r.detection.fmt, "handled": r.handled,
                     "tags": (r.report.counts.get("tags", 0) if r.handled else 0),
                     "warnings": list(r.project.warnings)} for fn, r in results],
        "nodes": nodes,
        "edges": edges,
        "counts": _count_types(nodes, edges),
        "fusion": _fusion_summary(signals),
    }


def _fuse_signals(handled, asset_ns):
    """Merge tag dictionaries across sources by name. First non-empty wins per field; roles union.

    Disagreement is NOT silently overwritten: distinct non-empty values for data_type/address are
    collected per source so a conflict can be flagged. Each field gets a confidence label
    (exact / inferred / name_only / missing / conflict) so every value is auditable.
    """
    merged = {}
    for fn, r in handled:
        vfd_role = {f.name: f.detail for f in r.report.vfd_signal_candidates}
        for t in r.report.tag_dictionary:
            name = t["name"]
            m = merged.get(name)
            if m is None:
                m = {"data_type": "", "address": "", "scope": "", "description": "",
                     "roles": set(), "vfd_role": "", "used_count": 0,
                     "sources": [], "type_sources": [], "addr_sources": [],
                     "type_values": {}, "addr_values": {}}
                merged[name] = m
            m["sources"].append(fn)
            dt = t.get("data_type")
            if dt:
                m["type_sources"].append(fn)
                m["type_values"].setdefault(dt, []).append(fn)
                m["data_type"] = m["data_type"] or dt
            addr = t.get("address")
            if addr:
                m["addr_sources"].append(fn)
                m["addr_values"].setdefault(addr, []).append(fn)
                m["address"] = m["address"] or addr
            m["scope"] = m["scope"] or t.get("scope", "")
            m["description"] = m["description"] or t.get("description", "")
            m["roles"].update(t.get("roles") or [])
            m["vfd_role"] = m["vfd_role"] or vfd_role.get(name, "")
            m["used_count"] = max(m["used_count"], t.get("used_count", 0))
    for name, m in merged.items():
        # asset-SCOPED id: two assets that both have e.g. "motor_run" must NOT collapse to one node
        # when several asset graphs are combined (multi-asset folders).
        m["id"] = _eid("%s.signal.%s" % (asset_ns, name))
        # conflict = a genuine disagreement, not just spelling: compare data types case-insensitively
        # (WORD vs Word is not a conflict) and addresses trimmed. Only distinct *meanings* flag.
        type_conflict = len({v.strip().upper() for v in m["type_values"]}) > 1
        addr_conflict = len({v.strip() for v in m["addr_values"]}) > 1
        m["confidence"] = {
            "name": "exact",
            "data_type": "conflict" if type_conflict else ("exact" if m["data_type"] else "missing"),
            "address": "conflict" if addr_conflict else ("exact" if m["address"] else "missing"),
            "role": "inferred" if (m["roles"] or m["vfd_role"]) else "missing",
        }
        # signal-level status: a real declaration gives a type; logic-only (CCW .st) is name_only
        m["status"] = ("resolved" if (m["data_type"] and m["address"])
                       else "partial" if (m["data_type"] or m["address"]) else "name_only")
        m["conflicts"] = []
        if type_conflict:
            m["conflicts"].append({"field": "data_type", "values": dict(m["type_values"])})
        if addr_conflict:
            m["conflicts"].append({"field": "address", "values": dict(m["addr_values"])})
    return merged


def _union_components(handled):
    comps = {}
    for fn, r in handled:
        for f in r.report.asset_candidates:
            c = comps.setdefault(f.name, {"detail": f.detail, "sources": []})
            if fn not in c["sources"]:
                c["sources"].append(fn)
    return comps


def _union_events(handled):
    seen, events = set(), []
    for _fn, r in handled:
        for f in list(r.report.fault_candidates) + list(r.report.review_required):
            key = (f.name, f.kind)
            if key in seen:
                continue
            seen.add(key)
            events.append({"name": f.name, "kind": f.kind, "detail": f.detail,
                           "confidence": f.confidence})
    return events


def _dependency_edges(handled, known):
    """Signal -> DependsOn -> Signal from the IR rungs (output depends on each condition ref).

    Both ends must be known signals; pairs are deduped. This is what turns a flat tag list into a
    graph: the conveyor's control logic ("MotorRun depends on EStopOK, AutoMode, ...")."""
    pairs = set()
    for _fn, r in handled:
        for _prog, _routine, rung in r.project.all_rungs():
            outs = {o.split(".")[0].split("[")[0] for o in rung.outputs}
            refs = {x.split(".")[0].split("[")[0] for x in rung.refs}
            for out in outs:
                if out not in known:
                    continue
                for ref in refs:
                    if ref != out and ref in known:
                        pairs.add((out, ref))
    return sorted(pairs)


def _count_types(nodes, edges):
    nt, et = {}, {}
    for n in nodes:
        nt[n["type"]] = nt.get(n["type"], 0) + 1
    for e in edges:
        et[e["type"]] = et.get(e["type"], 0) + 1
    return {"nodes": nt, "edges": et}


def _fusion_summary(signals):
    total = len(signals)
    typed = sum(1 for s in signals.values() if s["data_type"])
    addressed = sum(1 for s in signals.values() if s["address"])
    multi = sum(1 for s in signals.values() if len(set(s["sources"])) > 1)
    # the headline win: a signal whose NAME appeared in a source that gave NO type, with the type
    # supplied by a DIFFERENT source (i.e. cross-file fusion actually filled a gap).
    type_filled = sum(1 for s in signals.values()
                      if s["data_type"] and set(s["sources"]) - set(s["type_sources"]))
    conflicts = sum(1 for s in signals.values() if s["conflicts"])
    return {"signals": total, "typed": typed, "name_only": total - typed,
            "addressed": addressed, "multi_source": multi, "type_filled_by_fusion": type_filled,
            "conflicts": conflicts}
