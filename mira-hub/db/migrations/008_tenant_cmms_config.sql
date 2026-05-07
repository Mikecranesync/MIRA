-- Migration 008: tenant_cmms_config — per-tenant CMMS provider, base URL,
-- and deep-link template overrides.
--
-- Spec: docs/specs/cmms-deep-link-multi-provider-spec.md §4.1
--
-- Why: hub UI surfaces (WO detail, asset detail, conversation thread) need
-- to deep-link to the tenant's CMMS. Default = Atlas at cmms.factorylm.com,
-- but enterprise prospects on Maximo/Fiix/MaintainX/UpKeep need per-tenant
-- routing without a code deploy.
--
-- Atlas pre-seeded for every existing tenant so behavior is unchanged.
-- New tenants get a default row inserted at signup (separate plumbing).

BEGIN;

-- ─── ENUM: cmms_provider ─────────────────────────────────────────────────────
-- Narrow set on purpose — adding a provider is `ALTER TYPE cmms_provider ADD
-- VALUE 'newprovider'` in a future migration, same pattern as sourcetype.
DO $$ BEGIN
  CREATE TYPE cmms_provider AS ENUM ('atlas', 'maximo', 'fiix', 'maintainx', 'upkeep');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── tenant_cmms_config table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_cmms_config (
  tenant_id           TEXT PRIMARY KEY,
  provider            cmms_provider NOT NULL DEFAULT 'atlas',
  base_url            TEXT NOT NULL DEFAULT 'https://cmms.factorylm.com',
  -- Override default URL templates per tenant. JSONB shape (all keys optional):
  --   { "work_order": "/wo/{external_id}", "asset": "/asset/{external_id}", "pm": "..." }
  -- When empty, the provider class's default templates are used.
  link_templates      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Doppler secret name for API auth (e.g. "ATLAS_TOKEN_ACME"). Never store
  -- the credential itself here; the worker resolves it via Doppler at runtime.
  auth_credential_ref TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE tenant_cmms_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_cmms_config ON tenant_cmms_config;
CREATE POLICY tenant_isolation_cmms_config ON tenant_cmms_config
  FOR ALL
  TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_cmms_config TO factorylm_app;

-- ─── Seed: Atlas default for every existing tenant ───────────────────────────
-- tenants table seeds via `tenants.tenant_id`; if a tenant is referenced only
-- in work_orders / cmms_equipment we still want them covered.
INSERT INTO tenant_cmms_config (tenant_id, provider, base_url)
SELECT DISTINCT tid, 'atlas'::cmms_provider, 'https://cmms.factorylm.com'
FROM (
  SELECT tenant_id AS tid FROM tenants
  UNION
  SELECT tenant_id AS tid FROM work_orders
  UNION
  SELECT tenant_id AS tid FROM cmms_equipment
) all_tenants
WHERE tid IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

-- ─── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_tenant_cmms_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_cmms_config_updated_at ON tenant_cmms_config;
CREATE TRIGGER trg_tenant_cmms_config_updated_at
  BEFORE UPDATE ON tenant_cmms_config
  FOR EACH ROW EXECUTE FUNCTION touch_tenant_cmms_config_updated_at();

COMMIT;

-- Verification:
--   \d+ tenant_cmms_config
--   SELECT tenant_id, provider, base_url FROM tenant_cmms_config ORDER BY tenant_id;
--   -- expect one row per tenant, all 'atlas' / https://cmms.factorylm.com
--
-- Rollback:
--   DROP TABLE IF EXISTS tenant_cmms_config;
--   DROP TYPE  IF EXISTS cmms_provider;
--   DROP FUNCTION IF EXISTS touch_tenant_cmms_config_updated_at();
