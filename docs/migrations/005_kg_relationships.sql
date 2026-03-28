-- Migration 005: kg_relationships table (GraphRAG — NOT YET CREATED)
-- Status: PLANNED — do not run until GraphRAG phase starts
-- Dependency: Requires 004_kg_entities

CREATE TABLE IF NOT EXISTS kg_relationships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL,
    source_entity   UUID NOT NULL,     -- FK to kg_entities.id
    target_entity   UUID NOT NULL,     -- FK to kg_entities.id
    relation_type   TEXT NOT NULL,     -- 'has_component', 'causes_fault', 'resolves', 'requires_tool'
    properties      JSONB,
    confidence      REAL DEFAULT 1.0,
    source_chunk_id UUID,              -- FK to knowledge_entries.id
    created_at      TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, source_entity, target_entity, relation_type)
);

CREATE INDEX IF NOT EXISTS kg_relationships_tenant_idx
    ON kg_relationships (tenant_id);

CREATE INDEX IF NOT EXISTS kg_relationships_source_idx
    ON kg_relationships (source_entity);

CREATE INDEX IF NOT EXISTS kg_relationships_target_idx
    ON kg_relationships (target_entity);
