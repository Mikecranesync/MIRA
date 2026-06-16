# Runbook: Seed Demo Tenant Data

**Updated:** 2026-06-06
**Cross-links:** `docs/demos/demo-readiness-punch-list.md`, `tools/seeds/README.md`,
`tools/seeds/run_demo_seed.py`, `.claude/commands/mira-create-demo-plant.md`

---

## Context

The demo tenant UUID is `00000000-0000-0000-0000-0000000000d1`.

There are **two separate seed paths** that do not overlap:

| Seed | Target | What it provides |
|---|---|---|
| `demo-conveyor-001.sql` via `run_demo_seed.py` | `kg_entities`, `kg_relationships`, `relationship_proposals`, `component_templates` | Component knowledge graph, ISA-95 UNS tree, PE-001 template, proposals + evidence |
| `demo-hub-tenant.sql` via `psql` directly | Hub UI tables: `cmms_equipment`, `work_orders`, `pm_schedules`, `health_scores`, `kg_entities` (Hub schema) | Hub UI demo visuals (work orders, PM calendar, conveyor assets) |

These must both be applied for a full demo. See `docs/demos/demo-readiness-punch-list.md`
for the safe navigation path and which Hub pages to avoid.

---

## Prerequisites

- Doppler CLI authenticated and authorized for `factorylm/stg` and `factorylm/prd`
- Python 3.12 with `psycopg` installed (`pip install psycopg`)
- `psql` available for the Hub UI seed (psql supports `\set`/`\if` metacommands
  that the Python runner does not)
- Hub migrations applied through at least migration 018:
  - `001_knowledge_graph.sql`
  - `010_kg_uns_path.sql`
  - `013_external_ids.sql`
  - `015_equipment_uns_path.sql`
  - `016_component_templates.sql`
  - `017_installed_component_instances.sql`
  - `018_relationship_proposals.sql`
  (verify: `bun run db:check-order` in `mira-hub/`)
- LABS flag **OFF** — `NEXT_PUBLIC_LABS_ENABLED` must NOT be set in the target
  environment. Setting it exposes "Coming Soon" pages that conflict with seeded data.

---

## Step 1 — Dry run (always first)

Run against **staging** before prod. This validates the SQL without committing.

```bash
# Staging dry run (rolls back)
doppler run --project factorylm --config stg -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --dry-run
```

**Expected output:**

```
INFO  Connecting to NeonDB...
INFO  Applying demo-conveyor-001.sql (N bytes, outer BEGIN/COMMIT stripped)...
INFO  ✔ Seed validated (dry-run, rolled back).
```

If the seed SQL has a psql metacommand (`\set`, `\if`) that the Python runner
cannot execute, you will see a `SyntaxError` or `psycopg.errors.SyntaxError` on
the offending line. In that case, apply the seed directly via `psql` (see Step 3).

---

## Step 2 — Commit to staging

```bash
doppler run --project factorylm --config stg -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --commit
```

**Expected output:**

```
INFO  ✔ Seed committed.
```

---

## Step 3 — Verify staging counts

```bash
doppler run --project factorylm --config stg -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --verify
```

**Expected counts** (`tools/seeds/README.md`):

```
✔ component_templates                                  5
✔ installed_component_instances (demo tenant)          5
✔ kg_entities (demo tenant)                           13
✔ relationship_proposals (demo tenant)                12
✔ relationship_evidence (demo tenant)                  6
✔ kg_relationships (demo tenant)                      12
```

A `✗` (zero) on any line means the seed did not land for that table. Check logs
for constraint violations or dedup conflicts.

---

## Step 4 — Apply Hub UI seed (psql required)

⚠️ UNVERIFIED: `demo-hub-tenant.sql` is referenced in `tools/seeds/README.md`
but was absent from `tools/seeds/` on 2026-06-06. Verify its presence before
running:

```bash
ls tools/seeds/demo-hub-tenant.sql
```

If present, apply via `psql` (NOT via `run_demo_seed.py` — the file uses
`\set`/`\if` psql metacommands that the Python runner cannot execute):

```bash
# Staging first
doppler run --project factorylm --config stg -- \
  psql "$DATABASE_URL" \
  -v tenant_id=00000000-0000-0000-0000-0000000000d1 \
  -f tools/seeds/demo-hub-tenant.sql
```

