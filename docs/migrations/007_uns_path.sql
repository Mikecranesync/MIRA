-- Migration 007: UNS path enforcement on kg_entities
-- Spec: docs/specs/uns-kg-unification-spec.md §3.1, §4.5, Phase 3
-- Status: PRODUCTION
-- Depends on: 006_kg_bridge.sql

-- 1. Install ltree (idempotent, no-op if already present).
--    On Neon free-tier this is a one-shot: confirm in pre-flight that
--    the extension is allowed in the target project before running this.
CREATE EXTENSION IF NOT EXISTS ltree;

-- 2. Add the path column with the spec's default.
--    The broadened schema (Mike directive 2026-05-07) puts equipment
--    learned from manuals into the manufacturer-organized knowledge
--    base, NOT a separate "unassigned" subtree. The default below is
--    the bare KB root — every kg_writer call overrides it with a real
--    model path. Equipment that ends up with the bare default is a
--    triage signal: the extractor failed to find a manufacturer.
ALTER TABLE kg_entities
    ADD COLUMN IF NOT EXISTS uns_path ltree NOT NULL DEFAULT 'enterprise.knowledge_base';

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

-- 5. Backfill the existing test rows into the new manufacturer-organized
--    knowledge base. Equipment entities → enterprise.knowledge_base.{mfr}.{model}
--    (or enterprise.knowledge_base.{mfr}.{family}.{model} when family is
--    present in properties JSONB). Everything else stays at the bare
--    default and gets re-pathed by application code on next write.
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
                lower(coalesce(properties->>'family', '')),
                '[^a-z0-9]+', '_', 'g'
            ),
            '(^_+|_+$)', '', 'g'
        ) AS family_slug,
        regexp_replace(
            regexp_replace(
                lower(coalesce(name, '')),
                '[^a-z0-9]+', '_', 'g'
            ),
            '(^_+|_+$)', '', 'g'
        ) AS model_slug
      FROM kg_entities
     WHERE entity_type = 'equipment'
       AND uns_path IN (
           'enterprise.unassigned'::ltree,
           'enterprise.knowledge_base'::ltree
       )
)
UPDATE kg_entities ke
   SET uns_path = (
       'enterprise.knowledge_base' ||
       CASE WHEN eq.mfr_slug <> '' THEN '.' || eq.mfr_slug ELSE '' END ||
       CASE WHEN eq.mfr_slug <> '' AND eq.family_slug <> ''
            THEN '.' || eq.family_slug ELSE '' END ||
       CASE WHEN eq.mfr_slug <> '' AND eq.model_slug <> ''
            THEN '.' || eq.model_slug ELSE '' END
   )::ltree
  FROM eq
 WHERE ke.id = eq.id
   AND eq.mfr_slug <> '';

-- 6. Document the column for future readers.
COMMENT ON COLUMN kg_entities.uns_path IS
    'Unified Namespace path. ltree address of this entity. Equipment learned from manuals lives in the manufacturer-organized catalog: `enterprise.knowledge_base.{mfr}.{family?}.{model}`. User-placed equipment instances live under the company/site hierarchy: `enterprise.{company}.site.{site}.area.{area}.line.{line}.work_cell.{cell}.equipment.{eq}` (line and work_cell segments are skippable). Validated by uns_path_format CHECK constraint.';
