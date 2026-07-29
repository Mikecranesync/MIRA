-- 063_reconcile_staging_schema_drift.sql
--
-- Reconcile persistent-staging schema drift surfaced by migration-verify's RLS
-- integration tests (#2922 + the drift the same job exposed).
--
-- Root cause (§8 in .claude/rules/mira-hub-migrations.md): the persistent
-- staging Neon branch has tables created by SUPERSEDED migrations. Because the
-- canonical migrations use CREATE TABLE IF NOT EXISTS, they skipped re-creation
-- over the pre-existing stale tables, so staging diverged from the repo while
-- the ledger reported "applied". Prod applies migrations post-merge with no
-- pre-existing draft table, so prod has the canonical shape — every statement
-- here is a NO-OP on a canonical/prod table. This is a NEW migration (§8: never
-- edit an applied migration like 032/034/055).
--
-- Two drifted tables the integration tests hit:
--   1. decision_traces  — superseded "user_message/final_reply/llm_latency_ms"
--      shape; the engine writes the canonical 032 column set. Reconciled
--      ADDITIVELY (no data loss): add the canonical insert-contract columns,
--      restore trace_id's default, relax NOT NULL on the superseded columns the
--      insert never populates. (#2922)
--   2. flaky_input_signals — a WHOLESALE-different superseded shape (no
--      source_tag_path / detection_window). Reconciled by a GUARDED drop +
--      recreate to canonical 034 — additive morphing is impractical across two
--      unrelated column sets, and the Phase-9 detector table carries only stale
--      staging rows. The guard drops ONLY when the canonical source_tag_path
--      column is absent, so prod (canonical) is never touched.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. decision_traces — additive reconciliation to the canonical INSERT contract
--    (tenant_id, session_id, platform, uns_path, user_question, tag_evidence,
--     manual_evidence, kg_evidence, recommendation, citations_present,
--     technician_confirmed, outcome, model_used, latency_ms).
-- ══════════════════════════════════════════════════════════════════════════
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
-- staging table created the PK column WITHOUT it, so an INSERT that omits
-- trace_id (the engine's does) fails NOT NULL on the PK. Restore the default.
ALTER TABLE decision_traces ALTER COLUMN trace_id SET DEFAULT gen_random_uuid();

-- Relax NOT NULL on the superseded/optional columns the canonical insert does
-- not populate, so it is not rejected on a drifted table. platform is NULLABLE
-- in canonical 032; the superseded staging table made it NOT NULL. user_message
-- and chat_id are superseded columns absent from canonical. Guarded so each is a
-- no-op when the column doesn't exist (a canonical table).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='decision_traces' AND column_name='platform') THEN
        ALTER TABLE decision_traces ALTER COLUMN platform DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='decision_traces' AND column_name='user_message') THEN
        ALTER TABLE decision_traces ALTER COLUMN user_message DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='decision_traces' AND column_name='chat_id') THEN
        ALTER TABLE decision_traces ALTER COLUMN chat_id DROP NOT NULL;
    END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. flaky_input_signals — guarded drop + recreate to canonical 034.
--    Guard: only when the canonical source_tag_path column is ABSENT (the
--    superseded staging shape). No-op on prod / any canonical table.
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='flaky_input_signals' AND column_name='source_tag_path') THEN
        DROP TABLE IF EXISTS flaky_input_signals CASCADE;
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS ltree;

-- Canonical 034 definition (verbatim shape). CREATE IF NOT EXISTS → no-op when
-- the canonical table already exists (prod); recreates it after the guarded drop
-- (staging).
CREATE TABLE IF NOT EXISTS flaky_input_signals (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    uns_path LTREE,
    source_tag_path TEXT NOT NULL,
    detection_window TEXT NOT NULL,
    transition_count INTEGER,
    stable_peer_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence TEXT
        CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
    evidence_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_suggestion_id UUID REFERENCES ai_suggestions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flaky_input_signals_tenant_time_idx
    ON flaky_input_signals (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flaky_input_signals_open_idx
    ON flaky_input_signals (tenant_id, created_at DESC)
    WHERE status = 'open';
CREATE INDEX IF NOT EXISTS flaky_input_signals_uns_path_gist
    ON flaky_input_signals USING GIST (uns_path);

ALTER TABLE flaky_input_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flaky_input_signals_tenant ON flaky_input_signals;
CREATE POLICY flaky_input_signals_tenant
    ON flaky_input_signals
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON flaky_input_signals TO factorylm_app;
    END IF;
END $$;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- decision_traces changes are additive (non-destructive). The
-- flaky_input_signals recreate only fires on a drifted (staging) table and
-- restores the canonical 034 shape; no rollback is provided (reverting would
-- reintroduce the drift). On a canonical/prod table this migration is a no-op.
