BEGIN;

-- Migration 024: add `source_chunk_id` provenance column to kg_entities and
-- kg_relationships.
--
-- mira-crawler/ingest/kg_writer.py:upsert_entity (line ~117) and
-- upsert_relationship (line ~172) both INSERT into a `source_chunk_id`
-- column. The hub canonical schema (mira-hub/db/migrations/001_knowledge_graph.sql)
-- never declared it; the column lives only in the engine-side
-- docs/migrations/004_kg_entities.sql which is not authoritative under
-- ADR-0013.
--
-- Result before this migration: every kg_writer.upsert_entity call against
-- prod NeonDB failed with `UndefinedColumn: column "source_chunk_id" of
-- relation "kg_entities" does not exist` (swallowed by kg_writer's try/except,
-- so callers see "entity upsert returned no id" — see tools/uns_backfill.py
-- workflow run 26040357126).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.

ALTER TABLE kg_entities      ADD COLUMN IF NOT EXISTS source_chunk_id UUID;
ALTER TABLE kg_relationships ADD COLUMN IF NOT EXISTS source_chunk_id UUID;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- ALTER TABLE kg_entities      DROP COLUMN IF EXISTS source_chunk_id;
-- ALTER TABLE kg_relationships DROP COLUMN IF EXISTS source_chunk_id;
