BEGIN;

-- Migration 038: machine_runs — RUN-CENTRIC fault detection (issue #2341).
--
-- WHAT THIS IS
--   tag_events (mig 033) is the raw reading stream; tag_event_diffs (mig 037)
--   is the meaningful-change stream. This migration adds the RUN layer: it
--   groups a machine's activity into discrete RUNS (a trigger tag's value above
--   a threshold), establishes a per-tag BASELINE over recent normal runs, and
--   records per-run DIFFS where an observed run deviates from that baseline.
--
--   Four tables:
--     machine_run   — one row per detected run (open -> closed/anomalous).
--     run_step      — phases within a run (v1: a single 'default' step/run).
--     run_baseline  — living per-(equipment,tag,phase) baseline aggregate.
--     run_diff      — append-only observed-vs-baseline deviations per run.
--
-- RUN <-> tag_events LINK IS IMPLICIT. A run owns the tag_events rows in
--   [started_at, stopped_at] (widened by the evidence window) with a matching
--   uns_path. We do NOT alter tag_events and store no hard FK to it.
--
-- #2339 HISTORIAN LINK. machine_run is shaped to map onto the Historian Query
--   API's Run DTO (run_id / status / started_at / ended_at). Here the column is
--   `stopped_at`; the adapter maps stopped_at -> ended_at.
--   TODO(#2339): wire PostgresHistorianAdapter.list_runs() against machine_run
--   after both branches merge (trivial SELECT + column rename in the adapter).
--
-- APPEND-ONLY WITH NARROW EXCEPTIONS (enforced by GRANTs, documented per table):
--     machine_run  : INSERT + UPDATE only to CLOSE a run
--                    (stopped_at, duration_seconds, status open->closed/anomalous).
--                    No DELETE.
--     run_step     : INSERT + narrow UPDATE to set ended_at/duration_seconds.
--                    No DELETE.
--     run_baseline : INSERT + UPDATE of the stat fields (it is a living
--                    aggregate). UNIQUE(tenant_id, uns_path, tag_path,
--                    phase_name) drives the upsert. No DELETE.
--     run_diff     : INSERT only (append-only). No UPDATE / DELETE.
--   The app role is granted only the listed verbs; UPDATE/DELETE are REVOKEd
--   from PUBLIC. (The narrow column-level scoping of machine_run/run_step
--   UPDATE is a convention enforced by the writer, not a column GRANT, to keep
--   the policy identical in shape to mig 037.)
--
-- UNIQUE-KEY NOTE (deviation from the plan sketch, documented). The plan
--   sketched run_baseline UNIQUE(tenant_id, equipment_id, tag_path,
--   phase_name). equipment_id is an OPTIONAL UUID (often NULL in v1), and
--   Postgres treats NULLs as distinct, so a NULL equipment_id would break
--   ON CONFLICT upserts. Since the run<->tag_events link is by uns_path (always
--   present), the upsert key uses uns_path instead:
--   UNIQUE(tenant_id, uns_path, tag_path, phase_name). equipment_id is retained
--   as a column for when entity resolution is available.
--
-- TENANT ISOLATION — RLS, dual-setting form (app.tenant_id OR
--   app.current_tenant_id), matching mig 033 / 037.

CREATE EXTENSION IF NOT EXISTS ltree;

-- ─── machine_run ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_run (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Soft link to equipment (optional UUID; no hard FK, same pattern as
    -- tag_events.equipment_entity_id). NULL until entity resolution exists.
    equipment_id UUID,

    -- Resolved UNS location of the equipment that ran. This is the implicit
    -- join key back to tag_events.
    uns_path LTREE NOT NULL,

    -- The trigger that defined the run boundary (config-driven).
    run_trigger_tag TEXT NOT NULL,
    run_trigger_threshold NUMERIC,

    -- Lifecycle. started_at set on the rising edge; stopped_at/duration_seconds
    -- set on close (the only permitted UPDATE).
    started_at TIMESTAMPTZ NOT NULL,
    stopped_at TIMESTAMPTZ,
    duration_seconds NUMERIC,

    -- 'open' on the rising edge; 'closed' or 'anomalous' on close.
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed', 'anomalous')),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS machine_run_tenant_time_idx
    ON machine_run (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS machine_run_tenant_status_idx
    ON machine_run (tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS machine_run_uns_path_gist
    ON machine_run USING GIST (uns_path);

ALTER TABLE machine_run ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS machine_run_tenant ON machine_run;
CREATE POLICY machine_run_tenant
    ON machine_run
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append + narrow UPDATE (close a run). No DELETE.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON machine_run TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON machine_run FROM PUBLIC;

-- ─── run_step ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_step (
    step_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    phase_name TEXT NOT NULL DEFAULT 'default',
    phase_index INTEGER NOT NULL DEFAULT 0,

    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds NUMERIC,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS run_step_run_idx
    ON run_step (run_id, phase_index);
CREATE INDEX IF NOT EXISTS run_step_tenant_time_idx
    ON run_step (tenant_id, started_at DESC);

ALTER TABLE run_step ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_step_tenant ON run_step;
CREATE POLICY run_step_tenant
    ON run_step
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append + narrow UPDATE (set ended_at/duration_seconds). No DELETE.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON run_step TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON run_step FROM PUBLIC;

-- ─── run_baseline ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_baseline (
    baseline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    equipment_id UUID,            -- optional; see UNIQUE-KEY NOTE above
    uns_path LTREE NOT NULL,
    tag_path TEXT NOT NULL,
    phase_name TEXT NOT NULL DEFAULT 'default',

    -- Living aggregate over the last N normal runs (one sample per run = the
    -- run's mean for the tag). stddev is the POPULATION stddev.
    min NUMERIC,
    max NUMERIC,
    avg NUMERIC,
    stddev NUMERIC,
    sample_count INTEGER NOT NULL DEFAULT 0,
    k_sigma NUMERIC NOT NULL DEFAULT 3.0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Upsert key (uns_path, not equipment_id — see UNIQUE-KEY NOTE).
    CONSTRAINT run_baseline_unique
        UNIQUE (tenant_id, uns_path, tag_path, phase_name)
);

CREATE INDEX IF NOT EXISTS run_baseline_tenant_idx
    ON run_baseline (tenant_id, uns_path, tag_path);
CREATE INDEX IF NOT EXISTS run_baseline_uns_path_gist
    ON run_baseline USING GIST (uns_path);

ALTER TABLE run_baseline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_baseline_tenant ON run_baseline;
CREATE POLICY run_baseline_tenant
    ON run_baseline
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Insert + UPDATE of stat fields (living aggregate). No DELETE.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON run_baseline TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON run_baseline FROM PUBLIC;

-- ─── run_diff ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_diff (
    diff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    uns_path LTREE,
    tag_path TEXT NOT NULL,
    phase_name TEXT NOT NULL DEFAULT 'default',

    -- The deviation. observed = this run's mean; baseline = the baseline avg.
    observed NUMERIC,
    baseline NUMERIC,
    delta NUMERIC,
    delta_percent NUMERIC,

    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),

    -- Event-time the diff is anchored to (the run's stop, typically).
    event_timestamp TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS run_diff_run_idx
    ON run_diff (run_id);
CREATE INDEX IF NOT EXISTS run_diff_tenant_time_idx
    ON run_diff (tenant_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS run_diff_tenant_severity_idx
    ON run_diff (tenant_id, severity, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS run_diff_uns_path_gist
    ON run_diff USING GIST (uns_path);

ALTER TABLE run_diff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_diff_tenant ON run_diff;
CREATE POLICY run_diff_tenant
    ON run_diff
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append-only.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT ON run_diff TO factorylm_app;
    END IF;
END $$;
REVOKE UPDATE, DELETE ON run_diff FROM PUBLIC;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS run_diff_tenant ON run_diff;
-- DROP POLICY IF EXISTS run_baseline_tenant ON run_baseline;
-- DROP POLICY IF EXISTS run_step_tenant ON run_step;
-- DROP POLICY IF EXISTS machine_run_tenant ON machine_run;
-- DROP TABLE IF EXISTS run_diff;
-- DROP TABLE IF EXISTS run_baseline;
-- DROP TABLE IF EXISTS run_step;
-- DROP TABLE IF EXISTS machine_run;
-- COMMIT;
