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
// (BM25) immediately. A best-effort trailing pass (embedPendingNodeChunks) then
// fills `embedding` so the chunks are ALSO visible to the KB vector ranker
// (asset-intelligence.searchKB filters `embedding IS NOT NULL` — NULL-embedding
// rows are silently excluded from vector results; #2099). The pass is decoupled
// from the insert and never blocks/fails ingest, so it cannot recreate the
// embed-gate fragility (#1385): a down embedder just leaves chunks BM25-only.

import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import { proposeDocumentEdgesForNode } from "@/lib/node-document-proposals";
import { extractText, getDocumentProxy } from "unpdf";

const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 120;

// Multi-row INSERT batch size. Bounds BOTH the chunk rows held in memory at once
// (≤ BATCH_ROWS, instead of every chunk of a 1200-page manual accumulated in one
// array before any insert) AND the DB round-trips (total_chunks / BATCH_ROWS,
// not one query per chunk). This is a modest, honest win — it does NOT bound the
// dominant memory term (the full file buffer + eagerly-extracted page text); that
// is what the concurrency guard below contains, and true streaming is Slice 2.
const BATCH_ROWS = 50;

// Concurrency guard. unpdf loads the whole PDF (getDocumentProxy + eager
// extractText) into memory; the file buffer + extracted text — not the chunk
// rows — are the dominant memory term, and two large manuals parsing at once is
// the documented 8 GB-VPS OOM path (ADR-0019 / project_vps_oom_docling_incidents).
// Default 1 = serialize heavy parses, so the peak is one in-flight PDF, not N.
// Raise NODE_INGEST_CONCURRENCY only after measuring; the ceiling is
// concurrency x per-parse-peak, and per-parse-peak is O(file size), not O(1).
const INGEST_CONCURRENCY = Math.max(
  1,
  Number(process.env.NODE_INGEST_CONCURRENCY ?? "1"),
);
let activeIngests = 0;
const ingestWaiters: Array<() => void> = [];

/**
 * Acquire one of INGEST_CONCURRENCY parse slots; returns a release fn. A
 * releaser with a waiter hands its slot straight to that waiter (no decrement),
 * so the active count can never transiently exceed the limit between a release
 * and the woken waiter resuming. Double-release is a no-op.
 */
async function acquireIngestSlot(): Promise<() => void> {
  if (activeIngests < INGEST_CONCURRENCY) {
    activeIngests++;
  } else {
    await new Promise<void>((resolve) => ingestWaiters.push(resolve));
    // A releaser handed us its slot; activeIngests already accounts for us.
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = ingestWaiters.shift();
    if (next)
      next(); // hand the slot to the next waiter (count unchanged)
    else activeIngests--; // no waiter: free the slot
  };
}

export interface NodeIngestResult {
  uploadId: string;
  chunkCount: number;
}

/**
 * ARPK Phase 1c — thrown when a document yields ZERO chunks (scanned/image-only
 * PDF, or an empty/whitespace text file). A property of the FILE, not the
 * pipeline: retrying another ingest path cannot fix it, so callers must mark
 * the upload failed with this cause instead of reporting a bogus success
 * (`parsed` / `indexed:true` with chunkCount 0 — a document that can never be
 * cited). PRD: "Honest failure if no usable content is extracted."
 */
export class NoExtractableTextError extends Error {
  constructor(filename: string) {
    super(
      `no extractable text in ${filename} — the file appears to be scanned, image-only, or empty`,
    );
    this.name = "NoExtractableTextError";
  }
}

/**
 * Split text into ~CHUNK_CHARS windows with overlap, preferring to end on a
 * paragraph or sentence boundary. Single-use, intentionally simple.
 */
export function chunkText(
  text: string,
  size = CHUNK_CHARS,
  overlap = CHUNK_OVERLAP,
): string[] {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const brk = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
      );
      if (brk > size * 0.5) end = i + brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

// Embedding contract — MUST match the query path or cosine is meaningless
// (asset-intelligence.searchKB embeds with nomic-embed-text; column is vector(768)).
const EMBED_MODEL = "nomic-embed-text";
const EMBED_DIM = 768;
const EMBED_BATCH = 16; // chunks embedded per SELECT→embed→UPDATE round
// Kill switch (default ON). Set NODE_EMBED_ON_WRITE=0 to disable the trailing
// embed pass without a redeploy if the embedder is ever overloaded — chunks stay
// BM25-live regardless. Honors the #1385 caution: ingest never depends on embeds.
const EMBED_ON_WRITE = (process.env.NODE_EMBED_ON_WRITE ?? "1") !== "0";

