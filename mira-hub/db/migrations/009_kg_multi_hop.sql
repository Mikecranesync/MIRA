BEGIN;

-- Phase 1 of the multi-hop reasoning upgrade
-- (docs/specs/knowledge-graph-multi-hop-spec.md §4.1).
-- Additive only: new indexes + a non-materialized view. No table changes,
-- no data rewrites. Reversible with DROP INDEX / DROP VIEW.

-- Composite indexes: support the common traversal pattern of "find all
-- outgoing relationships of a given type from a given node" and the same in
-- reverse. The existing single-column indexes on source_id / target_id stay.

CREATE INDEX IF NOT EXISTS idx_kg_rel_tenant_source_type
  ON kg_relationships(tenant_id, source_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_kg_rel_tenant_target_type
  ON kg_relationships(tenant_id, target_id, relationship_type);

-- Temporal predicate queries on the triple log (e.g. "had_fault in last 90d").
CREATE INDEX IF NOT EXISTS idx_kg_triples_tenant_predicate_time
  ON kg_triples_log(tenant_id, predicate, extracted_at DESC);

-- Hierarchical asset rollup view. Walks parent_of + has_component edges
-- starting from any plant/area/line/equipment/component node. RLS-safe:
-- the underlying tables already enforce tenant isolation.
--
-- Not materialized in v1 — start with a regular view, measure, materialize
-- only if Phase 2 misses its latency budget (spec §5.5).
CREATE OR REPLACE VIEW kg_asset_hierarchy AS
  WITH RECURSIVE tree(tenant_id, root_id, descendant_id, depth, path) AS (
    SELECT e.tenant_id, e.id, e.id, 0, ARRAY[e.id::text]
      FROM kg_entities e
      WHERE e.entity_type IN ('plant','area','line','equipment','component')
    UNION ALL
    SELECT t.tenant_id,
           t.root_id,
           e.id,
           t.depth + 1,
           t.path || e.id::text
      FROM tree t
      JOIN kg_relationships r
        ON r.source_id = t.descendant_id
       AND r.tenant_id = t.tenant_id
       AND r.relationship_type IN ('parent_of','has_component')
      JOIN kg_entities e
        ON e.id = r.target_id
       AND e.tenant_id = t.tenant_id
      WHERE NOT (e.id::text = ANY(t.path))
        AND t.depth < 10
  )
  SELECT tenant_id, root_id, descendant_id, depth, path FROM tree;

-- Issue: #806
COMMIT;
