BEGIN;

-- Migration 026: dedupe kg_entities, then apply the natural-key reconcile
-- that migration 025 attempted but rolled back.
--
-- Background:
--   025 tried ALTER COLUMN DROP NOT NULL + DROP old UNIQUE + CREATE UNIQUE
--   INDEX (tenant_id, entity_type, name). The CREATE UNIQUE INDEX failed
--   because prod kg_entities has duplicate rows on that key (workflow run
--   26103240406 — at least one work_order row was duplicated). --single-transaction
--   rolled back everything; prod schema is unchanged after 025 ran.
--
--   The duplicates arose because kg_writer.upsert_entity has been failing
--   its ON CONFLICT clause for as long as the prod schema mismatched
--   (the constraint it referenced never existed). Inserts went through but
--   ON CONFLICT had nothing to bite, leaving duplicates from repeated
--   demo-seed and ingest runs.
--
-- This migration:
--   1. Builds a dedup map (one survivor per natural key — earliest by
--      created_at, tiebreak by id ASC).
--   2. Deletes proposals + namespace_versions rows pointing at duplicates
--      (no FK, manual cleanup).
--   3. Deletes the duplicate kg_entities rows. kg_relationships cascades
--      via the ON DELETE CASCADE FK in migration 001 — relationships that
--      pointed at duplicates are dropped. This is intentional: the duplicates
--      shouldn't have existed, so neither should their attached edges.
--      Kept-row relationships from earlier writes are preserved.
--   4. Re-runs the 025 schema changes (idempotent so safe even if 025 had
--      partially applied).
--
-- Idempotent: re-running after success is a no-op (dedup map is empty,
-- DROP NOT NULL / DROP CONSTRAINT IF EXISTS / CREATE UNIQUE INDEX IF NOT
-- EXISTS all skip on second pass).

-- 1. Identify duplicates: rows that are not the earliest in their natural-key group.
CREATE TEMP TABLE _kg_dedupe_map ON COMMIT DROP AS
WITH ranked AS (
    SELECT id, tenant_id, entity_type, name, created_at,
           row_number() OVER (
               PARTITION BY tenant_id, entity_type, name
               ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM kg_entities
)
SELECT id AS dup_id FROM ranked WHERE rn > 1;

DO $$
DECLARE
    n bigint;
BEGIN
    SELECT count(*) INTO n FROM _kg_dedupe_map;
    RAISE NOTICE 'kg_entities dedupe: % duplicate rows will be removed', n;
END$$;

-- 2. Clean up rows in tables that reference kg_entities.id but have no FK
--    (so no cascade). Tables are migrated separately; guard with IF EXISTS.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'relationship_proposals'
    ) THEN
        EXECUTE 'DELETE FROM relationship_proposals
                 WHERE source_entity_id IN (SELECT dup_id FROM _kg_dedupe_map)
                    OR target_entity_id IN (SELECT dup_id FROM _kg_dedupe_map)';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'namespace_versions'
    ) THEN
        EXECUTE 'DELETE FROM namespace_versions
                 WHERE entity_id IN (SELECT dup_id FROM _kg_dedupe_map)';
    END IF;
END$$;

-- 3. Delete duplicate kg_entities. kg_relationships cascade-deletes via FK.
DELETE FROM kg_entities
WHERE id IN (SELECT dup_id FROM _kg_dedupe_map);

-- 4. Apply the natural-key reconcile that 025 attempted.
ALTER TABLE kg_entities ALTER COLUMN entity_id DROP NOT NULL;

ALTER TABLE kg_entities
    DROP CONSTRAINT IF EXISTS kg_entities_tenant_id_entity_type_entity_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS kg_entities_tenant_type_name_key
    ON kg_entities (tenant_id, entity_type, name);

COMMIT;

-- ─── Rollback (manual, lossy) ────────────────────────────────────────
-- DROP INDEX IF EXISTS kg_entities_tenant_type_name_key;
-- ALTER TABLE kg_entities ADD UNIQUE (tenant_id, entity_type, entity_id);
-- ALTER TABLE kg_entities ALTER COLUMN entity_id SET NOT NULL;
--   -- ⚠ SET NOT NULL fails as soon as kg_writer runs against the migrated
--   --   schema (it doesn't populate entity_id). Plan a backfill SET
--   --   entity_id = gen_random_uuid()::text WHERE entity_id IS NULL first.
-- -- The duplicate rows are gone forever; only a NeonDB point-in-time
-- -- restore can recover them.
