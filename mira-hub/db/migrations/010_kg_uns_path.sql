BEGIN;

-- Unified Namespace path on kg_entities (CRA-14, ISA-95 hierarchy).
-- Every entity gets an ltree address — enterprise.plant.area.line.equipment.component
-- so we can answer "everything under floor 2 of plant A" with a single index lookup
-- instead of a recursive CTE. Coexists with the parent_of relationship graph;
-- the graph remains source of truth, uns_path is a cached, queryable projection.

CREATE EXTENSION IF NOT EXISTS ltree;
-- btree_gist lets us mix btree-typed columns (uuid) into a GIST index alongside
-- ltree. Without it the combined (tenant_id, uns_path) index fails: uuid has
-- no default GIST operator class.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS uns_path ltree;

CREATE INDEX IF NOT EXISTS idx_kg_entities_uns_path
  ON kg_entities USING GIST (uns_path);

-- Compound GIST so the planner can satisfy "tenant_id = X AND uns_path <@ Y"
-- with a single index scan instead of a bitmap AND.
CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_uns_path
  ON kg_entities USING GIST (tenant_id, uns_path);

-- Issue: CRA-14
COMMIT;
