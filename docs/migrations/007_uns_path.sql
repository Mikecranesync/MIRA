-- Migration 007: UNS path enforcement on kg_entities
-- Spec: docs/specs/uns-kg-unification-spec.md §3.1, §4.5, Phase 3
-- Status: PRODUCTION
-- Depends on: 006_kg_bridge.sql

-- 1. Install ltree (idempotent, no-op if already present).
--    On Neon free-tier this is a one-shot: confirm in pre-flight that
--    the extension is allowed in the target project before running this.
CREATE EXTENSION IF NOT EXISTS ltree;

-- 2. Add the path column with the spec's default.
--    The default is meaningful, NOT a placeholder — see §3.1 of the spec.
--    Existing rows (the 41 test entities) will adopt the default.
ALTER TABLE kg_entities
    ADD COLUMN IF NOT EXISTS uns_path ltree NOT NULL DEFAULT 'enterprise.unassigned';

-- 3. Format check — labels must be lowercase [a-z0-9_]+ separated by dots.
--    Drops + recreates to make the migration idempotent.
ALTER TABLE kg_entities DROP CONSTRAINT IF EXISTS uns_path_format;
ALTER TABLE kg_entities
    ADD CONSTRAINT uns_path_format
        CHECK (uns_path::text ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');

-- 4. Indexes — GIST for ancestor/descendant ltree queries (the dominant
--    Hub UNS browser pattern), btree for exact-path lookups.
CREATE INDEX IF NOT EXISTS kg_entities_uns_path_gist
    ON kg_entities USING gist (uns_path);
CREATE INDEX IF NOT EXISTS kg_entities_uns_path_btree
    ON kg_entities (uns_path);

-- 5. Backfill the existing test rows. Equipment entities get
--    enterprise.unassigned.{mfr}.{model}; everything else stays at the
--    bare default and gets re-pathed by application code on next write.
--    This is intentionally a one-shot; production rows will all be
--    written through kg_writer.upsert_entity which sets the path
--    explicitly per spec §3.1.
WITH eq AS (
    SELECT
        id,
        regexp_replace(
            regexp_replace(
                lower(coalesce(properties->>'manufacturer', '')),
                '[^a-z0-9]+', '_', 'g'
            ),
            '(^_+|_+$)', '', 'g'
        ) AS mfr_slug,
        regexp_replace(
            regexp_replace(
                lower(coalesce(name, '')),
                '[^a-z0-9]+', '_', 'g'
            ),
            '(^_+|_+$)', '', 'g'
        ) AS model_slug
      FROM kg_entities
     WHERE entity_type = 'equipment'
       AND uns_path = 'enterprise.unassigned'::ltree
)
UPDATE kg_entities ke
   SET uns_path = (
       'enterprise.unassigned' ||
       CASE WHEN eq.mfr_slug <> '' THEN '.' || eq.mfr_slug ELSE '' END ||
       CASE WHEN eq.mfr_slug <> '' AND eq.model_slug <> ''
            THEN '.' || eq.model_slug ELSE '' END
   )::ltree
  FROM eq
 WHERE ke.id = eq.id
   AND eq.mfr_slug <> '';

-- 6. Document the column for future readers.
COMMENT ON COLUMN kg_entities.uns_path IS
    'Unified Namespace path. ltree address of this entity. Default form is `enterprise.unassigned.{mfr_slug}.{model_slug}` for unplaced equipment; user-placed equipment lives at `enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}`. Validated by uns_path_format CHECK constraint.';