/**
 * Stable, greppable reason codes for why the trailing embed pass stopped.
 *
 * The point of these is the failure mode this module actually shipped: a
 * PERMANENT authorization error (Postgres 42501, the missing UPDATE grant fixed
 * by migration 079) was swallowed into a single console.warn, which made
 * "permanently broken" and "still indexing" look identical to an operator.
 * Every code below is therefore classified `permanent` or `transient`, and a
 * permanent one is logged at error level. Never widen this to a bare string.
 */
export type EmbedFailureCode =
  | "embedder_not_configured" // OLLAMA_BASE_URL unset — enrichment is off by config
  | "embedder_unavailable" // network/HTTP error reaching the embedder
  | "embedder_http_error" // embedder answered non-2xx
  | "embedder_timeout" // request exceeded EMBED_TIMEOUT_MS
  | "embedding_dimension_mismatch" // wrong-dim vector — refusing to store it
  | "db_permission_denied" // 42501 — the grant class this module was broken by
  | "vector_update_failed" // any other DB error on the UPDATE
  | "select_failed"; // could not even read the pending batch

const PERMANENT_CODES: ReadonlySet<EmbedFailureCode> = new Set([
  // These do not get better by waiting. An operator must act (grant a
  // privilege, fix the model/dim, set the env var).
  "embedder_not_configured",
  "embedding_dimension_mismatch",
  "db_permission_denied",
]);

/** Terminal state of one trailing embed pass. `degraded` = operator must look. */
export type EmbedPassState =
  | "complete" // no NULL-embedding rows remain for this source
  | "disabled" // kill switch off — deliberate, not a failure
  | "degraded"; // stopped early; see `code`

export interface EmbedPassResult {
  embedded: number;
  state: EmbedPassState;
  code?: EmbedFailureCode;
  /** True when `code` cannot resolve on its own. Drives error-vs-warn logging. */
  permanent: boolean;
}

const EMBED_TIMEOUT_MS = 15000;

/** Map a thrown DB error to a stable code. 42501 is the grant class (see 079). */
function classifyDbError(err: unknown): EmbedFailureCode {
  const code = (err as { code?: string } | null)?.code;
  if (code === "42501") return "db_permission_denied";
  return "vector_update_failed";
}

/**
 * Best-effort embed of one chunk with the SAME model + dim the query path uses.
 * Returns the vector, or a stable failure code — never a bare null, so the
 * caller can tell "embedder is down for a minute" from "this will never work".
 * A failure still just leaves the chunk BM25-only; ingest never hard-depends on
 * the embedder (#1385).
 */
async function embedText(
  text: string,
): Promise<{ vec: number[] } | { code: EmbedFailureCode }> {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base) return { code: "embedder_not_configured" };
  try {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!resp.ok) return { code: "embedder_http_error" };
    const data = (await resp.json()) as { embedding?: number[] };
    const vec = data.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
      return { code: "embedding_dimension_mismatch" };
    }
    return { vec };
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException.
    const name = (err as { name?: string } | null)?.name;
    return { code: name === "TimeoutError" ? "embedder_timeout" : "embedder_unavailable" };
  }
}

/**
 * Best-effort trailing pass: embed the just-written node_attachment chunks for one
 * upload so they're visible to the KB VECTOR ranker (asset-intelligence.searchKB
 * filters `embedding IS NOT NULL`), not only the BM25/text fallback (#2099).
 *
 * Runs AFTER the chunks are inserted (already BM25-live) and OUTSIDE the insert
 * transaction: withTenantContext wraps BEGIN/COMMIT on a POOLED connection, so we
 * must never hold one across N embed HTTP calls. Each round SELECTs a bounded
 * batch of NULL-embedding rows (memory-safe), embeds them with no DB connection
 * held, then reopens a short transaction to UPDATE the ones that returned a valid
 * 768-vec. The loop stops when no NULL rows remain OR a batch yields zero writable
 * vectors (embedder down) — so it can't spin on a persistently-failing embedder.
 * Never throws; the #2098 canary + tools/backfill_knowledge_embeddings.py are the
 * net for anything left dark (e.g. a server restart mid-pass). Returns rows embedded.
 */
