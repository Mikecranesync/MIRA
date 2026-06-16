# PRD: Database Fixes for Public Launch
**Status:** Draft  
**Date:** 2026-05-02  
**Priority:** P0 — Blocks public launch  
**Scope:** All users, all knowledge data, multi-tenant correctness

---

## Problem Statement

MIRA's database was built incrementally for a single internal user (`'mike'`). As the system opens to public users, seven distinct DB problems prevent new users from getting any value on first use. The benchmark score of 73.3 (Grade C) with technical accuracy at 60.9 is a direct consequence of these issues — not of model quality.

This PRD covers every DB-layer fix required before public users are onboarded. It does not cover UI, onboarding flow, or inference tuning.

---

## Issue Inventory

### Issue 1 — CRITICAL: Four Competing Tenant ID Systems

**What's broken:**

| Table | Tenant ID in use | Row count |
|---|---|---|
| `knowledge_entries` | `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` (UUID) | 74,744 |
| `fault_codes` | same UUID | 551 |
| `kb_chunks` | `'mike'` (string) | 67 |
| `hub_users` | `'mike'` (14 users) + UUIDs (22 users) | 36 |
| `mira_users` | N/A | **0** |
| `tenants` | UUID | 1 |

The RAG worker (`neon_recall.py`) queries `knowledge_entries` by tenant UUID. The 14 users stored under `'mike'` in `hub_users` will never find any knowledge when they query because their tenant ID doesn't match the knowledge pool. `kb_chunks` (67 rows) is queried by nothing — it is dead data.

**Fix required:**
1. Migrate all `hub_users` rows with `tenant_id = 'mike'` to the canonical UUID `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`
2. Migrate all `kb_chunks` rows with `tenant_id = 'mike'` to the same UUID, then backfill embeddings via `mira-ingest`
3. Add a DB constraint: `tenant_id` must be a valid UUID in all tenant-scoped tables — reject string slugs at the DB level
4. Delete or archive `kb_chunks` after migration (the canonical table is `knowledge_entries`)

**Acceptance criteria:**
- `SELECT COUNT(*) FROM hub_users WHERE tenant_id NOT SIMILAR TO '[0-9a-f-]{36}'` = 0
- `SELECT COUNT(*) FROM kb_chunks WHERE tenant_id NOT SIMILAR TO '[0-9a-f-]{36}'` = 0
- All 14 formerly-`'mike'` users can recall knowledge entries

---

### Issue 2 — CRITICAL: `MIRA_SHARED_TENANT_ID` Not Set in Doppler

**What's broken:**

`neon_recall.py` has this logic:
```python
SHARED_TENANT_ID = os.getenv("MIRA_SHARED_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3")
```

The env var is not set in Doppler (`factorylm/prd`). Every new public user gets their own tenant UUID. When they query, `neon_recall` runs:
```sql
WHERE tenant_id = :tid OR tenant_id = :shared_tid
```
If `MIRA_SHARED_TENANT_ID` isn't set, the fallback default in code is correct today — but this is a silent single point of failure. If the default is ever changed, updated, or the env var is set to empty, every new user gets zero shared knowledge with no error.

**Fix required:**
1. Set `MIRA_SHARED_TENANT_ID = 78917b56-f85f-43bb-9a08-1bb98a6cd6c3` explicitly in Doppler `factorylm/prd`
2. Add startup assertion in `neon_recall.py`: if `MIRA_SHARED_TENANT_ID` resolves to the same value as `MIRA_TENANT_ID` and there is only one tenant, log a warning — it means the shared pool and private pool are the same (fine for dev, wrong for multi-tenant prod)
3. Add integration test: new tenant UUID with zero private knowledge_entries still retrieves shared knowledge

**Acceptance criteria:**
- `doppler run -- printenv MIRA_SHARED_TENANT_ID` returns the correct UUID
- A query using a fresh tenant UUID returns ≥ 1 shared knowledge result
- No silent fallback path — missing env var logs `ERROR` at startup, not silence

---

### Issue 3 — CRITICAL: New User Gets Zero Knowledge on First Query

**What's broken:**

A new user signs up → gets a new tenant UUID → their `knowledge_entries` count = 0. The shared pool exists but is only accessible if Issue 2 is resolved. Even then, the shared pool has no knowledge of their specific equipment. There is no onboarding flow that seeds their tenant with baseline knowledge.

