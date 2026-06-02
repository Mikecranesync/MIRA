/**
 * Proposal state-machine transitions — Hub / TypeScript side.
 *
 * ADR: docs/adr/0017-proposal-state-machine-mapping.md
 *
 * Wraps every status write on:
 *   ai_suggestions.status
 *   relationship_proposals.status
 *   kg_relationships.approval_state  (post-approval write only)
 *
 * All callers must go through proposeRelationship / reviewProposal.
 * Direct UPDATE statements that bypass these helpers are bugs per ADR-0017 §Enforcement.
 *
 * ADR-0017 state-transition table (implemented here)
 * ---------------------------------------------------
 * | Trigger               | ai_suggestions | relationship_proposals | kg_relationships |
 * |-----------------------|----------------|------------------------|------------------|
 * | New LLM proposal      | pending        | proposed               | — (no row)       |
 * | Admin accepts         | accepted       | verified               | verified (write) |
 * | Admin rejects         | rejected       | rejected               | — (no row)       |
 * | Engine re-queues      | pending        | reviewed               | needs_review     |
 * | Contradicting evidence| pending+reason | contradicted           | needs_review     |
 * | Superseded by newer   | superseded     | deprecated             | unchanged        |
 *
 * Legal pre-states for reviewProposal: proposed | reviewed | needs_review.
 *
 * Vocab
 * -----
 * RELATIONSHIP_TYPE_VOCAB mirrors migrations 018/028 CHECK constraint.
 * reviewProposal enforces it so the Hub rejects bad types before DB roundtrip.
 */

import type { PoolClient } from "pg";
import { withTenantContext } from "@/lib/tenant-context";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Controlled vocabulary — mirrors migrations 018 + 028 CHECK constraints.
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPE_VOCAB = new Set<string>([
  // Hierarchy
  "HAS_COMPONENT",
  "INSTANCE_OF",
  "LOCATED_IN",
  "HAS_PART",
  // Documentation
  "HAS_DOCUMENT",
  "HAS_CHUNK",
  "REFERENCES",
  "HAS_PROCEDURE",
  // Wiring & power
  "WIRED_TO",
  "POWERED_BY",
  "MAPS_TO",
  "PUBLISHED_AS",
  // Logic & control (DRIVES + IS_DRIVEN_BY added migration 028)
  "USED_IN_LOGIC",
  "TRIGGERS",
  "CAUSES",
  "DRIVES",
  "IS_DRIVEN_BY",
  // Faults & resolution
  "OCCURS_ON",
  "RESOLVED_BY",
  "HAS_FAILURE_MODE",
  // Signals
  "HAS_SIGNAL",
  "HAS_ALIAS",
  // Topology
  "DEPENDS_ON",
  "UPSTREAM_OF",
  "DOWNSTREAM_OF",
  "REPLACES",
  // Evidence meta
  "CONFIRMED_BY",
  "CONTRADICTED_BY",
]);