**Expected output:** a series of `INSERT N` statements.

If the file is absent, Hub UI tables (`cmms_equipment`, `work_orders`,
`pm_schedules`, `health_scores`) will not be populated for the demo tenant.
The engine knowledge graph (from Step 2) will still work.

---

## Step 5 — Promote to prod

Only after staging verifies clean:

```bash
# Prod dry run
doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --dry-run

# Prod commit
doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --commit

# Prod verify
doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --verify
```

If the Hub UI seed is needed on prod:

```bash
doppler run --project factorylm --config prd -- \
  psql "$DATABASE_URL" \
  -v tenant_id=00000000-0000-0000-0000-0000000000d1 \
  -f tools/seeds/demo-hub-tenant.sql
```

---

## Step 6 — Validate the demo is ready

Run the pre-demo preflight:

```bash
doppler run --project factorylm --config prd -- \
  bash scripts/demo-preflight.sh
```

All 10 checks must pass (Doppler secrets, VPS reachable, mira-pipeline-saas,
mira-hub login, Atlas CMMS, QR scan, photo ingest, NeonDB URL, Stripe live mode,
Telegram bot).

---

## Safe navigation path for demos

From `docs/demos/demo-readiness-punch-list.md`:

**SAFE to show:**
`/feed` → `/namespace` → `/assets` → `/assets/[id]` (Overview + Ask tabs only) →
`/knowledge/manuals` → `/knowledge/map` → `/workorders` → `/schedule` →
`/command-center` → `/channels`

**DO NOT navigate** (broken/fake data in prod):
`/reports`, `/alerts`, `/conversations`, `/documents`, `/parts`, `/requests`,
`/team`, `/integrations`, `/assets/[id]` Activity / WO / Parts tabs

---

## Re-seeding other demo tenants

The runner also supports `epic-universe` and `garage-conveyor` tenants.
These require a real tenant UUID (not the fixed demo UUID):

```bash
# Find your tenant UUID
doppler run --project factorylm --config prd -- \
  psql "$DATABASE_URL" \
  -c "SELECT id, name FROM hub_tenants ORDER BY created_at DESC LIMIT 5;"

doppler run --project factorylm --config prd -- \
  python3 tools/seeds/run_demo_seed.py \
    --tenant garage-conveyor \
    --tenant-id <UUID> \
    --commit
```

---

## Idempotency

Every INSERT uses `ON CONFLICT DO NOTHING`. Re-running the seed is a no-op.
Row counts will remain unchanged on a second run. To reset, delete the seeded
rows manually (staging only — never mutate prod schema by hand).

---

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| `SyntaxError` on `\set` or `\if` line | Python runner does not support psql metacommands | Apply the SQL file directly via `psql -f` |
| `--verify` shows `✗ kg_entities 0` | Seed did not commit or tenant UUID mismatch | Check that `--commit` was used (not `--dry-run`); verify `DEMO_TENANT_ID` in `run_demo_seed.py:34` |
| `relation "component_templates" does not exist` | Missing migration | Run Hub migrations through at least `016_component_templates.sql` via `apply-migrations.yml` |
| Prod seed fails with connection error | `DATABASE_URL` not set or staging endpoint used | Always run under `doppler run --project factorylm --config prd`; never mix configs |
| Hub UI pages still show placeholder data after seed | `NEXT_PUBLIC_LABS_ENABLED` is set | Remove that env var — Labs shows fake data that overrides real seeds |
| Hub work orders page empty after Hub UI seed | `demo-hub-tenant.sql` not applied or tenant UUID wrong | Verify file presence and `psql -v tenant_id=...` argument |
| `insert_knowledge_entry` dedup noise | Seed re-run with same chunks | `ON CONFLICT DO NOTHING` — safe to ignore; counts will be 0 new rows |

---

## Engine recall vs Hub UI

`demo-conveyor-001.sql` populates the KG and proposals but does NOT write to
`knowledge_entries`. If you need the engine to cite demo knowledge in chat, you
must also run the knowledge ingest pipeline against the demo tenant's manual
corpus (see `docs/runbooks/upload-manual-verify-citable.md`, Option C).
