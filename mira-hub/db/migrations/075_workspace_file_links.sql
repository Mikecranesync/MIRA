BEGIN;

-- Migration 075: canonical Files + many-to-many workspace attachments.
--
-- Spec: Component Nameplate → Manual + Centralized Multi-Asset Files (Part 1).
-- namespace_direct_uploads (027/059) becomes the canonical file record — the
-- product-facing name is simply "Files". This migration is additive only; the
-- table is NOT renamed and every existing single-node behavior keeps working.
--
-- Three changes:
--
--   1. content_sha256 on namespace_direct_uploads + a partial UNIQUE index per
--      tenant. Exact-byte identity for NEW files: uploading identical bytes
--      resolves to the existing canonical fileId instead of parking a second
--      blob, and the unique index is the concurrency guard (two simultaneous
--      identical uploads cannot both insert — the loser re-selects the winner).
--      Legacy rows keep NULL and are never blocked (partial index). This is
--      deliberately DIFFERENT from 072's hub_uploads index, which is non-unique
--      because the old model re-ingested per node; under file links the same
--      bytes get ONE row + many links. Never dedup across tenants: the index
--      is tenant-prefixed and every lookup is tenant-scoped.
--
--   2. workspace_file_links — one canonical file, many explicit attachments.
--      Polymorphic (target_type, target_id) with an allowlisted type set; all
--      four current target tables key by UUID (equipment_notebooks.id,
--      cmms_equipment.id, kg_entities.id, work_orders.id), so target_id is
--      UUID. There is intentionally NO FK on target_id — each insert goes
--      through a target-specific tenant ownership validator in
--      src/lib/workspace-files.ts (same posture as 073's node_id). file_id IS
--      a real FK with ON DELETE RESTRICT: a file cannot be deleted while any
--      relationship remains ("detach everywhere and delete" removes links
--      first). Detaching a link never touches bytes, chunks, or sibling links.
--
--   3. match_evidence JSONB on equipment_notebook_sources — persisted manual
--      applicability evidence (matched tokens, evidence pages, decision
--      method, discovery/final URLs, confidence). Written when a discovered
--      manual is assessed against its own materialized chunks; never secrets.
--
-- Backfills (idempotent, ON CONFLICT DO NOTHING):
--   a. Every parked file's node_id becomes a 'namespace_node' link, primary
--      (it was the file's one filing location).
--   b. Every notebook source whose doc_id resolves to a parked file through
--      upload_id becomes an 'equipment_notebook' link (all match states —
--      links control where a file APPEARS; match_state controls chat).
--      Legacy hub_uploads docs with no parked original are NOT invented as
--      file rows — their bytes were never retained.
--
-- Idempotent, additive-only, single transaction (mira-hub-migrations.md §5/§8).

-- ── 1. Exact-byte identity ──────────────────────────────────────────────────

ALTER TABLE namespace_direct_uploads
    ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_namespace_uploads_tenant_sha
    ON namespace_direct_uploads (tenant_id, content_sha256)
    WHERE content_sha256 IS NOT NULL;

-- ── 2. workspace_file_links ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_file_links (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    file_id       UUID        NOT NULL
                              REFERENCES namespace_direct_uploads(id)
                              ON DELETE RESTRICT,
    target_type   TEXT        NOT NULL
        CHECK (target_type IN
               ('equipment_notebook','cmms_asset','namespace_node','work_order')),
    target_id     UUID        NOT NULL,
    role          TEXT,
    display_label TEXT,
    is_primary    BOOLEAN     NOT NULL DEFAULT false,
    created_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workspace_file_links_relationship
        UNIQUE (tenant_id, file_id, target_type, target_id)
);

-- At most one primary filing location per file.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_file_links_primary
    ON workspace_file_links (tenant_id, file_id)
    WHERE is_primary;

-- "Files attached to this target" — the read path for notebook/asset/node/WO
-- file sections.
CREATE INDEX IF NOT EXISTS idx_workspace_file_links_target
    ON workspace_file_links (tenant_id, target_type, target_id);

ALTER TABLE workspace_file_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_file_links_tenant ON workspace_file_links;
CREATE POLICY workspace_file_links_tenant
    ON workspace_file_links
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_file_links TO factorylm_app;

-- ── 3. Applicability evidence ───────────────────────────────────────────────

ALTER TABLE equipment_notebook_sources
    ADD COLUMN IF NOT EXISTS match_evidence JSONB;

-- ── Backfill a: node filings ────────────────────────────────────────────────
-- is_primary is guarded per-row so a re-run can never violate the one-primary
-- index if a primary was set elsewhere between runs.

INSERT INTO workspace_file_links
    (tenant_id, file_id, target_type, target_id, is_primary, created_by, created_at)
SELECT u.tenant_id, u.id, 'namespace_node', u.node_id,
       NOT EXISTS (SELECT 1 FROM workspace_file_links l
                    WHERE l.tenant_id = u.tenant_id
                      AND l.file_id   = u.id
                      AND l.is_primary),
       u.created_by::text, u.created_at
  FROM namespace_direct_uploads u
 WHERE u.node_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_workspace_file_links_relationship DO NOTHING;

-- ── Backfill b: notebook filings via upload_id ──────────────────────────────

INSERT INTO workspace_file_links
    (tenant_id, file_id, target_type, target_id, role, is_primary, created_by, created_at)
SELECT s.tenant_id, u.id, 'equipment_notebook', s.notebook_id,
       s.source_role, false, s.added_by, s.created_at
  FROM equipment_notebook_sources s
  JOIN namespace_direct_uploads u
    ON u.upload_id = s.doc_id
   AND u.tenant_id = s.tenant_id
ON CONFLICT ON CONSTRAINT uq_workspace_file_links_relationship DO NOTHING;

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS workspace_file_links;
-- DROP INDEX IF EXISTS uq_namespace_uploads_tenant_sha;
-- ALTER TABLE namespace_direct_uploads DROP COLUMN IF EXISTS content_sha256;
-- ALTER TABLE equipment_notebook_sources DROP COLUMN IF EXISTS match_evidence;
-- COMMIT;
