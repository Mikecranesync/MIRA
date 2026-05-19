BEGIN;

-- Migration 025: reconcile kg_entities natural key with kg_writer.upsert_entity.
--
-- mira-crawler/ingest/kg_writer.py:upsert_entity uses
--   ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
-- and its docstring documents the natural key as (tenant_id, entity_type, name).
--
-- Prod's original constraint from migrations/001_knowledge_graph.sql was
--   UNIQUE(tenant_id, entity_type, entity_id)
-- with entity_id TEXT NOT NULL. kg_writer never populates entity_id, so
-- every INSERT failed twice:
--   * NOT NULL on entity_id (default NULL because column omitted from INSERT)
--   * "no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Workflow run 26064409010 surfaced the second error after #1391 added the
-- source_chunk_id column. Per ADR-0013 the hub-side schema is authoritative,
-- so we adjust the schema to match the writer + docstring.
--
-- entity_id is preserved as a nullable auxiliary (no current code reads it
-- across mira-hub/src, mira-crawler, mira-bots, mira-mcp, tools — verified
-- with grep). Drop the column in a follow-up if it stays unused.
--
-- Idempotent: ALTER COLUMN DROP NOT NULL is a no-op when already nullable;
-- DROP CONSTRAINT IF EXISTS and CREATE UNIQUE INDEX IF NOT EXISTS handle
-- re-runs cleanly.

-- 1. Allow NULL on entity_id. kg_writer's INSERT omits the column entirely,
--    so the default-NULL needs to be permitted.
ALTER TABLE kg_entities ALTER COLUMN entity_id DROP NOT NULL;

-- 2. Drop the legacy unique on (tenant_id, entity_type, entity_id).
--    Auto-named by PostgreSQL from the inline UNIQUE() in migration 001:
--    {table}_{col1}_{col2}_{col3}_key.
ALTER TABLE kg_entities
    DROP CONSTRAINT IF EXISTS kg_entities_tenant_id_entity_type_entity_id_key;

-- 3. Create the unique kg_writer's ON CONFLICT clause expects.
CREATE UNIQUE INDEX IF NOT EXISTS kg_entities_tenant_type_name_key
    ON kg_entities (tenant_id, entity_type, name);

COMMIT;

-- ─── Rollback (manual, requires data inspection) ──────────────────────
-- DROP INDEX IF EXISTS kg_entities_tenant_type_name_key;
-- ALTER TABLE kg_entities ADD UNIQUE (tenant_id, entity_type, entity_id);
-- ALTER TABLE kg_entities ALTER COLUMN entity_id SET NOT NULL;
--   -- ⚠ SET NOT NULL fails if any rows have NULL entity_id (which they will
--   --   the moment kg_writer runs against this migrated schema). Plan a
--   --   backfill query before reverting.
