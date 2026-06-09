# Beta Demo Tenant — stand-up manifest + first-run empty state

**Purpose:** give a brand-new tenant a *useful first-run state* (not blank pages) for the
"Path to Beta Testers" phase — the garage conveyor story, end to end, so a beta tester sees a
real plant and can ask "What does GS10 fault code oC mean?" and get a cited answer.

**Reuse, don't rebuild.** Every piece below already exists in `tools/seeds/`. This manifest
composes them in the right order with the right tools — it does **not** introduce new seed data.
(Composing them into one script is deliberately avoided: the files use three different tenant
mechanisms — `__TENANT_ID__` substitution, psql `:tenant_id`, and embed-on-insert — and several
are not raw-SQL-safe. Apply each with the tool it was built for.)

**Demo tenant id:** `00000000-0000-0000-0000-0000000000d1` (the "demo" tenant).

---

## The story this seeds

| Layer | Concretely | Seed |
|---|---|---|
| Site → Area → Line → Equipment → Components | FactoryLM › Home Garage › Conveyor Lab › Conveyor 1 (CV-101) › Micro820 PLC, GS10 VFD, photoeye | `factorylm-garage-conveyor.sql` (kg_entities + relationships, `__TENANT_ID__`) |
| Component templates + KG proposals | PE-001 template, CV-001 instance, verified + proposed relationships | `demo-conveyor-001.sql` (fixed tenant d1) |
| GS10 fault-code / RS-485 knowledge (the citable manual) | GS10 `oC`=overcurrent, Modbus RTU integration | `gs10-vfd-knowledge.sql` (psql `:tenant_id`) + `oem-manuals/` via `apply_oem_seed.py` |
| Work orders + PM schedules + Hub render (/feed, /workorders, /assets) | 5 equipment, 7 WOs, 8 PMs, health score | ⚠️ `demo-hub-tenant.sql` — **NOT on `main`**; lives on `origin/chore/demo-hub-seed` |

> **Gap to close for a full beta tenant:** the WO/PM/Hub-render seed (`demo-hub-tenant.sql`) is
> not merged to `main`. Without it, `/workorders`, `/feed`, and `/schedule` render empty for the
> demo tenant. Merge `chore/demo-hub-seed` (or cherry-pick that file) before the Week-1 demo.

---

## Apply order (DEV → STAGING → PROD — never prod first)

Per `docs/environments.md` / root CLAUDE.md §Environments: KB seeds reach prod **only** after BM25
retrieval is verified on staging-shape data (issue #1385). Use `apply-seeds.yml` for prod; run the
commands below against a **dev/staging** DSN first.

```bash
# 1. Asset tree + KG (idempotent: ON CONFLICT … DO UPDATE on the entity key).
doppler run --project factorylm --config dev -- \
  python3 tools/seeds/run_demo_seed.py --tenant garage-conveyor \
    --tenant-id 00000000-0000-0000-0000-0000000000d1 --dry-run    # then --commit

# 2. Component templates + relationship proposals (tenant d1).
doppler run --project factorylm --config dev -- \
  python3 tools/seeds/run_demo_seed.py --tenant demo --dry-run     # then --commit

# 3. GS10 knowledge into knowledge_entries (psql var tenant; tsvector path works w/o embeddings).
doppler run --project factorylm --config dev -- \
  psql "$DATABASE_URL" -v tenant_id="'00000000-0000-0000-0000-0000000000d1'" \
    -f tools/seeds/gs10-vfd-knowledge.sql

# 4. OEM manual chunks WITH embeddings (needs Bravo Ollama at 192.168.1.11:11434).
#    Raw SQL won't embed — use the companion applier:
doppler run --project factorylm --config dev -- \
  python3 tools/seeds/oem-manuals/apply_oem_seed.py --tenant-id 00000000-0000-0000-0000-0000000000d1

# 5. (until merged) Hub render — WOs/PMs/health. From chore/demo-hub-seed:
#    git show origin/chore/demo-hub-seed:tools/seeds/demo-hub-tenant.sql | \
#      doppler run -p factorylm -c dev -- psql "$DATABASE_URL" -f -
```

**Idempotency:** steps 1–2 are idempotent (ON CONFLICT). Step 3/4 insert `knowledge_entries`;
re-running can duplicate chunks unless de-duped — verify chunk counts (`mira-crawler/ingest/dedup.py`
logic) before a second run on the same tenant. Label: every row carries the demo tenant id, so a
demo tenant is trivially identifiable and removable.

## Verify (the known-good Q/A)

After seeding, the beta-gate question must answer from the seeded manual:

> **Q:** "What does GS10 fault code oC mean?"
> **Known-good A:** `oC` = **Overcurrent** — drive output current exceeded ~200% of rated current
> (short accel time, shorted output/motor, mechanical jam, or ground fault). Action: increase accel
> time, check leads/load for shorts/jams, reset. **Cited from** the GS10 fault-code manual chunk.

Quick retrieval check (no embedding needed — BM25/tsvector path):
```bash
doppler run -p factorylm -c dev -- psql "$DATABASE_URL" -c \
  "SELECT manufacturer, model_number, left(content,80) FROM knowledge_entries
   WHERE tenant_id='00000000-0000-0000-0000-0000000000d1'
     AND content ILIKE '%overcurrent%' LIMIT 3;"
```

Then run the gate against staging: `tests/beta/beta_ready_upload_retrieval_citation.py`.

---

## First-run empty state (design)

When a tenant has **zero** `kg_entities` / uploads, the Hub landing surface (and the web
`/cmms` Mira chat) must show a guided first-run state — **never** a blank page or a fake-data page.

**Copy:**

> ### Your factory is empty — let's change that.
> MIRA grounds every answer in *your* equipment. Two ways to start:
>
> **📄 Upload a manual** — drop a PDF (VFD, PLC, drive, sensor). MIRA chunks it, ties it to a
> namespace node, and can cite it in seconds.   → **[Upload a manual]**
>
> **🔧 Try the demo conveyor** — load a ready-made garage conveyor (Micro820 PLC + GS10 VFD) and
> ask *"What does GS10 fault code oC mean?"* to see a grounded, cited answer.   → **[Load demo data]**
>
> _Nothing here is real until you add it. No invented assets, no fake work orders._

**Placement:** Hub home / `/namespace` when the tenant's entity count is 0; the `[Load demo data]`
CTA triggers the steps above for that tenant (dev/staging) — gated to non-prod or to an explicit
"demo tenant" flag so a real customer tenant never gets demo rows silently.

**Rule:** the empty state replaces today's "Coming Soon" / fake-data pages (see
`project_demo_readiness_2026_06_06`). Labs stays OFF. Implementation is a follow-up (UI change →
Screenshot Rule applies); this section is the approved design.