export async function embedPendingNodeChunks(
  tenantId: string,
  sourceUrl: string,
): Promise<EmbedPassResult> {
  if (!EMBED_ON_WRITE) {
    return { embedded: 0, state: "disabled", permanent: false };
  }
  let embedded = 0;
  let code: EmbedFailureCode | undefined;

  try {
    for (;;) {
      let rows: { id: string; content: string }[];
      try {
        rows = await withTenantContext(tenantId, async (c) => {
          const res = await c.query<{ id: string; content: string }>(
            `SELECT id::text, content FROM knowledge_entries
              WHERE tenant_id = $1 AND source_url = $2
                AND source_type = 'node_attachment' AND embedding IS NULL
              LIMIT $3`,
            [tenantId, sourceUrl, EMBED_BATCH],
          );
          return res.rows;
        });
      } catch (err) {
        // A SELECT failure is its own class: 42501 here means the role cannot
        // even read the pending batch, which is a different grant than the one
        // 079 fixes.
        code = classifyDbError(err) === "db_permission_denied"
          ? "db_permission_denied"
          : "select_failed";
        break;
      }
      if (rows.length === 0) break; // nothing left — success

      // Embed with NO DB connection held.
      const results = await Promise.all(rows.map((r) => embedText(r.content)));
      const writable: { id: string; vec: number[] }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = results[i];
        if ("vec" in r) writable.push({ id: rows[i].id, vec: r.vec });
        else code ??= r.code; // keep the FIRST reason — it explains the stall
      }
      if (writable.length === 0) {
        // Embedder produced nothing usable. `code` is already set above; stop
        // rather than spin on a persistently-failing embedder.
        break;
      }

      try {
        await withTenantContext(tenantId, async (c) => {
          for (const w of writable) {
            await c.query(
              `UPDATE knowledge_entries SET embedding = $2::vector
                WHERE id = $1 AND embedding IS NULL`,
              [w.id, `[${w.vec.join(",")}]`],
            );
          }
        });
      } catch (err) {
        // THE regression this classification exists for: before migration 079
        // this threw 42501 on every upload and was swallowed as a warn, so the
        // vector lane was permanently dark while looking like "still indexing".
        code = classifyDbError(err);
        break;
      }
      embedded += writable.length;
      code = undefined; // a later success clears an earlier transient blip
    }
  } catch (err) {
    // Defence in depth: the pass must never surface to the upload caller.
    code ??= classifyDbError(err);
  }

  if (!code) return { embedded, state: "complete", permanent: false };

  const permanent = PERMANENT_CODES.has(code);
  const detail = {
    event: "embed_enrichment_degraded",
    code,
    permanent,
    embedded,
    sourceUrl,
    tenantId,
  };
  // Permanent = an operator must act; it must NOT read as "still processing".
  // Transient = genuinely may finish later, so warn.
  if (permanent) {
    console.error(`[node-ingest] ${JSON.stringify(detail)}`);
  } else {
    console.warn(`[node-ingest] ${JSON.stringify(detail)}`);
  }
  return { embedded, state: "degraded", code, permanent };
}

interface NodeChunkOpts {
  tenantId: string;
  uploadId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
}

/**
 * Shared v2 chunk-writer core (#2277). Takes already-extracted page text and
 * writes per-chunk knowledge_entries rows (source_type='node_attachment',
 * ingest_route='v2', is_private=true) bound to an existing upload + node, then
 * kicks off the fire-and-forget embed pass. Both writePdfChunksForNode (PDF ->
 * unpdf pages) and writeTextChunksForNode (text bytes as one page) call this —
 * ONE insert/embed path, so is_private + dedup + embedding stay identical across
 * formats. Does NOT acquire the concurrency slot; that guards the heavy PDF
 * parse and is the PDF writer's responsibility. Returns the generated chunk count.
 */