**Fix required:**
1. On new tenant provisioning (triggered from `plg_tenants` row creation), enqueue a knowledge seed job that copies a curated baseline set of shared knowledge atoms into the new tenant's scope (or verifies shared pool access works)
2. Create a `tenant_onboarding_state` table (or add column to `plg_tenants`) that tracks: `knowledge_seeded_at`, `first_query_at`, `first_successful_recall_at` — so we can measure and debug new user knowledge gaps
3. The 551 `fault_codes` rows are shared by UUID — verify new tenant can access them via `neon_recall` fault code path

**Acceptance criteria:**
- New tenant provisioned → within 60 seconds, `neon_recall.recall_knowledge(embedding, new_tenant_id, ...)` returns ≥ 5 results
- `fault_codes` lookup works for new tenant with zero private knowledge
- `tenant_onboarding_state.knowledge_seeded_at` is populated on provisioning

---

### Issue 4 — HIGH: 21 of 23 `plg_tenants` Stuck in `pending` Provisioning

**What's broken:**

```
plg_tenants provisioning_status:
  ok:      1
  failed:  1
  pending: 21
```

21 accounts signed up and were never provisioned. They received no Atlas CMMS account, no activation email (status `pending`), and no working access. These are real users who tried MIRA and got nothing.

**Fix required:**
1. Audit all 21 pending rows — check if `provisioning_last_error` reveals a pattern
2. Fix the root cause blocking provisioning (likely Atlas API credentials, webhook, or async job failure)
3. Re-trigger provisioning for all 21 rows with valid emails (exclude `never-actually-registered-*` test rows)
4. Add alerting: any `plg_tenants` row remaining in `pending` > 5 minutes triggers a Discord notification to `#alpha-status`
5. Add idempotent provisioning retry — `provisioning_attempts` column exists but the retry logic is not running

**Acceptance criteria:**
- All non-test `plg_tenants` rows reach `ok` status or have a logged failure reason
- New signup → `ok` provisioning status within 60 seconds in staging
- Alert fires if provisioning stalls

---

### Issue 5 — HIGH: `mira_users` Table is Empty — User Activity Blind Spot

**What's broken:**

`mira_users` has 0 rows. The table exists with `id`, `tenant_id`, `display_name`, `email`, `created_at`, `updated_at` columns but is never populated. All user tracking flows through `hub_users` with no MIRA-specific metadata. This means:
- No per-user interaction history
- No per-user equipment context
- Cannot personalize responses per user
- Cannot track which users are getting bad answers

**Fix required:**
1. Populate `mira_users` on user creation in the Telegram and Hub flows — one row per user, linked to their `hub_users` tenant
2. Add `telegram_user_id` column to `mira_users` so Telegram users are linked by account, not just session
3. Ensure `interaction_log` (existing table) writes `mira_user_id` FK for every exchange so we can trace quality per user

**Acceptance criteria:**
- `SELECT COUNT(*) FROM mira_users` > 0 within 24 hours of fix deploy
- Every `interaction_log` row has a non-null `mira_user_id` (or `telegram_user_id`)
- `SELECT COUNT(*) FROM mira_users JOIN interaction_log ON ...` works without nulls

---

### Issue 6 — HIGH: `knowledge_gaps` Table Not Being Written

**What's broken:**

`knowledge_gaps` has 0 rows. The table is designed to capture queries MIRA cannot answer — manufacturer/model combos with low confidence. This is the primary mechanism for the system to get smarter over time. If it's not writing, every unanswered question disappears instead of feeding the crawler.

**Fix required:**
1. Find the code path that should write to `knowledge_gaps` and verify it's wired (check `rag_worker.py`, `engine.py` for gap logging calls)
2. If the write path exists but is gated, un-gate it
3. If the write path doesn't exist, implement it: any query where `top_score < 0.50` and no fault code match → insert row into `knowledge_gaps` with manufacturer/model extracted from the query
4. Wire `knowledge_gaps` to the crawler: any gap with `occurrence_count >= 2` should auto-enqueue a `kb_ingest_job` for that manufacturer/model

