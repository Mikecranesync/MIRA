// src/lib/node-document-proposals.ts
//
// Phase 2 of the KG navigator roadmap (~/.claude/plans/ok-study-the-knowledge-reactive-marble.md):
// when a document is attached to a /namespace node and parses, propose a GROUNDED
// connection on the graph — a `HAS_DOCUMENT` edge node→manual, evidenced by the
// document's own chunks. This is the ingest→suggest half of the closed loop.
//
// Iron Rule (ADR-0017, .claude/skills/managing-the-knowledge-graph): MIRA proposes,
// the human verifies. Even an EXPLICIT user attachment is written as a
// `relationship_proposals(status='proposed', created_by='rule')` row with evidence —
// NEVER straight to kg_relationships. High confidence sets the score, not the status;
// promotion is a human action via POST /api/proposals/[id]/decide.
//
// Shape mirrors knowledge-graph/extractor.ts (withKgContext → upsertEntity →
// upsertInferredProposal, fire-and-forget). The trigger lives in
// node-knowledge-ingest.ts, called like the embedPendingNodeChunks precedent:
// `void proposeDocumentEdgesForNode(...)` — a proposal failure must never flip the
// upload status or surface to the caller.

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { upsertInferredProposal } from "./knowledge-graph/proposals-writer";

// Explicit user attachment → high confidence. Still PROPOSED, never verified.
const DOC_PROPOSAL_CONFIDENCE = 0.95;
// Representative chunks pulled as grounding evidence (cheapest first pages).
const MAX_EVIDENCE_CHUNKS = 3;
const EXCERPT_CHARS = 280;

export interface ProposeDocResult {
  /** kg_entities.id of the upserted manual node (null only on early-exit/error). */
  manualEntityId: string | null;
  /** New proposal id, or null when deduped (idempotent re-run) / skipped. */
  proposalId: string | null;
  /** Number of evidence rows attached to a freshly-written proposal. */
  evidenceCount: number;
}

const EMPTY: ProposeDocResult = { manualEntityId: null, proposalId: null, evidenceCount: 0 };

export interface ProposeDocInput {
  tenantId: string;
  /** hub_uploads.id — the attached document; also the manual entity's domain key. */
  uploadId: string;
  /** kg_entities.id of the confirmed node the document was attached to. */
  nodeId: string;
  /**
   * The node's UNS path. Reserved for subtree placement of the manual entity
   * (deferred to Phase 5 — kept on the input so the trigger needn't change).
   */
  unsPath?: string | null;
  filename: string;
  chunkCount: number;
}

