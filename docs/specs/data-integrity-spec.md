# Data Integrity Spec

**Status:** DRAFT — pending review by Mike
**Version:** 0.1.0
**Author:** MIRA agent (Charlie node)
**Created:** 2026-05-07
**Trigger:** Stardust Racers WO loss incident (2026-05-07) — see §0
**Scope:** Every write path into NeonDB and Atlas Postgres across MIRA modules

---

## §0 Triage: Stardust Racers WO Loss (2026-05-07)

### What Mike did
Entered a work order in the Hub UI New Work Order page (`/workorders/new`) for asset "Stardust Racers" with description "track inspection nightly", saw a green-check success screen with a WO number like `WO-2026-XYZ`, then refreshed and the WO was gone.

### Root cause (high confidence — code review)
**Mike's hypothesis (the `sourcetype` enum bug ate it) is incorrect for this incident.** The actual cause is far worse:

`mira-hub/src/app/(hub)/workorders/new/page.tsx` is a **UI-only mock**. It has been a placeholder since the initial scaffold commit `6829c51 feat(hub): work orders list + 3-step create flow`. The `submit()` function:

```tsx
function submit() {
  setSubmitted(true);
  setTimeout(() => {}, 1500);
}
```

…sets a local React state, shows a fake success page, and **never calls any API**. The displayed WO number is generated in the JSX:

```tsx
WO-2026-{String(Math.floor(Math.random() * 900) + 100)}
```

Supporting evidence:
1. `grep -n "fetch\|POST\|api" mira-hub/src/app/(hub)/workorders/new/page.tsx` → **no matches**.
2. `mira-hub/src/app/api/work-orders/route.ts` exports **only `GET`**. There is no `POST` handler in any nested route — Hub has no server-side endpoint that accepts a new WO.
3. The Step-1 asset picker reads from a hardcoded constant `ASSET_OPTIONS` (Air Compressor, Conveyor Belt, CNC Mill, HVAC Unit, Pump Station). "Stardust Racers" is not in that list — Mike either typed it free-form (which silently filtered to no asset selected) or picked a placeholder, and either way the description "track inspection nightly" never reached a payload.
4. The `sourcetype` enum (with values like `telegram_text`, `auto_pm`, used at `mira-bots/shared/integrations/hub_neon.py:101` via `%s::sourcetype` cast) is only exercised by mira-bots writers. Hub UI never reaches that code path because Hub UI never writes.

### Recommended NeonDB queries (for empirical confirmation — needs prod-read approval)
The Production Read was blocked by the harness. To verify "WO never persisted," run from an approved console:

```sql
-- Q1: Stardust / track / nightly / inspection in last 24h
SELECT id, work_order_number, source, title, description, tenant_id, created_at
FROM work_orders
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND (description ILIKE '%track%'
       OR description ILIKE '%inspection%'
       OR description ILIKE '%nightly%'
       OR description ILIKE '%stardust%'
       OR title ILIKE '%stardust%');
-- Expected: 0 rows.

-- Q2: most recent WOs (should show telegram_text / auto_pm sources, no hub_ui)
SELECT work_order_number, source, title, tenant_id, created_at
FROM work_orders ORDER BY created_at DESC LIMIT 10;

-- Q3: any hub_ui-sourced WOs ever created?
SELECT COUNT(*) FROM work_orders WHERE source::text = 'hub_ui';
-- Expected: 0.

-- Q4: enum values currently defined for sourcetype
SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'sourcetype')
ORDER BY enumsortorder;
-- Expected today: 'telegram_text', 'telegram_voice', 'auto_pm', and possibly 'slack_text'.
-- 'hub_ui' likely missing — but irrelevant to this incident, since nothing writes it.
```

### Container log query
```bash
ssh root@100.68.120.99 'docker logs mira-hub --since 1h 2>&1 | grep -iE "error|500|work_order"'
# Expected: no POST-handler errors, because no POST request was ever made.
```

