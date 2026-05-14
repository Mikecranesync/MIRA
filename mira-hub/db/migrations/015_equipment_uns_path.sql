BEGIN;

-- Migration 015: ISA-95 UNS path on cmms_equipment.
--
-- Spec: docs/specs/uns-kg-unification-spec.md §3.1 (per-company site
-- hierarchy) — every cmms_equipment row gets a queryable ltree
-- address so the Hub can answer "show me everything in site X, area Y"
-- with a single index scan instead of multi-column WHERE chains.
--
-- Path grammar (per mira-crawler/ingest/uns.py:assigned_equipment_path):
--   enterprise.{tenant}.site.{site}.area.{area}[.line.{line}[.work_cell.{cell}]].equipment.{eq_number}
--
-- The ISA-95 literal markers (`site`, `area`, `line`, `work_cell`,
-- `equipment`) alternate with dynamic instance labels — that's what
-- makes the tree explorable one level at a time.
--
-- This migration only adds the column + index. The backfill that
-- populates it for existing rows lives in
-- tools/cmms_equipment_uns_backfill.py — separate so the slug logic
-- stays in one place (the Python helper module).

CREATE EXTENSION IF NOT EXISTS ltree;
-- btree_gist required for the compound (tenant_id, uns_path) GIST
-- index — uuid has no default GIST opclass otherwise.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE cmms_equipment
  ADD COLUMN IF NOT EXISTS uns_path ltree;

CREATE INDEX IF NOT EXISTS idx_cmms_equipment_uns_path
  ON cmms_equipment USING GIST (uns_path);

-- Compound GIST so "tenant_id = X AND uns_path <@ Y" satisfies in one
-- index scan. Mirrors the kg_entities pattern from migration 010.
CREATE INDEX IF NOT EXISTS idx_cmms_equipment_tenant_uns_path
  ON cmms_equipment USING GIST (tenant_id, uns_path);

COMMENT ON COLUMN cmms_equipment.uns_path IS
'ISA-95 Unified Namespace address: enterprise.{tenant}.site.{s}.area.{a}'
'[.line.{l}[.work_cell.{c}]].equipment.{eq}. Populated by '
'tools/cmms_equipment_uns_backfill.py for legacy rows; the Hub '
'POST /api/assets path is responsible for stamping it on new rows.';

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_cmms_equipment_tenant_uns_path;
-- DROP INDEX IF EXISTS idx_cmms_equipment_uns_path;
-- ALTER TABLE cmms_equipment DROP COLUMN IF EXISTS uns_path;
