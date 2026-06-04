"""End-to-end connector-framework demo.

Run it::

    python mira-connectors/demo.py
    # or, from inside the module dir:
    cd mira-connectors && python demo.py

It walks the full pipeline from ``docs/mira/connector-framework.md``:

1. Import IBM Maximo mock data (enterprise CMMS/EAM).
2. Import Ignition mock tag tree (plant-floor SCADA).
3. Normalize both into the MIRA canonical asset graph.
4. Cross-reference: propose tag→asset links (the OT↔enterprise join).
5. Print the proposed graph with confidence bands.
6. Show what a technician would confirm (the proposal queue).
7. Export an enriched Maximo work-order payload (dry-run → not pushed).

Nothing here writes to a source system or to NeonDB — everything is
``proposed`` and ``dry_run``.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Bootstrap sys.path so the demo runs standalone (no install / PYTHONPATH).
_HERE = Path(__file__).resolve().parent  # mira-connectors/
for _p in (_HERE, _HERE.parent / "mira-crawler"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from canonical import NormalizedGraph, Proposal, confidence_band  # noqa: E402
from cmms.maximo_mock import MaximoMockConnector  # noqa: E402
from scada.ignition_mock import IgnitionMockConnector  # noqa: E402

RULE = "─" * 72


def _h(title: str) -> None:
    print(f"\n{RULE}\n  {title}\n{RULE}")


def _print_graph(name: str, g: NormalizedGraph) -> None:
    s = g.summary()
    print(
        f"{name}: {s['entities']} entities · {s['relationships']} edges "
        f"(all proposed) · {s['proposals']} proposals · {s['source_objects']} raw records preserved"
    )
    from collections import Counter

    types = Counter(e.entity_type for e in g.entities.values())
    print("  entity types:", ", ".join(f"{k}×{v}" for k, v in sorted(types.items())))
    edges = Counter(r.relationship_type for r in g.relationships)
    print("  edge types:  ", ", ".join(f"{k}×{v}" for k, v in sorted(edges.items())))


def _print_proposals(proposals: list[Proposal]) -> None:
    if not proposals:
        print("  (none)")
        return
    for p in sorted(proposals, key=lambda x: -x.confidence):
        flag = "  ⚠ SAFETY" if p.risk_level == "safety_critical" else ""
        print(
            f"  [{p.confidence:.2f} {confidence_band(p.confidence):>6}] {p.suggestion_type:16}{flag}"
        )
        print(f"           {p.title}")


async def main() -> None:
    print("MIRA connector framework — end-to-end demo")
    print("source systems → raw import → normalize → cross-reference → propose → export")

    # 1+2. Import (read-only) from both a CMMS and a SCADA source.
    maximo = MaximoMockConnector()  # dry_run=True, read_only=True by default
    ignition = IgnitionMockConnector()

    _h("1. DISCOVER + IMPORT (read-only)")
    mx_cap = await maximo.discover()
    ig_cap = await ignition.discover()
    print(f"Maximo:   {mx_cap.display_name} — object types: {mx_cap.object_types}")
    print(f"Ignition: {ig_cap.display_name} — object types: {ig_cap.object_types}")
    mx_raw = await maximo.import_records()
    ig_raw = await ignition.import_records()
    print(f"imported: {len(mx_raw)} Maximo records, {len(ig_raw)} Ignition tags")

    # 3. Normalize each into the canonical model.
    _h("2. NORMALIZE into the canonical asset graph")
    mx_graph = maximo.normalize(mx_raw)
    ig_graph = ignition.normalize(ig_raw)
    _print_graph("Maximo  ", mx_graph)
    _print_graph("Ignition", ig_graph)
    for conn, g in ((maximo, mx_graph), (ignition, ig_graph)):
        rep = conn.validate(g)
        print(
            f"  validate {conn.name}: ok={rep.ok} errors={len(rep.errors)} warnings={len(rep.warnings)}"
        )

    # 4. Cross-reference: join OT (SCADA tags) to enterprise (CMMS assets).
    _h("3. CROSS-REFERENCE  (propose SCADA tag → CMMS asset links)")
    link_proposals = ignition.propose_asset_links(ig_graph, mx_graph)
    for p in sorted(link_proposals, key=lambda x: -x.confidence):
        tags = p.extracted_data["scada_tags"]
        flag = " ⚠SAFETY" if p.risk_level == "safety_critical" else ""
        print(
            f"  [{p.confidence:.2f} {confidence_band(p.confidence):>6}]{flag} "
            f"{len(tags)} tag(s) → {p.extracted_data['cmms_target_key']}"
        )
        print(f"           basis: {p.extracted_data['match_basis']}")
        print(f"           target UNS: {p.extracted_data['cmms_uns_path']}")

    # 5. The unified proposed graph.
    _h("4. PROPOSED UNIFIED GRAPH (merged, with confidence)")
    unified = NormalizedGraph()
    unified.merge(mx_graph)
    unified.merge(ig_graph)
    for p in link_proposals:
        unified.add_proposal(p)
    _print_graph("Unified ", unified)
    print("\n  Sample asset, its UNS address, and a few proposed edges:")
    conv = unified.get("asset:CONV-001")
    print(f"    {conv.key}  [{confidence_band(conv.confidence)} conf]  {conv.uns_path}")
    shown = 0
    for r in unified.relationships:
        if r.source_key == conv.key and shown < 5:
            shown += 1
            print(
                f"      └─{r.relationship_type}→ {r.target_key}  ({confidence_band(r.confidence)})"
            )

    # 6. What a technician confirms (the proposal queue).
    _h("5. TECHNICIAN CONFIRMATION QUEUE  (proposed → verified is a human action)")
    all_proposals = list(unified.proposals)
    print(f"{len(all_proposals)} pending proposal(s). MIRA proposes; a technician confirms:")
    _print_proposals(all_proposals)
    print(
        "\n  Until confirmed, every entity and edge stays approval_state='proposed'. "
        "\n  Nothing the connectors produced is auto-verified."
    )

    # 7. Export an enriched work-order payload (dry-run — not pushed).
    _h("6. EXPORT enriched work order back to Maximo (dry-run)")
    result = await maximo.export_enriched(
        {
            "wonum": "WO-10231",
            "uns_path": conv.uns_path,
            "diagnosis": "VFD GS10 tripped on F0004 (DC bus OK at 325V); fault cleared, "
            "fuses replaced. Recommend PM-VFD-ANNUAL firmware check.",
            "confidence": "high",
        }
    )
    print(f"supported={result.supported}  written={result.written}  ({result.note})")
    print("  payload that WOULD be written to Maximo (custom fields preserved):")
    for k, v in result.payloads[0].items():
        if k.startswith("MIRA_") or k == "WONUM":
            print(f"    {k} = {v}")

    _h("done")
    print("Run the connectors live by constructing with dry_run=False, read_only=False")
    print("and pointing get_config_schema() fields at real endpoints (secrets via Doppler).")


if __name__ == "__main__":
    asyncio.run(main())
