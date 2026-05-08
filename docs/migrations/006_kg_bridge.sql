-- Migration 006: Bridge knowledge_entries ↔ kg_entities
-- Spec: docs/specs/uns-kg-unification-spec.md §3.3, §4.1, Phase 1
-- Status: PRODUCTION
-- Depends on: 001_knowledge_entries.sql, 004_kg_entities.sql, 005_kg_relationships.sql

-- 1. Make sure the planned KG tables exist before we FK to them.
--    The 004 / 005 migration files were marked "PLANNED" — promote to production now.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kg_entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    name            TEXT NOT NULL,
    properties      JSONB,
    source_chunk_id UUID,
    embedding       vector(768),
    created_at      TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, entity_type, name)
);

CREATE INDEX IF NOT EXISTS kg_entities_tenant_type_idx
    ON kg_entities (tenant_id, entity_type);

CREATE TABLE IF NOT EXISTS kg_relationships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL,
    source_entity   UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    target_entity   UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    relation_type   TEXT NOT NULL,
    properties      JSONB,
    confidence      REAL DEFAULT 1.0,
    source_chunk_id UUID,
    created_at      TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, source_entity, target_entity, relation_type)
);

CREATE INDEX IF NOT EXISTS kg_relationships_tenant_idx
    ON kg_relationships (tenant_id);
CREATE INDEX IF NOT EXISTS kg_relationships_source_idx
    ON kg_relationships (source_entity);
CREATE INDEX IF NOT EXISTS kg_relationships_target_idx
    ON kg_relationships (target_entity);

-- 2. The bridge column. Nullable: legacy chunks stay readable until backfill runs.
--    ON DELETE SET NULL: dropping an entity must not cascade-delete vector chunks.
ALTER TABLE knowledge_entries
    ADD COLUMN IF NOT EXISTS equipment_entity_id UUID
        REFERENCES kg_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS knowledge_entries_equipment_entity_id_idx
    ON knowledge_entries (equipment_entity_id);

-- 3. Document the column for future readers.
COMMENT ON COLUMN knowledge_entries.equipment_entity_id IS
    'FK to kg_entities.id when the chunk is sourced from a manual / page about a known equipment model. NULL when source is unrelated to a single equipment (e.g. a general curriculum doc) or extraction has not yet run.';
