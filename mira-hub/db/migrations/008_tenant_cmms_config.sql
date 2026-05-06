-- Migration 008: tenant CMMS config for deep-link integration
--
-- Stores per-tenant CMMS provider configuration. Phase 1 of the deep-link
-- integration: when a tenant has a row here AND an entity carries an atlas_id
-- (or other provider-specific external id) the OpenInCMMSButton can resolve a
-- canonical deep link via the provider abstraction.
--
-- Atlas is the default provider for all existing tenants — every hub_tenants
-- row gets a seed config pointing at https://cmms.factorylm.com.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_cmms_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  provider        TEXT        NOT NULL,                 -- 'atlas' | 'maintainx' | 'fiix' | ...
  base_url        TEXT        NOT NULL,                 -- e.g. 'https://cmms.factorylm.com'
  display_name    TEXT        NOT NULL,                 -- shown on the OpenInCMMSButton ('Atlas', 'MaintainX')
  config          JSONB       NOT NULL DEFAULT '{}',    -- provider-specific knobs (route templates, api hints)
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 1 invariant: at most one enabled CMMS per tenant. A future migration can
-- relax this once we support multi-CMMS routing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_cmms_config_one_enabled
  ON tenant_cmms_config (tenant_id) WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_tenant_cmms_config_tenant
  ON tenant_cmms_config (tenant_id);

-- RLS: tenants see only their own config (matches asset_enrichment pattern in 004).
ALTER TABLE tenant_cmms_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_cmms_config_tenant ON tenant_cmms_config;
CREATE POLICY tenant_cmms_config_tenant ON tenant_cmms_config
  AS PERMISSIVE FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', TRUE))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_cmms_config TO factorylm_app;

-- ─── Atlas-default seed ──────────────────────────────────────────────────────
-- Every existing tenant gets a default Atlas configuration pointing at the
-- shared cmms.factorylm.com instance. Self-hosted tenants override base_url
-- via the /cmms settings page later.
--
-- hub_tenants.id is TEXT but always stores UUID-formatted values
-- (gen_random_uuid()::text), so the cast is safe.
INSERT INTO tenant_cmms_config (tenant_id, provider, base_url, display_name)
SELECT
  hub_tenants.id::uuid,
  'atlas',
  'https://cmms.factorylm.com',
  'Atlas'
FROM hub_tenants
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_cmms_config tcc
  WHERE tcc.tenant_id = hub_tenants.id::uuid
);

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS tenant_cmms_config;
