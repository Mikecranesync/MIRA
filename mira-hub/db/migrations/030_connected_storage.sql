-- 030_connected_storage.sql
-- Connected Storage: Drive / SharePoint / Dropbox as live document stores.
-- Files stay in the provider; MIRA indexes them and links them to namespace nodes.

CREATE TABLE IF NOT EXISTS connected_storage_providers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  provider         TEXT NOT NULL CHECK (provider IN ('google_drive', 'sharepoint', 'dropbox')),
  root_path        TEXT,
  display_name     TEXT NOT NULL,
  last_synced_at   TIMESTAMPTZ,
  sync_status      TEXT NOT NULL DEFAULT 'idle'
                     CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error       TEXT,
  file_count       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT,
  UNIQUE (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS storage_file_index (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT NOT NULL,
  provider_id       UUID NOT NULL
                      REFERENCES connected_storage_providers(id) ON DELETE CASCADE,
  external_file_id  TEXT NOT NULL,
  external_url      TEXT,
  filename          TEXT NOT NULL,
  mime_type         TEXT,
  file_size_bytes   BIGINT,
  last_modified_at  TIMESTAMPTZ,
  indexed_at        TIMESTAMPTZ,
  kb_entry_count    INT NOT NULL DEFAULT 0,
  index_status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (index_status IN
                        ('pending','indexing','indexed','failed','skipped','removed')),
  UNIQUE (tenant_id, provider_id, external_file_id)
);

CREATE TABLE IF NOT EXISTS storage_file_nodes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  file_id        UUID NOT NULL REFERENCES storage_file_index(id) ON DELETE CASCADE,
  node_id        UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  associated_by  TEXT NOT NULL DEFAULT 'drag_drop'
                   CHECK (associated_by IN ('drag_drop', 'ai_proposed', 'folder_map')),
  confirmed      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT,
  UNIQUE (file_id, node_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_provider
  ON storage_file_index (tenant_id, provider_id);

CREATE INDEX IF NOT EXISTS idx_sfi_tenant_status
  ON storage_file_index (tenant_id, index_status);

CREATE INDEX IF NOT EXISTS idx_sfn_node
  ON storage_file_nodes (tenant_id, node_id);

CREATE INDEX IF NOT EXISTS idx_sfn_file
  ON storage_file_nodes (tenant_id, file_id);

-- Row-Level Security
ALTER TABLE connected_storage_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY csp_tenant_isolation ON connected_storage_providers
  USING (tenant_id = current_setting('app.current_tenant_id', true)
         OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE storage_file_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY sfi_tenant_isolation ON storage_file_index
  USING (tenant_id = current_setting('app.current_tenant_id', true)
         OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE storage_file_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY sfn_tenant_isolation ON storage_file_nodes
  USING (tenant_id = current_setting('app.current_tenant_id', true)
         OR tenant_id = current_setting('app.tenant_id', true));

-- Grant read/write to the app role used by Hub API routes
GRANT SELECT, INSERT, UPDATE, DELETE
  ON connected_storage_providers, storage_file_index, storage_file_nodes
  TO factorylm_app;
