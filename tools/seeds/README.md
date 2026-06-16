# Demo Seeds

Loaders for tenant-scoped demo data. Each seed targets a single, well-known
tenant UUID so it can be applied to dev or prod without touching real customers.

| File | Tenant | Asset | What it seeds |
|---|---|---|---|
| `demo-conveyor-001.sql` | `00000000-0000-0000-0000-0000000000d1` ("demo") | Conveyor 001 (`CV-001`) | 5 components (PE/MTR/VFD/PLC/PANEL), PE-001 full template, ISA-95 UNS paths, PLC tag bindings (4 entities), 12 verified relationship proposals + evidence, promoted into `kg_relationships` |
| `demo-hub-tenant.sql` | `00000000-0000-0000-0000-0000000000d1` ("demo") | Garage conveyor cell | Hub UI tables for demo videos: 11 `kg_entities` (ISA-95 UNS tree), 5 `cmms_equipment` assets (conveyor/GS10/Micro820/photoeyes), 7 `work_orders` (mixed status), 8 `pm_schedules` (3 overdue, 5 upcoming), 2 `kg_relationships` (CONTROLS + DRIVES), 1 `health_scores` row. Does NOT duplicate knowledge_entries — complements demo-conveyor-001.sql. Apply via `psql -v tenant_id=…` (not run_demo_seed.py — uses psql `\set`/`:'var'` syntax). |
| `run_demo_seed.py` | — | — | Python runner: `--dry-run` (rollback), `--commit`, `--verify`. Note: does NOT support demo-hub-tenant.sql (psql variable syntax — apply directly via psql). |

## Prerequisites

Migrations applied in this order before any seed runs:
- `mira-hub/db/migrations/001_knowledge_graph.sql`
- `mira-hub/db/migrations/010_kg_uns_path.sql`
- `mira-hub/db/migrations/013_external_ids.sql`
- `mira-hub/db/migrations/015_equipment_uns_path.sql`
- `mira-hub/db/migrations/016_component_templates.sql`
- `mira-hub/db/migrations/017_installed_component_instances.sql`
- `mira-hub/db/migrations/018_relationship_proposals.sql`

Verify against prod with:
```bash
gh workflow run apply-prod-migrations.yml
```

The `cmms_equipment` insert is wrapped in an exception handler — if the Atlas
schema isn't present or its column shape differs, the seed logs a NOTICE and
the rest of the data still lands (the `kg_entities` row covers the asset).

## Apply

```bash
# Dry run (rollback after) — proves the SQL is valid against current schema
doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py --dry-run

# Commit
doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py --commit

# Verify counts post-apply
doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py --verify
```

Expected on success:
```
✔ component_templates                                  5
✔ installed_component_instances (demo tenant)          5
✔ kg_entities (demo tenant)                           13
✔ relationship_proposals (demo tenant)                12
✔ relationship_evidence (demo tenant)                  6
✔ kg_relationships (demo tenant)                      12
```

## Idempotency

Every INSERT uses `ON CONFLICT DO NOTHING` keyed on a stable natural key
(`(manufacturer, model, version)` for templates, `(tenant_id, entity_type, entity_id)`
for KG entities, primary key for instances/proposals). Re-running the seed is a no-op.

## UNS path

```
enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.{pe_001|mtr_001|vfd_001|plc_001|panel_001}
```

Query the demo subtree:
```sql
SELECT entity_type, entity_id, name FROM kg_entities
WHERE uns_path <@ 'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001'::ltree
ORDER BY uns_path;
```
