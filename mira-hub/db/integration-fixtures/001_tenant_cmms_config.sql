-- Integration fixture: minimal twin of migration 008_tenant_cmms_config.sql.
--
-- The integration schema (scripts/setup-integration-db.mjs) does not apply 008
-- because 008 backfills from `work_orders`, a pre-repo saas-layer table that
-- the disposable test database never has. Migration 111 adds a column to
-- tenant_cmms_config, so the table must exist here first. Same type, columns,
-- RLS shape and GRANT as 008 — no backfill INSERT, no trigger.
DO $$ BEGIN
  CREATE TYPE cmms_provider AS ENUM ('atlas', 'maximo', 'fiix', 'maintainx', 'upkeep');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenant_cmms_config (
  tenant_id           TEXT PRIMARY KEY,
  provider            cmms_provider NOT NULL DEFAULT 'atlas',
  base_url            TEXT NOT NULL DEFAULT 'https://cmms.factorylm.com',
  link_templates      JSONB NOT NULL DEFAULT '{}'::jsonb,
  auth_credential_ref TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_cmms_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cmms_config ON tenant_cmms_config;
CREATE POLICY tenant_isolation_cmms_config ON tenant_cmms_config
  FOR ALL
  TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_cmms_config TO factorylm_app;
