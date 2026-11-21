-- Disposable test-only shape, based on MIRA integration-fixtures/000_base_cmms_rls.sql
-- plus columns required by the pinned real v2 writer and lexical reader.
CREATE ROLE factorylm_app NOLOGIN;
CREATE TABLE knowledge_entries (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL, source_type TEXT, manufacturer TEXT,
 model_number TEXT, equipment_type TEXT, content TEXT NOT NULL DEFAULT '',source_url TEXT,
 source_page INTEGER, metadata JSONB NOT NULL DEFAULT '{}',is_private BOOLEAN NOT NULL DEFAULT false,
 verified BOOLEAN NOT NULL DEFAULT false,chunk_type TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 doc_id UUID,ingest_route TEXT,page_start INTEGER,page_end INTEGER,section_path TEXT,
 content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english',content)) STORED
);
CREATE UNIQUE INDEX proof_dedup ON knowledge_entries(tenant_id,source_url,((metadata->>'chunk_index')::int)) WHERE metadata->>'chunk_index' IS NOT NULL;
CREATE INDEX proof_lexical ON knowledge_entries USING GIN(content_tsv);
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY proof_tenant ON knowledge_entries TO factorylm_app USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON knowledge_entries TO factorylm_app;
