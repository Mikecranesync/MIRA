-- Migration 073: Equipment Notebook V1 — notebooks, source membership, turn snapshots.
--
-- PRD: docs/plans/2026-08-11-equipment-notebook-v1-delta.md (Equipment Notebook V1).
-- One physical machine = one notebook = one bounded source set = one grounded
-- chat context. A notebook WRAPS a kg_entities node (node_id) so the existing
-- v2 ingest + doc-scoped retrieval stack serves it unchanged; these tables add
-- only the product semantics: identity lifecycle, source membership with match
-- state, and the per-turn source/evidence snapshot (auditability — an old
-- answer must stay interpretable after the user changes source selections).
--
-- Tenant family: UUID (kg/Hub family — .claude/rules/mira-hub-migrations.md §1).
-- Only UUID tenants can authenticate (session.ts 401s non-UUID tid), so UUID is
-- both correct and reachable. TENSION, stated per the rules: hub_uploads.tenant_id
-- is TEXT — app-layer joins compare hub_uploads.tenant_id = <uuid>::text; no
-- cross-cast lives in SQL policies here.
--
-- node_id has NO hard FK to kg_entities(id) — same deliberate posture as
-- hub_uploads.kg_entity_id (runtime-created table precedent); the app validates.
-- doc_id refers to hub_uploads.id (= knowledge_entries.doc_id), also no hard FK.
--
-- RLS: in-type UUID comparison (current_setting(...)::uuid), both app.tenant_id
-- and app.current_tenant_id honored. GRANT to factorylm_app in this migration
-- (rule §3 — a new table without the grant 403s before RLS runs).
--
-- Idempotent, additive-only, single transaction. Applied via migration-verify
-- (staging) / apply-migrations.yml (prod) only.
-- Rollback: DROP TABLE IF EXISTS equipment_notebook_turns;
--           DROP TABLE IF EXISTS equipment_notebook_sources;
--           DROP TABLE IF EXISTS equipment_notebooks;

BEGIN;

CREATE TABLE IF NOT EXISTS equipment_notebooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  display_name     TEXT NOT NULL,

  manufacturer     TEXT NULL,
  model            TEXT NULL,
  catalog_number   TEXT NULL,
  serial_number    TEXT NULL,
  equipment_type   TEXT NULL,
  asset_tag        TEXT NULL,
  location_label   TEXT NULL,

  identity_status  TEXT NOT NULL DEFAULT 'unknown'
    CHECK (identity_status IN ('unknown','candidate','user_confirmed','verified')),
  identity_confidence  NUMERIC NULL,
  identity_source_type TEXT NULL
    CHECK (identity_source_type IS NULL
           OR identity_source_type IN ('manual','nameplate_image','user','existing_asset')),
  identity_source_ref  TEXT NULL,
  -- raw pre-correction extraction (provenance is never discarded — PRD §8.4)
  identity_observation JSONB NULL,

  node_id          UUID NOT NULL,

  created_by       TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at   TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_notebooks_tenant
  ON equipment_notebooks (tenant_id, last_opened_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_equipment_notebooks_node
  ON equipment_notebooks (node_id);

CREATE TABLE IF NOT EXISTS equipment_notebook_sources (
  notebook_id        UUID NOT NULL,
  doc_id             UUID NOT NULL,
  tenant_id          UUID NOT NULL,
  enabled_by_default BOOLEAN NOT NULL DEFAULT true,
  match_state        TEXT NOT NULL DEFAULT 'user_confirmed'
    CHECK (match_state IN ('candidate','user_confirmed','verified','rejected')),
  source_role        TEXT NULL
    CHECK (source_role IS NULL
           OR source_role IN ('manual','quick_start','drawing','work_order','note','photo','other')),
  added_by           TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notebook_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_notebook_sources_tenant
  ON equipment_notebook_sources (tenant_id, notebook_id);

CREATE TABLE IF NOT EXISTS equipment_notebook_turns (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id            UUID NOT NULL,
  tenant_id              UUID NOT NULL,
  question               TEXT NOT NULL,
  answer_status          TEXT NOT NULL DEFAULT 'answered'
    CHECK (answer_status IN ('answered','insufficient_evidence','error')),
  answer_text            TEXT NULL,
  enabled_source_doc_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence               JSONB NOT NULL DEFAULT '[]'::jsonb,
  model                  TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_notebook_turns_notebook
  ON equipment_notebook_turns (tenant_id, notebook_id, created_at);

-- RLS (UUID family — in-type cast; both setting names honored)
ALTER TABLE equipment_notebooks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_notebook_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_notebook_turns   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_notebooks_tenant_isolation ON equipment_notebooks;
CREATE POLICY equipment_notebooks_tenant_isolation ON equipment_notebooks
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

DROP POLICY IF EXISTS equipment_notebook_sources_tenant_isolation ON equipment_notebook_sources;
CREATE POLICY equipment_notebook_sources_tenant_isolation ON equipment_notebook_sources
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

DROP POLICY IF EXISTS equipment_notebook_turns_tenant_isolation ON equipment_notebook_turns;
CREATE POLICY equipment_notebook_turns_tenant_isolation ON equipment_notebook_turns
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebooks        TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebook_sources TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebook_turns   TO factorylm_app;

COMMIT;
