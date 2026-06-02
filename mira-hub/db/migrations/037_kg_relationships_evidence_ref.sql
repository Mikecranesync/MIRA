-- 037_kg_relationships_evidence_ref.sql
-- Purpose : Add explicit relationship_proposal_id FK on kg_relationships so
--           the engine and Hub can navigate directly from a verified edge back
--           to its proposal row (and its evidence chain in relationship_evidence)
--           without parsing JSONB payloads.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1 / §D2
--
-- Investigation findings (what already existed before this migration):
--
--   mig 001 (kg_relationships) — no relationship_proposal_id column.
--   mig 018 (relationship_proposals) — defines relationship_proposals(id UUID PK).
--   mig 027 (ai_suggestions) — for suggestion_type='kg_edge', the column
--     extracted_data JSONB stores {"relationship_proposal_id": <uuid>, ...}.
--     The link exists, but only in JSONB — not a real FK, not queryable as a
--     join without jsonb_extract. Hub /proposals reads it via JSON parsing.
--   mig 029 (kg_approval_state) — adds approval_state, proposed_by, evidence_summary
--     to kg_relationships, but still no direct proposal FK.
--
-- Conclusion: the direct FK is absent. This migration adds it as a nullable
-- column with a real FK constraint (relationship_proposals IS present in mig 018
-- and is guaranteed on every env that ran the standard migration sequence).
--
-- NULL = row predates the proposal system, or was inserted via import without
-- a corresponding proposal (valid; the FK is advisory/enrichment, not a hard
-- gate on writes).

BEGIN;

ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS relationship_proposal_id UUID
    REFERENCES relationship_proposals(id) ON DELETE SET NULL;

-- Index: navigate from proposal → verified edge (Phase 8 promotion job)
CREATE INDEX IF NOT EXISTS idx_kg_rel_proposal_id
  ON kg_relationships (relationship_proposal_id)
  WHERE relationship_proposal_id IS NOT NULL;

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_kg_rel_proposal_id;
-- ALTER TABLE kg_relationships DROP COLUMN IF EXISTS relationship_proposal_id;
-- COMMIT;
