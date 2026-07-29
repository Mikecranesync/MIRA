"""Deterministic multi-sheet system-graph builder. NO LLM, NO network.

Builds one persistent, cited system-level graph from a *sheet index*: a
manifest of the book's sheets, each carrying the devices and cross-sheet
references extracted for that page (today hand-authored or adapter-fed from
per-page ``graph.json`` runs; every entry carries an evidence code).

Honesty is structural, not advisory:

- A sheet whose ``quality`` is ``missing`` or ``blurred`` contributes ZERO
  observed facts. Any ``ev:"obs"`` entry on such a sheet is recorded as a
  ``phantom_observation`` violation and excluded from the graph. ``ev:"inf"``
  entries are the honest way to record expectations about such sheets and are
  admitted, permanently marked as inference.
- A cross-reference whose peer sheet is missing/blurred classifies as
  ``unverifiable`` — never silently ``resolved``.
- A cross-reference whose peer sheet is not in the book at all is
  ``dangling``; a peer outside the book (``EXT:<assembly>``) is ``external``.

Index shape (see tests/printsense/test_systemgraph.py for a worked example)::

    {"sheets": [{"sheet": "21", "quality": "clear_upright",
                 "devices": [{"tag": "-21/K01", "kind": "pilot_relay", "ev": "obs"}],
                 "xrefs":   [{"sig": "U01.6", "dir": "out", "peer": "S22.0",
                              "ev": "obs"}]}, ...]}

``peer`` grammar: ``S<sheet>[.<col>]`` for in-book targets, ``EXT:<name>``
for other assemblies. Column digits are advisory (rotated-photo captures make
them low-confidence); classification is sheet-level.
"""

from __future__ import annotations

import re

from .grader import _norm

QUALITY_OBSERVABLE = {"clear_upright", "clear_rotated"}
QUALITY_UNOBSERVABLE = {"blurred", "missing"}

_PREFIX = re.compile(r"^[+-](\d+[a-z]?)/", re.IGNORECASE)


def _sheet_of_peer(peer: str) -> str | None:
    """'S21.7' -> '21'; 'S18a.2' -> '18a'; 'S22' -> '22'; anything else -> None."""
    if not peer or not peer.startswith("S"):
        return None
    body = peer[1:].split(".", 1)[0].strip().lower()
    return body or None


def _tag_prefix_sheet(tag: str) -> str | None:
    """'-21/K01' -> '21' (EPLAN device-tag prefix = host sheet convention)."""
    m = _PREFIX.match(str(tag).strip())
    return m.group(1).lower() if m else None


def _head(tag: str) -> str:
    """Strip a ':port' suffix — mirrors verify._head without importing the
    verify module (which pulls the interpreter chain)."""
    return str(tag).split(":")[0]