// Same dual-setting RLS context as knowledge-graph/extractor.ts + cmms-sync.ts.
// One transaction so the manual entity + its proposal land atomically.
async function withKgContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transaction body — takes an open, RLS-scoped client so it is unit-testable with
 * a mocked PoolClient (see __tests__/node-document-proposals.test.ts). Returns
 * what it proposed. May throw (caller's withKgContext rolls back); the never-throws
 * guarantee lives in the exported wrapper below.
 */
export async function proposeDocumentEdgesForNodeTx(
  client: PoolClient,
  input: ProposeDocInput,
): Promise<ProposeDocResult> {
  const { tenantId, uploadId, nodeId, filename, chunkCount } = input;

  // 1. Resolve the anchor node. Early-exit if it doesn't exist (or isn't visible
  //    to this tenant under RLS) — propose nothing rather than dangle an edge.
  const node = await client.query<{ entity_type: string }>(
    `SELECT entity_type FROM kg_entities WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, nodeId],
  );
  if (!node.rowCount) return EMPTY;
  const nodeType = node.rows[0]!.entity_type;

  // 2. Upsert the manual entity. The REAL unique key on kg_entities is
  //    (tenant_id, entity_type, name) — NOT entity_id (migration 001 declared
  //    entity_id, but the live schema's arbiter is the name index; see
  //    .claude/skills/managing-the-knowledge-graph "Gotchas"). Conflicting on the
  //    actual index makes the upsert idempotent (one manual node per filename per
  //    tenant); entity_id=uploadId is carried as the domain key. A blind
  //    `ON CONFLICT (tenant_id, entity_type, entity_id)` throws "no unique or
  //    exclusion constraint matching" against the live schema.
  const manual = await client.query<{ id: string }>(
    `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
     VALUES ($1, 'manual', $2, $3, $4)
     ON CONFLICT (tenant_id, entity_type, name) DO UPDATE SET
       properties = kg_entities.properties || EXCLUDED.properties,
       updated_at = now()
     RETURNING id`,
    [
      tenantId,
      uploadId,
      filename,
      JSON.stringify({ upload_id: uploadId, node_id: nodeId, chunk_count: chunkCount, source: "hub_node_attachment" }),
    ],
  );
  const manualId = manual.rows[0]!.id;

  // 3. Pull a few representative chunks of THIS document as grounding evidence
  //    (the chain knowledge_entries.doc_id = uploadId, written by node-knowledge-ingest).
  const chunks = await client.query<{ id: string; content: string | null; source_page: number | null }>(
    `SELECT id::text, content, source_page FROM knowledge_entries
      WHERE tenant_id = $1 AND doc_id = $2
      ORDER BY source_page NULLS LAST
      LIMIT $3`,
    [tenantId, uploadId, MAX_EVIDENCE_CHUNKS],
  );

  const evidence =
    chunks.rows.length > 0
      ? chunks.rows.map((c) => ({
          evidenceType: "document_page",
          sourceDescription: `${filename}${c.source_page ? ` p.${c.source_page}` : ""}`,
          excerpt: (c.content ?? "").slice(0, EXCERPT_CHARS),
          confidenceContribution: DOC_PROPOSAL_CONFIDENCE,
        }))
      : // Chunks may not be queryable yet on a degenerate parse — still attach one
        // evidence row naming the source so the proposal is never evidence-less.
        [{ evidenceType: "document_page", sourceDescription: filename, confidenceContribution: DOC_PROPOSAL_CONFIDENCE }];

  // 4. Propose node → manual HAS_DOCUMENT. upsertInferredProposal is idempotent
  //    (skips if a verified edge OR an open proposal already exists) and refuses
  //    non-canonical types. Status stays 'proposed' — never auto-verified.
  const proposalId = await upsertInferredProposal(client, tenantId, {
    sourceEntityId: nodeId,
    sourceEntityType: nodeType,
    targetEntityId: manualId,
    targetEntityType: "manual",
    relationshipType: "HAS_DOCUMENT",
    confidence: DOC_PROPOSAL_CONFIDENCE,
    reasoning: `"${filename}" was attached to this node (${chunkCount} chunk${chunkCount === 1 ? "" : "s"}). Confirm to link the manual.`,
    evidence,
  });

  return { manualEntityId: manualId, proposalId, evidenceCount: proposalId ? evidence.length : 0 };
}

/**
 * Fire-and-forget entry point for the node-attach ingest path. Opens an
 * RLS-scoped transaction and proposes the document edge. NEVER throws — a
 * proposal failure must not flip the upload status or reach the upload caller
 * (mirrors embedPendingNodeChunks in node-knowledge-ingest.ts).
 */
export async function proposeDocumentEdgesForNode(input: ProposeDocInput): Promise<ProposeDocResult> {
  // Kill switch (default ON). Set NODE_DOC_PROPOSALS=0 to stop ingest from
  // generating HAS_DOCUMENT proposals without a redeploy — chunks still ingest.
  if ((process.env.NODE_DOC_PROPOSALS ?? "1") === "0") return EMPTY;
  try {
    return await withKgContext(input.tenantId, (client) => proposeDocumentEdgesForNodeTx(client, input));
  } catch (err) {
    console.warn(
      `[node-doc-proposals] propose failed for upload ${input.uploadId} on node ${input.nodeId}: ${(err as Error).message}`,
    );
    return EMPTY;
  }
}
