BEGIN;

-- Migration 029: approval_state + provenance columns on kg_relationships and kg_entities.
--
-- ADR : docs/adr/0017-proposal-state-machine-mapping.md
-- Spec: docs/specs/maintenance-namespace-builder-spec.md §"Data Model"
--
-- The /api/proposals/[id]/decide endpoint already writes these columns but they
-- were missing from the schema, causing every Verify/Reject click to 500.
-- (The engine-side spec referenced "008_kg_approval_state.sql" — that file was
-- never written; this migration is the canonical delivery.)
--
-- kg_relationships gets three columns:
--   approval_state   — mirrors relationship_proposals.status post-promotion
--   proposed_by      — actor string ("llm:groq", "human:user_<uuid>", etc.)
--   evidence_summary — short text snapshot; full chain stays in relationship_evidence
--
-- kg_entities gets one column:
--   approval_state   — entity-level readiness (used by engine diagnostic path)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (approval_state IN ('proposed', 'verified', 'rejected', 'needs_review')),
  ADD COLUMN IF NOT EXISTS proposed_by TEXT,
  ADD COLUMN IF NOT EXISTS evidence_summary TEXT;

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (approval_state IN ('proposed', 'verified', 'rejected', 'needs_review', 'deprecated'));

-- Index: engine diagnostic path looks up verified edges for a given tenant fast.
CREATE INDEX IF NOT EXISTS idx_kg_rel_tenant_approval
  ON kg_relationships (tenant_id, approval_state)
  WHERE approval_state = 'verified';

CREATE INDEX IF NOT EXISTS idx_kg_ent_tenant_approval
  ON kg_entities (tenant_id, approval_state);

COMMIT;

-- ─── DOWN ──────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_kg_rel_tenant_approval;
-- DROP INDEX IF EXISTS idx_kg_ent_tenant_approval;
-- ALTER TABLE kg_relationships
--   DROP COLUMN IF EXISTS approval_state,
--   DROP COLUMN IF EXISTS proposed_by,
--   DROP COLUMN IF EXISTS evidence_summary;
-- ALTER TABLE kg_entities
--   DROP COLUMN IF EXISTS approval_state;
-- COMMIT;
