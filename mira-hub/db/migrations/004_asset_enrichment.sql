-- Migration 004: asset enrichment reports
-- One report per asset per tenant, upserted on each enrichment run.

CREATE TABLE IF NOT EXISTS asset_enrichment_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  asset_id        UUID        NOT NULL REFERENCES cmms_equipment(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending',  -- pending | complete | failed
  kb_hits         JSONB       NOT NULL DEFAULT '[]',
  kg_entities     JSONB       NOT NULL DEFAULT '[]',
  kg_relationships JSONB      NOT NULL DEFAULT '[]',
  cmms_summary    JSONB       NOT NULL DEFAULT '{}',
  web_results     JSONB       NOT NULL DEFAULT '[]',
  oem_advisories  JSONB       NOT NULL DEFAULT '[]',
  youtube_hits    JSONB       NOT NULL DEFAULT '[]',
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_asset_unique
  ON asset_enrichment_reports(tenant_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_enrichment_tenant
  ON asset_enrichment_reports(tenant_id);

ALTER TABLE asset_enrichment_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY enrichment_tenant ON asset_enrichment_reports
  AS PERMISSIVE FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', TRUE))::uuid);
