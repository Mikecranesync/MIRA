#!/usr/bin/env python3
"""Load research/variable-manifest.json into the knowledge graph.

Spec: docs/specs/mira-component-intelligence-architecture.md (Step 5)

For each PLC variable in the manifest, this tool creates:
  * kg_entities rows for: the io_point, its sourceDevice, its PLC address,
    its Modbus register (when present), and its alias.
  * relationship_proposals (with evidence rows) for the edges:
      io_point   HAS_ALIAS         alias
      io_point   MAPS_TO           physical_device   (the sourceDevice)
      io_point   WIRED_TO          plc_address       (the %IX/%QX address)
      io_point   PUBLISHED_AS      modbus_register   (the HR/COIL address)

Wiring notes that mention a variable are attached as additional
`relationship_evidence` rows on the relevant proposals.

This is the garage-conveyor proof-of-concept. The chain it stitches together —
sensor → terminal → tag → rung → fault → asset → fix — is the heart of the
diagnostic product.

Usage (dry run prints to stdout, no DB writes):
  doppler run --project factorylm --config prd -- \\
    python3 tools/load_manifest_to_kg.py --tenant-id <uuid>

Add --commit to actually write to NeonDB.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = REPO_ROOT / "research" / "variable-manifest.json"
DEV_TENANT_ID = "00000000-0000-0000-0000-000000000000"  # seed/dev tenant

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("load-manifest-to-kg")


# ---------- DB layer ---------------------------------------------------------

def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set — run under `doppler run`")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


# ---------- Entity / relationship builders ----------------------------------

def build_entities_and_proposals(
    manifest: dict[str, Any],
    tenant_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (entities, proposals, evidence) lists ready for DB insert.

    Entities use deterministic UUIDs (uuid5) so re-runs of this loader are
    idempotent — the (tenant_id, entity_type, entity_id) unique key catches
    duplicates, and the deterministic UUID makes cross-references stable.
    """
    ns = uuid.UUID("12345678-1234-5678-1234-567812345678")  # arbitrary fixed namespace
    tenant_ns = uuid.uuid5(ns, tenant_id)

    def ent_uuid(entity_type: str, entity_id: str) -> str:
        return str(uuid.uuid5(tenant_ns, f"{entity_type}:{entity_id}"))

    entities: dict[str, dict[str, Any]] = {}   # keyed by id to dedupe
    proposals: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []

    def ensure_entity(entity_type: str, entity_id: str, name: str, props: dict[str, Any] | None = None) -> str:
        eid = ent_uuid(entity_type, entity_id)
        if eid not in entities:
            entities[eid] = {
                "id": eid,
                "tenant_id": tenant_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "name": name,
                "properties": props or {},
            }
        return eid

    def propose(
        source_id: str,
        source_type: str,
        target_id: str,
        target_type: str,
        rel_type: str,
        confidence: float,
        reasoning: str,
        risk_level: str = "low",
        proposal_evidence: list[dict[str, Any]] | None = None,
    ) -> str:
        pid = str(uuid.uuid4())
        proposals.append(
            {
                "id": pid,
                "tenant_id": tenant_id,
                "source_entity_id": source_id,
                "source_entity_type": source_type,
                "target_entity_id": target_id,
                "target_entity_type": target_type,
                "relationship_type": rel_type,
                "confidence": confidence,
                "created_by": "import",
                "risk_level": risk_level,
                "requires_human_review": risk_level in ("high", "safety_critical"),
                "reasoning": reasoning,
            }
        )
        for ev in proposal_evidence or []:
            evidence.append({**ev, "proposal_id": pid})
        return pid

    manifest_source = ", ".join(manifest.get("sourceFiles") or []) or "variable-manifest.json"

    # Pre-index wiring notes by variable name they mention — used as evidence.
    wiring_notes: list[str] = manifest.get("wiringNotes") or []

    def notes_for(var_name: str) -> list[str]:
        return [n for n in wiring_notes if var_name in n]

    for var in manifest.get("variables") or []:
        name: str = var["name"]
        alias: str | None = var.get("alias")
        address: str | None = var.get("address")
        modbus: str | None = var.get("modbusAddress")
        source_device: str | None = var.get("sourceDevice")
        direction: str = (var.get("direction") or "").upper() or "?"

        io_point_id = ensure_entity(
            "io_point",
            name,
            name,
            {
                "data_type": var.get("dataType"),
                "scope": var.get("scope"),
                "direction": direction,
                "retain": var.get("retain", False),
            },
        )

        per_var_evidence = [
            {
                "evidence_type": "manifest",
                "source_description": manifest_source,
                "page_or_location": f"variables[].name={name}",
                "excerpt": json.dumps(var)[:500],
                "confidence_contribution": 0.4,
            }
        ]
        for note in notes_for(name):
            per_var_evidence.append(
                {
                    "evidence_type": "technician_note",
                    "source_description": "variable-manifest.json wiringNotes",
                    "page_or_location": f"wiringNotes mentioning {name}",
                    "excerpt": note,
                    "confidence_contribution": 0.2,
                }
            )

        if alias:
            alias_id = ensure_entity("alias", alias, alias)
            propose(
                io_point_id, "io_point", alias_id, "alias",
                "HAS_ALIAS",
                confidence=0.85,
                reasoning=f"Manifest alias field for {name}",
                proposal_evidence=per_var_evidence,
            )

        if source_device:
            dev_id = ensure_entity("physical_device", source_device, source_device)
            propose(
                io_point_id, "io_point", dev_id, "physical_device",
                "MAPS_TO",
                confidence=0.80,
                reasoning=f"Manifest sourceDevice for {name} = {source_device}",
                proposal_evidence=per_var_evidence,
            )

        if address:
            addr_id = ensure_entity("plc_address", address, address, {"plc_type": "Micro820"})
            propose(
                io_point_id, "io_point", addr_id, "plc_address",
                "WIRED_TO",
                confidence=0.90,
                reasoning=f"Manifest address for {name} = {address}",
                proposal_evidence=per_var_evidence,
            )

        if modbus:
            mb_id = ensure_entity("modbus_register", modbus, modbus)
            # E-stop wiring is safety-critical when surfaced via Modbus.
            is_safety = any(
                kw in (alias or "").lower() for kw in ("e-stop", "estop", "safety", "interlock")
            )
            propose(
                io_point_id, "io_point", mb_id, "modbus_register",
                "PUBLISHED_AS",
                confidence=0.90,
                reasoning=f"Manifest modbusAddress for {name} = {modbus}",
                risk_level="safety_critical" if is_safety else "low",
                proposal_evidence=per_var_evidence,
            )

    return list(entities.values()), proposals, evidence


