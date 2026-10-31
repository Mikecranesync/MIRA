-- 105_guided_procedure_sessions.sql — WP-1 guided troubleshooting sessions.
--
-- One row per technician session of a compiled manufacturer procedure on an equipment notebook.
-- `records` is the append-only StepRecord list the #4498 runner replays (observations, readings,
-- the named person confirming isolation). That is customer plant data, so it lives in a
-- tenant-isolated table with RLS — NOT in workflow_runs, whose rows are readable across tenants
-- through /api/workflows (Codex #4573 F1).
--
-- tenant_id is UUID: the notebook family (073) is UUID-keyed and only UUID tenants reach the Hub
-- API (session.ts). The policy compares in UUID, as 073 does, reading both settings
-- withTenantContext writes.
--
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS), one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS guided_procedure_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  notebook_id      UUID NOT NULL REFERENCES equipment_notebooks(id) ON DELETE CASCADE,
  template_id      TEXT NOT NULL,
  template_version TEXT NOT NULL,
  source_sha256    TEXT NOT NULL,
  revision         TEXT NOT NULL CHECK (revision IN ('exact', 'not_attached')),
  status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'degraded', 'failed')),
  records          JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_by       TEXT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_guided_procedure_sessions_notebook
  ON guided_procedure_sessions (tenant_id, notebook_id, template_id, started_at DESC);

ALTER TABLE guided_procedure_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guided_procedure_sessions_tenant_isolation ON guided_procedure_sessions;
CREATE POLICY guided_procedure_sessions_tenant_isolation ON guided_procedure_sessions
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE ON guided_procedure_sessions TO factorylm_app;

COMMIT;
