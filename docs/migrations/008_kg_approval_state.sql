-- Migration 008: engine-side approval state on kg_entities + kg_relationships.
--
-- Spec : docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
-- Plan : docs/plans/2026-05-15-maintenance-namespace-builder.md (Phase 1
--        deliverable #1, Phase 2 slice-2 dependency)
-- ADR  : docs/adr/0013-uns-namespace-builder-schema-canonicalization.md
--
-- The Hub-side `relationship_proposals` table (mira-hub/db/migrations/
-- 018_relationship_proposals.sql) is the upstream proposal queue. When a
-- human (or rule) verifies a proposal, the engine-readable copy lands here
-- on kg_relationships. This column lets the engine answer "is this edge
-- safe to act on?" without joining back to the Hub schema.
--
-- Two columns:
--   approval_state — 'proposed' | 'verified' | 'rejected' | 'needs_review'.
--                    Default 'verified' on backfill of existing rows because
--                    rows that pre-date this migration were inserted by the
--                    old direct-write path (no proposal queue at the time).
--                    Default 'proposed' for new inserts so future write
--                    paths must promote explicitly.
--   proposed_by   — opaque actor id ('llm:groq', 'human:user_xxx',
--                    'rule:cmms_import', 'import:csv'). Free-text; the app
--                    layer enforces vocabulary.
--   evidence_summary — short text snapshot of the evidence at promotion
--                    time. The full evidence chain lives on Hub's
--                    `relationship_evidence` (mig 018); this column is a
--                    convenience read for the engine.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- kg_relationships — every edge gets an approval state.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'verified'
    CHECK (approval_state IN ('proposed', 'verified', 'rejected', 'needs_review'));

ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS proposed_by TEXT;

ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS evidence_summary TEXT;

CREATE INDEX IF NOT EXISTS kg_rel_approval_state
  ON kg_relationships (tenant_id, approval_state);

-- Partial index for the diagnostic engine's hot read path — "give me all
-- verified relationships for this tenant" should not scan rejected/proposed
-- rows.
CREATE INDEX IF NOT EXISTS kg_rel_verified_only
  ON kg_relationships (tenant_id, relationship_type)
  WHERE approval_state = 'verified';


-- ────────────────────────────────────────────────────────────────────────
-- kg_entities — entities themselves can be proposed (e.g., an LLM proposed
-- a new component template). Same column shape.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'verified'
    CHECK (approval_state IN ('proposed', 'verified', 'rejected', 'needs_review'));

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS proposed_by TEXT;

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS evidence_summary TEXT;

CREATE INDEX IF NOT EXISTS kg_ent_approval_state
  ON kg_entities (tenant_id, approval_state);

CREATE INDEX IF NOT EXISTS kg_ent_verified_only
  ON kg_entities (tenant_id, entity_type)
  WHERE approval_state = 'verified';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────
-- DOWN — drop indexes + columns. Existing rows survive (no data loss).
-- ────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS kg_rel_verified_only;
-- DROP INDEX IF EXISTS kg_rel_approval_state;
-- DROP INDEX IF EXISTS kg_ent_verified_only;
-- DROP INDEX IF EXISTS kg_ent_approval_state;
-- ALTER TABLE kg_relationships DROP COLUMN IF EXISTS evidence_summary;
-- ALTER TABLE kg_relationships DROP COLUMN IF EXISTS proposed_by;
-- ALTER TABLE kg_relationships DROP COLUMN IF EXISTS approval_state;
-- ALTER TABLE kg_entities      DROP COLUMN IF EXISTS evidence_summary;
-- ALTER TABLE kg_entities      DROP COLUMN IF EXISTS proposed_by;
-- ALTER TABLE kg_entities      DROP COLUMN IF EXISTS approval_state;
-- COMMIT;