async function writeChunkRowsForNode(
  pages: string[],
  opts: NodeChunkOpts,
): Promise<number> {
  const { tenantId, uploadId, nodeId, unsPath, filename } = opts;

  // Unique per attachment so same-named files on different nodes never false-dedup
  // against the partial UNIQUE (tenant_id, source_url, metadata->>'chunk_index').
  const sourceUrl = `node-doc/${uploadId}/${filename}`;

  type ChunkRow = { content: string; page: number; idx: number };
  let idx = 0;
  let batch: ChunkRow[] = [];

  await withTenantContext(tenantId, async (c) => {
    // Flush the buffered chunks as ONE multi-row INSERT, then drop them.
    // tenant_id / source_url / doc_id are constant across the whole file, so
    // they are fixed leading params ($1..$3) and only id/content/page/metadata
    // vary per row — keeping the param count at 3 + 4*BATCH_ROWS.
    const flush = async () => {
      if (batch.length === 0) return;
      const tuples = batch.map((_r, k) => {
        const b = 3 + k * 4; // per-row params start after the 3 fixed ones
        // page_start and page_end reuse the SAME page placeholder ($b+3).
        return `($${b + 1}, $1, 'node_attachment', $${b + 2}, $2, $${b + 3}, $3, 'v2', $${b + 3}, $${b + 3}, $${b + 4}, true)`;
      });
      const params: unknown[] = [tenantId, sourceUrl, uploadId];
      for (const r of batch) {
        params.push(
          randomUUID(),
          r.content,
          r.page,
          JSON.stringify({
            filename,
            uns_path: unsPath,
            node_id: nodeId,
            chunk_index: r.idx,
            source: "hub_node_attachment",
          }),
        );
      }
      await c.query(
        // #1903: a node attachment is a per-tenant upload, NOT shared OEM corpus.
        // is_private = true (a LITERAL, never a bound param) keeps it out of the
        // universal/library aggregate surfaces and the hybrid read filter
        // `(is_private = false OR tenant_id = $caller)`, so tenant A's manual is
        // never visible to tenant B. The column defaults to false, so relying on
        // the default would leak (see .claude/rules/knowledge-entries-tenant-scoping.md #1833).
        `INSERT INTO knowledge_entries
             (id, tenant_id, source_type, content, source_url, source_page,
              doc_id, ingest_route, page_start, page_end, metadata, is_private)
           VALUES ${tuples.join(", ")}
           ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
             WHERE (metadata->>'chunk_index') IS NOT NULL
             DO NOTHING`,
        params,
      );
      batch = [];
    };

    for (let p = 0; p < pages.length; p++) {
      const pageText = pages[p];
      pages[p] = ""; // release each page's text once chunked — bounds peak memory
      for (const piece of chunkText(pageText)) {
        batch.push({ content: piece, page: p + 1, idx: idx++ });
        if (batch.length >= BATCH_ROWS) await flush();
      }
    }
    await flush();
  });

  // Zero chunks = nothing was inserted above; failing here is honest and safe.
  if (idx === 0) throw new NoExtractableTextError(filename);

  // Fire-and-forget embed pass — chunks are already BM25-live, so the upload
  // response must not block on embedding a large manual (and a slow/dead
  // embedder must not delay it). The Hub runs as a long-lived standalone Node
  // server, so this continues after the caller returns; embedPendingNodeChunks
  // is self-contained (own short transactions) and never throws. Anything left
  // dark (e.g. a restart mid-pass) is caught by the #2098 canary + backfill.
  void embedPendingNodeChunks(tenantId, sourceUrl);

  // Generated-chunk count (matches the historical `rows.length` semantics: the
  // number attempted, not the number actually inserted after ON CONFLICT).
  return idx;
}

/**
 * Extract + chunk a PDF buffer and write per-chunk knowledge_entries rows bound
 * to an EXISTING upload + node. Shared by `ingestPdfToNode` (node-attach door)
 * and the blind upload doors (#1806). Serializes the heavy unpdf parse behind the
 * concurrency slot, then delegates the insert/embed to writeChunkRowsForNode.
 * Returns the chunk count. Throws on extraction/insert error (caller marks the upload).
 */
export async function writePdfChunksForNode(opts: {
  tenantId: string;
  uploadId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
  buffer: Buffer | Uint8Array;
}): Promise<number> {
  const { buffer, ...rest } = opts;

  // Serialize heavy parses so concurrent uploads don't multiply the in-memory
  // PDF peak (see acquireIngestSlot / INGEST_CONCURRENCY above).
  const release = await acquireIngestSlot();
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages: string[] = Array.isArray(text) ? text : [text];
    return await writeChunkRowsForNode(pages, rest);
  } finally {
    release();
  }
}

/**
 * Write a UTF-8 text/markdown buffer into v2 node_attachment knowledge_entries
 * rows (#2277). The bytes ARE the text — no unpdf extraction, so no heavy
 * in-memory parse and no PDF concurrency slot. Decodes and chunks as a single
 * page; everything downstream (is_private=true rows, dedup, embed-on-write) is
 * identical to the PDF path. Returns the chunk count.
 */
