BEGIN;

-- Migration 037: tag_event_diffs — the MEANINGFUL-CHANGE stream.
--
-- Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 5
--   ("historize" — turn raw current state into queryable history).
-- Gap-closure plan: docs/plans/current-state-gap-closure-plan.md §4.1, which
--   explicitly anticipated this table: "The plan's Phase-5 diff-event model
--   (event_type rising/falling/value_changed) is a separate downstream concern:
--   it can be derived from this raw stream by the Phase-5 diff logger, or land
--   as its own tag_event_diffs table later." This is that table.
--
-- WHAT THIS IS
--   One row per *meaningful* transition the TagDiffLogger (mira-relay/
--   tag_diff_logger.py) extracts from the RAW tag_events stream (mig 033).
--   tag_events is every accepted reading; this is only the changes that matter:
--     - rising_edge   : a digital input went 0 → 1
--     - falling_edge  : a digital input went 1 → 0
--     - threshold_cross_high / threshold_cross_low : an analog value crossed a
--       configured threshold (entered / left an alarm band)
--     - quality_degraded / quality_recovered : OPC quality good → bad / bad → good
--     - value_changed : a non-edge value change (catch-all for enums/strings)
--   Fault windows are not a row TYPE — they are an attribute: a diff that falls
--   within ±N seconds of a fault-trigger event is tagged with a shared
--   fault_window_id so "everything around fault X" is one indexed query.
--
--   This table is APPEND-ONLY and DERIVED. It can always be rebuilt by
--   replaying tag_events through the logger, so it carries no truth the raw
--   stream lacks — it is the queryable, pre-computed "what changed" index.
--
-- PROVENANCE — simulated is carried through from the source tag_events rows
--   (NEVER recomputed, NEVER mixed). A diff derived from simulated readings is
--   simulated=true; the partial real-only index mirrors tag_events.
--
-- KEYING — diff_id UUID PK; logical key (tenant_id, event_timestamp). The
--   from_event_id / to_event_id columns point back at the tag_events rows the
--   transition was computed FROM and TO (evidence / replay anchor).
--
-- TENANT ISOLATION — RLS dual-setting form, matching tag_events (033).

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS tag_event_diffs (
    diff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Resolved UNS location (copied from the source tag_events row when present).
    uns_path LTREE,

    -- Source-side tag path, as named by the source.
    tag_path TEXT NOT NULL,

    -- The kind of meaningful change.
    diff_type TEXT NOT NULL CHECK (diff_type IN (
        'rising_edge', 'falling_edge',
        'threshold_cross_high', 'threshold_cross_low',
        'quality_degraded', 'quality_recovered',
        'value_changed'
    )),

    -- The transition, in canonical TEXT form (same discriminator as tag_events).
    prev_value TEXT,
    new_value TEXT,
    value_type TEXT NOT NULL DEFAULT 'string'
        CHECK (value_type IN ('bool', 'int', 'float', 'string', 'enum')),

    -- For analog threshold crossings: which threshold was crossed (the
    -- configured limit), so the row is self-describing without the rule config.
    threshold NUMERIC,

    -- Anchor rows in the raw stream the transition was computed between.
    from_event_id UUID,
    to_event_id UUID,

    -- Fault-window grouping. NULL = not part of a fault window. A shared
    -- fault_window_id groups every diff within ±N s of a fault trigger.
    fault_window_id UUID,

    -- Provenance — carried through from tag_events, never recomputed.
    source_system TEXT,
    simulated BOOLEAN NOT NULL DEFAULT false,

    -- When the transition was observed (event-time, from tag_events) vs when the
    -- logger wrote the diff (process-time, for lag audit).
    event_timestamp TIMESTAMPTZ NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Time scans dominate ("recent changes for tenant").
CREATE INDEX IF NOT EXISTS tag_event_diffs_tenant_time_idx
    ON tag_event_diffs (tenant_id, event_timestamp DESC);

-- "Change history for this tag".
CREATE INDEX IF NOT EXISTS tag_event_diffs_tag_time_idx
    ON tag_event_diffs (tenant_id, tag_path, event_timestamp DESC);

-- "Everything around fault X".
CREATE INDEX IF NOT EXISTS tag_event_diffs_fault_window_idx
    ON tag_event_diffs (fault_window_id)
    WHERE fault_window_id IS NOT NULL;

-- Subtree queries ("all changes under <line>").
CREATE INDEX IF NOT EXISTS tag_event_diffs_uns_path_gist
    ON tag_event_diffs USING GIST (uns_path);

-- Analytics trust boundary — real (non-simulated) changes only.
CREATE INDEX IF NOT EXISTS tag_event_diffs_real_idx
    ON tag_event_diffs (tenant_id, event_timestamp DESC)
    WHERE simulated = false;

ALTER TABLE tag_event_diffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tag_event_diffs_tenant ON tag_event_diffs;
CREATE POLICY tag_event_diffs_tenant
    ON tag_event_diffs
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append-only.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT ON tag_event_diffs TO factorylm_app;
    END IF;
END $$;
REVOKE UPDATE, DELETE ON tag_event_diffs FROM PUBLIC;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS tag_event_diffs_tenant ON tag_event_diffs;
-- DROP TABLE IF EXISTS tag_event_diffs;
-- COMMIT;
