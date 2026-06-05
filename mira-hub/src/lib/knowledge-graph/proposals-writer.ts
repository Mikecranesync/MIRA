// src/lib/knowledge-graph/proposals-writer.ts
/**
 * Idempotent writer for INFERRED relationship proposals (created_by='rule').
 * Skips writing when a verified kg_relationships edge OR an open (non-rejected)
 * proposal already exists for the same pair+type (checked in BOTH directions,
 * since same_model/co_failed are symmetric). Evidence rows are inserted 1..N.
 * Assumes the caller has set the tenant RLS context (see kg-infer-proposals worker).
 */
import type { PoolClient } from "pg";

/**
 * Canonical relationship-type vocabulary accepted by the
 * `relationship_proposals.relationship_type` CHECK (migrations 018 → 028 →
 * 032). Every inferred proposal MUST use one of these; a non-canonical type
 * would violate the CHECK and throw, dropping the edge. Single source of
 * truth on the TS side — keep in lockstep with the latest
 * `*_relationship_type_check` migration.
 */
export const CANONICAL_PROPOSAL_RELATIONSHIP_TYPES = new Set<string>([
  // Hierarchy
  "HAS_COMPONENT", "INSTANCE_OF", "LOCATED_IN", "HAS_PART",
  // Documentation
  "HAS_DOCUMENT", "HAS_CHUNK", "REFERENCES", "HAS_PROCEDURE",
  // Wiring & power
  "WIRED_TO", "POWERED_BY", "MAPS_TO", "PUBLISHED_AS",
  // Logic & control
  "USED_IN_LOGIC", "TRIGGERS", "CAUSES", "DRIVES", "IS_DRIVEN_BY",
  // Faults & resolution
  "OCCURS_ON", "RESOLVED_BY", "HAS_FAILURE_MODE",
  // Signals
  "HAS_SIGNAL", "HAS_ALIAS",
  // Topology
  "DEPENDS_ON", "UPSTREAM_OF", "DOWNSTREAM_OF", "REPLACES",
  // Evidence meta
  "CONFIRMED_BY", "CONTRADICTED_BY",
  // Inferred / similarity
  "SAME_MODEL_AS", "CO_FAILED_WITH", "SIMILAR_TO",
]);

export function isCanonicalProposalRelationshipType(t: string): boolean {
  return CANONICAL_PROPOSAL_RELATIONSHIP_TYPES.has(t);
}

/**
 * Maps the hub's lowercase `kg_relationships` vocabulary (`types.ts`
 * RELATIONSHIP_TYPES — emitted by the LLM extractor, CMMS sync, hierarchy
 * backfill, etc.) to the UPPERCASE canonical vocabulary the
 * `relationship_proposals` CHECK accepts. The TS analogue of the Python
 * `_CANONICAL_RELATION_TYPE` map (mira-crawler/ingest/proposal_writer.py).
 *
 * `flip` means the canonical edge runs the opposite direction from the
 * lowercase one (e.g. `A caused_by B` → `B CAUSES A`), so the caller must
 * swap source/target. Types with no clean canonical equivalent are omitted
 * → `mapToCanonicalEdge` returns null and the caller skips the edge rather
 * than emit a wrong type. Extend deliberately as the vocabularies converge.
 */
const LOWERCASE_TO_CANONICAL_EDGE: Record<string, { type: string; flip: boolean }> = {
  // LLM relationship-extractor (EXTRACTOR_ALLOWLIST)
  caused_by: { type: "CAUSES", flip: true },
  resolved_by: { type: "RESOLVED_BY", flip: false },
  feeds: { type: "UPSTREAM_OF", flip: false },
  requires_part: { type: "HAS_PART", flip: false },
  triggered_pm: { type: "TRIGGERS", flip: false },
  had_fault: { type: "HAS_FAILURE_MODE", flip: false },
  // conversation extractor
  mentioned_tag: { type: "HAS_SIGNAL", flip: false },
  exhibited_fault: { type: "HAS_FAILURE_MODE", flip: false },
  // CMMS sync
  located_at: { type: "LOCATED_IN", flip: false },
  has_pm: { type: "HAS_PROCEDURE", flip: false },
  // hierarchy backfill (area → equipment: the parent HAS_COMPONENT the child)
  parent_of: { type: "HAS_COMPONENT", flip: false },
  // other types.ts vocabulary
  has_component: { type: "HAS_COMPONENT", flip: false },
  electrically_connected: { type: "WIRED_TO", flip: false },
  references_drawing: { type: "REFERENCES", flip: false },
  similar_to: { type: "SIMILAR_TO", flip: false },
  // No clean canonical equivalent yet (skip + warn until added to the CHECK):
  //   has_work_order, controls, protects, maintained_by
};

