-- Migration 004: kg_entities table (GraphRAG — NOT YET CREATED)
-- Status: PLANNED — do not run until GraphRAG phase starts
-- Dependency: Requires Phase 3C (section-level metadata) to meaningfully classify entity types

CREATE TABLE IF NOT EXISTS kg_entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL,
    entity_type     TEXT NOT NULL,     -- 'equipment', 'component', 'fault_code', 'procedure', 'specification'
    name            TEXT NOT NULL,     -- 'PowerFlex 40', 'DC bus capacitor', 'F-201'
    properties      JSONB,             -- type-specific attributes
    source_chunk_id UUID,              -- FK to knowledge_entries.id
    embedding       vector(768),
    created_at      TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, entity_type, name)
);

CREATE INDEX IF NOT EXISTS kg_entities_tenant_type_idx
    ON kg_entities (tenant_id, entity_type);

CREATE INDEX IF NOT EXISTS kg_entities_embedding_idx
    ON kg_entities USING ivfflat (embedding vector_cosine_ops);
