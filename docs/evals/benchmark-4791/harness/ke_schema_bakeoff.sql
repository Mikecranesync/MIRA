\restrict 135XTRjtULeJd4WpT2uLr81YyAQ6Ok4l4fOPHdLVEffe08irfDiJiR7ULktVCe3
CREATE TABLE public.knowledge_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    source_type text NOT NULL,
    equipment_type text,
    manufacturer text,
    model_number text,
    content text NOT NULL,
    embedding vector(768),
    image_embedding text,
    is_private boolean DEFAULT true NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    input_type text DEFAULT 'text'::text NOT NULL,
    source_url text,
    source_page integer,
    source_ref text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chunk_type text DEFAULT 'text'::text,
    image_path text,
    isa95_path text,
    equipment_id text,
    data_type text DEFAULT 'manual'::text NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED,
    equipment_entity_id uuid,
    doc_id uuid,
    page_start integer,
    page_end integer,
    section_path text,
    ingest_route text
);
ALTER TABLE public.knowledge_entries OWNER TO bench;
COMMENT ON COLUMN public.knowledge_entries.equipment_entity_id IS 'FK to kg_entities.id when the chunk is sourced from a manual / page about a known equipment model. NULL when source is unrelated to a single equipment (e.g. a general curriculum doc) or extraction has not yet run.';
ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT knowledge_entries_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX idx_ke_chunk_dedup ON public.knowledge_entries USING btree (tenant_id, source_url, (((metadata ->> 'chunk_index'::text))::integer)) WHERE ((metadata ->> 'chunk_index'::text) IS NOT NULL);
CREATE INDEX idx_ke_created_at ON public.knowledge_entries USING btree (created_at DESC);
CREATE INDEX idx_ke_mfg_model ON public.knowledge_entries USING btree (manufacturer, model_number);
CREATE INDEX idx_ke_source_type ON public.knowledge_entries USING btree (source_type);
CREATE INDEX idx_knowledge_entries_content_tsv ON public.knowledge_entries USING gin (content_tsv);
CREATE INDEX idx_knowledge_entries_data_type ON public.knowledge_entries USING btree (tenant_id, data_type);
CREATE INDEX idx_knowledge_entries_doc ON public.knowledge_entries USING btree (tenant_id, doc_id) WHERE (doc_id IS NOT NULL);
CREATE INDEX idx_knowledge_entries_isa95_path ON public.knowledge_entries USING btree (tenant_id, isa95_path text_pattern_ops);
CREATE INDEX idx_knowledge_entries_route ON public.knowledge_entries USING btree (tenant_id, ingest_route, created_at DESC) WHERE (ingest_route = 'v2'::text);
CREATE INDEX knowledge_entries_equipment_entity_id_idx ON public.knowledge_entries USING btree (equipment_entity_id);
ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_entries_tenant ON public.knowledge_entries USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));
\unrestrict 135XTRjtULeJd4WpT2uLr81YyAQ6Ok4l4fOPHdLVEffe08irfDiJiR7ULktVCe3
CREATE INDEX knowledge_entries_embedding_hnsw_idx ON public.knowledge_entries USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='factorylm_app') THEN CREATE ROLE factorylm_app NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO factorylm_app;
GRANT SELECT, INSERT, UPDATE ON knowledge_entries TO factorylm_app;
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_entries_tenant ON knowledge_entries USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
