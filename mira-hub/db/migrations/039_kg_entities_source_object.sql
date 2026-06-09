BEGIN;

-- Migration 039: Add kg_entities.source_object_id — canonical source-system
--                identity on a graph node (one FK into the Phase 2 source layer).
--
-- Spec  : docs/mira/canonical-asset-graph.md §4 + §5 (SQL copied verbatim).
-- Epic  : #1666  ·  Decisions: #1677  ·  Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md (Phase 2 — source layer)
--
-- WHY
--   A canonical node must preserve which external record it came from. Today
--   kg_entities carries only source_chunk_id / source_conversation_id (organic
--   provenance). For connector-imported nodes (MaintainX/SAP/Ignition/...) the
--   canonical mechanism is a single FK into the Phase 2 `source_objects` table.
--
--   This migration adds the column (and its index) now so the KG side is ready
--   before the source layer (migrations 040-042) lands. The column is a
--   FK-BY-CONVENTION to source_objects(id); the actual FK constraint is added
--   with source_objects in Phase 2 — adding it here would reference a table that
--   does not yet exist.
--
--   Nullable by design: organic nodes (chat/photo) have no external source
--   object — that is the normal case, not an error. source_object_id holds the
--   PRIMARY/origin row; a node deriving from N source rows (manual + CMMS +
--   nameplate) gets the full set via the reverse FK source_objects.mapped_entity_id
--   defined in Phase 2.
--
-- COMPATIBILITY
--   Additive, idempotent (IF NOT EXISTS). No existing row changes. No FK
--   constraint, no NOT NULL, no default. DOWN drops the index then the column.

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS source_object_id UUID;  -- FK-by-convention -> source_objects(id), Phase 2

CREATE INDEX IF NOT EXISTS idx_kg_entities_source_object
  ON kg_entities (tenant_id, source_object_id)
  WHERE source_object_id IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN
-- ----------------------------------------------------------------------------
-- BEGIN;
--
-- DROP INDEX IF EXISTS idx_kg_entities_source_object;
-- ALTER TABLE kg_entities DROP COLUMN IF EXISTS source_object_id;
--
-- COMMIT;