export async function writeTextChunksForNode(opts: {
  tenantId: string;
  uploadId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
  buffer: Buffer | Uint8Array;
}): Promise<number> {
  const { buffer, ...rest } = opts;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    new Uint8Array(buffer),
  );
  return writeChunkRowsForNode([text], rest);
}

/**
 * Ingest a PDF buffer attached to a namespace node. Creates the hub_uploads row,
 * extracts + chunks the text, and writes per-chunk knowledge_entries rows.
 * Returns the upload id + chunk count. Throws (and marks the upload failed) on error.
 */
/**
 * Ingest a plain-text buffer attached to a namespace node (the copied-text /
 * technician-note source door, #3241 follow-through). Identical lifecycle to
 * ingestPdfToNode — createUpload → chunk rows → parsed/failed status → edge
 * proposal — but the bytes ARE the text, so writeTextChunksForNode decodes and
 * chunks as a single page (is_private=true, dedup, embed-on-write downstream).
 */
export async function ingestTextToNode(opts: {
  tenantId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  buffer: Buffer;
  contentSha256?: string | null;
}): Promise<NodeIngestResult> {
  const { tenantId, nodeId, unsPath, filename, mimeType, sizeBytes, buffer } =
    opts;

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
    contentSha256: opts.contentSha256 ?? null,
  });

  try {
    const chunkCount = await writeTextChunksForNode({
      tenantId,
      uploadId: upload.id,
      nodeId,
      unsPath,
      filename,
      buffer,
    });
    await updateUploadStatus(upload.id, tenantId, "parsed", null, {
      kbChunkCount: chunkCount,
    });
    void proposeDocumentEdgesForNode({
      tenantId,
      uploadId: upload.id,
      nodeId,
      unsPath,
      filename,
      chunkCount,
    });
    return { uploadId: upload.id, chunkCount };
  } catch (err) {
    await updateUploadStatus(
      upload.id,
      tenantId,
      "failed",
      (err as Error).message,
    );
    throw err;
  }
}

/**
 * Best-effort removal of an ORPHANED node ingest — an upload whose token-fenced
 * finalize LOST the claim (stolen mid-ingest after the stale window): its
 * chunks duplicate the winner's and must not stay retrievable, which is the
 * exact duplicate-corpus bug the ingestion claim exists to prevent.
 *
 * Raw owner pool, explicit tenant + doc predicates: factorylm_app has no
 * DELETE grant on knowledge_entries (migrations 011/049 grant SELECT/INSERT
 * only), and the scope here is one tenant's one upload. Never throws — losing
 * the race is benign and a cleanup failure must not fail the request; a leaked
 * orphan is logged and stays invisible to notebook chat (no source row points
 * at it).
 */
export async function deleteOrphanNodeIngest(
  tenantId: string,
  uploadId: string,
): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM knowledge_entries WHERE tenant_id = $1::uuid AND doc_id = $2::uuid`,
      [tenantId, uploadId],
    );
    await pool.query(`DELETE FROM hub_uploads WHERE tenant_id = $1 AND id = $2::uuid`, [
      tenantId,
      uploadId,
    ]);
  } catch (err) {
    console.warn(
      `[node-ingest] orphan cleanup failed upload=${uploadId}: ${(err as Error).message}`,
    );
  }
}

export async function ingestPdfToNode(opts: {
  tenantId: string;
  nodeId: string;
  unsPath: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  buffer: Buffer;
  /** sha256 hex of the bytes — persisted for content dedup (ARPK 1b). */
  contentSha256?: string | null;
}): Promise<NodeIngestResult> {
  const { tenantId, nodeId, unsPath, filename, mimeType, sizeBytes, buffer } =
    opts;

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
    contentSha256: opts.contentSha256 ?? null,
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
    await updateUploadStatus(upload.id, tenantId, "parsed", null, {
      kbChunkCount: chunkCount,
    });

    // Fire-and-forget: propose a grounded HAS_DOCUMENT edge node→manual on the
    // graph (Phase 2 of the KG navigator). Decoupled + never-throws, exactly like
    // the embed pass above — a proposal failure must NOT flip the upload to failed
    // or surface to the caller. Promotion to a verified edge is a human action.
    void proposeDocumentEdgesForNode({
      tenantId,
      uploadId: upload.id,
      nodeId,
      unsPath,
      filename,
      chunkCount,
    });

    return { uploadId: upload.id, chunkCount };
  } catch (err) {
    await updateUploadStatus(
      upload.id,
      tenantId,
      "failed",
      (err as Error).message,
    );
    throw err;
  }
}
