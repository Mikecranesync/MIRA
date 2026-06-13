#!/usr/bin/env python3
"""Create the Conv_Simple bench equipment node in the knowledge graph.

Models the real bench as a site-side equipment instance under the canonical
ISA-95 UNS, links its VFD component to the GS10 catalog node so the drive's
manuals + fault codes are reachable by graph traversal, and stamps the live
data hooks (Modbus host, MQTT prefix, diagnostics topic) as properties.

All writes go through the canonical idempotent helpers (ingest.kg_writer), so
re-running is safe. Entities land approval_state='verified' (the column
default) — this is a deliberate, human-authorized assertion, not an AI proposal.

Usage (dry run prints the plan, NO DB writes):
    python tools/create_bench_equipment_node.py
Commit (writes to NeonDB — run under doppler so NEON_DATABASE_URL/MIRA_TENANT_ID resolve):
    doppler run --project factorylm --config prd -- \\
      python tools/create_bench_equipment_node.py --commit
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "mira-crawler"))

from ingest import kg_writer, uns  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("create-bench-equipment-node")

# Bench identity (slugs feed the ISA-95 path builder).
COMPANY, SITE, AREA, EQUIPMENT_ID = "factorylm", "bench", "conv_simple", "cv101"

BENCH_PROPS = {
    "description": "Conv_Simple bench conveyor (Micro820 + GS10 demo rig)",
    "plc": "Allen-Bradley Micro820 2080-LC20-20QBB",
    "drive": "AutomationDirect DURApulse GS10",
    "modbus_tcp": "192.168.1.100:502",
    "mqtt_prefix": "demo/cell1/conveyor/cv101",
    "diagnostics_topic": "demo/cell1/conveyor/cv101/diagnostics/conv_simple_anomaly",
    "anomaly_engine": "conv_simple_anomaly",
    "source": "create_bench_equipment_node.py",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="write to NeonDB (else dry-run)")
    args = ap.parse_args()

    tenant = os.environ.get("MIRA_TENANT_ID")

    bench_path = uns.assigned_equipment_path(COMPANY, SITE, AREA, EQUIPMENT_ID)
    gs10_path = uns.equipment_unassigned_path("AutomationDirect", "GS10")
    vfd_path = uns.equipment_subnode_path(bench_path, "component", "vfd")

    plan = [
        ("equipment", "Conv_Simple cv101", bench_path, BENCH_PROPS),
        ("equipment", "GS10", gs10_path,
         {"manufacturer": "AutomationDirect", "catalog_node": True}),
        ("component", "cv101 VFD (GS10)", vfd_path,
         {"manufacturer": "AutomationDirect", "model": "GS10", "role": "conveyor drive"}),
    ]
    edges = [
        ("Conv_Simple cv101", "has_component", "cv101 VFD (GS10)"),
        ("cv101 VFD (GS10)", "instance_of", "GS10"),
    ]

    log.info("Planned entities:")
    for etype, name, path, _ in plan:
        ok = uns.is_valid_path(path)
        log.info("  [%s] %-18s %s  %s", etype, name, path, "OK" if ok else "INVALID PATH")
        if not ok:
            log.error("invalid uns_path — aborting")
            return 2
    log.info("Planned edges:")
    for s, rel, t in edges:
        log.info("  %s -[%s]-> %s", s, rel, t)

    if not args.commit:
        log.info("DRY RUN — no DB writes. Re-run with --commit (under doppler) to apply.")
        return 0

    if not tenant or not os.environ.get("NEON_DATABASE_URL"):
        log.error("MIRA_TENANT_ID and NEON_DATABASE_URL required (run under doppler).")
        return 2

    ids: dict[str, str] = {}
    for etype, name, path, props in plan:
        eid = kg_writer.upsert_entity(tenant, etype, name, path, properties=props)
        if not eid:
            log.error("upsert_entity failed for %s/%s", etype, name)
            return 1
        ids[name] = eid
        log.info("upserted %-18s -> %s", name, eid)
    for s, rel, t in edges:
        rid = kg_writer.upsert_relationship(tenant, ids[s], ids[t], rel)
        log.info("edge %s -[%s]-> %s : %s", s, rel, t, rid or "FAILED")
    log.info("Done. Bench equipment node id = %s", ids["Conv_Simple cv101"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
