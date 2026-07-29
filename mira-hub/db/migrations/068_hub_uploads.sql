-- Migration 068: hub_uploads — move off inline runtime DDL (#703).
--
-- hub_uploads.ts::ensureUploadsSchema() has run CREATE TABLE IF NOT EXISTS +
-- five ALTER TABLE ADD COLUMN IF NOT EXISTS statements on every cold start
-- since the table was introduced. A 2026-04-26 senior backend review flagged
-- three problems: (1) branch-to-branch DDL divergence with no review gate,
-- (2) race conditions on multi-replica startup, (3) no migration history —
-- can't audit "when did the kind column appear?" without git-archaeology.
--
-- This migration is the canonical shape, transcribed VERBATIM from the
-- runtime DDL in mira-hub/src/lib/uploads.ts as of 2026-07-28 (see git log on
-- that file for the per-column history this migration now formalizes). It is
-- a pure no-op on any environment where ensureUploadsSchema() already ran
-- (prod/staging) — CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- against an identical existing shape does nothing. Idempotent, additive-only,
-- single transaction (§5, §8 mira-hub-migrations.md).
--
-- tenant_id is TEXT (legacy slug family, matches cmms_equipment — see rule 1
-- of mira-hub-migrations.md) because hub_uploads predates the UUID-only
-- tenancy migration and this migration only formalizes the existing shape,
-- not a schema redesign.
--
-- No RLS/GRANT: hub_uploads has never had a tenant_isolation policy — the app
-- connects via mira-hub/src/lib/db.ts's raw NEON_DATABASE_URL pool (not
-- withTenantContext/factorylm_app), and every query already filters
-- `WHERE tenant_id = $N` explicitly in application code (uploads.ts). Adding
-- RLS now would be an unrelated hardening change, out of scope for #703.
--
-- Companion change: ensureUploadsSchema() no longer executes DDL — it does a
-- cheap one-time-per-process column check and fails loud if this migration
-- hasn't been applied yet, instead of silently creating the schema.

BEGIN;

CREATE TABLE IF NOT EXISTS hub_uploads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL DEFAULT 'mike',
  provider              TEXT NOT NULL,
  external_file_id      TEXT,
  external_download_url TEXT,
  filename              TEXT NOT NULL,
  mime_type             TEXT,
  size_bytes            BIGINT,
  external_created_at   TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'queued',
  status_detail         TEXT,
  kb_file_id            TEXT,
  kb_chunk_count        INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'document';
ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS asset_tag TEXT;
ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS uns_path TEXT;
-- mira-ingest-v2 (ADR-0019) / Hub folder=brain: confirmed kg_entities node id.
ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS kg_entity_id UUID;
-- 'v2' = mira-ingest-v2 / Hub-node attachment (knowledge_entries); NULL/'ow' = legacy.
ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS ingest_route TEXT;

CREATE INDEX IF NOT EXISTS idx_hub_uploads_tenant_status
  ON hub_uploads (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hub_uploads_kg_entity
  ON hub_uploads (tenant_id, kg_entity_id)
  WHERE kg_entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_uploads_dedup
  ON hub_uploads (tenant_id, provider, external_file_id)
  WHERE external_file_id IS NOT NULL;

COMMIT;
