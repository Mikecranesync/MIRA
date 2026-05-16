BEGIN;

-- Migration 014: Idempotent SQL-side backfill of kg_entities.uns_path.
--
-- Spec: docs/specs/uns-kg-unification-spec.md §3.1 (knowledge-base branch)
-- Companion: mira-crawler/ingest/uns.py (path grammar, slug rules)
-- Prior migration: 010_kg_uns_path.sql added the ltree column + GIST indexes.
--
-- What this fills:
--   * kg_entities rows with NULL uns_path that have enough metadata in
--     `properties` jsonb to compute the catalog-side path
--     `enterprise.knowledge_base.{mfr}.{family?}.{model}`.
--
-- What it deliberately does NOT fill:
--   * Site-side instance paths (those need ISA-95 hierarchy that lives
--     on cmms_equipment — see migration 015 + tools/cmms_equipment_uns_backfill.py).
--   * Rows with no manufacturer info — leave NULL so the Python
--     orchestrator (tools/uns_backfill.py) can report orphans.
--
-- Idempotent: only updates rows where uns_path IS NULL. Re-running is a
-- no-op for any row that already has a path. The Python orchestrator
-- in tools/uns_backfill.py is responsible for the richer cases
-- (creating entities from knowledge_entries pairs and linking chunks).

-- ───────────────────────────────────────────────────────────────────────
-- Slug helper — mirrors mira-crawler/ingest/uns.py:slug()
-- ───────────────────────────────────────────────────────────────────────
-- Lowercases, collapses runs of non-alphanumeric to `_`, strips
-- leading/trailing `_`. Returns NULL if nothing usable remains so
-- COALESCE chains can fall through to a default segment.

CREATE OR REPLACE FUNCTION uns_slug(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    trim(BOTH '_' FROM regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '_', 'g')),
    ''
  )
$$;

-- ───────────────────────────────────────────────────────────────────────
-- Build a knowledge-base UNS path from manufacturer / family / model.
-- Returns NULL when manufacturer is missing — caller decides what to do
-- with orphans.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION uns_kb_path(manufacturer text, family text, model text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN uns_slug(manufacturer) IS NULL THEN NULL
    ELSE concat_ws(
      '.',
      'enterprise',
      'knowledge_base',
      uns_slug(manufacturer),
      uns_slug(family),
      uns_slug(model)
    )
  END
$$;

-- ───────────────────────────────────────────────────────────────────────
-- Backfill pass: equipment / manual / fault_code / pm_schedule entities.
-- Pulls manufacturer / family / model out of the properties jsonb the
-- crawler stamps on every kg_entities row. Rows without enough info
-- stay NULL.
-- ───────────────────────────────────────────────────────────────────────

UPDATE kg_entities
   SET uns_path = uns_kb_path(
         properties ->> 'manufacturer',
         properties ->> 'family',
         coalesce(properties ->> 'model', properties ->> 'model_number')
       )::ltree
 WHERE uns_path IS NULL
   AND entity_type IN ('equipment', 'manual', 'fault_code', 'pm_schedule', 'parts_list')
   AND uns_kb_path(
         properties ->> 'manufacturer',
         properties ->> 'family',
         coalesce(properties ->> 'model', properties ->> 'model_number')
       ) IS NOT NULL;

-- Manuals/fault_codes/pm_schedules nest one level deeper than the
-- equipment row. The orchestrator (tools/uns_backfill.py) writes the
-- nested paths when it creates entities; this SQL pass only handles
-- the equipment-level default. The richer logic stays in Python where
-- the slug rules already live and can stay in sync with uns.py.

-- ───────────────────────────────────────────────────────────────────────
-- Audit view: surface what still needs attention.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW kg_entities_uns_orphans AS
SELECT id,
       tenant_id,
       entity_type,
       name,
       properties ->> 'manufacturer' AS manufacturer,
       properties ->> 'model'        AS model,
       created_at
  FROM kg_entities
 WHERE uns_path IS NULL;

COMMENT ON VIEW kg_entities_uns_orphans IS
'Entities without a uns_path — typically missing manufacturer/model. '
'tools/uns_backfill.py reports these.';

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- DROP VIEW IF EXISTS kg_entities_uns_orphans;
-- DROP FUNCTION IF EXISTS uns_kb_path(text, text, text);
-- DROP FUNCTION IF EXISTS uns_slug(text);
-- -- uns_path values backfilled by this migration can be reset with:
-- --   UPDATE kg_entities SET uns_path = NULL
-- --    WHERE entity_type IN ('equipment','manual','fault_code','pm_schedule','parts_list');