### Severity
- **Data loss:** total. Mike's input never reached any persistence layer.
- **Detection:** none. The UI showed a fake success.
- **Frequency:** every Hub UI new-WO submission since the scaffold landed.
- **Blast radius:** all Hub-UI-entered WOs to date are fictional. Telegram/voice/PM-scheduler WOs (which use `mira-bots/shared/integrations/hub_neon.py`) **do** persist correctly.

### Immediate action items (out of scope for this spec, tracked separately)
1. Wire `mira-hub/src/app/(hub)/workorders/new/page.tsx submit()` to a real `POST /api/work-orders`.
2. Implement `POST` in `mira-hub/src/app/api/work-orders/route.ts` (mirror `hub_neon.py` validation: enum cast, tenant scope, `RETURNING id`).
3. Replace hardcoded `ASSET_OPTIONS` with a query against `cmms_equipment` filtered by `tenant_id`.
4. Add a Playwright smoke test that creates a WO and re-fetches the list to confirm persistence.
5. Audit every other Hub UI form for the same anti-pattern (asset create, PM create, user invite, upload).

---

## §1 Data Flow Map

Every write path in the system. Format: `actor → validation layer → write target → confirmation → read-back`. A path is **hardened** when every column is filled.

| # | Source actor             | Validation                            | Write target                        | Confirmation              | Read-back verification         | Status |
|---|--------------------------|---------------------------------------|-------------------------------------|---------------------------|--------------------------------|--------|
| 1 | Hub UI: WO create        | (none — currently)                    | (none — currently)                  | fake setState             | none                           | **BROKEN** (§0) |
| 2 | Hub UI: asset create     | TBD audit                             | TBD audit                           | TBD                       | TBD                            | UNKNOWN |
| 3 | Hub UI: PM create        | TBD audit                             | TBD audit                           | TBD                       | TBD                            | UNKNOWN |
| 4 | Hub UI: file upload      | TBD audit                             | TBD audit                           | TBD                       | TBD                            | UNKNOWN |
| 5 | Hub UI: user session     | NextAuth/iron-session                 | session cookie + Neon hub_users     | redirect on login         | route guard reads session       | OK |
| 6 | Telegram bot             | `guardrails.classify_intent`, FSM     | NeonDB `work_orders`, `telegram_messages` | `RETURNING id`        | bot replies with WO number     | OK |
| 7 | Slack bot                | adapter MIME allowlist + guardrails   | NeonDB same as Telegram             | `RETURNING id`            | thread reply with WO number    | OK |
| 8 | MIRA Scan (mira-web)     | scan QR → asset_tag lookup            | NeonDB `scan_queue`, manual cache   | HTTP 201 + body           | client refetch on success      | OK |
| 9 | Atlas CMMS direct        | Atlas API auth                        | Atlas Postgres (independent DB)     | Atlas API response        | atlas-api GET                  | OK |
| 10 | Sync worker (NeonDB↔Atlas) | conflict-resolve: NeonDB wins         | both, with `atlas_id` link          | per-row commit            | nightly drift report           | PARTIAL — see §7 |
| 11 | KB ingest (mira-ingest)  | tier-limit gate, MIME, dedupe         | NeonDB `kb_chunks`, `kg_entities`   | `RETURNING id` per chunk  | search test after ingest       | OK |
| 12 | Cron agents (morning_brief, pm_scheduler) | scheduler lock + tenant scope | NeonDB `agent_events`, `health_logs` | `RETURNING id`           | dashboard query                | OK |

**Rule:** every row in this table must reach status OK before MVP ships. Each `BROKEN`/`UNKNOWN` row gets a Linear issue and a Playwright/E2E test pinned to it.

---

## §2 Database Schema Contracts

For each table the application writes, this section names: required columns, types, constraints, foreign keys, enums, RLS policies, indexes, and migration discipline. Treat this as the contract — any drift between this spec and the live schema is a data-integrity bug.

