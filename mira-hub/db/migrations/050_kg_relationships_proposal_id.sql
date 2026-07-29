BEGIN;

-- Migration 050: provenance back-link column on kg_relationships.
--
-- Issue: #1890 ([knowledge-review] P0 — Suggestions "Verify" 500s in every env)
-- ADR  : docs/adr/0017-proposal-state-machine-mapping.md
-- Spec : docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
--
-- The /api/proposals/[id]/decide endpoint (verify branch) writes
-- kg_relationships.relationship_proposal_id on both the INSERT (new edge) and
-- the UPDATE (existing edge) paths, recording which relationship_proposal a
-- verified edge was promoted from. The column was only ever described in a
-- COMMENT in 027_ai_suggestions.sql — no migration created it. Live dev/staging/
-- prod kg_relationships had no such column, so every "Verify" click 500'd with
-- `column "relationship_proposal_id" of relation "kg_relationships" does not
-- exist`. ("Reject" took the no-kg-write path, so it returned 200 — masking the
-- gap.) This is the same class of bug 029 fixed for approval_state/proposed_by/
-- evidence_summary: the route shipped ahead of its schema.
--
-- ON DELETE SET NULL: this is a provenance back-link, not an ownership edge.
-- A verified kg_relationships edge must survive the deletion of the proposal it
-- came from (the edge is now its own truth); the link just goes null.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (carries the FK) + CREATE INDEX IF NOT
-- EXISTS. Safe to re-run — applied to dev manually, recorded in the
-- schema_migrations ledger when apply-migrations.yml runs it on staging/prod.

ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS relationship_proposal_id uuid
    REFERENCES relationship_proposals(id) ON DELETE SET NULL;

-- Provenance lookups ("which edge did proposal X verify?") and the ADR-0017
-- canary's Check 2 read this back-link; index the non-null subset.
CREATE INDEX IF NOT EXISTS idx_kg_rel_proposal_id
  ON kg_relationships (relationship_proposal_id)
  WHERE relationship_proposal_id IS NOT NULL;

COMMIT;

-- ─── DOWN ──────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_kg_rel_proposal_id;
-- ALTER TABLE kg_relationships
--   DROP COLUMN IF EXISTS relationship_proposal_id;
-- COMMIT;
