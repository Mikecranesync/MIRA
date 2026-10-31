/**
 * General rechunk operator for #4842: re-chunk an existing document by tenant + doc ID.
 *
 * Tenant-scoped, idempotent, dry-run by default, audited.
 * Wraps #4866 one-off logic with generalization for tenant + expect terms.
 */

import pool from "@/lib/db";
import {
  extractPdfPagesForNode,
  embedPendingNodeChunks,
  writeChunkRowsForNode,
  type NodeChunkOpts,
  type TextRepair,
} from "@/lib/node-knowledge-ingest";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RechunkRequest {
  tenantId: string;
  docId: string;
  expectTerms?: string[];
  applyMode?: boolean;
  dryRun?: boolean;
  auditLog?: (entry: AuditEntry) => void;
}

export interface AuditEntry {
  timestamp: string;
  tenantId: string;
  docId: string;
  user?: string;
  mode: "dry-run" | "apply";
  beforeChunkCount: number;
  afterChunkCount: number;
  expectHits: Record<string, number>;
  gitSha?: string;
}

export interface RechunkResult {
  success: boolean;
  docId: string;
  beforeChunkCount: number;
  afterChunkCount: number;
  expectTerms: string[];
  expectHits: Record<string, number>;
  error?: string;
  isNoOp?: boolean;
}

export async function rechunkDocument(req: RechunkRequest): Promise<RechunkResult> {
  const { tenantId, docId, expectTerms = [], applyMode = false, dryRun = !applyMode } = req;

  // Validate inputs
  if (!UUID_RE.test(tenantId)) {
    return { success: false, docId, beforeChunkCount: 0, afterChunkCount: 0, expectTerms, expectHits: {}, error: "Invalid tenant ID (must be UUID)" };
  }
  if (!UUID_RE.test(docId)) {
    return { success: false, docId, beforeChunkCount: 0, afterChunkCount: 0, expectTerms, expectHits: {}, error: "Invalid doc ID (must be UUID)" };
  }

  const client = await pool.connect();
  try {
    // Fetch document metadata
    const docRes = await client.query(
      "SELECT id, kg_entity_id as nodeId, upload_id as uploadId FROM hub_uploads WHERE id = $1 AND tenant_id = $2",
      [docId, tenantId],
    );
    if (!docRes.rows[0]) {
      return { success: false, docId, beforeChunkCount: 0, afterChunkCount: 0, expectTerms, expectHits: {}, error: "Document not found for tenant" };
    }
    const { nodeId, uploadId } = docRes.rows[0] as { nodeId: string; uploadId: string };

    // Fetch current chunks
    const oldRes = await client.query("SELECT COUNT(*) as cnt FROM knowledge_entries WHERE doc_id = $1 AND tenant_id = $2", [docId, tenantId]);
    const beforeChunkCount = Number((oldRes.rows[0] as { cnt: string }).cnt);

    // Fetch document content
    const contentRes = await client.query("SELECT content FROM namespace_direct_uploads WHERE id = $1", [uploadId]);
    if (!contentRes.rows[0]) {
      return { success: false, docId, beforeChunkCount, afterChunkCount: 0, expectTerms, expectHits: {}, error: "Document content not found" };
    }
    const buffer = Buffer.from((contentRes.rows[0] as { content: string }).content, "base64");

    // Extract pages and chunk
    const extracted = await extractPdfPagesForNode(buffer, { nodeId, tenantId, docId } as NodeChunkOpts);
    const newChunks: string[] = [];
    for (const page of extracted.pages) {
      const chunks = require("@/lib/node-knowledge-ingest").chunkText(page, 1000, 120);
      newChunks.push(...chunks);
    }

    const expectHits: Record<string, number> = {};
    for (const term of expectTerms) {
      expectHits[term] = newChunks.filter((c) => c.includes(term)).length;
    }

    if (dryRun) {
      return {
        success: true,
        docId,
        beforeChunkCount,
        afterChunkCount: newChunks.length,
        expectTerms,
        expectHits,
      };
    }

    // Apply: DELETE + INSERT in transaction
    await client.query("BEGIN");
    try {
      const delRes = await client.query("DELETE FROM knowledge_entries WHERE doc_id = $1 AND tenant_id = $2", [docId, tenantId]);
      if (delRes.rowCount === beforeChunkCount) {
        // Re-insert via writeChunkRowsForNode (which handles tenant scoping)
        const newCount = await writeChunkRowsForNode(
          extracted.pages,
          { nodeId, tenantId, docId } as NodeChunkOpts,
          extracted.repairs,
          { client, deferEmbed: true },
        );
        await client.query("COMMIT");

        // Emit audit
        if (req.auditLog) {
          req.auditLog({
            timestamp: new Date().toISOString(),
            tenantId,
            docId,
            user: process.env.USER,
            mode: "apply",
            beforeChunkCount,
            afterChunkCount: newCount,
            expectHits,
            gitSha: process.env.GIT_SHA,
          });
        }

        // Emit embed asynchronously (after commit)
        embedPendingNodeChunks(tenantId, docId).catch((e) => console.error("Embed failed:", e));

        return { success: true, docId, beforeChunkCount, afterChunkCount: newCount, expectTerms, expectHits };
      } else {
        await client.query("ROLLBACK");
        return { success: false, docId, beforeChunkCount, afterChunkCount: 0, expectTerms, expectHits, error: `DELETE mismatch: expected ${beforeChunkCount}, deleted ${delRes.rowCount}` };
      }
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    client.release();
  }
}
