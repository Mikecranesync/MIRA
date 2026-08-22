-- Migration 080: per-turn provider spend telemetry on decision_traces.
--
-- WHY 080 AND NOT 078
-- The unmerged MIRA-1000 P0003 branch (#3342) carries
-- `078_decision_traces_provider_usage.sql` with these same columns. That branch
-- is not on main and 078 is a GAP in main's sequence (…077, 079…). Reusing the
-- filename would be unsafe: `migration-verify.yml` auto-applies migrations to the
-- PERSISTENT staging branch for any PR touching this directory, and migration 066
-- records a content hash per filename — so a same-name/different-content file
-- fails the hash guard, while a same-name/same-content file is indistinguishable
-- from the draft that may already be recorded there. Reusing the NUMBER under a
-- different name only adds ordering ambiguity (rules §7).
--
-- So this takes the next free integer (080 is unused on main AND on #3342) while
-- keeping 078's column names and types EXACTLY. Consequence: if #3342 ever
-- merges, its 078 becomes a harmless no-op — every statement here is
-- `IF NOT EXISTS`, and the two files agree column for column. Whichever lands
-- first wins; the second is a no-op. No conflict, no drift, no re-approval.
--
-- WHAT THIS ENABLES
-- PR #3359 gave the Hub notebook-chat turn a canonical usage record (provider,
-- tokens, cached tokens, estimated cost, fallback chain) but only emitted it as
-- an SSE frame and a log line. Logs rotate; you cannot ask a log "what did this
-- tenant spend last week". ADR-0037 gates Cloud Gold on per-turn spend telemetry,
-- which means queryable, not greppable. These columns are that ledger.
--
-- TENANT TYPE: decision_traces.tenant_id is **TEXT** since migration 070 (not
-- UUID). The RLS policy compares in-type with NO cast, and its WITH CHECK applies
-- to INSERT. Callers must pass the tenant as text; `withTenantContext` sets both
-- `app.tenant_id` and `app.current_tenant_id`, so the policy is satisfied.
--
-- GRANTS: migration 032 already grants SELECT, INSERT on decision_traces to
-- factorylm_app. This migration inserts nothing and needs no new grant — a fresh
-- GRANT here would widen privilege for no reason.
--
-- Idempotent, additive-only, single transaction. Applied via migration-verify
-- (staging) / apply-migrations.yml (prod) only. NOT applied to production by this
-- change.
--
-- Rollback:
--   ALTER TABLE decision_traces
--     DROP COLUMN IF EXISTS provider,
--     DROP COLUMN IF EXISTS route_reason,
--     DROP COLUMN IF EXISTS principal,
--     DROP COLUMN IF EXISTS input_tokens,
--     DROP COLUMN IF EXISTS cached_input_tokens,
--     DROP COLUMN IF EXISTS output_tokens,
--     DROP COLUMN IF EXISTS cost_usd_estimate,
--     DROP COLUMN IF EXISTS tool_call_count,
--     DROP COLUMN IF EXISTS status;
--   DROP INDEX IF EXISTS idx_decision_traces_spend;

BEGIN;

ALTER TABLE decision_traces
    ADD COLUMN IF NOT EXISTS provider            TEXT,
    ADD COLUMN IF NOT EXISTS route_reason        TEXT,
    ADD COLUMN IF NOT EXISTS principal           TEXT,
    ADD COLUMN IF NOT EXISTS input_tokens        INTEGER,
    ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS output_tokens       INTEGER,
    ADD COLUMN IF NOT EXISTS cost_usd_estimate   NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS tool_call_count     INTEGER,
    ADD COLUMN IF NOT EXISTS status              TEXT;

-- "What did this tenant spend, recently, by provider" — the ADR-0037 question.
CREATE INDEX IF NOT EXISTS idx_decision_traces_spend
    ON decision_traces (tenant_id, ts DESC, provider);

COMMENT ON COLUMN decision_traces.provider IS
    'Provider that served the turn (cascade member or cloud gold). ADR-0037 spend telemetry.';
COMMENT ON COLUMN decision_traces.route_reason IS
    'Why this provider served: primary | fallback:<failed,…> | exhausted:<…>. Makes a degraded cascade visible.';
COMMENT ON COLUMN decision_traces.cached_input_tokens IS
    'Cached prefix tokens, billed ~0.1x. Kept separate so spend is not overstated.';
COMMENT ON COLUMN decision_traces.cost_usd_estimate IS
    'ESTIMATE from published per-Mtok prices, not billing truth. NULL (never 0) when the provider is unpriced or usage was not reported — 0 would read as "this turn was free".';
COMMENT ON COLUMN decision_traces.status IS
    'Provider-call status (ok|empty|error|capped) — NOT the troubleshooting outcome.';

COMMIT;
