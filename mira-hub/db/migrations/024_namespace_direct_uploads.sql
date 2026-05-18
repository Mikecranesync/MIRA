-- Migration 024: namespace direct uploads + node–file association
--
-- Plan: docs/plans/2026-05-18-windows-explorer-namespace.md
--
-- Adds two things:
--   1. namespace_node_id FK on existing `uploads` table so cloud-sourced files
--      (Google Drive, Dropbox) can be associated with a namespace folder.
--   2. namespace_direct_uploads table for files dragged directly from desktop
--      into the namespace tree (no cloud provider involved).
--
-- Hard limit: 10 MB per file enforced at the DB layer (CHECK constraint).
-- Never SELECT content except in the dedicated download endpoint.

-- 1. Associate cloud uploads with namespace nodes
ALTER TABLE uploads
  ADD COLUMN IF NOT EXISTS namespace_node_id UUID
    REFERENCES kg_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_uploads_namespace_node
  ON uploads (tenant_id, namespace_node_id)
  WHERE namespace_node_id IS NOT NULL;

-- 2. Direct desktop drag-drop uploads
CREATE TABLE IF NOT EXISTS namespace_direct_uploads (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  node_id      UUID        REFERENCES kg_entities(id) ON DELETE SET NULL,
  filename     TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   BIGINT      NOT NULL DEFAULT 0
                             CHECK (size_bytes <= 10485760),  -- 10 MB hard cap
  content      BYTEA       NOT NULL,
  uploaded_by  UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ndu_node
  ON namespace_direct_uploads (tenant_id, node_id);

CREATE INDEX IF NOT EXISTS idx_ndu_tenant_recent
  ON namespace_direct_uploads (tenant_id, created_at DESC);

ALTER TABLE namespace_direct_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ndu_tenant ON namespace_direct_uploads;
CREATE POLICY ndu_tenant ON namespace_direct_uploads
  USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON namespace_direct_uploads TO factorylm_app;