def build_system_graph(index: dict) -> dict:
    """Fold a sheet index into one system graph with per-edge provenance.

    Returns ``{"devices", "edges", "violations", "contradictions", "summary"}``
    — every edge carries its source sheet (``src``), evidence kind (``ev``)
    and classification (``cls`` in resolved|unverifiable|dangling|external).
    ``contradictions`` are typed (alias_variation, kind_mismatch,
    terminal_conflict, contact_semantic_conflict, impossible_continuity),
    each carrying ``safety: True`` when its subject is listed in the index's
    optional ``safety_critical`` list.
    """
    sheets = index.get("sheets", [])
    quality = {str(s["sheet"]).lower(): s.get("quality", "clear_upright") for s in sheets}
    known = set(quality)

    devices: dict[str, dict] = {}
    edges: list[dict] = []
    violations: list[dict] = []

    for s in sheets:
        sid = str(s["sheet"]).lower()
        observable = quality[sid] in QUALITY_OBSERVABLE

        for d in s.get("devices", []):
            ev = d.get("ev", "obs")
            if ev == "obs" and not observable:
                violations.append(
                    {"code": "phantom_observation", "sheet": sid, "item": d["tag"]}
                )
                continue
            key = _norm(d["tag"])
            node = devices.setdefault(
                key,
                {"tag": d["tag"], "kinds": set(), "sheets": set(), "ev": ev,
                 "first_sheet": sid},
            )
            node["kinds"].add(str(d.get("kind", "")).strip())
            node["sheets"].add(sid)

        for x in s.get("xrefs", []):
            ev = x.get("ev", "obs")
            if ev == "obs" and not observable:
                violations.append(
                    {"code": "phantom_observation", "sheet": sid, "item": x["sig"]}
                )
                continue
            peer = str(x.get("peer", ""))
            if peer.startswith("EXT:"):
                cls, dst = "external", None
            else:
                dst = _sheet_of_peer(peer)
                if dst is None or dst not in known:
                    cls = "dangling"
                elif quality[dst] in QUALITY_UNOBSERVABLE:
                    cls = "unverifiable"
                else:
                    cls = "resolved"
            edges.append(
                {"sig": x["sig"], "src": sid, "dst": dst, "peer": peer,
                 "dir": x.get("dir", ""), "cls": cls, "ev": ev}
            )

    # advisory reciprocity: a resolved edge whose peer sheet also names the signal
    sigs_by_sheet: dict[str, set[str]] = {}
    for e in edges:
        sigs_by_sheet.setdefault(e["src"], set()).add(_norm(e["sig"]))
    for e in edges:
        if e["cls"] == "resolved":
            e["reciprocal"] = _norm(e["sig"]) in sigs_by_sheet.get(e["dst"], set())

    safety_set = {_norm(s) for s in index.get("safety_critical", [])}

    def _is_safety(*subjects: str) -> bool:
        return any(_norm(_head(s)) in safety_set or _norm(s) in safety_set
                   for s in subjects if s)

    contradictions: list[dict] = []

    for node in devices.values():
        # EPLAN convention: the tag prefix names the device's HOME sheet.
        # Cross-sheet appearances (aux contacts, references) are legitimate —
        # the violation is a device that never appears on its home sheet.
        prefix = _tag_prefix_sheet(node["tag"])
        if prefix and prefix not in node["sheets"]:
            violations.append(
                {"code": "prefix_mismatch", "sheet": node["first_sheet"],
                 "item": node["tag"], "expected_sheet": prefix,
                 "seen_on": sorted(node["sheets"])}
            )
        kinds = {k for k in node["kinds"] if k}
        if len(kinds) > 1:
            violations.append(
                {"code": "duplicate_conflict", "item": node["tag"],
                 "kinds": sorted(kinds)}
            )
            contradictions.append(
                {"type": "kind_mismatch", "item": node["tag"],
                 "kinds": sorted(kinds), "sheets": sorted(node["sheets"]),
                 "safety": _is_safety(node["tag"])}
            )

    # alias_variation: same device identity (head-normalized, sign-insensitive)
    # written in more than one raw form across the book.
    alias_forms: dict[str, dict] = {}
    for node in devices.values():
        key = _norm(_head(node["tag"])).lstrip("+-")
        slot = alias_forms.setdefault(key, {"forms": set(), "sheets": set()})
        slot["forms"].add(node["tag"])
        slot["sheets"] |= node["sheets"]
    for key, slot in alias_forms.items():
        if len(slot["forms"]) > 1:
            contradictions.append(
                {"type": "alias_variation", "key": key,
                 "forms": sorted(slot["forms"]),
                 "sheets": sorted(slot["sheets"]),
                 "safety": _is_safety(*slot["forms"])}
            )

    # terminal_conflict: the same (device:terminal) claimed toward different
    # peer sheets. NOTE: a deliberately bussed/jumpered terminal is a known
    # legitimate pattern — this is a review queue, not an auto-verdict.
    terminals: dict[str, dict] = {}
    for s in sheets:
        sid = str(s["sheet"]).lower()
        if quality[sid] in QUALITY_UNOBSERVABLE:
            continue
        for x in s.get("xrefs", []):
            term = x.get("terminal")
            if not term:
                continue
            dst = None if str(x.get("peer", "")).startswith("EXT:") \
                else _sheet_of_peer(str(x.get("peer", "")))
            slot = terminals.setdefault(
                _norm(term), {"raw": term, "peers": set(), "sheets": set()})
            slot["sheets"].add(sid)
            if dst:
                slot["peers"].add(dst)
    for slot in terminals.values():
        if len(slot["peers"]) > 1:
            contradictions.append(
                {"type": "terminal_conflict", "terminal": slot["raw"],
                 "peer_sheets": sorted(slot["peers"]),
                 "sheets": sorted(slot["sheets"]),
                 "safety": _is_safety(slot["raw"])}
            )

    # contact_semantic_conflict: one chain designation, two contact forms.
    chains: dict[str, dict] = {}
    for s in sheets:
        sid = str(s["sheet"]).lower()
        for c in s.get("contact_chains", []):
            slot = chains.setdefault(
                str(c.get("chain")), {"forms": set(), "sheets": set()})
            slot["forms"].add(str(c.get("form", "")))
            slot["sheets"].add(sid)
    for chain, slot in chains.items():
        forms = {f for f in slot["forms"] if f}
        if len(forms) > 1:
            # NO/NC meaning on a feedback/interlock chain is inherently
            # safety-relevant — always escalated, never allowlist-gated.
            contradictions.append(
                {"type": "contact_semantic_conflict", "chain": chain,
                 "forms": sorted(forms), "sheets": sorted(slot["sheets"]),
                 "safety": True}
            )

    # impossible_continuity: both endpoints drive the same signal OUT at each
    # other. NOTE: multi-drop buses / wired-OR loops can false-positive; the
    # entry is evidence for review, not a verdict.
    outs = {(_norm(e["sig"]), e["src"], e["dst"])
            for e in edges if e.get("dir") == "out" and e["dst"]}
    seen_pairs: set[tuple] = set()
    for sig, src, dst in outs:
        if (sig, dst, src) in outs:
            pair = (sig, *sorted((src, dst)))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            raw_sig = next(e["sig"] for e in edges
                           if _norm(e["sig"]) == sig and e["src"] in pair)
            # a phantom always-driven signal is inherently safety-relevant
            contradictions.append(
                {"type": "impossible_continuity", "sig": raw_sig,
                 "sheets": sorted((src, dst)), "safety": True}
            )

    by_class = {"resolved": 0, "unverifiable": 0, "dangling": 0, "external": 0}
    for e in edges:
        by_class[e["cls"]] += 1

    device_rows = [
        {"tag": n["tag"], "kinds": sorted(k for k in n["kinds"] if k),
         "sheets": sorted(n["sheets"]), "ev": n["ev"]}
        for n in devices.values()
    ]

    return {
        "devices": device_rows,
        "edges": edges,
        "violations": violations,
        "contradictions": contradictions,
        "summary": {
            "sheets": len(sheets),
            "observable_sheets": sum(
                1 for q in quality.values() if q in QUALITY_OBSERVABLE
            ),
            "devices": len(device_rows),
            "edges_by_class": by_class,
            "violations": len(violations),
            "contradictions": len(contradictions),
        },
    }