**Acceptance criteria:**
- Run 10 queries for equipment not in the KB → `SELECT COUNT(*) FROM knowledge_gaps` = 10
- Any gap with `occurrence_count >= 2` appears in `kb_ingest_jobs` within 60 seconds

---

### Issue 7 — MEDIUM: `kb_ingest_jobs` Dead Since January — Ingestion Pipeline Stalled

**What's broken:**

```
kb_ingest_jobs: 7 rows, all from 2026-01-20
  completed: 5 (but atoms_created = 0 on all)
  pending:   2 (stuck for 3+ months)
```

Every completed job created 0 atoms and has `source = null`. The ingest pipeline ran but produced nothing. The 2 pending jobs have been stuck since January with no worker picking them up.

**Fix required:**
1. Investigate why all completed jobs have `atoms_created = 0` — was the worker crashing silently after marking complete?
2. Clear the 2 stale `pending` rows (or re-queue them with valid source URLs)
3. Verify `mira-ingest` worker is running and healthy — add heartbeat to `kb_worker_heartbeats` table (already exists)
4. Add `kb_ingest_jobs.error_message` population on failure — currently null on all rows
5. Add a daily job that checks for `pending` rows older than 1 hour and either retries or marks `failed`

**Acceptance criteria:**
- `SELECT * FROM kb_worker_heartbeats ORDER BY last_seen DESC LIMIT 1` shows heartbeat < 5 minutes old
- Any new `kb_ingest_job` row with valid URL → atoms created within 10 minutes
- No `pending` rows older than 1 hour without a logged retry or failure

---

### Issue 8 — MEDIUM: `fault_codes.action` Has Mixed Format (String vs JSON Array)

**What's broken:**

Some `fault_codes.action` values are plain strings. Others are PostgreSQL array literals:
```
{"1. Check parameter 94...","2. Check parameter 95..."}
```
This means the bot receives inconsistently formatted action steps. Plain text is rendered correctly; JSON arrays are displayed as raw `{"step1","step2"}` strings — ugly and confusing for users.

**Fix required:**
1. Write a migration that normalizes all `fault_codes.action` values: parse PostgreSQL array literals → join as numbered plain text
2. Add a DB check constraint or trigger that rejects future inserts of raw array literals into `action`
3. Verify the fault code insert path in the ingest pipeline formats actions as plain text before writing

**Acceptance criteria:**
- `SELECT COUNT(*) FROM fault_codes WHERE action LIKE '{"%'` = 0
- Sample 20 `fault_codes.action` values — all are readable plain text

---

## Implementation Order

| # | Issue | Effort | Impact | Do first |
|---|---|---|---|---|
| 2 | Set `MIRA_SHARED_TENANT_ID` in Doppler | 5 min | Unblocks all new users immediately | **Yes — do now** |
| 8 | Normalize `fault_codes.action` format | 30 min | Fixes E-OC class failures in benchmark | **Yes — do now** |
| 1 | Migrate `'mike'` tenant IDs to UUID | 2 hrs | Fixes 14 existing users | Sprint 1 |
| 4 | Fix plg_tenants provisioning pipeline | 4 hrs | Unblocks 21 waiting users | Sprint 1 |
| 3 | New user knowledge seed on provisioning | 4 hrs | All future public users get value day 1 | Sprint 1 |
| 5 | Populate `mira_users` table | 2 hrs | User tracking, personalization | Sprint 2 |
| 6 | Wire `knowledge_gaps` writes | 3 hrs | Self-improving KB | Sprint 2 |
| 7 | Fix ingest pipeline stall | 4 hrs | KB growth resumes | Sprint 2 |

---

## Out of Scope for This PRD

- UI/UX elegance
- Onboarding flow design  
- Inference model tuning
- Response quality improvements beyond what DB fixes deliver
- `manual_chunks` table population (Docling feature flag) — separate PRD

---

## Success Metrics

| Metric | Current | Target after fixes |
|---|---|---|
| New user first-query recall rate | Unknown (likely 0) | ≥ 5 chunks returned |
| Benchmark technical score | 60.9 | ≥ 75 |
| plg_tenants provisioning success | 4% (1/23) | 95%+ |
| knowledge_gaps written per day | 0 | ≥ 1× query volume with low confidence |
| mira_users populated | 0 | 100% of active users |
| fault_codes action format | Mixed | 100% plain text |
