-- 063_reconcile_decision_traces_insert_contract.sql
--
-- Fix #2922 — decision_traces telemetry inserts silently skipped on staging.
--
-- Root cause: staging's decision_traces table was created by a SUPERSEDED
-- migration (an older "user_message / final_reply / retrieval_set /
-- llm_latency_ms" design), NOT the canonical 032_decision_traces.sql shape the
-- engine writes ("user_question / recommendation / tag_evidence / latency_ms").
-- 032 uses CREATE TABLE IF NOT EXISTS, so it skipped re-creation over the
-- pre-existing stale table (the §8 silent-drift trap in
-- .claude/rules/mira-hub-migrations.md). Result: mira-bots/shared/decision_trace.py
-- INSERTs a column set the staging table doesn't have -> psycopg2 UndefinedColumn
-- -> the insert is caught and the trace is dropped. Prod applies migrations
-- post-merge with no pre-existing draft table, so prod has the canonical shape;
-- this reconciles any env that drifted.
--
-- Approach: NON-DESTRUCTIVE + idempotent. We do NOT DROP the table — a drop
-- would (a) be dangerous on prod and (b) revert migration 055's additions. We
-- only (1) ADD the canonical insert-contract columns if absent and (2) relax the
-- NOT NULL constraints on the superseded columns the current insert never
-- populates, so the canonical INSERT succeeds on a drifted table. On a canonical
-- table every statement here is a no-op. This is a NEW migration (§8: never edit
-- an applied migration like 032/055).
--
-- The canonical INSERT (decision_trace.py) targets:
--   tenant_id, session_id, platform, uns_path, user_question,
--   tag_evidence, manual_evidence, kg_evidence, recommendation,
--   citations_present, technician_confirmed, outcome, model_used, latency_ms

BEGIN;

-- 1. Add the canonical insert-contract columns that a drifted table lacks.
--    Types/defaults mirror 032_decision_traces.sql. user_question is added
--    NULLABLE here (032 declares it NOT NULL) so existing drifted rows are not
--    invalidated; the engine always supplies it on write.
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS user_question TEXT;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS tag_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS manual_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS kg_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS recommendation TEXT;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS technician_confirmed BOOLEAN;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

-- Canonical 032 declares trace_id with DEFAULT gen_random_uuid(); the superseded
-- staging table created the PK column WITHOUT that default, so an INSERT that
-- omits trace_id (the engine's does) fails NOT NULL on the PK. Restore the
-- default. Idempotent (no-op when already set). gen_random_uuid() is core in
-- PG13+ (Neon is PG15/16).
ALTER TABLE decision_traces ALTER COLUMN trace_id SET DEFAULT gen_random_uuid();

-- 2. Relax NOT NULL on the superseded columns the current insert does not
--    populate, so an INSERT of the canonical column set is not rejected on a
--    drifted (staging) table. Guarded: no-op when the column is absent (a
--    canonical table never had these).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'decision_traces' AND column_name = 'user_message'
    ) THEN
        ALTER TABLE decision_traces ALTER COLUMN user_message DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'decision_traces' AND column_name = 'chat_id'
    ) THEN
        ALTER TABLE decision_traces ALTER COLUMN chat_id DROP NOT NULL;
    END IF;
END $$;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- Non-destructive + additive; no rollback needed. (Re-adding NOT NULL to
-- user_message/chat_id would require every row to be populated and is not
-- desired — the columns are superseded.)
