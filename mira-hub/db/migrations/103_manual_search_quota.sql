-- Migration 103: manual_search_quota — atomic per-user/tenant/global caps on
-- paid provider (Serper) queries for OEM manual discovery (#4160 S4, PRD R13).
--
-- WHY
-- S1 (#4161) capped provider queries PER CALL (provider_query_budget, default
-- 4, in mira-bots/shared/manual_search/search.py). Nothing bounds how many
-- CALLS a user, a tenant, or the whole system can make per day/month — a
-- single caller could still exhaust the Serper budget. PRD R13: "Hard stops,
-- enforced at the one place searches leave the system … Counters live in
-- Postgres … Before each actual provider request, retries included, a single
-- atomic statement or transaction reserves that query against every
-- applicable counter."
--
-- SHAPE
-- One row per (scope, scope_key, window_start). `scope` is one of
-- 'user_day' | 'tenant_day' | 'global_month'; `window_start` is the UTC day
-- (daily scopes) or the first of the UTC month (the monthly scope) — the
-- column type is `date` for both, so a daily and a monthly row for the same
-- scope_key never collide (different scope). The global row's scope_key is
-- the literal '*' (there is only one system-wide counter).
--
-- WRITER / READER
-- Written ONLY by mira-ask (mira-bots/shared/manual_search/quota.py), via its
-- own direct psycopg2 connection to NEON_DATABASE_URL as the pool OWNER role
-- — NOT through the Hub's `withTenantContext` / factorylm_app pool. No Hub
-- route reads this table (it is operational/billing-adjacent counters, not
-- product data), so this migration deliberately adds NO RLS policy and NO
-- GRANT to factorylm_app (contrast asset_fix_records / 095, a Hub-read table
-- that needs both — see .claude/rules/mira-hub-migrations.md §3).
--
-- CONTENT
-- Holds NO tenant content. `scope_key` is an opaque identifier (a tenant id,
-- or `tenant_id:user_id` for the per-user scope — see quota.py's
-- QuotaIdentity.key() — or '*' for the global scope), never a manufacturer,
-- model, or search string.
--
-- Idempotent, additive-only, single transaction.
-- Rollback: DROP TABLE IF EXISTS manual_search_quota;

BEGIN;

CREATE TABLE IF NOT EXISTS manual_search_quota (
  scope        TEXT NOT NULL CHECK (scope IN ('user_day', 'tenant_day', 'global_month')),
  scope_key    TEXT NOT NULL,
  window_start DATE NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (scope, scope_key, window_start)
);

COMMIT;
