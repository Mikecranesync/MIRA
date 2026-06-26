-- Integration-test fixture only. Do not apply to production/staging.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT 'integration@example.local',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  tenant_id TEXT REFERENCES hub_tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_type TEXT,
  manufacturer TEXT,
  model_number TEXT,
  equipment_type TEXT,
  content TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  source_page INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_private BOOLEAN NOT NULL DEFAULT false,
  verified BOOLEAN NOT NULL DEFAULT false,
  chunk_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cmms_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS cmms_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID REFERENCES cmms_sites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, slug)
);

CREATE TABLE IF NOT EXISTS cmms_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  equipment_number TEXT NOT NULL,
  manufacturer TEXT,
  site_id UUID REFERENCES cmms_sites(id) ON DELETE SET NULL,
  area_id UUID REFERENCES cmms_areas(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, equipment_number)
);

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_app_select ON tenants;
CREATE POLICY tenants_app_select ON tenants
  FOR SELECT TO factorylm_app
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS cmms_sites_tenant ON cmms_sites;
CREATE POLICY cmms_sites_tenant ON cmms_sites
  FOR ALL TO factorylm_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS cmms_areas_tenant ON cmms_areas;
CREATE POLICY cmms_areas_tenant ON cmms_areas
  FOR ALL TO factorylm_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS cmms_equipment_tenant ON cmms_equipment;
CREATE POLICY cmms_equipment_tenant ON cmms_equipment
  FOR ALL TO factorylm_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_audit_log_insert ON tenant_audit_log;
CREATE POLICY tenant_audit_log_insert ON tenant_audit_log
  FOR INSERT TO factorylm_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_audit_log_select ON tenant_audit_log;
CREATE POLICY tenant_audit_log_select ON tenant_audit_log
  FOR SELECT TO factorylm_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT ON tenants TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cmms_sites TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cmms_areas TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cmms_equipment TO factorylm_app;
GRANT SELECT, INSERT ON tenant_audit_log TO factorylm_app;
REVOKE UPDATE, DELETE ON tenant_audit_log FROM factorylm_app;
