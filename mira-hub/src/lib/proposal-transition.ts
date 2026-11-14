/**
 * proposal-transition.ts — the single Hub-side writer for proposal status.
 *
 * Implements ADR-0017 ("Proposal state-machine mapping — one logical machine,
 * three table projections"). One logical decision fans out to three tables,
 * each with its own enum:
 *
 *   ai_suggestions.status          pending|accepted|rejected|deferred|superseded
 *   relationship_proposals.status  proposed|reviewed|verified|rejected|deprecated|contradicted
 *   kg_*.approval_state            proposed|verified|rejected|needs_review   (engine side, Python)
 *
 * This module owns the FIRST TWO (Hub) projections. kg_*.approval_state is the
 * engine's hot-path read and is written by mira_bots/shared/proposal_transition.py
 * and by the decide route's existing kg_relationships upsert.
 *
 * Per .claude/CLAUDE.md § "Knowledge graph proposals": once this helper exists,
 * a direct `UPDATE … SET status = …` on ai_suggestions / relationship_proposals
 * is a bug — go through applyHubProposalTransition().
 *
 * The mapping table below is the load-bearing artifact (ADR-0017 §Decision).
 */

export type ProposalTrigger =
  | "new" // a fresh LLM proposal lands
  | "accept" // admin accepts on Hub
  | "reject" // admin rejects on Hub
  | "defer" // admin punts ("ask me later")
  | "supersede" // a newer proposal replaces this one
  | "contradict" // engine finds contradicting evidence
  | "flag_review"; // engine flags an edge for human re-look

export interface HubStatusMap {
  /** ai_suggestions.status, or null to leave unchanged. */
  aiSuggestion: string | null;
  /** relationship_proposals.status (kg_edge only), or null to leave unchanged. */
  relationshipProposal: string | null;
}

/** Canonical ADR-0017 mapping (Hub-side columns only). */
export const PROPOSAL_TRANSITIONS: Record<ProposalTrigger, HubStatusMap> = {
  new: { aiSuggestion: "pending", relationshipProposal: "proposed" },
  accept: { aiSuggestion: "accepted", relationshipProposal: "verified" },
  reject: { aiSuggestion: "rejected", relationshipProposal: "rejected" },
  defer: { aiSuggestion: "deferred", relationshipProposal: null },
  supersede: { aiSuggestion: "superseded", relationshipProposal: "deprecated" },
  contradict: { aiSuggestion: "pending", relationshipProposal: "contradicted" },
  flag_review: { aiSuggestion: "pending", relationshipProposal: "reviewed" },
};

import { kgAliasValuesSql } from "@/capabilities/kg-relationship-read-view";

/** The kg_relationships.approval_state a superseded edge moves to (ADR-0017, amended #5523). */
export const KG_EDGE_STATE_WHEN_SUPERSEDED = "rejected";

/** Minimal query interface — matches the pg client passed by withTenantContext. */
export interface QueryClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export interface ProposalTransitionInput {
  trigger: ProposalTrigger;
  /** relationship_proposals.id (for kg_edge proposals). */
  relationshipProposalId?: string;
  /** ai_suggestions.id, if known directly. */
  aiSuggestionId?: string;
  /** Audit label, e.g. `human:<userId>`. */
  reviewerLabel?: string;
  /** Optional reason, stored on relationship_proposals.reasoning. */
  reason?: string;
}

export interface ProposalTransitionResult {
  trigger: ProposalTrigger;
  relationshipProposalStatus: string | null;
  aiSuggestionStatus: string | null;
  aiSuggestionRowsUpdated: number;
  /** kg_relationships rows taken out of the verified set (supersede only). */
  kgEdgesDemoted: number;
}

/**
 * Apply the ADR-0017 Hub-side projections for one logical decision, inside the
 * caller's transaction. Updates relationship_proposals (when an id + mapped
 * status are present) AND the paired ai_suggestions row (matched by
 * payload->>'relationship_proposal_id', or by explicit aiSuggestionId) so the
 * two Hub projections never drift apart — the gap the ADR-0017 canary detects.
 *
 * Engine-side kg_*.approval_state is NOT written here (Python helper / the
 * decide route's kg_relationships upsert own it) — with ONE exception, amended
 * 2026-11-14 (#5523): `supersede` also takes the superseded edge out of the
 * verified set, in the same transaction, so no reader can serve a corrected fact.
 */
