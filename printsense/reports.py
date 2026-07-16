"""Degraded-mode Scout reports — evidence-linked, deterministic (PR-G).

Every row links back to page-level evidence (page_sha, and bbox where the
underlying record carries one). Inputs are the package-pipeline manifest and
per-page stage payloads; no model calls happen here.
"""

from __future__ import annotations

from .modes import package_scout_envelope


def _uf_find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _uf_union(parent, a, b):
    ra, rb = _uf_find(parent, a), _uf_find(parent, b)
    if ra != rb:
        parent[rb] = ra


def build_scout_reports(manifest: dict, page_payloads: dict,
                        xref_records: list[dict]) -> dict:
    """manifest: pipeline manifest; page_payloads: {page_sha: {devices:[{tag,
    bbox?}], sheet_title?, sheet_id?, unreadable?}}; xref_records: resolved
    extractor output."""
    pages = [p for p in manifest.get("pages", [])]
    dup = [{"page_sha": p["page_sha"], "duplicate_of_index": p["duplicate_of"]}
           for p in pages if p.get("duplicate_of") is not None]
    unread, toc, dev_register, page_index = [], [], {}, {}
    for p in pages:
        sha = p["page_sha"]
        pay = page_payloads.get(sha, {})
        if pay.get("unreadable"):
            unread.append({"page_sha": sha, "evidence": "page-level flag"})
        toc.append({"page_sha": sha, "source_index": p.get("source_index"),
                    "sheet_id": pay.get("sheet_id"),
                    "sheet_title": pay.get("sheet_title")})
        for d in pay.get("devices", []):
            tag = d.get("tag")
            if not tag:
                continue
            dev_register.setdefault(tag, []).append(
                {"page_sha": sha, "bbox": d.get("bbox")})
            page_index.setdefault(tag, set()).add(sha)

    resolved = [r for r in xref_records if r.get("resolution") == "resolved"]
    unresolved = [r for r in xref_records
                  if r.get("resolution") in ("ambiguous", "missing_target")]
    contradictions = [r for r in xref_records
                      if r.get("resolution") == "contradictory"]

    # probable subsystem clusters: connected components over resolved edges
    sheet_pages = {t["sheet_id"]: t["page_sha"] for t in toc if t.get("sheet_id")}
    parent = {sha: sha for sha in sheet_pages.values()}
    for r in resolved:
        src = sheet_pages.get(str(r.get("source_page")))
        dst = r.get("target_page")
        if src in parent and dst in parent:
            _uf_union(parent, src, dst)
    clusters: dict = {}
    for sha in parent:
        clusters.setdefault(_uf_find(parent, sha), []).append(sha)

    # missing pages: sheets referenced by xrefs but absent from the package
    known = set(sheet_pages)
    missing = sorted({str(r.get("target_sheet_lexical"))
                      for r in xref_records
                      if r.get("resolution") == "missing_target"
                      and r.get("target_sheet_lexical")} - known)

    inventory = {
        "table_of_contents": toc,
        "device_register": {t: v for t, v in sorted(dev_register.items())},
        "page_device_index": {t: sorted(v) for t, v in sorted(page_index.items())},
        "missing_page_report": [{"sheet_id": s, "evidence":
                                 "referenced by extracted xref"} for s in missing],
        "duplicate_page_report": dup,
        "unreadable_page_report": unread,
        "subsystem_clusters": [sorted(v) for _, v in sorted(clusters.items())],
        "xref_report": {"resolved": resolved, "unresolved": unresolved},
        "contradiction_report": contradictions,
    }
    return package_scout_envelope(inventory)
