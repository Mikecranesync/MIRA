// Attach-later indexing for parked files (#4367).
//
// POST /api/files parks an unassigned upload as a "stored" file: bytes kept,
// nothing indexed, because chunks need a node id. Attaching that file later to a
// namespace node, or to a notebook that has a backing node, must index it, or the
// file stays uncitable forever. This helper runs that index-on-attach step using
// the same claim -> ingest -> link -> sync sequence as POST /api/files.

import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode, deleteOrphanNodeIngest } from "@/lib/node-knowledge-ingest";
import {
  claimIngest,
  releaseIngestClaim,
  linkFileToUpload,
  syncNotebookSourcesForFile,
  type AttachTarget,
} from "@/lib/workspace-files";

export type ParkedIndexStatus =
  | "indexed"
  | "already_indexed"
  | "not_indexable"
  | "no_node"
  | "in_progress"
  | "failed";

export interface ParkedIndexOutcome {
  indexing: ParkedIndexStatus;
  uploadId?: string;
}

/** The node that chunks should be stamped with, from the attach targets. */
async function resolveNodeId(tenantId: string, targets: AttachTarget[]): Promise<string | null> {
  const nodeTarget = targets.find((t) => t.targetType === "namespace_node");
  if (nodeTarget) return nodeTarget.targetId;
  const notebookTarget = targets.find((t) => t.targetType === "equipment_notebook");
  if (!notebookTarget) return null;
  return withTenantContext(tenantId, async (c) => {
    const r = await c.query<{ node_id: string | null }>(
      `SELECT node_id::text AS node_id FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookTarget.targetId],
    );
    return r.rows[0]?.node_id ?? null;
  });
}

/**
 * Index a parked file into the node its attach targets resolve to. Never throws:
 * the attach has already committed, so every failure is reported as a status.
 */
export async function indexParkedFileForTargets(opts: {
  tenantId: string;
  fileId: string;
  targets: AttachTarget[];
  userId: string | null;
}): Promise<ParkedIndexOutcome> {
  const { tenantId, fileId, targets, userId } = opts;
  try {
    const file = await withTenantContext(tenantId, async (c) => {
      const r = await c.query<{
        content: Buffer;
        filename: string;
        mime_type: string;
        size_bytes: number;
        upload_id: string | null;
      }>(
        `SELECT content, filename, mime_type, size_bytes, upload_id::text AS upload_id
           FROM namespace_direct_uploads
          WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, fileId],
      );
      return r.rows[0] ?? null;
    });
    if (!file) return { indexing: "failed" };

    if (file.upload_id) {
      // Already indexed by an earlier request: only the notebook membership may be missing.
      await syncNotebookSourcesForFile(tenantId, fileId, file.upload_id, userId);
      return { indexing: "already_indexed", uploadId: file.upload_id };
    }

    const isPdf = file.mime_type === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
    const lower = file.filename.toLowerCase();
    const isText =
      file.mime_type.startsWith("text/plain") || lower.endsWith(".txt") || lower.endsWith(".md");
    if (!isPdf && !isText) return { indexing: "not_indexable" };

    const nodeId = await resolveNodeId(tenantId, targets);
    if (!nodeId) return { indexing: "no_node" };

    const claim = await claimIngest(tenantId, fileId);
    if (!claim.claimed) {
      if (claim.reason === "already_ingested" && claim.uploadId) {
        await syncNotebookSourcesForFile(tenantId, fileId, claim.uploadId, userId);
        return { indexing: "already_indexed", uploadId: claim.uploadId };
      }
      return { indexing: "in_progress" };
    }

    try {
      const unsPath = await withTenantContext(tenantId, async (c) => {
        const r = await c.query<{ uns_path: string | null }>(
          `SELECT uns_path::text AS uns_path FROM kg_entities
            WHERE id = $1::uuid AND tenant_id = $2::uuid`,
          [nodeId, tenantId],
        );
        return r.rows[0]?.uns_path ?? null;
      });
      const ingest = isPdf ? ingestPdfToNode : ingestTextToNode;
      const { uploadId } = await ingest({
        tenantId,
        nodeId,
        unsPath,
        filename: file.filename,
        mimeType: file.mime_type,
        sizeBytes: Number(file.size_bytes),
        buffer: file.content,
      });
      const won = await linkFileToUpload(tenantId, fileId, uploadId, claim.claimToken);
      if (!won) {
        await deleteOrphanNodeIngest(tenantId, uploadId);
        return { indexing: "in_progress" };
      }
      await syncNotebookSourcesForFile(tenantId, fileId, uploadId, userId);
      return { indexing: "indexed", uploadId };
    } catch (err) {
      await releaseIngestClaim(tenantId, fileId, claim.claimToken).catch(() => {});
      console.error("[parked-file-index] ingest failed (file kept)", err);
      return { indexing: "failed" };
    }
  } catch (err) {
    console.error("[parked-file-index] index-on-attach failed (attach kept)", err);
    return { indexing: "failed" };
  }
}