### 2.1 `work_orders` (NeonDB; canonical source)
| Column                | Type                | Constraint                                                              |
|-----------------------|---------------------|-------------------------------------------------------------------------|
| `id`                  | `uuid`              | PRIMARY KEY, default `gen_random_uuid()`                                |
| `work_order_number`   | `text`              | NOT NULL, unique per tenant                                             |
| `tenant_id`           | `text`              | NOT NULL, default `'mike'` (migration 010), indexed                     |
| `user_id`             | `text`              | NOT NULL                                                                |
| `source`              | `sourcetype` enum   | NOT NULL                                                                |
| `equipment_id`        | `uuid`              | FK → `cmms_equipment.id`; auto-created when missing (see §5.6)          |
| `title`               | `text`              | NOT NULL, ≤ 200 chars                                                   |
| `description`         | `text`              | ≤ 2000 chars                                                            |
| `fault_description`   | `text`              | nullable (migration 005)                                                |
| `resolution`          | `text`              | nullable                                                                |
| `priority`            | `prioritylevel` enum| NOT NULL, default `'medium'`                                            |
| `status`              | `workorderstatus` enum | NOT NULL, default `'open'`                                           |
| `closed_at`           | `timestamptz`       | nullable (migration 005)                                                |
| `created_by_agent`    | `text`              | nullable                                                                |
| `suggested_actions`   | `text[]`            | nullable                                                                |
| `safety_warnings`     | `text[]`            | nullable                                                                |
| `route_taken`         | `text`              | nullable                                                                |
| `created_at`          | `timestamptz`       | NOT NULL, default `now()`                                               |
| `updated_at`          | `timestamptz`       | NOT NULL, default `now()`, updated via trigger                          |
| `deleted_at`          | `timestamptz`       | nullable — soft-delete (§5.1)                                           |

**Enums (must match app constants — §6):**
- `sourcetype`: `telegram_text`, `telegram_voice`, `slack_text`, `auto_pm`, **`hub_ui`** (must be added — see §6.4)
- `workorderstatus`: `open`, `in_progress`, `completed`, `cancelled`, `needs_completion` (added in migration 005)
- `prioritylevel`: `low`, `medium`, `high`, `critical`

**Indexes:** `idx_work_orders_tenant_created (tenant_id, created_at DESC)` (migration 010).

**RLS policy (NeonDB):** `tenant_isolation USING (tenant_id = current_setting('app.tenant_id', true))`. Every Hub-API read MUST go through `withTenantContext()` (mira-hub/src/lib/tenant-context.ts) which sets the role to `factorylm_app` (no BYPASSRLS) and the local `app.tenant_id`.

### 2.2 `cmms_equipment` (NeonDB)
| Column              | Type   | Constraint                                  |
|---------------------|--------|---------------------------------------------|
| `id`                | `uuid` | PK                                          |
| `equipment_number`  | `text` | unique per tenant                           |
| `manufacturer`      | `text` | nullable                                    |
| `tenant_id`         | `text` | NOT NULL                                    |
| `created_at`        | `timestamptz` | NOT NULL                              |
| `deleted_at`        | `timestamptz` | nullable                              |

(Full schema TBD — same pattern as `work_orders`.)

### 2.3 `pm_schedules` (NeonDB)
Migration 005 adds: `trigger_type` (CHECK in `'calendar'|'meter'|'calendar_or_meter'`), `meter_type`, `meter_threshold`, `meter_current`, `meter_last_reset_at`. Index `idx_pm_meter_due (tenant_id, meter_current, meter_threshold)` partial WHERE `trigger_type IN ('meter','calendar_or_meter')`.

### 2.4 `telegram_messages`, `kb_chunks`, `kg_entities`, `agent_events`, `health_logs`, `scan_queue`, `cmms_sync_conflicts`
Each follows the same template — listed as a backlog item per row in the §1 status table; each gets its own §2.x subsection in v0.2 of this spec.

### 2.5 Migration discipline
1. **Append-only.** New migration = next integer, never edit a merged one.
2. **Idempotent.** Wrap in `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object THEN NULL` (already the pattern in migrations 005/010).
3. **Both directions documented.** Every migration ends with `-- Rollback:` comments (already the pattern).
4. **One transaction.** `BEGIN; ... COMMIT;` per file (currently inconsistent — fix in audit).
5. **CI gate.** `scripts/check_migrations.sh` runs `psql --single-transaction --set ON_ERROR_STOP=1` against an empty DB on every PR.

