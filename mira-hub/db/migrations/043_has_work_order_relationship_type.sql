BEGIN;

-- Migration 043: Add CMMS / tag relationship types to
-- relationship_proposals.relationship_type (HAS_WORK_ORDER, HAS_PM_SCHEDULE,
-- HAS_TAG).
--
-- Issue : #1721 (hub relationship writers must propose by default)
-- ADR   : docs/adr/0017-proposal-state-machine-mapping.md
-- Map   : mira-hub/src/lib/knowledge-graph/proposals-writer.ts
--         (CANONICAL_PROPOSAL_RELATIONSHIP_TYPES + mapToCanonicalEdge)
--
-- Why:
--   The CMMS-sync + conversation writers (cmms-sync.ts / extractor.ts) emit
--   equipment→work-order, equipment→PM-schedule, and asset→tag edges. To
--   migrate them onto the propose path (upsertInferredProposal) these need
--   canonical types the CHECK accepts, and the team chose DEDICATED types over
--   reusing near-fits (so the graph distinguishes a work order from a
--   procedure, and a tag from a generic signal):
--     - has_work_order → HAS_WORK_ORDER   (vs the too-narrow HAS_PROCEDURE)
--     - has_pm         → HAS_PM_SCHEDULE   (a recurring PM, distinct from a
--                                           one-off work-instruction PROCEDURE)
--     - mentioned_tag  → HAS_TAG           (a PLC/CMMS tag, distinct from the
--                                           generic HAS_SIGNAL)
--   The remaining emitted types still map to existing canonical members
--   (located_at→LOCATED_IN, parent_of→LOCATED_IN [flipped],
--   exhibited_fault→HAS_FAILURE_MODE, requires_part→HAS_PART) — no new type
--   needed for those.
--
-- Numbering:
--   037 is the live tail; 038–042 are reserved by #1677 (canonical asset-graph
--   sign-offs). This takes 043 to stay clear of that range.
--
-- Compatibility:
--   The new CHECK is a strict SUPERSET of migration 032 — every existing row
--   stays valid. DOWN restores the 032 CHECK exactly (refuses if HAS_WORK_ORDER
--   rows exist).

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
    -- Inferred / similarity
    'SAME_MODEL_AS', 'CO_FAILED_WITH', 'SIMILAR_TO',
    -- CMMS / tags (new in this migration)
    'HAS_WORK_ORDER', 'HAS_PM_SCHEDULE', 'HAS_TAG'
  ));

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN
-- ----------------------------------------------------------------------------
--
-- BEGIN;
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM relationship_proposals WHERE relationship_type IN ('HAS_WORK_ORDER','HAS_PM_SCHEDULE','HAS_TAG')) THEN
--     RAISE EXCEPTION 'Cannot down-migrate: HAS_WORK_ORDER/HAS_PM_SCHEDULE/HAS_TAG rows exist. Reject or rewrite them first.';
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
