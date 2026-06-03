BEGIN;

-- Migration 033: tag_events — append-only RAW tag-change stream.
--
-- Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md
--   §1.3 ("live_signal_events … needs a tenant-scoped append-only twin") +
--   Phase 4/5. Gap-closure plan: docs/plans/current-state-gap-closure-plan.md
--   §2.3 (Store) + §4.1 (schema refinement).
--
-- WHAT THIS IS
--   The production ingestion stream. Every tag value that arrives through the
--   Phase-2 POST /api/v1/tags/ingest endpoint (from Ignition, the bench
--   bridge, or the mock simulator) lands one row here, append-only. This is
--   the RAW stream — one row per accepted reading, with full provenance.
--
--   It is deliberately a SEPARATE table from:
--     - live_signal_events (Hub 019): the demo-simulator-coupled stream
--       (default simulated=true, source='demo_simulator', component-bound).
--       That table stays for the existing demo path; tag_events is the
--       customer-ingestion twin the master plan called for.
--     - live_signal_cache (Hub 020): the LATEST-value cache (one row per
--       tag). tag_events is the history; the cache is "right now".
--
--   The Phase-5 *meaningful-diff* layer (rising_edge / falling_edge /
--   value_changed / fault_window_*) is derived FROM this raw stream by the
--   diff logger — it is a downstream concern, not this table. See gap-closure
--   plan §4.1. (If a dedicated diff table is later needed it is additive.)
--
-- PROVENANCE — the columns the master plan's first-pass SQL omitted and
--   Phase 2 requires:
--     source_system        : 'ignition' | 'plc_bridge' | 'relay' | 'simulator'
--     source_connection_id  : which configured connection delivered it
--     simulated            : DEFAULT false (production-first; the demo tables
--                            default true). NEVER silently mixed — the ingest
--                            endpoint sets this only when the source declares
--                            itself a simulator.
--     event_timestamp      : when the value was observed at the source
--     ingested_at          : when MIRA received/stored it (clock skew audit)
--
-- VALUE — stored as TEXT canonical form + a value_type discriminator
--   ('bool'|'int'|'float'|'string'|'enum'). This matches the raw-ingestion
--   contract (one column) rather than live_signal_*'s triple text/numeric/bool
--   columns; the reader casts by value_type. quality is the OPC/Sparkplug-style
--   quality band ('good'|'bad'|'stale'|'uncertain').
--
-- KEYING — append-only. event_id UUID PK; logical key (tenant_id,
--   event_timestamp). No UPDATE / DELETE from the app role.
--
-- TENANT ISOLATION — RLS, dual-setting form (matches signal family 019/020/025).
--
-- WHY HUB SCHEMA — ADR-0013: product surface lives in Hub. Command Center
--   freshness (Phase 4) and the future tag-history MCP tools read here.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS tag_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Soft link to the equipment this tag belongs to (kg_entities /
    -- installed_component_instances lineage is dual, so no hard FK — same
    -- pattern as wiring_connections 026). Nullable until resolved.
    equipment_entity_id UUID,

    -- Resolved UNS location, when the ingest endpoint could resolve it.
    -- Nullable: a tag may arrive before its UNS mapping exists.
    uns_path LTREE,

    -- The source-side tag path / topic, exactly as the source named it
    -- (e.g. 'Mira_Monitored/Conveyor/Motor_Current' or a Sparkplug metric).
    tag_path TEXT NOT NULL,

    -- The reading. Canonical TEXT form + discriminator.
    value TEXT,
    value_type TEXT NOT NULL DEFAULT 'string'
        CHECK (value_type IN ('bool', 'int', 'float', 'string', 'enum')),

    -- OPC/Sparkplug-style quality band.
    quality TEXT NOT NULL DEFAULT 'good'
        CHECK (quality IN ('good', 'bad', 'stale', 'uncertain')),

    -- Provenance.
    source_system TEXT NOT NULL,                 -- ignition|plc_bridge|relay|simulator
    source_connection_id TEXT,                   -- which configured connection
    simulated BOOLEAN NOT NULL DEFAULT false,    -- production-first default

    -- Time. observed-at vs received-at (clock-skew audit).
    event_timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Free-form provenance bag (raw quality codes, batch id, units, etc.).
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Idempotency: the master-plan appendix D2 originally named this column 'ts';
-- the implementation was updated to 'event_timestamp' for clarity. On the
-- staging DB the table may already exist with the old column name — rename it
-- here so subsequent index creation succeeds. Also adds the column if somehow
-- missing entirely.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'tag_events'
          AND column_name  = 'ts'
    ) THEN
        ALTER TABLE tag_events RENAME COLUMN ts TO event_timestamp;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'tag_events'
          AND column_name  = 'event_timestamp'
    ) THEN
        ALTER TABLE tag_events ADD COLUMN event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

-- Replay / time scans dominate.
CREATE INDEX IF NOT EXISTS tag_events_tenant_time_idx
    ON tag_events (tenant_id, event_timestamp DESC);

-- "History for this tag".
CREATE INDEX IF NOT EXISTS tag_events_tag_time_idx
    ON tag_events (tenant_id, tag_path, event_timestamp DESC);

-- Subtree queries ("all events under <line>").
CREATE INDEX IF NOT EXISTS tag_events_uns_path_gist
    ON tag_events USING GIST (uns_path);

-- "All real (non-simulated) events" — analytics trust boundary.
CREATE INDEX IF NOT EXISTS tag_events_real_idx
    ON tag_events (tenant_id, event_timestamp DESC)
    WHERE simulated = false;

ALTER TABLE tag_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tag_events_tenant ON tag_events;
CREATE POLICY tag_events_tenant
    ON tag_events
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append-only.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT ON tag_events TO factorylm_app;
    END IF;
END $$;
REVOKE UPDATE, DELETE ON tag_events FROM PUBLIC;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS tag_events_tenant ON tag_events;
-- DROP TABLE IF EXISTS tag_events;
-- COMMIT;