---

## §3 Write Guarantees

Every write path in §1 must satisfy all of the following or it is non-compliant.

### 3.1 Transaction wrapping
```python
# Pattern (psycopg2)
with conn:                       # commits on exit, rolls back on exception
    with conn.cursor() as cur:
        cur.execute(...)
```
```ts
// Pattern (TypeScript / pg) — the existing withTenantContext helper already does this
await withTenantContext(tenantId, async (client) => {
  await client.query('BEGIN');           // implicit in withTenantContext
  const r = await client.query('INSERT ... RETURNING id', params);
  // any throw → ROLLBACK
  return r.rows[0];
});
```
**Forbidden:** raw `pool.query()` for any mutation outside `withTenantContext`.

### 3.2 Enum validation BEFORE insert
The DB must never be the first thing to reject an enum value. App-level validation:

```ts
// mira-hub/src/lib/enums.ts (to be created — §6)
import { SOURCE_TYPES, type SourceType } from "./enums";
function assertSource(s: string): asserts s is SourceType {
  if (!SOURCE_TYPES.includes(s as SourceType)) {
    throw new ValidationError(`invalid source: ${s}; allowed: ${SOURCE_TYPES.join(',')}`);
  }
}
```
```python
# mira-bots/shared/enums.py (to be created — §6)
SOURCE_TYPES: frozenset[str] = frozenset({
    "telegram_text", "telegram_voice", "slack_text", "auto_pm", "hub_ui",
})
def assert_source(s: str) -> None:
    if s not in SOURCE_TYPES:
        raise ValueError(f"invalid source: {s!r}; allowed: {sorted(SOURCE_TYPES)}")
```
The DB cast `%s::sourcetype` remains as a defense-in-depth guard, never the primary check.

### 3.3 Tenant ID injection
Every mutation path MUST resolve `tenant_id` from authenticated session (Hub UI), bot adapter context (Telegram/Slack), or scheduler config (cron). It is **forbidden** to insert without `tenant_id`. The migration-010 default `'mike'` is a temporary single-tenant convenience and must be removed before multi-tenant launch (Linear: track in MVP-Unit-9c).

### 3.4 Timestamps
Every mutable table requires `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` plus a trigger:

```sql
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
```

### 3.5 RETURNING + caller verification
Every `INSERT`/`UPDATE` MUST end with `RETURNING <pk>, <key business cols>` and the caller MUST inspect the result before reporting success. Pattern:

```ts
const { rows } = await client.query(
  `INSERT INTO work_orders (...) VALUES (...) RETURNING id, work_order_number, created_at`,
  params,
);
if (rows.length !== 1) {
  throw new PersistenceError('INSERT returned no rows — assume failure');
}
return rows[0];
```

### 3.6 Frontend MUST verify the returned row
React handlers must NOT show success unless the API response contains the persisted row's id (this is the rule §0 violated):

```tsx
async function submit() {
  const res = await fetch('/api/work-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    setError(await res.text());      // show the real error
    return;
  }
  const wo = await res.json();
  if (!wo?.id) {                     // server returned 200 but no row — treat as failure
    setError('Server did not confirm persistence; please retry');
    return;
  }
  setCreated(wo);                    // only now show success
}
```

### 3.7 Idempotency
POST endpoints accept an `Idempotency-Key` header (UUIDv4 from the client). The server records the key + response in a small `idempotency_keys` table for 24 h. Re-submission with the same key returns the original response, never a second insert.

### 3.8 Forbidden anti-patterns (lint-enforced where possible)
- `setSubmitted(true)` without an awaited `fetch` to a real endpoint — caught by an ESLint rule.
- `RETURNING` omitted from any `INSERT/UPDATE` — caught by `ast-grep` rule (extend `.ast-grep-rules/`).
- Hardcoded asset / equipment / user lists in production code paths — caught by `ast-grep` rule.

---

## §4 Read Guarantees

