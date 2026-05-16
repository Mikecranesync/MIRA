BEGIN;

-- Migration 019: Troubleshooting sessions + live signal events.
-- Spec: docs/plans/2026-05-14-demo-backend-plan.md (Phase 3 + Phase 5)
--
-- Two demo-driven tables:
--
--   troubleshooting_sessions
--     One row per technician troubleshooting interaction (Slack thread, tablet
--     session, Telegram chat). Holds the confirmed namespace context (asset,
--     optional component) plus an append-only transcript. The North Star
--     "no confirmed namespace context, no troubleshooting" rule is enforced
--     at the API layer by reading status='confirmed' before allowing
--     /api/mira/ask to invoke the LLM.
--
--   live_signal_events
--     Append-only stream of signal samples for a component's PLC tag. For
--     the May 21 demo we don't subscribe to MQTT — the simulator endpoint
--     (POST /api/demo/signals/toggle) writes rows here, and the tablet polls
--     the latest. `simulated` defaults TRUE so we never confuse fake samples
--     for real telemetry once the real MQTT bridge lands.
--
-- Both tables are tenant-scoped with RLS. Indexes are sized for the demo
-- (single tenant, ~5 components, ~hundreds of signal events) — re-tune when
-- we have real production load.

CREATE TABLE IF NOT EXISTS troubleshooting_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Confirmed namespace context — the gate.
    -- asset_id is REQUIRED before status can advance past 'awaiting_namespace'.
    -- component_id is OPTIONAL (a session may target a whole asset rather than
    -- one component).
    asset_id UUID,
    component_id UUID,

    -- Who's troubleshooting. Nullable so unattended demo sessions still work.
    technician_user_id UUID,
    channel TEXT NOT NULL DEFAULT 'tablet'
        CHECK (channel IN ('tablet', 'slack', 'telegram', 'web', 'other')),

    status TEXT NOT NULL DEFAULT 'awaiting_namespace'
        CHECK (status IN ('awaiting_namespace', 'confirmed', 'resolved', 'abandoned')),

    confirmed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,

    -- Append-only history of turns. Shape:
    --   [{ "role": "user"|"assistant"|"system", "content": "...",
    --      "ts": "ISO8601", "evidence": [...] }]
    transcript JSONB NOT NULL DEFAULT '[]',

    -- Free-form bag for demo-only metadata (asset_tag, ip_of_tablet, etc.).
    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant
    ON troubleshooting_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_asset
    ON troubleshooting_sessions (tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status
    ON troubleshooting_sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_recent
    ON troubleshooting_sessions (tenant_id, created_at DESC);

ALTER TABLE troubleshooting_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_tenant ON troubleshooting_sessions;
CREATE POLICY sessions_tenant
    ON troubleshooting_sessions
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


CREATE TABLE IF NOT EXISTS live_signal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Either component_id (preferred) or plc_tag (fallback when a tag fires
    -- before a component is bound). At least one must be present — enforced
    -- by the CHECK below.
    component_id UUID,
    plc_tag TEXT,

    -- The reading itself. Use value_text for discrete states ("present",
    -- "clear", "fault"), value_numeric for analog/integer (rpm, amps, hz).
    -- value_bool is the cheap path for the 90% of demo signals that are 1-bit.
    value_text TEXT,
    value_numeric DOUBLE PRECISION,
    value_bool BOOLEAN,

    -- Provenance. simulated=true means the demo signal-toggle endpoint
    -- generated this; false means it came from the real MQTT bridge.
    simulated BOOLEAN NOT NULL DEFAULT true,
    source TEXT NOT NULL DEFAULT 'demo_simulator',

    -- Free-form (e.g. {"units":"rpm","quality":"good"}).
    properties JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT signal_subject_present CHECK (
        component_id IS NOT NULL OR plc_tag IS NOT NULL
    ),
    CONSTRAINT signal_value_present CHECK (
        value_text IS NOT NULL OR value_numeric IS NOT NULL OR value_bool IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_signals_tenant_component_recent
    ON live_signal_events (tenant_id, component_id, created_at DESC)
    WHERE component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_tenant_tag_recent
    ON live_signal_events (tenant_id, plc_tag, created_at DESC)
    WHERE plc_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_recent
    ON live_signal_events (tenant_id, created_at DESC);

ALTER TABLE live_signal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signals_tenant ON live_signal_events;
CREATE POLICY signals_tenant
    ON live_signal_events
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Grant the limited app role used by withTenantContext.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON troubleshooting_sessions TO factorylm_app;
        GRANT SELECT, INSERT ON live_signal_events TO factorylm_app;
    END IF;
END $$;

COMMIT;