export async function applyHubProposalTransition(
  client: QueryClient,
  input: ProposalTransitionInput,
): Promise<ProposalTransitionResult> {
  const map = PROPOSAL_TRANSITIONS[input.trigger];
  if (!map) {
    throw new Error(`unknown proposal trigger: ${String(input.trigger)}`);
  }
  const reviewer = input.reviewerLabel ?? null;
  const reason = input.reason ?? "";

  // 1) relationship_proposals (kg_edge projection)
  if (map.relationshipProposal && input.relationshipProposalId) {
    await client.query(
      `UPDATE relationship_proposals
          SET status = $1,
              reviewed_at = now(),
              reviewed_by = COALESCE($2, reviewed_by),
              reasoning = COALESCE(NULLIF($3, ''), reasoning)
        WHERE id = $4`,
      [map.relationshipProposal, reviewer, reason, input.relationshipProposalId],
    );
  }

  // 1b) supersede: the edge this proposal verified leaves the verified set (#5523).
  // kg_relationships cannot hold 'deprecated'; 'rejected' is the allowed non-current state
  // and the proposal's 'deprecated' status records why. Matched by the proposal link OR by
  // the proposal's own tenant/endpoints/type, because approval keeps a row's FIRST link.
  let kgEdges = 0;
  if (input.trigger === "supersede" && input.relationshipProposalId) {
    const r = await client.query(
      `UPDATE kg_relationships k
          SET approval_state = '${KG_EDGE_STATE_WHEN_SUPERSEDED}'
         FROM relationship_proposals p
        WHERE p.id = $1
          AND k.approval_state = 'verified'
          AND k.tenant_id = p.tenant_id
          AND (k.relationship_proposal_id = p.id
               OR (k.source_id = p.source_entity_id
                   AND k.target_id = p.target_entity_id
                   AND k.relationship_type = p.relationship_type)
               -- the same fact stored under its legacy name (endpoints swapped where the
               -- writer swaps them): a duplicate must not keep a retired fact current
               OR EXISTS (SELECT 1 FROM (VALUES ${kgAliasValuesSql()}) AS m(canonical, legacy, flip)
                           WHERE m.canonical = p.relationship_type
                             AND k.relationship_type = m.legacy
                             AND k.source_id = CASE WHEN m.flip THEN p.target_entity_id ELSE p.source_entity_id END
                             AND k.target_id = CASE WHEN m.flip THEN p.source_entity_id ELSE p.target_entity_id END))
          -- replay-safe: a LATER approval of the same fact outranks this older supersede
          AND NOT EXISTS (SELECT 1 FROM relationship_proposals p2
                           WHERE p2.id <> p.id
                             AND p2.tenant_id = p.tenant_id
                             AND p2.source_entity_id = p.source_entity_id
                             AND p2.target_entity_id = p.target_entity_id
                             AND p2.relationship_type = p.relationship_type
                             AND p2.status = 'verified')`,
      [input.relationshipProposalId],
    );
    kgEdges = (r as { rowCount?: number }).rowCount ?? r.rows.length;
  }

  // 2) ai_suggestions (Hub queue projection) — keep the paired row in lockstep.
  // The kg_edge AISuggestion points at its relationship_proposals row via the
  // JSONB column `extracted_data` -> 'relationship_proposal_id' (verified
  // against mig 027 + the ADR-0017 canary, which keys off the same column —
  // NOT `payload`).
  let aiRows = 0;
  if (map.aiSuggestion) {
    if (input.aiSuggestionId) {
      const r = await client.query(
        `UPDATE ai_suggestions
            SET status = $1, updated_at = now(),
                reviewed_by = COALESCE($2, reviewed_by),
                reviewed_at = now()
          WHERE id = $3`,
        [map.aiSuggestion, reviewer, input.aiSuggestionId],
      );
      aiRows = (r as { rowCount?: number }).rowCount ?? r.rows.length;
    } else if (input.relationshipProposalId) {
      const r = await client.query(
        `UPDATE ai_suggestions
            SET status = $1, updated_at = now(),
                reviewed_by = COALESCE($2, reviewed_by),
                reviewed_at = now()
          WHERE suggestion_type = 'kg_edge'
            AND NULLIF(extracted_data->>'relationship_proposal_id', '')::uuid = $3::uuid`,
        [map.aiSuggestion, reviewer, input.relationshipProposalId],
      );
      aiRows = (r as { rowCount?: number }).rowCount ?? r.rows.length;
    }
  }

  return {
    trigger: input.trigger,
    relationshipProposalStatus: map.relationshipProposal,
    aiSuggestionStatus: map.aiSuggestion,
    aiSuggestionRowsUpdated: aiRows,
    kgEdgesDemoted: kgEdges,
  };
}