### 4.1 RLS scoping
Every Hub-API read goes through `withTenantContext(ctx.tenantId, ...)` (already the pattern in `mira-hub/src/app/api/work-orders/route.ts`). Pipeline services that intentionally bypass RLS (e.g. mira-pipeline, sync worker) must document why and be reviewed quarterly.

### 4.2 Consistent ordering
Lists are ordered deterministically. For `work_orders`:
```sql
ORDER BY
  CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
  CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  created_at DESC,
  id        -- stable tiebreaker on identical timestamps
```
The trailing `id` is mandatory — without it pagination can skip rows when two records share a `created_at`.

### 4.3 Pagination
Use keyset pagination (`WHERE (created_at, id) < ($lastSeenAt, $lastSeenId)`) for any list that can exceed 200 rows. `LIMIT/OFFSET` is forbidden on tenant-scoped lists because OFFSET re-reads skipped rows under concurrent writes.

### 4.4 Cache invalidation
Hub UI lists use SWR/React-Query. Every successful POST/PATCH MUST call the corresponding `mutate(key)` (or invalidateQueries). A list refetched after a write MUST observe the new row — this is verified by an E2E test (§9).

### 4.5 Soft-delete filter
Every read against a soft-delete-capable table includes `WHERE deleted_at IS NULL` unless the route is explicitly an "archive view." Helper:
```sql
CREATE VIEW work_orders_active AS
  SELECT * FROM work_orders WHERE deleted_at IS NULL;
```
Hub APIs query the view, not the base table, by default.

---

## §5 Data Loss Prevention

### 5.1 No hard deletes
`DELETE FROM <table>` is forbidden in application code. Replace with `UPDATE ... SET deleted_at = now()`. A nightly Postgres role audit (`pg_stat_statements`) flags any `DELETE` in the last 24 h.

### 5.2 Write-ahead log for critical mutations
For WO create, asset create, PM create: write a JSONL audit row to `data_audit_log` (separate table, append-only, never RLS-restricted to admins) inside the same transaction:
```sql
INSERT INTO data_audit_log (entity_type, entity_id, action, payload, tenant_id, actor, created_at)
VALUES ('work_order', $1, 'create', $2::jsonb, $3, $4, now());
```
If the production write fails, the audit row rolls back together — but if the API process crashes between transaction commit and HTTP response, the audit row + business row both persist, and a reconciliation job replays missed responses.

### 5.3 Retry on transient NeonDB failures
psycopg2 / pg client retries with exponential backoff on the following error codes ONLY: `08000, 08003, 08006, 53300, 57P03` (connection / admin shutdown). Max 3 attempts, total deadline 5 s. **Never retry on constraint violations.**

### 5.4 Idempotency keys
See §3.7. Required on every POST that creates a row visible to humans.

### 5.5 Optimistic UI + server confirmation
Optimistic updates (write to local cache before server confirms) are PERMITTED only when paired with rollback on failure:
```tsx
const optimistic = { ...payload, id: 'temp-' + nanoid(), pending: true };
mutate(key, [...current, optimistic], false);
try {
  const real = await postWO(payload);
  mutate(key, [...current, real], false);     // swap in real id
} catch (e) {
  mutate(key, current, false);                 // rollback
  setError(e.message);
}
```
The "fake success without server call" pattern in §0 is the inverse and is forbidden.

### 5.6 Dependent-record creation
When inserting a WO without a known `equipment_id`, the writer MUST create a placeholder equipment row in the same transaction (the existing pattern in `mira-bots/shared/integrations/hub_neon.py:_get_or_create_equipment_id`). Never let the FK fail silently or the insert succeed against a NULL FK.

### 5.7 Bulk import safety
Any bulk insert (KB ingest, CSV upload) processes in batches of ≤ 500 rows per transaction with row-level error capture into a `bulk_import_errors` table. A single bad row never fails the whole batch.

---

## §6 Enum Management

This is the section directly motivated by the "missing `hub_ui` enum value" hypothesis. Even though it didn't cause Stardust Racers, it is a real risk class.

