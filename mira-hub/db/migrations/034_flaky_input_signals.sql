BEGIN;

-- Migration 034: flaky_input_signals — detected signal-instability records.
--
-- Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md
--   Phase 1 schema (table) + Phase 9 (detector job + D6 rule). Gap-closure
--   plan: docs/plans/current-state-gap-closure-plan.md §2.6 (Pattern).
--
-- WHAT THIS IS
--   One row per detected unstable input — a prox switch chattering, a
--   brown-out, an intermittent disconnect, an analog spike. The Phase-9
--   detector (out of this work stream's 0–4 scope) reads tag_events over a
--   rolling window and writes a row here when a rule fires. Each row bridges
--   to an ai_suggestions row (suggestion type added by the detector phase)
--   so the Hub /proposals reviewer queue surfaces it — alerts do NOT push to
--   Slack until human-validated (alarm-fatigue avoidance, master plan Phase 9).
--
--   This migration ships the TABLE now (Phase 1) so the detector phase has a
--   stable target. The detection logic itself is not in this migration.
--
-- COLUMNS — the gap-closure task's instability shape:
--   detection_window  : human-readable window descriptor ('1h', '15m', ...)
--   transition_count  : observed transitions in the window
--   stable_peer_tags  : JSONB list of correlated tags that did NOT flicker
--                       (evidence the instability is isolated to this input)
--   confidence        : low|medium|high band (matches uns-resolver convention)
--   evidence_event_ids: JSONB list of tag_events.event_id that triggered it
--   status            : open|acknowledged|resolved|false_positive (mutable)
--
-- TENANT ISOLATION — RLS dual-setting form. NOT append-only: status
--   transitions (open → acknowledged → resolved) require UPDATE.
--
-- WHY HUB SCHEMA — ADR-0013. The reviewer queue is a Hub surface.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS flaky_input_signals (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Where the unstable input lives.
    uns_path LTREE,
    source_tag_path TEXT NOT NULL,

    -- The detection window + what was seen.
    detection_window TEXT NOT NULL,              -- '1h' | '15m' | ...
    transition_count INTEGER,

    -- Tags in the same neighbourhood that stayed stable — evidence the
    -- flicker is isolated to this input, not a plant-wide event.
    stable_peer_tags JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Confidence band (low|medium|high) — same convention as the UNS resolver.
    confidence TEXT
        CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),

    -- The tag_events rows that triggered this alert.
    evidence_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Bridge to the reviewer queue (the suggestion type is added by the
    -- Phase-9 detector). Soft reference — nullable until bridged.
    ai_suggestion_id UUID REFERENCES ai_suggestions(id) ON DELETE SET NULL,

    -- Lifecycle.
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency guard: earlier versions of this migration lacked created_at /
-- updated_at. If the table was created from that older schema, add them now.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'flaky_input_signals'
          AND column_name  = 'created_at'
    ) THEN
        ALTER TABLE flaky_input_signals
            ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'flaky_input_signals'
          AND column_name  = 'updated_at'
    ) THEN
        ALTER TABLE flaky_input_signals
            ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS flaky_input_signals_tenant_time_idx
    ON flaky_input_signals (tenant_id, created_at DESC);

-- Reviewer queue reads open alerts.
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
-- BEGIN;
-- DROP POLICY IF EXISTS flaky_input_signals_tenant ON flaky_input_signals;
-- DROP TABLE IF EXISTS flaky_input_signals;
-- COMMIT;
