-- Migration 078: decision_traces — per-turn provider/route/usage telemetry.
--
-- WHY (ADR-0037, MIRA-1000 P0003 Part B): ADR-0037 authorizes Cloud Gold — a
-- PAID frontier provider on the chat/diagnosis path — and makes per-turn cost
-- telemetry a PRECONDITION for that traffic, not a Phase-7 follow-up. You cannot
-- enforce a spend budget you cannot measure.
--
-- REUSE, NOT A SECOND LEDGER. P0003 requires searching for an existing durable
-- tenant-scoped run/audit ledger before creating one. `decision_traces` (032) is
-- already exactly that: one append-only row per troubleshooting turn, RLS-scoped
-- by tenant, written non-blocking from the bot runtime
-- (mira-bots/shared/decision_trace.py). It already carries the identity half of
-- what ADR-0037 needs:
--
--     tenant_id      -> tenant            (TEXT since 070 — bot tenants are slugs)
--     session_id     -> conversation
--     trace_id       -> request/run id    (UUID PK)
--     platform       -> client surface
--     model_used     -> model
--     latency_ms     -> latency
--     ts             -> timestamp
--
-- What it lacked is the accounting half. This migration adds ONLY that. No new
-- table, no second canonical run ledger, no change to any existing column.
--
-- P0001 found the pre-existing usage store (`api_usage`) is per-container SQLite
-- at MIRA_DB_PATH, so it cannot answer a cross-tenant spend question at all. That
-- store is NOT dropped here — it stays as the local provider-health counter it
-- already is. This is the durable, tenant-scoped one.
--
-- WHAT IS DELIBERATELY *NOT* STORED. P0003: "Do not put the full prompt or
-- sensitive retrieved data into a billing table merely because it is convenient."
-- These columns hold counts, identifiers and status only. The turn's question and
-- recommendation already live on this table PII-sanitized (032); this migration
-- adds no new free-text payload and no credential material of any kind.
--
-- COST IS STORED AS INPUTS, NOT A FROZEN TOTAL. Provider prices change; a
-- persisted dollar figure silently rots. We store the token counts + provider +
-- model that a price table multiplies, plus an OPTIONAL cost_usd_estimate for the
-- price actually believed at write time. Budget enforcement reads the inputs.
--
-- TENANT TYPE: tenant_id is TEXT on this table (070). Nothing here touches it, so
-- there is no cast and no RLS change — the existing policy keeps applying to the
-- new columns automatically. Per .claude/rules/mira-hub-migrations.md §1, that is
-- deliberate: the bot surfaces that write these rows are slug-tenant surfaces.
--
-- RETENTION: unchanged from 032 — append-only, no app-role UPDATE/DELETE. These
-- columns inherit that. Retention/rollup policy is a separate decision; nothing
-- here creates a new lifecycle.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS throughout, single transaction.

BEGIN;

ALTER TABLE decision_traces
    -- Which provider actually served the turn. Distinct from model_used: the
    -- cascade records "groq"/"cerebras"/"together" here and "groq/<model>" there,
    -- and Cloud Gold would record "openai". This is the column a spend query
    -- groups by.
    ADD COLUMN IF NOT EXISTS provider TEXT,

    -- Which MIRA edition/route was selected and why (e.g. 'cascade:default',
    -- 'cloud_gold:explicit'). ADR-0037 requires Cloud Gold to be an explicit,
    -- never-silent selection; this is the audit of that choice.
    ADD COLUMN IF NOT EXISTS route_reason TEXT,

    -- The acting principal, when the surface knows one. Nullable: several bot
    -- surfaces are chat-id-scoped and have no resolved user. Never an email or
    -- credential — an opaque id.
    ADD COLUMN IF NOT EXISTS principal TEXT,

    -- Token accounting. cached_input_tokens is separate because cached input is
    -- billed at 0.1x on the Responses API (verified 2026-08-19) — folding it into
    -- input_tokens would overstate spend by up to 10x on a cached prefix.
    ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS output_tokens INTEGER,

    -- Cost believed at write time, in USD. NULLABLE and advisory — the inputs
    -- above are the source of truth for any recomputation.
    ADD COLUMN IF NOT EXISTS cost_usd_estimate NUMERIC(12, 6),

    -- Tool calls made during the turn. 0 today (no model-callable tools until
    -- P0005); the column exists so the contract does not need re-cutting then.
    ADD COLUMN IF NOT EXISTS tool_call_count INTEGER,

    -- Provider-call status, distinct from `outcome` (which is the TROUBLESHOOTING
    -- result — did the fix work). A turn can have outcome=NULL and status='error'.
    -- Values: 'ok' | 'empty' | 'error'.
    ADD COLUMN IF NOT EXISTS status TEXT;

-- Spend queries are "this tenant, this window, grouped by provider". Without
-- this the budget check degrades to a seq scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_decision_traces_spend
    ON decision_traces (tenant_id, ts DESC, provider);

COMMENT ON COLUMN decision_traces.provider IS
    'Provider that served the turn (cascade member or cloud gold). ADR-0037 spend telemetry.';
COMMENT ON COLUMN decision_traces.cached_input_tokens IS
    'Cached prefix tokens, billed ~0.1x. Kept separate so spend is not overstated.';
COMMENT ON COLUMN decision_traces.status IS
    'Provider-call status (ok|empty|error) — NOT the troubleshooting outcome.';

COMMIT;