### 6.1 Single source of truth
Each enum has exactly one definition in a migration file. Naming convention: `migration NNN_create_<enum>.sql`. Adding a value: `migration NNN_add_<value>_to_<enum>.sql` containing:
```sql
DO $$ BEGIN
  ALTER TYPE sourcetype ADD VALUE IF NOT EXISTS 'hub_ui';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

### 6.2 App-side mirrors
Every enum has a TypeScript file and a Python file with the same values:
```ts
// mira-hub/src/lib/enums.ts
export const SOURCE_TYPES = [
  'telegram_text','telegram_voice','slack_text','auto_pm','hub_ui',
] as const;
export type SourceType = typeof SOURCE_TYPES[number];
```
```python
# mira-bots/shared/enums.py
from typing import Final
SOURCE_TYPES: Final[frozenset[str]] = frozenset({
    "telegram_text", "telegram_voice", "slack_text", "auto_pm", "hub_ui",
})
```

### 6.3 CI drift check
A new script `scripts/check_enum_drift.py` connects to a CI-provisioned Postgres (with all migrations applied), reads `pg_enum`, and compares against the TS+Python constants. Mismatch fails the build with a diff. Add to `.github/workflows/code-review.yml`.

### 6.4 Adding a new enum value — checklist
1. Write the migration file (`ADD VALUE IF NOT EXISTS`).
2. Update both `enums.ts` and `enums.py`.
3. Add a unit test that round-trips the new value through `assert_source` / `assertSource`.
4. Add an integration test that inserts a row using the new value end-to-end.
5. Run `scripts/check_enum_drift.py` locally before pushing.

**Remediation for `hub_ui` specifically:** because §0 will require a real Hub-UI POST handler, the migration that adds `hub_ui` to `sourcetype` must land in the same PR as the new `POST /api/work-orders` route.

---

## §7 Cross-System Consistency (NeonDB ↔ Atlas)

### 7.1 Source of truth
NeonDB is canonical for: work orders, equipment, PMs, KB, conversations. Atlas Postgres is canonical for nothing — it is a CMMS replica for ops UI use.

### 7.2 Linkage
Every NeonDB row that has been mirrored to Atlas carries an `atlas_id` column (TEXT, nullable until mirrored). The sync worker fills it on first push.

### 7.3 Conflict resolution
NeonDB wins. If the sync worker observes Atlas-side changes after a NeonDB write, it overwrites Atlas. The previous Atlas state is stored in `cmms_sync_conflicts` for forensic review:
```sql
CREATE TABLE cmms_sync_conflicts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL,
  entity_id     uuid NOT NULL,
  neon_state    jsonb NOT NULL,
  atlas_state   jsonb NOT NULL,
  resolution    text NOT NULL,                 -- 'neon_wins' | 'atlas_wins' | 'manual'
  resolved_by   text,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
```

### 7.4 Sync failure handling
Any sync error blocks the row from being marked synced; a per-entity retry counter increments. After 5 failures the row is marked `sync_blocked` and surfaces on the dashboard (§8). A blocked row never re-attempts automatically — a human must clear it.

### 7.5 Sync status dashboard
Grafana panel reads `cmms_sync_conflicts` + `work_orders.atlas_id IS NULL AND created_at < now() - INTERVAL '5 min'` and exposes:
- conflict count last 24 h
- backlog (rows pending sync ≥ 5 min)
- per-entity sync error rate

---

## §8 Monitoring + Alerting

### 8.1 Daily count audit
Cron at 02:00 UTC writes to `data_integrity_metrics`:
```sql
INSERT INTO data_integrity_metrics (table_name, row_count, captured_at, tenant_id)
SELECT 'work_orders', COUNT(*), now(), tenant_id
FROM work_orders WHERE deleted_at IS NULL GROUP BY tenant_id;
```
Alert (Discord `#alpha-status`) on:
- absolute drop in row_count between consecutive days
- relative drop > 10 % per tenant
- count flat for ≥ 7 days on a tenant marked `active`

