BEGIN;

-- Migration 030: Add SAME_MODEL_AS + CO_FAILED_WITH + SIMILAR_TO to
-- relationship_proposals.relationship_type.
--
-- Spec : docs/superpowers/specs/2026-06-02-kg-relationship-graph-design.md
-- Plan : docs/superpowers/plans/2026-06-02-kg-graph-phase2-enrich.md
--
-- Why:
--   Phase 2 of the relationship-graph work infers two new edge types and writes
--   them as proposals (low confidence, human-review) through the existing
--   approval machinery — the industrial analog of Obsidian's "unlinked mentions":
--     SAME_MODEL_AS   — equipment sharing identical manufacturer + model_number.
--     CO_FAILED_WITH  — equipment whose work orders co-occur in a time window.
--   SIMILAR_TO is added at the same time to fix a long-standing parity gap:
--   'similar_to' exists in src/lib/knowledge-graph/types.ts but was never in the
--   relationship_proposals CHECK, so a similarity proposal would violate it.
--
--   These are inferred (rule-generated) candidate edges, never auto-verified;
--   a human promotes them via POST /api/proposals/[id]/decide, which is the
--   existing path that upserts kg_relationships.
--
-- Compatibility:
--   The new CHECK is a strict superset of migration 028's — every existing row
--   remains valid. DOWN migration restores the prior CHECK exactly.

ALTER TABLE relationship_proposals
  DROP CONSTRAINT IF EXISTS relationship_proposals_relationship_type_check;

ALTER TABLE relationship_proposals
  ADD CONSTRAINT relationship_proposals_relationship_type_check
  CHECK (relationship_type IN (
    -- Hierarchy
    'HAS_COMPONENT', 'INSTANCE_OF', 'LOCATED_IN', 'HAS_PART',
    -- Documentation
    'HAS_DOCUMENT', 'HAS_CHUNK', 'REFERENCES', 'HAS_PROCEDURE',
    -- Wiring & power
    'WIRED_TO', 'POWERED_BY', 'MAPS_TO', 'PUBLISHED_AS',
    -- Logic & control
    'USED_IN_LOGIC', 'TRIGGERS', 'CAUSES', 'DRIVES', 'IS_DRIVEN_BY',
    -- Faults & resolution
    'OCCURS_ON', 'RESOLVED_BY', 'HAS_FAILURE_MODE',
    -- Signals
    'HAS_SIGNAL', 'HAS_ALIAS',
    -- Topology
    'DEPENDS_ON', 'UPSTREAM_OF', 'DOWNSTREAM_OF', 'REPLACES',
    -- Evidence meta
    'CONFIRMED_BY', 'CONTRADICTED_BY',
    -- Inferred / similarity (new in this migration)
    'SAME_MODEL_AS', 'CO_FAILED_WITH', 'SIMILAR_TO'
  ));

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN
-- ----------------------------------------------------------------------------
--
-- BEGIN;
--
-- -- Pre-check: refuse rollback if any rows still use the new types.
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM relationship_proposals
--     WHERE relationship_type IN ('SAME_MODEL_AS', 'CO_FAILED_WITH', 'SIMILAR_TO')
--   ) THEN
--     RAISE EXCEPTION 'Cannot down-migrate: SAME_MODEL_AS/CO_FAILED_WITH/SIMILAR_TO rows exist. Reject or rewrite them first.';
--   END IF;
-- END $$;
--
-- ALTER TABLE relationship_proposals
--   DROP CONSTRAINT IF EXISTS relationship_proposals_relationship_type_check;
--
-- ALTER TABLE relationship_proposals
--   ADD CONSTRAINT relationship_proposals_relationship_type_check
--   CHECK (relationship_type IN (
--     'HAS_COMPONENT', 'INSTANCE_OF', 'LOCATED_IN', 'HAS_PART',
--     'HAS_DOCUMENT', 'HAS_CHUNK', 'REFERENCES', 'HAS_PROCEDURE',
--     'WIRED_TO', 'POWERED_BY', 'MAPS_TO', 'PUBLISHED_AS',
--     'USED_IN_LOGIC', 'TRIGGERS', 'CAUSES', 'DRIVES', 'IS_DRIVEN_BY',
--     'OCCURS_ON', 'RESOLVED_BY', 'HAS_FAILURE_MODE',
--     'HAS_SIGNAL', 'HAS_ALIAS',
--     'DEPENDS_ON', 'UPSTREAM_OF', 'DOWNSTREAM_OF', 'REPLACES',
--     'CONFIRMED_BY', 'CONTRADICTED_BY'
--   ));
--
-- COMMIT;
