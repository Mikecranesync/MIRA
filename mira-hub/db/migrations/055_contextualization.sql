-- Migration 055: contextualization — project workspace for PLC-export contextualization.
-- Tables: contextualization_projects, ctx_sources, ctx_extractions.
-- Tenant: UUID (Hub auth layer; 401 on non-UUID session since 2026-05-19).
-- Pattern: 008_tenant_cmms_config.sql (BEGIN/COMMIT, RLS, GRANT, updated_at trigger).

BEGIN;

-- ── contextualization_projects ────────────────────────────────────────────────
-- One row per contextualization session. A human creates a project, imports
-- sources, reviews AI proposals, and exports approved UNS/i3X output.

CREATE TABLE IF NOT EXISTS contextualization_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_projects_tenant
  ON contextualization_projects(tenant_id);

ALTER TABLE contextualization_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ctx_projects ON contextualization_projects;
CREATE POLICY tenant_isolation_ctx_projects ON contextualization_projects
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON contextualization_projects TO factorylm_app;

-- ── ctx_sources ───────────────────────────────────────────────────────────────
-- One row per uploaded file within a project.
-- source_type drives which parser path the worker uses.

CREATE TABLE IF NOT EXISTS ctx_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES contextualization_projects(id) ON DELETE CASCADE,
  source_type   TEXT NOT NULL
    CHECK (source_type IN ('l5x', 'st', 'plcopen', 'csv', 'manual', 'other')),
  file_name     TEXT NOT NULL,
  file_path     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_sources_project
  ON ctx_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_ctx_sources_tenant
  ON ctx_sources(tenant_id);

ALTER TABLE ctx_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ctx_sources ON ctx_sources;
CREATE POLICY tenant_isolation_ctx_sources ON ctx_sources
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ctx_sources TO factorylm_app;

-- ── ctx_extractions ───────────────────────────────────────────────────────────
-- One row per extracted tag / signal from a source file.
-- The parse worker populates these; the human approves/rejects each row.

CREATE TABLE IF NOT EXISTS ctx_extractions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES contextualization_projects(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES ctx_sources(id) ON DELETE CASCADE,
  tag_name          TEXT NOT NULL,
  roles             TEXT[] NOT NULL DEFAULT '{}',
  uns_path_proposed TEXT,
  i3x_element_id    TEXT,
  evidence_json     JSONB NOT NULL DEFAULT '{}',
  confidence        NUMERIC(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_extractions_project
  ON ctx_extractions(project_id);
CREATE INDEX IF NOT EXISTS idx_ctx_extractions_source
  ON ctx_extractions(source_id);
CREATE INDEX IF NOT EXISTS idx_ctx_extractions_status
  ON ctx_extractions(project_id, status);

ALTER TABLE ctx_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ctx_extractions ON ctx_extractions;
CREATE POLICY tenant_isolation_ctx_extractions ON ctx_extractions
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ctx_extractions TO factorylm_app;

-- ── updated_at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_ctx_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ctx_projects_updated_at ON contextualization_projects;
CREATE TRIGGER trg_ctx_projects_updated_at
  BEFORE UPDATE ON contextualization_projects
  FOR EACH ROW EXECUTE FUNCTION touch_ctx_updated_at();

DROP TRIGGER IF EXISTS trg_ctx_sources_updated_at ON ctx_sources;
CREATE TRIGGER trg_ctx_sources_updated_at
  BEFORE UPDATE ON ctx_sources
  FOR EACH ROW EXECUTE FUNCTION touch_ctx_updated_at();

DROP TRIGGER IF EXISTS trg_ctx_extractions_updated_at ON ctx_extractions;
CREATE TRIGGER trg_ctx_extractions_updated_at
  BEFORE UPDATE ON ctx_extractions
  FOR EACH ROW EXECUTE FUNCTION touch_ctx_updated_at();

COMMIT;

-- Verification:
--   \d+ contextualization_projects
--   \d+ ctx_sources
--   \d+ ctx_extractions
--
-- Rollback:
--   DROP TABLE IF EXISTS ctx_extractions, ctx_sources, contextualization_projects CASCADE;
--   DROP FUNCTION IF EXISTS touch_ctx_updated_at();
