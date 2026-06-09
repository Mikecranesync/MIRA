# Demo Seeds

Loaders for tenant-scoped demo data. Each seed targets a single, well-known
tenant UUID so it can be applied to dev or prod without touching real customers.

| File | Tenant | Asset | What it seeds |
|---|---|---|---|
| `demo-conveyor-001.sql` | `00000000-0000-0000-0000-0000000000d1` ("demo") | Conveyor 001 (`CV-001`) | 5 components (PE/MTR/VFD/PLC/PANEL), PE-001 full template, ISA-95 UNS paths, PLC tag bindings (4 entities), 12 verified relationship proposals + evidence, promoted into `kg_relationships` |
| `run_demo_seed.py` | — | — | Python runner: `--dry-run` (rollback), `--commit`, `--verify` |
| `beta-demo-tenant.md` | `…d1` ("demo") | Garage conveyor (CV-101) | **Manifest** — how to stand up the full beta demo tenant from the seeds above (apply order, known-good GS10 `oC` Q/A, first-run empty-state design). Start here for "Path to Beta". |
| `seed-simlab-docs.py` | `00000000-0000-0000-0000-000000515ab1` ("SimLab") | Juice bottling line (11 assets) | Ingests the 77 synthetic maintenance markdown fixtures under `simlab/docs/<asset_id>/` (7 doc types × 11 assets) into `knowledge_entries`, chunked for BM25, UNS-tagged in `isa95_path` via `simlab.uns.asset_path`, `source_system="simulator"`/`simulated=true` in metadata. Closes #1835. Requires PR #1816's `simlab/docs/`. |

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

## SimLab doc seed (`seed-simlab-docs.py`)

Ingests the SimLab juice-bottling maintenance docs so the engine can **cite**
them during SimLab scenarios. Reads `simlab/docs/<asset_id>/*.md` (7 doc types ×
11 assets = 77 files), chunks each on `##` sections (H1 title prepended for
context; oversize sections soft-split at ~1800 chars), and inserts into
`knowledge_entries` under the fixed SimLab tenant.

```bash
# Local — DEV ONLY (the docs are synthetic; never seed prod from a code shell)
doppler run --project factorylm --config dev -- \
  .venv/bin/python tools/seeds/seed-simlab-docs.py --dry-run   # validate, rollback
doppler run --project factorylm --config dev -- \
  .venv/bin/python tools/seeds/seed-simlab-docs.py --commit    # apply (242 chunks)
doppler run --project factorylm --config dev -- \
  .venv/bin/python tools/seeds/seed-simlab-docs.py --verify    # counts + BM25 proof
```

- **Schema facts:** `knowledge_entries.tenant_id` is **UUID** (FK → `tenants.id`;
  the seed inserts an idempotent `tenants` row first). `source_system`/`simulated`
  live in `metadata` JSONB (no dedicated columns). UNS path → `isa95_path`.
- **Idempotency:** `ON CONFLICT` on the partial unique index `idx_ke_chunk_dedup`
  `(tenant_id, source_url, (metadata->>'chunk_index')::int)`. Re-running inserts 0.
  `DO NOTHING` → edits to a doc are **not** re-synced (clear the tenant to reload).
- **`--verify` proves citability, not just row count:** it replays the engine's
  OR-fanout BM25 query (`mira-bots/shared/neon_recall.py::_recall_bm25`) for canned
  probes and asserts the expected asset is in the top-K candidate set. It does
  **not** assert rank-#1: `_recall_bm25` is tenant-wide (no asset scoping), so
  vocabulary-sharing siblings (filler/rinser both "nozzle/pressure") can outrank
  the target on a generic query. At runtime the engine disambiguates via the
  SimLab `direct_connection` `asset_id` + RRF fusion — wiring that asset scope
  into `tests/simlab/runner.py` (which binds no tenant today) is the #1816
  follow-up, **not** this ingestion PR.
- **Via workflow:** `apply-seeds.yml` with `seeds=simlab-docs` (or `all`) runs this
  as a dedicated Python step — `dry-run` rolls back, `apply` commits + verifies.
  It ignores the `tenant_id` input (own fixed tenant) and no-ops until `simlab/`
  is on the checked-out ref.

UNS subtree (canonical lowercase ltree, built by `simlab.uns.asset_path`):
```
enterprise.florida_natural_demo.plant1.juice_bottling.line01.{depalletizer01|conveyorzone01|conveyorzone02|rinser01|filler01|capper01|labeler01|casepacker01|palletizer01|airsystem01|cipskid01}
```
