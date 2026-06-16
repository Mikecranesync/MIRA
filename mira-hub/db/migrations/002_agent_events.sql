-- Agent events log — immutable compliance record for safety alerts (#797)
-- Append-only: rows are never updated or deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,          -- 'safety_alert' | 'morning_brief' | 'pm_escalation'
  severity      TEXT,                   -- 'low' | 'medium' | 'high' | 'critical'
  asset_id      TEXT,                   -- equipment_number or asset UUID (nullable)
  keyword       TEXT,                   -- triggering keyword (for safety alerts)
  payload       JSONB DEFAULT '{}',     -- full alert object
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS: tenants see only their own events
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_events_tenant ON agent_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE INDEX IF NOT EXISTS agent_events_tenant_created
  ON agent_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_events_type
  ON agent_events (tenant_id, event_type, created_at DESC);

GRANT SELECT, INSERT ON agent_events TO factorylm_app;

COMMIT;
