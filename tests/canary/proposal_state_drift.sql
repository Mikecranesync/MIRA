-- ADR-0017 proposal-state-drift canary (#1723)
--
-- Each query below returns the OFFENDING rows for one cross-table invariant.
-- A healthy database returns ZERO rows for every check. The nightly workflow
-- (.github/workflows/proposal-state-canary.yml) runs these against STAGING and
-- fails on any non-zero result.
--
-- Doctrine: MIRA proposes, a human verifies (ADR-0017,
-- .claude/skills/managing-the-knowledge-graph). The three status projections
-- (ai_suggestions.status / relationship_proposals.status /
-- kg_relationships.approval_state) must stay consistent.
--
-- LEGACY-SAFE BY DESIGN: both checks key off an explicit proposal link, so the
-- ~300 pre-#1716/#1729 auto-verified edges (which have
-- kg_relationships.relationship_proposal_id IS NULL and no paired suggestion)
-- are never flagged. A naive "any verified edge without a proposal" check would
-- false-positive on all of them — these don't.

-- @check: accepted_suggestion_pairs_unverified_proposal
-- An ai_suggestions(kg_edge) the human ACCEPTED must point at a
-- relationship_proposals row that is now 'verified'. If the suggestion is
-- accepted but its paired proposal is not verified, the accept→verify
-- transition (ADR-0017) broke.
SELECT
  s.id              AS suggestion_id,
  s.status          AS suggestion_status,
  p.id              AS proposal_id,
  p.status          AS proposal_status
FROM ai_suggestions s
JOIN relationship_proposals p
  ON p.id = NULLIF(s.extracted_data ->> 'relationship_proposal_id', '')::uuid
WHERE s.suggestion_type = 'kg_edge'
  AND s.status = 'accepted'
  AND p.status <> 'verified';

-- @check: verified_edge_links_unverified_proposal
-- A kg_relationships row that records which proposal it came from
-- (relationship_proposal_id) must link to a 'verified' proposal — the edge is
-- only supposed to exist because a human verified that proposal. A link to a
-- non-verified proposal means an edge was written ahead of (or without) its
-- human approval.
SELECT
  k.id                       AS relationship_id,
  k.approval_state,
  k.relationship_proposal_id,
  p.status                   AS proposal_status
FROM kg_relationships k
JOIN relationship_proposals p
  ON p.id = k.relationship_proposal_id
WHERE k.relationship_proposal_id IS NOT NULL
  AND p.status <> 'verified';