const REVIEWABLE_STATES = new Set(["proposed", "reviewed", "needs_review"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceInput {
  evidence_type:
    | "document_page"
    | "plc_rung"
    | "tag_list"
    | "work_order"
    | "technician_note"
    | "live_data"
    | "manifest"
    | "oem_kb"
    | "human_observation";
  source_id?: string | null;
  source_description?: string | null;
  page_or_location?: string | null;
  excerpt?: string | null;
  confidence_contribution?: number;
}

export interface ProposeRelationshipInput {
  sourceId: string;
  targetId: string;
  relType: string;
  evidence?: EvidenceInput[];
  confidence?: number;
  reasoning?: string | null;
  riskLevel?: "low" | "medium" | "high" | "safety_critical";
  sourceChunkId?: string | null;
  proposedBy?: string;
  title?: string | null;
  body?: string | null;
}

export interface ProposeRelationshipResult {
  proposalId: string;
  created: boolean; // false = de-duped, returned existing
}

export type ReviewDecision = "approve" | "reject";

export interface ReviewProposalInput {
  proposalId: string;
  decision: ReviewDecision;
  tenantId: string;
  reviewedBy: string;
  reason?: string;
}

export interface ReviewProposalResult {
  proposalId: string;
  decision: ReviewDecision;
  proposalStatus: "verified" | "rejected";
  kgRelationshipId: string | null;
}

// ---------------------------------------------------------------------------
// proposeRelationship
// ---------------------------------------------------------------------------

/**
 * Create a relationship_proposals row + evidence + ai_suggestions(kg_edge).
 * De-duped on (tenant_id, source, target, rel_type).
 * Returns the proposal ID and whether a new row was created.
 * Rejects unknown rel_type values from RELATIONSHIP_TYPE_VOCAB.
 */
export async function proposeRelationship(
  tenantId: string,
  input: ProposeRelationshipInput,
): Promise<ProposeRelationshipResult | null> {
  const {
    sourceId,
    targetId,
    relType,
    evidence = [],
    confidence = 0.5,
    reasoning = null,
    riskLevel = "low",
    sourceChunkId = null,
    proposedBy = "llm:unknown",
    title = null,
    body = null,
  } = input;

  // --- vocab guard ---
  if (!RELATIONSHIP_TYPE_VOCAB.has(relType)) {
    console.error(
      `[proposal-transition] proposeRelationship rejected unknown rel_type=${relType}`,
    );
    return null;
  }

  if (sourceId === targetId) {
    console.debug(`[proposal-transition] skipping self-edge ${sourceId}`);
    return null;
  }

  try {
    return await withTenantContext(tenantId, async (c) => {
      // --- look up entity types ---
      const srcTypeRow = await c.query<{ entity_type: string }>(
        "SELECT entity_type FROM kg_entities WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1",
        [sourceId, tenantId],
      );
      const tgtTypeRow = await c.query<{ entity_type: string }>(
        "SELECT entity_type FROM kg_entities WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1",
        [targetId, tenantId],
      );
      const srcType = srcTypeRow.rows[0]?.entity_type ?? "unknown";
      const tgtType = tgtTypeRow.rows[0]?.entity_type ?? "unknown";

      // --- de-dup ---
      const existingRes = await c.query<{ id: string }>(
        `SELECT id FROM relationship_proposals
          WHERE source_entity_id = $1
            AND target_entity_id = $2
            AND relationship_type = $3
            AND (tenant_id = $4 OR tenant_id IS NULL)
          LIMIT 1`,
        [sourceId, targetId, relType, tenantId],
      );

      if (existingRes.rows.length > 0) {
        const proposalId = existingRes.rows[0].id;
        await writeEvidence(c, proposalId, evidence, sourceChunkId);
        return { proposalId, created: false };
      }

      const proposalId = randomUUID();
      const clampedConf = Math.max(0.0, Math.min(1.0, confidence));
      const createdBy = proposedBy.startsWith("llm") ? "llm" : "import";

      await c.query(
        `INSERT INTO relationship_proposals
             (id, tenant_id,
              source_entity_id, source_entity_type,
              target_entity_id, target_entity_type,
              relationship_type, confidence,
              status, created_by,
              risk_level, requires_human_review,
              reasoning)
         VALUES
             ($1, $2,
              $3, $4,
              $5, $6,
              $7, $8,
              'proposed', $9,
              $10, $11,
              $12)`,
        [
          proposalId,
          tenantId,
          sourceId,
          srcType,
          targetId,
          tgtType,
          relType,
          clampedConf,
          createdBy,
          riskLevel,
          riskLevel === "high" || riskLevel === "safety_critical",
          reasoning,
        ],
      );

      await writeEvidence(c, proposalId, evidence, sourceChunkId);

      // --- ai_suggestions bridge ---
      const suggestionId = randomUUID();
      const payload = JSON.stringify({
        relationship_proposal_id: proposalId,
        relationship_type: relType,
        source_entity_id: sourceId,
        target_entity_id: targetId,
      });

      await c.query(
        `INSERT INTO ai_suggestions
             (id, tenant_id, suggestion_type,
              extracted_data, confidence,
              status, risk_level,
              proposed_by, title, body,
              source_kind)
         VALUES
             ($1, $2, 'kg_edge',
              $3::jsonb, $4,
              'pending', $5,
              $6, $7, $8,
              'knowledge_entry')`,
        [
          suggestionId,
          tenantId,
          payload,
          clampedConf,
          riskLevel,
          proposedBy,
          title ?? `${relType}: ${sourceId} → ${targetId}`,
          body ?? reasoning,
        ],
      );

      return { proposalId, created: true };
    });
  } catch (err) {
    console.error("[proposal-transition] proposeRelationship failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// reviewProposal (human action — ONLY path that writes to kg_relationships)
// ---------------------------------------------------------------------------

/**
 * Apply a human approve|reject decision to a relationship proposal.
 *
 * On approve:
 *   1. relationship_proposals.status → 'verified'
 *   2. INSERT/UPDATE kg_relationships with approval_state='verified',
 *      relationship_proposal_id FK set.
 *   3. ai_suggestions (kg_edge bridge) → 'accepted'
 *
 * On reject:
 *   1. relationship_proposals.status → 'rejected'
 *   2. NO kg_relationships write.
 *   3. ai_suggestions → 'rejected'
 *
 * Throws an Error for illegal pre-state or unknown decision.
 * Returns null on DB failure.
 */
export async function reviewProposal(
  input: ReviewProposalInput,
): Promise<ReviewProposalResult | null> {
  const { proposalId, decision, tenantId, reviewedBy, reason = "" } = input;

  if (decision !== "approve" && decision !== "reject") {
    throw new Error(`decision must be 'approve' or 'reject', got '${decision}'`);
  }

  try {
    return await withTenantContext(tenantId, async (c: PoolClient) => {
      const proposalRes = await c.query(
        `SELECT id, tenant_id,
                source_entity_id, source_entity_type,
                target_entity_id, target_entity_type,
                relationship_type, confidence,
                status, created_by, reasoning
           FROM relationship_proposals
          WHERE id = $1
            AND (tenant_id = $2 OR tenant_id IS NULL)
          FOR UPDATE`,
        [proposalId, tenantId],
      );

      if (proposalRes.rows.length === 0) {
        throw new Error(`proposal ${proposalId} not found`);
      }
      const p = proposalRes.rows[0];

      if (!REVIEWABLE_STATES.has(p.status)) {
        throw new Error(
          `Illegal transition: proposal ${proposalId} is in state '${p.status}'; ` +
            `can only decide proposals in [${[...REVIEWABLE_STATES].sort().join(", ")}]`,
        );
      }

      const newRelStatus = decision === "approve" ? "verified" : "rejected";

      // 1. Update relationship_proposals
      await c.query(
        `UPDATE relationship_proposals
            SET status = $1,
                reviewed_at = now(),
                reviewed_by = $2,
                reasoning = COALESCE(NULLIF($3, ''), reasoning)
          WHERE id = $4`,
        [newRelStatus, reviewedBy, reason, proposalId],
      );

      let kgRelationshipId: string | null = null;

      if (decision === "approve") {
        // 2. Insert/update kg_relationships — ONLY path that writes 'verified'
        const existingRel = await c.query<{ id: string }>(
          `SELECT id FROM kg_relationships
            WHERE tenant_id = $1
              AND source_id = $2
              AND target_id = $3
              AND relationship_type = $4`,
          [tenantId, p.source_entity_id, p.target_entity_id, p.relationship_type],
        );

        if (existingRel.rows.length > 0) {
          kgRelationshipId = existingRel.rows[0].id;
          await c.query(
            `UPDATE kg_relationships
                SET approval_state = 'verified',
                    confidence = GREATEST(confidence, $1),
                    proposed_by = COALESCE(proposed_by, $2),
                    evidence_summary = COALESCE(evidence_summary, $3),
                    relationship_proposal_id = $4
              WHERE id = $5`,
            [p.confidence, p.created_by, p.reasoning, proposalId, kgRelationshipId],
          );
        } else {
          kgRelationshipId = randomUUID();
          await c.query(
            `INSERT INTO kg_relationships
                 (id, tenant_id, source_id, target_id,
                  relationship_type, confidence,
                  approval_state, proposed_by, evidence_summary,
                  relationship_proposal_id)
             VALUES
                 ($1, $2, $3, $4,
                  $5, $6,
                  'verified', $7, $8,
                  $9)`,
            [
              kgRelationshipId,
              tenantId,
              p.source_entity_id,
              p.target_entity_id,
              p.relationship_type,
              p.confidence,
              p.created_by,
              p.reasoning,
              proposalId,
            ],
          );
        }
      }

      // 3. Sync ai_suggestions bridge
      await c.query(
        `UPDATE ai_suggestions
            SET status = $1,
                reviewed_by = $2,
                reviewed_at = now(),
                review_note = $3,
                updated_at = now()
          WHERE suggestion_type = 'kg_edge'
            AND extracted_data->>'relationship_proposal_id' = $4
            AND status = 'pending'`,
        [
          decision === "approve" ? "accepted" : "rejected",
          reviewedBy,
          reason,
          proposalId,
        ],
      );

      return {
        proposalId,
        decision,
        proposalStatus: newRelStatus as "verified" | "rejected",
        kgRelationshipId,
      };
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Illegal transition") ||
        err.message.startsWith("decision must be"))
    ) {
      throw err; // re-throw validation errors
    }
    console.error("[proposal-transition] reviewProposal failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeEvidence(
  c: PoolClient,
  proposalId: string,
  evidence: EvidenceInput[],
  sourceChunkId: string | null | undefined,
): Promise<void> {
  const rows = [...evidence];

  // Append synthetic chunk row if provided
  if (sourceChunkId) {
    const already = rows.some(
      (r) =>
        r.source_id === sourceChunkId && r.evidence_type === ("knowledge_entry" as string),
    );
    if (!already) {
      rows.push({
        evidence_type: "oem_kb",
        source_id: sourceChunkId,
        source_description: "ingest chunk",
        confidence_contribution: 0,
      });
    }
  }

  for (const ev of rows) {
    try {
      await c.query(
        `INSERT INTO relationship_evidence
             (proposal_id, evidence_type, source_id,
              source_description, page_or_location,
              excerpt, confidence_contribution)
         VALUES
             ($1, $2, $3::uuid,
              $4, $5,
              $6, $7)`,
        [
          proposalId,
          ev.evidence_type,
          ev.source_id ?? null,
          ev.source_description ?? null,
          ev.page_or_location ?? null,
          ev.excerpt ?? null,
          ev.confidence_contribution ?? 0,
        ],
      );
    } catch (err) {
      console.warn(
        `[proposal-transition] writeEvidence row failed (proposal ${proposalId}):`,
        err,
      );
    }
  }
}
