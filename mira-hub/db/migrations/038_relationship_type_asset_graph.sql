BEGIN;

-- Migration 038: Extend relationship_proposals.relationship_type CHECK with the
--                four genuinely-new asset-graph edge types.
--
-- Spec  : docs/mira/canonical-asset-graph.md §3 + §5 (SQL adapted from §5 — see
--         "LINEAGE" note below; §5's list was stale).
-- Epic  : #1666   Decisions: #1677
-- Plan  : docs/plans/2026-06-01-mira-master-architecture-plan.md (Phase 3 —
--         proposal path is the authoritative writer of new edge types).
--
-- Why:
--   The canonical asset graph (MIRA as the OT<->enterprise asset graph) needs
--   four edge types the existing vocabulary doesn't yet carry. 16 of the 18
--   requested edges map onto existing types as-is (see §3); only these four are
--   genuinely new:
--     - HAS_ALARM       — an asset/component has an alarm definition.
--     - HAS_WORK_ORDER  — an asset has an associated CMMS work order.
--     - HAS_PM_TASK     — an asset has a preventive-maintenance task.
--     - USES_PART       — a work order CONSUMES a spare part (consumption
--                         semantics), distinct from HAS_PART containment
--                         (an asset CONTAINS a part).
--
--   New edge types enter ONLY by extending this CHECK on relationship_proposals,
--   so the proposal path stays the authoritative gate (master-plan Phase 3).
--   kg_relationships.relationship_type stays free TEXT (no CHECK) — the proposal
--   table is the gate, not the materialized edge. No edge is auto-verified;
--   approval_state defaults are unchanged.
--
-- LINEAGE — why this list is 35, not the doc's 32 (28 + 4):
--   docs/mira/canonical-asset-graph.md §5 was written against the Hub-028
--   baseline of 28 values and predates the gap-closure merge (PR #1657). That
--   merge landed 032_inferred_relationship_types.sql, which extended the CHECK
--   with three more values: SAME_MODEL_AS, CO_FAILED_WITH, SIMILAR_TO. The LIVE
--   constraint is therefore 31 values, not 28. Copying §5 verbatim would have
--   silently DROPPED those three — a regression that would reject future
--   SAME_MODEL_AS / CO_FAILED_WITH / SIMILAR_TO proposals. This migration is a
--   strict SUPERSET of the live 31-value set (028's 28 + 032's 3) plus the four
--   new asset-graph types = 35 total. Every existing row remains valid; no data
--   is rewritten.
--
-- Compatibility:
--   The new CHECK is a strict superset of the live (post-032) constraint, so all
--   existing rows remain valid. DOWN restores the 31-value (post-032) state
--   exactly and refuses rollback if any of the four NEW-type rows still exist.

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
    -- Inferred / similarity (migration 032 — preserved, NOT dropped)
    'SAME_MODEL_AS', 'CO_FAILED_WITH', 'SIMILAR_TO',
    -- Asset-graph (new in migration 038)
    'HAS_ALARM', 'HAS_WORK_ORDER', 'HAS_PM_TASK', 'USES_PART'
  ));

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN
-- ----------------------------------------------------------------------------
-- Restores the live pre-038 (post-032) 31-value CHECK. Refuses rollback while
-- any of the four NEW asset-graph types are still in use.
--
-- BEGIN;
--
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM relationship_proposals
--     WHERE relationship_type IN ('HAS_ALARM', 'HAS_WORK_ORDER', 'HAS_PM_TASK', 'USES_PART')
--   ) THEN
--     RAISE EXCEPTION 'Cannot down-migrate 038: HAS_ALARM/HAS_WORK_ORDER/HAS_PM_TASK/USES_PART rows exist. Reject or rewrite them first.';
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
--     'CONFIRMED_BY', 'CONTRADICTED_BY',
--     'SAME_MODEL_AS', 'CO_FAILED_WITH', 'SIMILAR_TO'
--   ));
--
-- COMMIT;
