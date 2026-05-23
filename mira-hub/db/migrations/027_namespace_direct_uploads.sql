BEGIN;

-- Migration 027: namespace_direct_uploads — files attached directly to namespace nodes.
--
-- Referenced since Phase 2 Slice 1 by:
--   /api/namespace/node/[id]/files  (GET + POST)
--   /api/namespace/files/[id]       (GET + DELETE)
--   /api/namespace/tree             (files_count subquery)
-- ...but never defined in a migration. Runtime errors on every file upload
-- until this table exists.
--
-- Design:
--   One row per uploaded file. node_id is nullable ON DELETE SET NULL so
--   files survive node deletions (human decision whether to re-attach or
--   garbage collect). The factorylm_app role needs CRUD because the hub
--   owns the full lifecycle here (no separate ingest worker).

CREATE TABLE IF NOT EXISTS namespace_direct_uploads (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    node_id      UUID        REFERENCES kg_entities(id) ON DELETE SET NULL,
    filename     TEXT        NOT NULL,
    mime_type    TEXT,
    size_bytes   BIGINT,
    source       TEXT        NOT NULL DEFAULT 'user_upload',
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_namespace_uploads_tenant_node
    ON namespace_direct_uploads (tenant_id, node_id);

CREATE INDEX IF NOT EXISTS idx_namespace_uploads_tenant_created
    ON namespace_direct_uploads (tenant_id, created_at DESC);

ALTER TABLE namespace_direct_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS namespace_direct_uploads_tenant ON namespace_direct_uploads;
CREATE POLICY namespace_direct_uploads_tenant
    ON namespace_direct_uploads
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON namespace_direct_uploads TO factorylm_app;

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS namespace_direct_uploads CASCADE;
-- COMMIT;
