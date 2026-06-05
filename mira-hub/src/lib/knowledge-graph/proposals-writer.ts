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