### 8.2 Orphan detection
Daily query:
```sql
-- WOs with no equipment
SELECT id FROM work_orders WHERE equipment_id IS NULL;
-- WOs whose equipment_id no longer exists
SELECT w.id FROM work_orders w LEFT JOIN cmms_equipment e ON e.id = w.equipment_id
WHERE e.id IS NULL;
-- rows with NULL tenant_id (none should exist post-migration 010)
SELECT 'work_orders' AS t, COUNT(*) FROM work_orders WHERE tenant_id IS NULL;
```
Non-zero result on any → page #alpha-status.

### 8.3 Enum drift check
See §6.3. Runs on every PR plus nightly against prod (read-only).

### 8.4 Migration audit
```sql
CREATE TABLE schema_migrations (
  version    text PRIMARY KEY,                 -- e.g. '010'
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum   text NOT NULL                     -- sha256 of migration file
);
```
Boot-time check compares files in `db/migrations/` to this table; any missing or checksum-mismatched migration logs ERROR and refuses to start the service.

### 8.5 Persistence smoke test
Hourly cron from CHARLIE: create a synthetic WO via the real Hub `POST /api/work-orders` (synthetic tenant `__smoke__`), refetch via `GET`, soft-delete it. Failure → page. This is the canary that would have caught Stardust Racers within an hour.

---

## §9 Acceptance Criteria — "Hardened"

The system is **hardened** when, on a fresh staging environment, every one of the following is green:

1. **Zero data loss on any write path.** For each of the 12 rows in §1, an automated test creates a row, refetches it, asserts equality. Test suite: `tests/data-integrity/`.
2. **Every write returns the created/updated row.** `ast-grep` rule `wip-no-returning` finds zero matches in app code.
3. **Every enum value is validated app-side before DB insert.** `scripts/check_enum_drift.py` exits 0 against staging Postgres.
4. **Every table has RLS** (or is explicitly listed in `docs/security/rls-exceptions.md` with rationale).
5. **Every table has soft-delete** (`deleted_at TIMESTAMPTZ`) — except append-only audit tables.
6. **Every write path has a persistence test.** A row count taken before and after each test increments correctly.
7. **Frontend shows real error state on write failure.** Playwright tests covering Hub UI mutation forms assert that simulating a 500 response produces a visible error, not a green check.
8. **Hourly persistence canary is green for 30 consecutive days** before MVP launch.
9. **Stardust Racers regression test:** a Playwright test that fills out the New WO form, submits, hard-refreshes the list page, and asserts the new WO is visible. Currently RED; must be GREEN before this spec exits draft.

---

## Appendix A — Open questions for Mike

1. Hub UI `ASSET_OPTIONS` is hardcoded mock data. When the new POST handler lands, do we require the asset to exist in `cmms_equipment` (strict), or do we auto-create on submit (the bot pattern)? Recommendation: strict for Hub UI (typed by humans, errors are recoverable), auto-create for bots (text input is messy).
2. `tenant_id DEFAULT 'mike'` — when do we drop the default and force callers to set it explicitly? Suggested: as part of MVP-Unit-9c.
3. Soft-delete retention — how long do we keep `deleted_at IS NOT NULL` rows before vacuum? Suggested: 90 days, then archive to S3.
4. Audit log retention + access — who can read `data_audit_log`? Suggested: tenant admins for their own rows; never cross-tenant.
5. Should §8.5 hourly canary count against tier-limit usage for the synthetic tenant, or bypass it?

## Appendix B — Files cited

- `mira-hub/src/app/(hub)/workorders/new/page.tsx` (the broken form)
- `mira-hub/src/app/api/work-orders/route.ts` (GET-only)
- `mira-hub/src/app/api/work-orders/[id]/route.ts`
- `mira-hub/src/lib/tenant-context.ts` (`withTenantContext`)
- `mira-bots/shared/integrations/hub_neon.py` (the working WO writer)
- `mira-bots/shared/models/work_order.py` (UNS WO model)
- `mira-hub/db/migrations/005_wo_pm_enhancements.sql` (workorderstatus + PM fields)
- `mira-core/mira-ingest/db/migrations/010_tenant_id_on_work_orders_telegram.sql`
- `mira-bots/shared/pm_scheduler.py` (`auto_pm` source writer)
- `mira-bots/shared/engine.py` (`telegram_text` source writer)
