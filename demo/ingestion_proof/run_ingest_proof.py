"""Stranger-factory ingestion proof.

Stage A (REAL code): load a foreign Ignition/MES tag export the system has never seen and was not tuned
for, and run the actual factory_context pipeline (iie.load -> build_model) to produce a structured UNS
namespace: entities, live signals (with inferred archetypes), and inferred relationships — each with a
confidence band and an approval status. Nothing is auto-approved.

Stage B (faithful port of the committed Hub TS): map that FactoryModel into the Hub approval queue exactly
as mira-hub/src/lib/factory-model-proposals.ts (PR-1) and factory-model-relationships.ts (PR-2) do —
kg_entity + tag_mapping ai_suggestions, and UPSTREAM_OF / HAS_COMPONENT / HAS_SIGNAL relationship_proposals.
Ported to Python here only because the Hub's bun toolchain isn't installed locally; the transform is pure.

    python demo/ingestion_proof/run_ingest_proof.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
for _p in (str(ROOT / "factory_context"), str(ROOT / "discovery_corpus" / "scripts"),
           str(ROOT / "mira-plc-parser")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import build as build_mod  # noqa: E402  (factory_context/build.py — REAL)
import interrogate_ignition_export as iie  # noqa: E402  (REAL loader/classifier)

EXPORT = HERE / "stranger_water_plant_export.json"

# --- faithful ports of the committed Hub transforms (pure functions) ----------------------------
BAND_TO_CONFIDENCE = {"high": 0.85, "medium": 0.6, "low": 0.35, "review": 0.3}
ARCHETYPE_TO_DATA_TYPE = {"live_bool": "BOOL", "live_counter": "DINT", "live_state": "STRING", "live_analog": "REAL"}
SPINE_REL_TO_CANONICAL = {"feeds": "UPSTREAM_OF", "contains": "HAS_COMPONENT"}


def pr1_suggestions(model) -> dict:
    """factory-model-proposals.ts: assets -> kg_entity, signals -> tag_mapping (skip empty-uns), unknown -> needs_review."""
    kg_entity, tag_mapping, needs_review = [], [], 0
    for n in model.entities():
        if n.level == "asset":
            kg_entity.append({"name": n.name, "uns": n.uns_path, "status": n.suggestion.status})
    for n in model.signals():
        if not n.uns_path:
            continue  # static-metadata signal, no UNS -> skipped (as PR-1 does)
        status = "needs_review" if n.archetype == "unknown" else "pending"
        if status == "needs_review":
            needs_review += 1
        tag_mapping.append({"name": n.name, "uns": n.uns_path, "archetype": n.archetype,
                            "data_type": ARCHETYPE_TO_DATA_TYPE.get(n.archetype, "UNKNOWN"), "status": status})
    return {"kg_entity": kg_entity, "tag_mapping": tag_mapping, "needs_review": needs_review}


def pr2_relationship_specs(model) -> list:
    """factory-model-relationships.ts: feeds->UPSTREAM_OF, contains->HAS_COMPONENT, + derived asset->signal HAS_SIGNAL."""
    out = []
    for r in model.relationships:
        canon = SPINE_REL_TO_CANONICAL.get(r.rel_type)
        if canon and r.source_path and r.target_path and r.source_path != r.target_path:
            out.append({"type": canon, "src": r.source_path, "tgt": r.target_path})
    assets = [n.uns_path for n in model.entities() if n.level == "asset" and n.uns_path]
    by_len = sorted(assets, key=len, reverse=True)
    for n in model.signals():
        if not n.uns_path:
            continue
        asset = next((a for a in by_len if n.uns_path == a or n.uns_path.startswith(a + ".")), None)
        if asset and asset != n.uns_path:
            out.append({"type": "HAS_SIGNAL", "src": asset, "tgt": n.uns_path})
    return out


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    print("== STRANGER-FACTORY INGESTION PROOF ==")
    print(f"input: {EXPORT.relative_to(ROOT)}  (a water-treatment plant — NOT bottling, NOT Conv_Simple)\n")

    # Stage A — REAL structuring
    project = iie.load(EXPORT)
    model = build_mod.build_model(project, "demo/ingestion_proof/stranger_water_plant_export.json")
    c = model.counts()

    print("STAGE A — structured by the real factory_context code")
    print(f"  hierarchy: enterprise={c['enterprise']} site={c['site']} area={c['area']} "
          f"line={c['line']} asset={c['asset']} cell(proposed)={c['cell']}")
    print("\n  UNS namespace (entities):")
    for n in model.entities():
        print(f"    [{n.level:10}] {n.uns_path or '(no path)':60} {n.suggestion.confidence:<7} {n.suggestion.status}")

    sigs = [n for n in model.signals() if n.uns_path]
    arche = {}
    for n in sigs:
        arche[n.archetype] = arche.get(n.archetype, 0) + 1
    print(f"\n  live signals: {len(sigs)}  by archetype: {arche}")
    print("  sample signals:")
    for n in sigs[:8]:
        print(f"    {n.uns_path:70} {n.archetype:12} {n.suggestion.confidence}")

    print(f"\n  relationships: {len(model.relationships)}")
    for r in model.relationships:
        print(f"    {r.rel_type:9} {r.source_path}  ->  {r.target_path}   ({r.suggestion.confidence}, {r.suggestion.status})")

    auto_approved = [s for s in model.all_suggestions() if s.status == "approved"]
    print(f"\n  auto-approved by machine: {len(auto_approved)}  (must be 0 — humans approve)")

    # Stage B — Hub approval-queue mapping (faithful port of committed TS)
    s = pr1_suggestions(model)
    rels = pr2_relationship_specs(model)
    by_type = {}
    for r in rels:
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
    print("\nSTAGE B — mapped into the Hub approval queue (PR-1 / PR-2 transforms)")
    print(f"  ai_suggestions: kg_entity={len(s['kg_entity'])}  tag_mapping={len(s['tag_mapping'])}  "
          f"(needs_review={s['needs_review']})")
    print(f"  relationship_proposals: {len(rels)}  by type: {by_type}")
    print("  every row lands as a PROPOSAL — a human approves; nothing is asserted as fact.\n")

    # honesty check: this export was never tuned for; report any unclassified signals
    unknown = [n.uns_path for n in sigs if n.archetype == "unknown"]
    if unknown:
        print(f"  NOTE (honest): {len(unknown)} signal(s) the classifier could not type -> flagged needs_review:")
        for u in unknown:
            print(f"    - {u}")
    else:
        print("  NOTE: every live signal was classified into an archetype on first sight.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
