-- Migration 056: contextualization intake — extend 055 for the shared HubV3
-- Intake Contract (Hub as system of record; offline/Telegram are ingest clients).
--
-- Builds on 055_contextualization. Adds:
--   * contextualization_projects.bundle_sha256   (+ partial UNIQUE per tenant) — project dedup
--   * ctx_import_batches                          — one row per import submission, review_status
--   * ctx_sources.source_sha256                   (+ partial UNIQUE per tenant) — source dedup (PRD test 3)
--   * ctx_sources.import_batch_id                 (FK → ctx_import_batches)
--   * ctx_extraction_asset_matches                — P3 asset-matching staging (created now, populated later)
--
-- Tenant: UUID (matches 055; Hub auth 401s non-UUID sessions). RLS pattern, GRANT
-- to factorylm_app, and the touch_ctx_updated_at() trigger fn are reused verbatim
-- from 055. Idempotent (IF NOT EXISTS / DROP POLICY|TRIGGER IF EXISTS). Single txn.
--
-- ADR: docs/adr/0023-hub-system-of-record-contextualization.md
-- Spec: docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md §2, §5 P1/P2
-- Rule: .claude/rules/mira-hub-migrations.md (UUID tenant family, RLS in-type, GRANT, idempotency)

BEGIN;

-- ── ctx_import_batches ─────────────────────────────────────────────────────────
-- One row per import submission. Groups the sources/extractions of a single
-- intake. review_status holds the batch at 'proposed' on intake — nothing is
-- auto-approved (ADR-0017). Per-bundle idempotency via the partial UNIQUE index.

CREATE TABLE IF NOT EXISTS ctx_import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES contextualization_projects(id) ON DELETE CASCADE,
  ingest_route  TEXT NOT NULL
    CHECK (ingest_route IN ('offline', 'telegram', 'hub_upload')),
  bundle_sha256 TEXT,
  source_count     INTEGER NOT NULL DEFAULT 0,
  extraction_count INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (review_status IN ('proposed', 'approved', 'rejected', 'needs_review')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_import_batches_project
  ON ctx_import_batches(project_id);
CREATE INDEX IF NOT EXISTS idx_ctx_import_batches_tenant
  ON ctx_import_batches(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ctx_import_batches_bundle_sha
  ON ctx_import_batches(tenant_id, bundle_sha256)
  WHERE bundle_sha256 IS NOT NULL;

ALTER TABLE ctx_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ctx_import_batches ON ctx_import_batches;
CREATE POLICY tenant_isolation_ctx_import_batches ON ctx_import_batches
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ctx_import_batches TO factorylm_app;

DROP TRIGGER IF EXISTS trg_ctx_import_batches_updated_at ON ctx_import_batches;
CREATE TRIGGER trg_ctx_import_batches_updated_at
  BEFORE UPDATE ON ctx_import_batches
  FOR EACH ROW EXECUTE FUNCTION touch_ctx_updated_at();

-- ── contextualization_projects: bundle_sha256 (project dedup) ───────────────────
ALTER TABLE contextualization_projects
  ADD COLUMN IF NOT EXISTS bundle_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ctx_projects_bundle_sha
  ON contextualization_projects(tenant_id, bundle_sha256)
  WHERE bundle_sha256 IS NOT NULL;

-- ── ctx_sources: source_sha256 (source dedup) + import_batch_id ─────────────────
ALTER TABLE ctx_sources
  ADD COLUMN IF NOT EXISTS source_sha256 TEXT;
ALTER TABLE ctx_sources
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES ctx_import_batches(id) ON DELETE SET NULL;

-- PRD §6 test 3: same source sha256 must not duplicate source records. Partial
-- so manually-added sources (no hash) are unaffected; the import route's
-- ON CONFLICT (tenant_id, source_sha256) WHERE source_sha256 IS NOT NULL infers it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ctx_sources_source_sha
  ON ctx_sources(tenant_id, source_sha256)
  WHERE source_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ctx_sources_batch
  ON ctx_sources(import_batch_id);

-- ── ctx_extraction_asset_matches (P3 staging — created now, populated later) ─────
-- Links a staged extraction (or a whole batch) to a candidate cmms_equipment
-- asset with a match strength. candidate_asset_id is a SOFT reference (no FK to
-- cmms_equipment — that full schema is upstream of 055; a hard FK would couple
-- this migration to it and break a ctx-only test DB). P3's asset-matcher resolves it.

CREATE TABLE IF NOT EXISTS ctx_extraction_asset_matches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  project_id         UUID NOT NULL REFERENCES contextualization_projects(id) ON DELETE CASCADE,
  import_batch_id    UUID REFERENCES ctx_import_batches(id) ON DELETE SET NULL,
  extraction_id      UUID REFERENCES ctx_extractions(id) ON DELETE CASCADE,
  candidate_asset_id UUID,                                  -- soft ref → cmms_equipment.id (resolved in P3)
  match_strength     TEXT NOT NULL
    CHECK (match_strength IN ('strong', 'probable', 'none')),
  match_evidence     JSONB NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_asset_matches_project
  ON ctx_extraction_asset_matches(project_id);
CREATE INDEX IF NOT EXISTS idx_ctx_asset_matches_tenant
  ON ctx_extraction_asset_matches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ctx_asset_matches_extraction
  ON ctx_extraction_asset_matches(extraction_id);
CREATE INDEX IF NOT EXISTS idx_ctx_asset_matches_candidate
  ON ctx_extraction_asset_matches(candidate_asset_id);

ALTER TABLE ctx_extraction_asset_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ctx_asset_matches ON ctx_extraction_asset_matches;
CREATE POLICY tenant_isolation_ctx_asset_matches ON ctx_extraction_asset_matches
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ctx_extraction_asset_matches TO factorylm_app;

DROP TRIGGER IF EXISTS trg_ctx_asset_matches_updated_at ON ctx_extraction_asset_matches;
CREATE TRIGGER trg_ctx_asset_matches_updated_at
  BEFORE UPDATE ON ctx_extraction_asset_matches
  FOR EACH ROW EXECUTE FUNCTION touch_ctx_updated_at();

COMMIT;

-- Verification:
--   \d+ ctx_import_batches
--   \d+ ctx_extraction_asset_matches
--   \d  contextualization_projects   (bundle_sha256 + uq_ctx_projects_bundle_sha)
--   \d  ctx_sources                  (source_sha256, import_batch_id + uq_ctx_sources_source_sha)
--
-- Rollback:
--   DROP TABLE IF EXISTS ctx_extraction_asset_matches CASCADE;
--   ALTER TABLE ctx_sources DROP COLUMN IF EXISTS import_batch_id, DROP COLUMN IF EXISTS source_sha256;
--   DROP TABLE IF EXISTS ctx_import_batches CASCADE;
--   ALTER TABLE contextualization_projects DROP COLUMN IF EXISTS bundle_sha256;
