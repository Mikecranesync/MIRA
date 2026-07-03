BEGIN;

-- Migration 040: machine memory windows + typed anomalies (machine-memory buildout PR 2).
--
-- WHY (discovery evidence)
--   038 cannot represent idle/not-running windows (no run row when the trigger
--   never rises) nor typed anomaly transitions (run_diff has only severity) —
--   see docs/discovery/2026-07-03-machine-memory-buildout.md D2. This migration
--   is ADDITIVE; 038 is never reshaped. This is NOT a machine_events table —
--   tag_events (033) remains the raw stream.
--
-- WHAT
--   1. run_diff gains typed-anomaly columns:
--        diff_type     TEXT  — NULL for existing rows (implicit
--                              'baseline_deviation' semantics) or
--                              'anomaly_<RULE_ID>' (e.g. 'anomaly_A1_COMM_STALE')
--                              for A0–A12 machine-card anomalies.
--        window_id     UUID  — parent machine_state_window when the diff is
--                              anomaly-shaped and no run exists (idle faults).
--        from_event_id UUID  — evidence anchor: first tag_events row of the
--                              condition (soft link, no FK — same discipline as
--                              the implicit run<->tag_events link in 038).
--        to_event_id   UUID  — evidence anchor: last/confirming tag_events row.
--      run_id becomes nullable; a CHECK requires at least one parent
--      (run_id OR window_id).
--   2. machine_state_window — the ONE new table. A state window is a genuinely
--      different concept from a run: it records WHAT STATE the machine was in
--      (idle / comm_down / estopped / …) over an interval, including intervals
--      where no run trigger ever rose and 038 records nothing.
--
-- TENANT ISOLATION — RLS, dual-setting UUID-cast form (app.tenant_id OR
--   app.current_tenant_id), copied verbatim from 038.
--
-- APPEND-ONLY WITH NARROW EXCEPTIONS (mirrors 038):
--   machine_state_window : INSERT + UPDATE only to close a window (ended_at,
--                          metadata refresh). No DELETE.
--   run_diff             : unchanged — INSERT only.

-- ─── run_diff: typed anomalies + evidence pointers ─────────────────────────
ALTER TABLE run_diff ADD COLUMN IF NOT EXISTS diff_type TEXT;
ALTER TABLE run_diff ADD COLUMN IF NOT EXISTS window_id UUID;
ALTER TABLE run_diff ADD COLUMN IF NOT EXISTS from_event_id UUID;
ALTER TABLE run_diff ADD COLUMN IF NOT EXISTS to_event_id UUID;

-- Anomaly rows have no run (idle faults) — parent is the state window instead.
ALTER TABLE run_diff ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE run_diff DROP CONSTRAINT IF EXISTS run_diff_parent_check;
ALTER TABLE run_diff ADD CONSTRAINT run_diff_parent_check
    CHECK (run_id IS NOT NULL OR window_id IS NOT NULL);

-- Idempotency key for the machine-memory worker's anomaly rows: re-processing
-- the same events must not duplicate a typed anomaly within a window.
CREATE UNIQUE INDEX IF NOT EXISTS run_diff_window_anomaly_dedup
    ON run_diff (tenant_id, window_id, diff_type, tag_path, event_timestamp)
    WHERE window_id IS NOT NULL AND diff_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS run_diff_window_idx
    ON run_diff (window_id)
    WHERE window_id IS NOT NULL;

-- ─── machine_state_window ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_state_window (
    window_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    uns_path    LTREE NOT NULL,
    state       TEXT NOT NULL
        CHECK (state IN ('idle', 'running', 'faulted', 'comm_down',
                         'estopped', 'unknown')),
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ,
    -- Evidence anchors (from_event_id / to_event_id) + worker provenance live
    -- in metadata; the window<->tag_events link stays soft, like 038's runs.
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Idempotency key for worker re-runs over the same events.
    CONSTRAINT machine_state_window_unique
        UNIQUE (tenant_id, uns_path, state, started_at)
);

CREATE INDEX IF NOT EXISTS machine_state_window_tenant_time_idx
    ON machine_state_window (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS machine_state_window_uns_path_gist
    ON machine_state_window USING GIST (uns_path);

ALTER TABLE machine_state_window ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS machine_state_window_tenant ON machine_state_window;
CREATE POLICY machine_state_window_tenant
    ON machine_state_window
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append + narrow UPDATE (close a window: set ended_at). No DELETE.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON machine_state_window TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON machine_state_window FROM PUBLIC;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS machine_state_window_tenant ON machine_state_window;
-- DROP TABLE IF EXISTS machine_state_window;
-- DROP INDEX IF EXISTS run_diff_window_anomaly_dedup;
-- DROP INDEX IF EXISTS run_diff_window_idx;
-- ALTER TABLE run_diff DROP CONSTRAINT IF EXISTS run_diff_parent_check;
-- -- NOTE: do NOT re-add NOT NULL to run_id or drop the new columns if any
-- -- anomaly rows exist; the migration is additive and forward-safe.
-- COMMIT;
