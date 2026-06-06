BEGIN;

-- Migration 028: Add `DRIVES` + `IS_DRIVEN_BY` to relationship_proposals.relationship_type.
--
-- Spec : docs/specs/maintenance-namespace-builder-spec.md §"Component hierarchy"
-- ADR  : docs/adr/0018-component-hierarchy-siblings-with-control-edges.md
-- Plan : ~/.claude/plans/each-motor-should-be-majestic-popcorn.md
--
-- Why:
--   The existing relationship_proposals.relationship_type CHECK (migration 018)
--   covers Hierarchy / Documentation / Wiring / Logic / Faults / Signals /
--   Topology / Evidence. The closest match for the VFD-controls-motor
--   relationship is POWERED_BY, but that's too generic (a 24V control PSU
--   "powers" a relay without "driving" it in the variable-frequency sense).
--   Both IEC 81346-1:2022 and OPC UA Robotics (OPC 40010-1) model the VFD-
--   motor relationship as a typed semantic edge between sibling components,
--   not as parent-child containment. OPC UA's reference type is literally
--   named IsDrivenBy / Drives.
--
--   This migration adds DRIVES + IS_DRIVEN_BY as an inverse pair. The
--   AISuggestion accept handler writes both rows so any traversal (downstream
--   from VFD or upstream from motor) hits the edge.
--
-- Compatibility:
--   The new CHECK is a strict superset of the previous one — every existing
--   row remains valid. DOWN migration restores the prior CHECK exactly.

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
    -- Logic & control (DRIVES + IS_DRIVEN_BY new in this migration)
    'USED_IN_LOGIC', 'TRIGGERS', 'CAUSES', 'DRIVES', 'IS_DRIVEN_BY',
    -- Faults & resolution
    'OCCURS_ON', 'RESOLVED_BY', 'HAS_FAILURE_MODE',
    -- Signals
    'HAS_SIGNAL', 'HAS_ALIAS',
    -- Topology
    'DEPENDS_ON', 'UPSTREAM_OF', 'DOWNSTREAM_OF', 'REPLACES',
    -- Evidence meta
    'CONFIRMED_BY', 'CONTRADICTED_BY'
  ));

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN
-- ----------------------------------------------------------------------------
--
-- BEGIN;
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
--     'USED_IN_LOGIC', 'TRIGGERS', 'CAUSES',
--     'OCCURS_ON', 'RESOLVED_BY', 'HAS_FAILURE_MODE',
--     'HAS_SIGNAL', 'HAS_ALIAS',
--     'DEPENDS_ON', 'UPSTREAM_OF', 'DOWNSTREAM_OF', 'REPLACES',
--     'CONFIRMED_BY', 'CONTRADICTED_BY'
--   ));
--
-- -- Pre-check: refuse rollback if any DRIVES / IS_DRIVEN_BY rows still exist.
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM relationship_proposals
--     WHERE relationship_type IN ('DRIVES', 'IS_DRIVEN_BY')
--   ) THEN
--     RAISE EXCEPTION 'Cannot down-migrate: DRIVES/IS_DRIVEN_BY rows exist. Reject or rewrite them first.';
--   END IF;
-- END $$;
--
-- COMMIT;
