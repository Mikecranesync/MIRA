# Ingest schema reconciliation plan — `tag_events` & `approved_tags`

**Status:** investigation + written plan (2026-06-24). **NOTHING APPLIED.** Non-additive
changes require a separate approval. Prod is **not** touched (it is already correct).

**TL;DR:** The canonical migrations (`033_tag_events.sql`, `035_approved_tags.sql`) are
**correct**. **Prod runs the canonical shapes. Dev has the tables absent. Only *staging* is
drifted** — frozen at an early *draft* shape from PR #1657's development. Staging's drifted
tables are **empty (0 rows) and orphaned (no code reads their draft columns)**. The fix is a
**staging-only** reconciliation; **no prod migration is needed**. Recommendation: **PROCEED**
(staging-only), **do not redesign/rename** the canonical tables.

---

## 1. Root-cause report — the "collision"

It is **not** two migration files colliding. It is **one filename, two different contents**,
reconciled by a filename-keyed ledger to "applied" without the content matching.

1. `033_tag_events.sql` + `035_approved_tags.sql` were introduced in a **single commit**
   `ee7ba7b5` (PR **#1657**, "Walker DT-2026 gap closure") and **never rewritten in the repo
   since** (`git log --follow` shows one commit). The repo content = **canonical**.
2. During #1657's long development, **early drafts** of those two files had a *different design*:
   - `tag_events` as a **combined diff/event table** (`event_type, prev_value, new_value,
     threshold, window_start/end, severity, delta, raw_quality, relay_batch_id`). The design was
     later **split** into raw `033 tag_events` + derived **`037_tag_event_diffs.sql`** (whose
     columns — `event_type, prev_value, new_value, threshold` — match the staging leftovers).
   - `approved_tags` as a **monitoring-config table** (`tag_id` PK, `data_type, threshold,
     baseline_period_days, hmac_key_ref`) — the design sketched in
     `docs/plans/2026-06-01-mira-master-architecture-plan.md` and `docs/specs/dtma-to-mtr-bridge.md`.
     It was later simplified to the **allowlist** (`035`).
3. **`migration-verify.yml` auto-applies migrations to the *persistent* staging Neon branch on
   every PR** touching `mira-hub/db/migrations/`. So the **draft** `033/035` were applied to
   staging during #1657's development, creating the draft tables there.
4. The files were rewritten to the **canonical** shape before merge.
5. Both `033/035` use **`CREATE TABLE IF NOT EXISTS`**, and the migration ledger keys on the
   **filename** (`schema_migrations.migration_name`, see `.claude/rules/mira-hub-migrations.md`
   §7). When the canonical versions later ran on staging (ledger shows `033_tag_events.sql` +
   `035_approved_tags.sql` applied **2026-06-10 08:43**), the draft tables already existed → the
   `CREATE` was **skipped** → the ledger recorded "applied" while the **table kept the draft
   shape**.
6. **Prod** receives migrations **only via the gated `apply-migrations.yml`** (post-merge,
   canonical content), and its `tag_events/approved_tags` did **not** pre-exist → prod got clean
   **canonical** tables. **Dev** never had them applied → absent.

**Net:** the divergence is a **staging-only artifact** of (auto-apply-drafts-to-persistent-staging)
× (`CREATE TABLE IF NOT EXISTS`) × (filename-keyed ledger). Prod and the repo are correct.

---

## 2. Schema comparison — canonical vs dev / staging / prod

Sources: repo `033/035` (canonical); staging via direct read-only psycopg2 (`factorylm/stg`);
prod via the **sanctioned** `db-inspect.yml` (read-only, extended with an ingest-schema probe);
dev via `factorylm/dev`.

### `tag_events`
| | Shape | PK | Rows |
|---|---|---|---|
| **Canonical (033)** | `event_id`(uuid,default)·tenant_id·equipment_entity_id·uns_path·tag_path·**value·value_type·quality·source_system·source_connection_id**·simulated·event_timestamp·ingested_at·**metadata** | `event_id` | — |
| **PROD** | **IDENTICAL to canonical** (`event_id` default `gen_random_uuid()`, all 14 cols) | `event_id` | **0** |
| **STAGING** | **DRIFT** — diff design: `event_id`(NO default)·tag_id·**event_type**·prev_value·new_value·threshold·window_start/end·severity·delta·raw_quality·relay_batch_id (+ the 7 ingest cols **added additively by 057 this week**) | `event_id` | **0** |
| **DEV** | **ABSENT** | — | — |

### `approved_tags`
| | Shape | PK | Rows |
|---|---|---|---|
| **Canonical (035)** | tenant_id·source_system·source_tag_path·normalized_tag_path·uns_path·enabled·**notes**·created_by·created_at·**updated_at** | **(tenant_id, source_system, source_tag_path)** | — |
| **PROD** | **IDENTICAL to canonical** (incl. `notes`, `updated_at`) | **(tenant_id, source_system, source_tag_path)** | **58** (real allowlist) |
| **STAGING** | **DRIFT** — monitoring design: **tag_id** PK·**data_type**·threshold·baseline_period_days·hmac_key_ref (+ `notes`,`updated_at` **added additively this week**) | **(tenant_id, tag_id)** | **0** |
| **DEV** | **ABSENT** | — | — |

`live_signal_cache` is **canonical on staging and prod** (no drift).

---

## 3. Impact analysis — who depends on the *old* shapes

Enumerated every SQL reader/writer of both tables.

**`tag_events`**
| Code path | Uses | Shape expected |
|---|---|---|
| `mira-relay/tag_ingest.py` (`ingest_batch`/`NeonTagStore`) | INSERT value/value_type/quality/source_system/metadata | **canonical** |
| `mira-relay/flaky_detector.py` | reads value/value_type/source_system | **canonical** |
| `mira-relay/tag_diff_logger.py` | reads `value`; writes `prev_value/new_value` to **`037 tag_event_diffs`** (separate table) | **canonical** (+037) |
| `mira-hub` i3x (`value.ts`,`data-access.ts`,`history/route.ts`) | reads value/uns_path/value_type/event_timestamp | **canonical** |

**`approved_tags`**
| Code path | Uses | Shape expected |
|---|---|---|
| `mira-relay/tag_ingest.py` (`load_allowlist`) | normalized_tag_path/uns_path/source_system/enabled | **canonical** |
| `mira-hub` i3x (`approval.ts`,`data-access.ts`) | uns_path/enabled | **canonical** |
| Ignition WebDev `api/tags/*` | gateway-side allowlist (file `approved_tags.json`), not the DB monitoring cols | n/a |

**The draft-only columns** — `event_type/prev_value/...` on `tag_events`, and
`data_type/threshold/baseline_period_days/hmac_key_ref/tag_id` on `approved_tags` — are used by
**no code**; the monitoring columns appear **only in docs/specs**. They are **orphaned**.
⇒ Reconciling staging to canonical **breaks nothing**, and **fixes** the staging readers that are
**already broken today** (relay ingest *and* the i3x value/history API both fail against staging's
drift).

---

## 4. Proposed reconciliation strategy + risks

Because **prod is canonical, dev is absent, and only staging is drifted with empty + orphaned
tables**, this is a **staging-only** repair — *not* a cross-env migration and *not* a redesign.

- **Strategy R1 (recommended) — staging-only drop+recreate from canonical.** Drop the two empty
  orphaned staging tables and re-run canonical `033`/`035` (+`036` freshness add-ons). Cleanest,
  leaves staging byte-identical to prod/canonical. **Requires DROP authorization** (separate
  approval — outside the current additive-only guardrails).
- **Strategy R2 (no DROP) — staging-only in-place non-additive ALTER.** Give `tag_events.event_id`
  a default; make the orphaned NOT-NULL columns nullable (or drop them); swap `approved_tags` PK to
  the composite key (drop the `tag_id` PK, add the canonical PK). Achievable without `DROP TABLE`
  but still **non-additive** (DROP CONSTRAINT / ALTER COLUMN) — also needs separate approval. Messier
  and leaves orphaned columns behind.
- **Prod:** **no action** (already canonical). **Dev:** **no action** (canonical migrations create
  the correct tables when applied).

**Risks**
| Risk | Level | Mitigation |
|---|---|---|
| Data loss | **None** | both staging tables are **0 rows** |
| Code breakage | **None** | draft columns are orphaned; all code wants canonical |
| Touching prod by mistake | Med (process) | staging-only; prod is correct — explicitly scope to `factorylm/stg` |
| Recurrence | Med | the auto-apply-drafts mechanism persists (see §7 process fix) |

---

## 5. Exact migration approach for staging — **NOT APPLIED**

> Requires a **separate approval** (R1 uses `DROP`; R2 uses non-additive `ALTER`). Presented for
> review only. Scope: **`factorylm/stg` only**. Take `pg_dump --schema-only` of both tables first.

**R1 (recommended), staging only:**
```sql
BEGIN;
-- both tables are EMPTY + orphaned on staging (verified 0 rows)
DROP TABLE IF EXISTS approved_tags;          -- requires approval (no-DROP guardrail)
DROP TABLE IF EXISTS tag_events;
-- re-run the canonical bodies verbatim:
\i mira-hub/db/migrations/033_tag_events.sql
\i mira-hub/db/migrations/035_approved_tags.sql
\i mira-hub/db/migrations/036_current_tag_state_freshness.sql   -- if any tag_events freshness add-ons
COMMIT;
-- ledger already lists 033/035 as applied (filename) — leave as-is; tables now match canonical.
```

**R2 (no DROP), staging only — the non-additive ALTERs:**
```sql
BEGIN;
ALTER TABLE tag_events  ALTER COLUMN event_id SET DEFAULT gen_random_uuid();
ALTER TABLE tag_events  ALTER COLUMN event_type DROP NOT NULL;   -- orphaned draft col
ALTER TABLE tag_events  ALTER COLUMN tag_id     DROP NOT NULL;   -- orphaned draft col
ALTER TABLE approved_tags DROP CONSTRAINT approved_tags_pkey;    -- (tenant_id, tag_id)
ALTER TABLE approved_tags ALTER COLUMN tag_id DROP NOT NULL;
ALTER TABLE approved_tags ALTER COLUMN data_type DROP NOT NULL;
ALTER TABLE approved_tags ADD PRIMARY KEY (tenant_id, source_system, source_tag_path);
COMMIT;
```
R1 is preferred (clean, leaves no orphaned columns; the seed/ON-CONFLICT then "just works").

The **additive** changes already applied to staging this week (`057` tag_events cols; `approved_tags`
`notes`/`updated_at`) are harmless and are **superseded** by R1 (or retained by R2).

---

## 6. Rollback / recovery plan

- **Pre-change:** `pg_dump --schema-only -t tag_events -t approved_tags` (staging) for audit.
- **R1 rollback:** trivial — the tables are empty; if ever needed, re-create the old draft tables
  from the schema dump. No data to restore.
- **R2 rollback:** re-add the dropped PK / re-assert NOT NULLs from the dump.
- **Prod:** untouched throughout → **no prod rollback concern**.
- **Ledger:** unchanged (already lists 033/035 applied by filename); after R1 the staging tables
  match what the ledger claims.

---

## 7. Recommendation

**PROCEED with a staging-only reconciliation (Strategy R1). Do NOT redesign, rename, or version
the table names.** The canonical `033`/`035` design is correct, is what **prod** runs and **all
code** expects; the draft design was already superseded (`tag_events` split into `033`+`037`; the
monitoring `approved_tags` became the allowlist). This is purely **bringing staging into line with
the already-correct canonical/prod**, on **empty, orphaned** tables → lowest-risk class of change.

**Gated on a separate approval** (R1 needs `DROP`; both are non-additive) — per your standing rule.

**Also recommended:**
- **Close PR #2283 (migration `057`)** — prod is already canonical (the columns exist with
  defaults), dev is absent, and staging needs a *full* reconciliation, not additive columns. `057`
  is a harmless no-op everywhere but **moot**; keeping it risks implying prod needs a change (it
  doesn't).
- **Process fix to prevent recurrence** (the real root cause): `migration-verify.yml` applying
  *drafts* to a **persistent** staging branch, combined with `CREATE TABLE IF NOT EXISTS` + a
  filename-keyed ledger, is what froze staging. Options: (a) run `migration-verify` against an
  **ephemeral** DB (reset per run), (b) add a **content-hash** column to `schema_migrations` and
  warn when a filename's content changes after apply, and/or (c) enforce the discipline in
  `.claude/rules/mira-hub-migrations.md` that a migration file is **never rewritten** once any env
  has applied it (supersede with a new numbered migration instead).

**Do NOT touch production. Do NOT apply R1/R2 without separate approval.**

---

## Appendix — what was changed this week (additive only, reversible)
- Staging `tag_events`: +7 ingest columns (migration `057`, PR #2283).
- Staging `approved_tags`: +`notes`, +`updated_at` (additive).
- `db-inspect.yml`: +a **read-only** ingest-schema probe (this branch) used to inspect prod safely.
- No prod changes. No `DROP`/`TRUNCATE`/rename/data-rewrite. Bespoke validation rows were cleaned up.