/**
 * Resolve any relationship type to a canonical proposal edge. Already-canonical
 * types pass through unflipped; known lowercase types map; everything else
 * returns null (caller skips).
 */
export function mapToCanonicalEdge(
  rawType: string,
): { type: string; flip: boolean } | null {
  if (isCanonicalProposalRelationshipType(rawType)) return { type: rawType, flip: false };
  return LOWERCASE_TO_CANONICAL_EDGE[rawType] ?? null;
}

export interface InferredEvidence {
  evidenceType: string; // must be in relationship_evidence CHECK (e.g. 'manifest','work_order')
  sourceDescription?: string;
  excerpt?: string;
  confidenceContribution: number; // [-1, 1]
}

export interface InferredProposalInput {
  sourceEntityId: string;
  sourceEntityType: string;
  targetEntityId: string;
  targetEntityType: string;
  relationshipType: string;
  confidence: number;
  reasoning: string;
  evidence: InferredEvidence[];
}

/** Returns the new proposalId, or null if skipped (already exists). */
export async function upsertInferredProposal(
  client: PoolClient,
  tenantId: string,
  p: InferredProposalInput,
): Promise<string | null> {
  // Central guard: a non-canonical type would violate the
  // relationship_proposals CHECK and throw. Skip (don't drop the run) and
  // warn so the caller's mapping gap is visible. Every existing caller
  // already passes canonical types.
  if (!isCanonicalProposalRelationshipType(p.relationshipType)) {
    console.warn(
      `upsertInferredProposal: non-canonical relationship_type ${JSON.stringify(
        p.relationshipType,
      )} — proposal skipped (${p.sourceEntityId} -> ${p.targetEntityId})`,
    );
    return null;
  }

  const relExists = await client.query(
    `SELECT 1 FROM kg_relationships
      WHERE tenant_id = $1 AND relationship_type = $2
        AND ((source_id = $3 AND target_id = $4) OR (source_id = $4 AND target_id = $3))
      LIMIT 1`,
    [tenantId, p.relationshipType, p.sourceEntityId, p.targetEntityId],
  );
  if (relExists.rowCount && relExists.rowCount > 0) return null;

  const propExists = await client.query(
    `SELECT 1 FROM relationship_proposals
      WHERE tenant_id = $1 AND relationship_type = $2 AND status <> 'rejected'
        AND ((source_entity_id = $3 AND target_entity_id = $4)
          OR (source_entity_id = $4 AND target_entity_id = $3))
      LIMIT 1`,
    [tenantId, p.relationshipType, p.sourceEntityId, p.targetEntityId],
  );
  if (propExists.rowCount && propExists.rowCount > 0) return null;

  const ins = await client.query<{ id: string }>(
    `INSERT INTO relationship_proposals
       (tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type,
        relationship_type, confidence, status, created_by, risk_level, requires_human_review, reasoning)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'proposed','rule','low',true,$8)
     RETURNING id`,
    [tenantId, p.sourceEntityId, p.sourceEntityType, p.targetEntityId, p.targetEntityType,
     p.relationshipType, p.confidence, p.reasoning],
  );
  const proposalId = ins.rows[0].id;

  for (const ev of p.evidence) {
    await client.query(
      `INSERT INTO relationship_evidence
         (proposal_id, evidence_type, source_description, excerpt, confidence_contribution)
       VALUES ($1,$2,$3,$4,$5)`,
      [proposalId, ev.evidenceType, ev.sourceDescription ?? null, ev.excerpt ?? null, ev.confidenceContribution],
    );
  }
  return proposalId;
}
