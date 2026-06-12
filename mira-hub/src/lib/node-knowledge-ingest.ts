// Hub folder=brain — ingest a PDF attached to a namespace node into knowledge_entries.
//
// Spec: docs/specs/uns-node-centric-knowledge-spec.md (Slice 2 — Hub-side ingest)
// ADR : docs/adr/0019-miradrop-ingest-v2.md (writes chunks INTO knowledge_entries)
//
// A doc attached to a /namespace node becomes BM25-citable: text -> chunks ->
// knowledge_entries rows (ingest_route='v2', doc_id = hub_uploads.id), plus a
// hub_uploads row stamped with kg_entity_id = the confirmed node. Chunk -> node
// address is the chain knowledge_entries.doc_id -> hub_uploads.kg_entity_id ->
// kg_entities.uns_path, so subtree retrieval (Slice 3) rides the existing GIST index.
//
// content_tsv is GENERATED ALWAYS from content, so inserted chunks are searchable
// immediately. embedding is left NULL (BM25 needs only content_tsv; pgvector backfill
// is a later concern, and avoids the GS11 embed-gate fragility).

import { randomUUID } from "crypto";
import { withTenantContext } from "@/lib/tenant-context";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import { extractText, getDocumentProxy } from "unpdf";

const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 120;

export interface NodeIngestResult {
  uploadId: string;
  chunkCount: number;
}

/**
 * Split text into ~CHUNK_CHARS windows with overlap, preferring to end on a
 * paragraph or sentence boundary. Single-use, intentionally simple.
 */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const brk = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (brk > size * 0.5) end = i + brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

/**
 * Extract + chunk a PDF buffer and write per-chunk knowledge_entries rows bound
 * to an EXISTING upload + node. Single source of v2 chunk-writing, shared by
 * `ingestPdfToNode` (node-attach door) and the blind upload doors (#1806, which
 * route un-addressed PDFs into the per-tenant Inbox node). Does NOT create or
 * update a hub_uploads row — the caller owns the upload lifecycle. Returns the
 * chunk count. Throws on extraction/insert error (caller marks the upload).
 */
export async function writePdfChunksForNode(opts: {
  tenantId: string;
  uploadId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
  buffer: Buffer | Uint8Array;
}): Promise<number> {
  const { tenantId, uploadId, nodeId, unsPath, filename, buffer } = opts;

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [text];

  // Unique per attachment so same-named files on different nodes never false-dedup
  // against the partial UNIQUE (tenant_id, source_url, metadata->>'chunk_index').
  const sourceUrl = `node-doc/${uploadId}/${filename}`;

  type ChunkRow = { content: string; page: number; idx: number };
  const rows: ChunkRow[] = [];
  let idx = 0;
  pages.forEach((pageText, p) => {
    for (const piece of chunkText(pageText)) {
      rows.push({ content: piece, page: p + 1, idx: idx++ });
    }
  });

  if (rows.length > 0) {
    await withTenantContext(tenantId, async (c) => {
      for (const r of rows) {
        await c.query(
          // #1903: a node attachment is a per-tenant upload, NOT shared OEM corpus.
          // is_private = true keeps it out of the universal/library aggregate surfaces
          // and the hybrid read filter `(is_private = false OR tenant_id = $caller)`, so
          // tenant A's manual is never visible to tenant B. The column defaults to false,
          // so relying on the default would leak (see .claude/rules/knowledge-entries-tenant-scoping.md #1833).
          `INSERT INTO knowledge_entries
             (id, tenant_id, source_type, content, source_url, source_page,
              doc_id, ingest_route, page_start, page_end, metadata, is_private)
           VALUES ($1, $2, 'node_attachment', $3, $4, $5, $6, 'v2', $7, $7, $8, true)
           ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
             WHERE (metadata->>'chunk_index') IS NOT NULL
             DO NOTHING`,
          [
            randomUUID(),
            tenantId,
            r.content,
            sourceUrl,
            r.page,
            uploadId,
            r.page,
            JSON.stringify({
              filename,
              uns_path: unsPath,
              node_id: nodeId,
              chunk_index: r.idx,
              source: "hub_node_attachment",
            }),
          ],
        );
      }
    });
  }

  return rows.length;
}

/**
 * Ingest a PDF buffer attached to a namespace node. Creates the hub_uploads row,
 * extracts + chunks the text, and writes per-chunk knowledge_entries rows.
 * Returns the upload id + chunk count. Throws (and marks the upload failed) on error.
 */
export async function ingestPdfToNode(opts: {
  tenantId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  buffer: Buffer;
}): Promise<NodeIngestResult> {
  const { tenantId, nodeId, unsPath, filename, mimeType, sizeBytes, buffer } = opts;

  const upload = await createUpload({
    tenantId,
    provider: "local",
    kind: "document",
    filename,
    mimeType,
    sizeBytes,
    unsPath,
    kgEntityId: nodeId,
    ingestRoute: "v2",
    initialStatus: "parsing",
  });

  try {
    const chunkCount = await writePdfChunksForNode({
      tenantId,
      uploadId: upload.id,
      nodeId,
      unsPath,
      filename,
      buffer,
    });
    await updateUploadStatus(upload.id, tenantId, "parsed", null, { kbChunkCount: chunkCount });
    return { uploadId: upload.id, chunkCount };
  } catch (err) {
    await updateUploadStatus(upload.id, tenantId, "failed", (err as Error).message);
    throw err;
  }
}