# ---------- DB writes --------------------------------------------------------

def write_to_db(
    entities: list[dict[str, Any]],
    proposals: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
) -> dict[str, int]:
    from sqlalchemy import text

    inserted_ent = 0
    inserted_prop = 0
    inserted_ev = 0

    with _engine().begin() as conn:
        # Set the tenant context so RLS lets these inserts land.
        if entities:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": entities[0]["tenant_id"]},
            )

        for e in entities:
            res = conn.execute(
                text(
                    """
                    INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties)
                    VALUES (:id, :tenant_id, :entity_type, :entity_id, :name, :properties)
                    ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING
                    """
                ),
                {**e, "properties": json.dumps(e["properties"])},
            )
            inserted_ent += res.rowcount or 0

        for p in proposals:
            conn.execute(
                text(
                    """
                    INSERT INTO relationship_proposals (
                        id, tenant_id, source_entity_id, source_entity_type,
                        target_entity_id, target_entity_type, relationship_type,
                        confidence, created_by, risk_level, requires_human_review,
                        reasoning
                    ) VALUES (
                        :id, :tenant_id, :source_entity_id, :source_entity_type,
                        :target_entity_id, :target_entity_type, :relationship_type,
                        :confidence, :created_by, :risk_level, :requires_human_review,
                        :reasoning
                    )
                    """
                ),
                p,
            )
            inserted_prop += 1

        for ev in evidence:
            conn.execute(
                text(
                    """
                    INSERT INTO relationship_evidence (
                        proposal_id, evidence_type, source_description,
                        page_or_location, excerpt, confidence_contribution
                    ) VALUES (
                        :proposal_id, :evidence_type, :source_description,
                        :page_or_location, :excerpt, :confidence_contribution
                    )
                    """
                ),
                ev,
            )
            inserted_ev += 1

    return {
        "entities_inserted": inserted_ent,
        "proposals_inserted": inserted_prop,
        "evidence_inserted": inserted_ev,
    }


# ---------- CLI --------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Path to variable-manifest.json")
    p.add_argument("--tenant-id", default=DEV_TENANT_ID, help="Tenant UUID for entity/proposal rows")
    p.add_argument("--commit", action="store_true", help="Write to NeonDB (default: dry run)")
    p.add_argument("--summary-only", action="store_true", help="Print counts only, not the full payload")
    args = p.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        log.error("Manifest not found: %s", manifest_path)
        return 2

    manifest = json.loads(manifest_path.read_text())
    entities, proposals, evidence = build_entities_and_proposals(manifest, args.tenant_id)

    summary = {
        "manifest": str(manifest_path),
        "tenant_id": args.tenant_id,
        "entities": len(entities),
        "proposals": len(proposals),
        "evidence_rows": len(evidence),
        "by_entity_type": {},
        "by_relationship_type": {},
        "safety_critical_proposals": sum(1 for p in proposals if p["risk_level"] == "safety_critical"),
    }
    for e in entities:
        summary["by_entity_type"][e["entity_type"]] = summary["by_entity_type"].get(e["entity_type"], 0) + 1
    for p in proposals:
        summary["by_relationship_type"][p["relationship_type"]] = (
            summary["by_relationship_type"].get(p["relationship_type"], 0) + 1
        )

    if args.summary_only:
        print(json.dumps(summary, indent=2))
    else:
        print(
            json.dumps(
                {"summary": summary, "entities": entities[:3], "proposals": proposals[:5]},
                indent=2,
            )
        )

    if args.commit:
        result = write_to_db(entities, proposals, evidence)
        log.info("DB write done: %s", result)
        print(f"\n→ DB write: {json.dumps(result)}")
    else:
        log.info("Dry run — pass --commit to write to NeonDB.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
