BEGIN;

-- Migration 020: live_signal_cache + diagnostic trend session tables.
-- Spec: docs/plans/2026-05-14-demo-backend-plan.md (Phases 4–6 of the
-- 2026-05-15 PR — extends the live signal layer landed in migration 019).
--
-- Three demo-driven tables. RLS-scoped per tenant. Indexes sized for one
-- demo tenant with a handful of components; re-tune when real production
-- load lands.
--
--   live_signal_cache
--     Denormalized current state for one (tenant_id, plc_tag) topic. The
--     events table (live_signal_events from 019) is the truth log; this
--     cache is the "what is it RIGHT NOW" read path the tablet polls when
--     it only needs the latest value (e.g. "is PE-001 currently blocked?"
--     without scanning history).
--
--     Keyed on plc_tag (the MQTT-shaped topic) — not component_id —
--     because a tag can exist before a component is bound, and a single
--     component may republish multiple tags. component_id is captured
--     when known (resolved via installed_component_instances at write
--     time) but does not participate in the UNIQUE key.
--
--   diagnostic_trend_sessions
--     A recording window opened during troubleshooting. When MIRA proposes
--     "let's watch PE-001, the run command, and VFD faulted for the next
--     two minutes", it opens a row here with the watched topics. The end
--     of the window is recorded by `ended_at`; status flips to
--     'completed' or 'abandoned'.
--
--     The trend session is linked optionally to a troubleshooting_session
--     so the tablet can show captured signals alongside the chat turn
--     that proposed them.
--
--   diagnostic_trend_signals
--     Append-only capture of signal samples observed during a trend
--     session. Populated by the trend-append endpoint (explicit write)
--     OR by a read-time JOIN against live_signal_events filtered by
--     trend_session.watched_topics and the trend window. The migration
--     creates the table; the read path is the source of truth for the
--     demo and lets the tablet show "what we saw" without coupling the
--     signal recorder to active-trend state.

CREATE TABLE IF NOT EXISTS live_signal_cache (
    tenant_id UUID NOT NULL,
    plc_tag TEXT NOT NULL,

    -- Resolved at write time when the tag maps to a known component.
    -- Nullable because tags can publish before a component is bound.
    component_id UUID,

    -- Latest value. Same three-column shape as live_signal_events.
    last_value_text TEXT,
    last_value_numeric DOUBLE PRECISION,
    last_value_bool BOOLEAN,

    -- When the last sample arrived (regardless of whether it was an edge).
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- When the value last *changed*. Updated only when the incoming value
    -- differs from the previous value (rising/falling edge for booleans,
    -- numeric inequality for numerics, string inequality for text).
    last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The previous value, captured at the moment of the most recent change.
    -- Lets the tablet show "was IDLE_CLEAR, now ITEM_PRESENT" without a
    -- second query against events.
    prev_value_text TEXT,
    prev_value_numeric DOUBLE PRECISION,
    prev_value_bool BOOLEAN,

    -- Provenance carried forward from the last event.
    simulated BOOLEAN NOT NULL DEFAULT true,
    source TEXT NOT NULL DEFAULT 'demo_simulator',
    properties JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, plc_tag),

    CONSTRAINT cache_value_present CHECK (
        last_value_text IS NOT NULL
        OR last_value_numeric IS NOT NULL
        OR last_value_bool IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_signal_cache_component
    ON live_signal_cache (tenant_id, component_id)
    WHERE component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_cache_changed_at
    ON live_signal_cache (tenant_id, last_changed_at DESC);

ALTER TABLE live_signal_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_cache_tenant ON live_signal_cache;
CREATE POLICY signal_cache_tenant
    ON live_signal_cache
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


CREATE TABLE IF NOT EXISTS diagnostic_trend_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Optional parent troubleshooting session. When set, the tablet shows
    -- captured trend signals inline with the chat turn that proposed the
    -- trend. Nullable for unattended/ad-hoc trends started from the API.
    troubleshooting_session_id UUID,

    -- What we're watching and why.
    name TEXT NOT NULL,                  -- e.g. "Motor restart investigation"
    hypothesis TEXT,                     -- one-line statement under test
    watched_topics TEXT[] NOT NULL DEFAULT '{}',  -- plc_tag list

    -- Demo trends are scoped to one asset for clarity.
    asset_id UUID,

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned')),

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,                -- NULL while active
    duration_seconds INTEGER,            -- nullable; set on completion

    -- What we concluded. Filled in when the technician (or MIRA) closes the
    -- trend with a verdict.
    conclusion TEXT,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_sessions_tenant
    ON diagnostic_trend_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trend_sessions_session
    ON diagnostic_trend_sessions (tenant_id, troubleshooting_session_id)
    WHERE troubleshooting_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trend_sessions_active
    ON diagnostic_trend_sessions (tenant_id, status)
    WHERE status = 'active';

ALTER TABLE diagnostic_trend_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trend_sessions_tenant ON diagnostic_trend_sessions;
CREATE POLICY trend_sessions_tenant
    ON diagnostic_trend_sessions
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


CREATE TABLE IF NOT EXISTS diagnostic_trend_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trend_session_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    plc_tag TEXT NOT NULL,
    component_id UUID,

    value_text TEXT,
    value_numeric DOUBLE PRECISION,
    value_bool BOOLEAN,

    -- Edge marker for boolean tags. NULL when the sample was a steady-state
    -- read (numeric, or boolean equal to the previous).
    edge_direction TEXT CHECK (edge_direction IN ('rising', 'falling')),

    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT trend_signal_value_present CHECK (
        value_text IS NOT NULL
        OR value_numeric IS NOT NULL
        OR value_bool IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_trend_signals_session
    ON diagnostic_trend_signals (trend_session_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_trend_signals_tenant_tag
    ON diagnostic_trend_signals (tenant_id, plc_tag, captured_at DESC);

ALTER TABLE diagnostic_trend_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trend_signals_tenant ON diagnostic_trend_signals;
CREATE POLICY trend_signals_tenant
    ON diagnostic_trend_signals
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


-- Grant the limited app role used by withTenantContext. Mirrors 019.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON live_signal_cache TO factorylm_app;
        GRANT SELECT, INSERT, UPDATE ON diagnostic_trend_sessions TO factorylm_app;
        GRANT SELECT, INSERT ON diagnostic_trend_signals TO factorylm_app;
    END IF;
END $$;

COMMIT;
