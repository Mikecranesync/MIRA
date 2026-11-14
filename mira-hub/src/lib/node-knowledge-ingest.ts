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

import { createHash, randomUUID } from "crypto";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import { proposeDocumentEdgesForNode } from "@/lib/node-document-proposals";
import { extractText, getDocumentProxy } from "unpdf";
import { repairExtractedPage, type PageRepair } from "@/capabilities/garbled-text";
import { ocrExtractPage } from "@/capabilities/garbled-text-ocr";
import { readPageLabelsBounded } from "@/capabilities/pdf-page-label-reader";
import { pageLayoutItems } from "@/capabilities/pdf-layout-items";
import { pageWithTables, type TableChunk } from "@/capabilities/table-rows";
import { contactRatingTable, columnLines, withColumnLines } from "@/capabilities/contact-ratings-table";
import { SectionTableScope, modelSectionModels, scopeTableChunks, sectionTableLayout, readOutputTypes, mergeOutputTypes, type ScopedText, type SectionScope } from "@/capabilities/section-table-scope";
import { hasUnmappedGlyphBetweenDigits } from "@/capabilities/manual-completeness";
import { uploadIdentity } from "@/capabilities/page-label-backfill";

const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 120;

/**
 * Table rows at upload (garage pilot plan row 1-A). Bumped whenever the chunks written for a
 * document change shape (flat-text-only -> table-aware, or a change to that algorithm) so a
 * reprocessing pass can tell an old stored document from a freshly re-ingested one. Stamped as
 * `metadata.extraction_version` on EVERY chunk this module writes, PDF or text path alike.
 *   v2 — header-row model tables as one chunk per model column (PR-1, #5430).
 *   v3 — a model-keyed table (one model per line) stored as one unqualified chunk instead of flat
 *        text (#5450); a document stamped v2 is stale and `reprocessNodeDocument` rewrites it.
 *   v4 — a contact-ratings table's make / break / continuous columns written as lines under the
 *        table in the page text (#5474 item 5). A document stamped v3 has no such lines, so the
 *        answer check's WRONG-COLUMN rule cannot run on it until it is reprocessed.
 *   v5 — layout-bounded model sections, including relay applicability from the manual's own
 *        complete per-model output-type table (#5503). One reprocess also includes v4's lines.
 */
export const EXTRACTION_VERSION = 5;

type PageTable = { remainder: string; chunks: TableChunk[]; sections?: ScopedText[] };

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
 * and the woken waiter resuming. Double-release is a no-op. Exported so every
 * whole-PDF parse (ingest, and work-packet re-extraction) shares one budget.
 */
export async function acquireIngestSlot(): Promise<() => void> {
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

// A line that starts a code-keyed table row: "F005 OverVoltage …", "0xF003 Recoverable …".
const TABLE_ROW_START = /^(0x[0-9A-Fa-f]{3,4}|[A-Za-z]{1,3}\d{1,4}[A-Za-z]?)\s+[A-Z][A-Za-z]/gm;
const TABLE_MIN_ROWS = 3;

/**
 * Offsets of the rows of a code-keyed table (fault codes, error codes), or []
 * when the page is not one. Codes group by family (prefix letters + digit
 * count, or 0x + length); a page is a table when one family starts at least
 * TABLE_MIN_ROWS lines, and only that family counts, so an action-cell line
 * such as "A485 [Current Limit]" inside an F-code table is not a row (#4842).
 */
function tableRowStarts(clean: string): number[] {
  const hits = [...clean.matchAll(TABLE_ROW_START)].map((m) => {
    const code = m[1];
    const family = code.startsWith("0x")
      ? `0x${code.length}`
      : `${code.replace(/\d.*$/, "")}${(code.match(/\d+/) ?? [""])[0].length}`;
    return { at: m.index ?? 0, family };
  });
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(h.family, (counts.get(h.family) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [family, n] of counts) {
    if (n > bestCount) {
      best = family;
      bestCount = n;
    }
  }
  if (bestCount < TABLE_MIN_ROWS) return [];
  return hits.filter((h) => h.family === best).map((h) => h.at);
}

/**
 * Split text into ~CHUNK_CHARS windows with overlap, preferring to end on a
 * paragraph or sentence boundary. On a code-keyed table page it ends a window
 * just before a row instead, so a fault code stays in one chunk with its
 * cause and corrective action (#4842: the F005 "Extend the decel time" step
 * was split away by a mid-row ". " break). Other pages are unchanged.
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

  const rowStarts = tableRowStarts(clean);
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    let atRow = false;
    if (end < clean.length) {
      const rowBreak = rowStarts.filter((s) => s > i + size * 0.5 && s < end).pop();
      if (rowBreak !== undefined) {
        end = rowBreak;
        atRow = true;
      } else {
        const window = clean.slice(i, end);
        const brk = Math.max(
          window.lastIndexOf("\n\n"),
          window.lastIndexOf(". "),
        );
        if (brk > size * 0.5) end = i + brk + 1;
      }
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    // A row break needs no overlap: the next chunk begins exactly at the row.
    i = atRow ? end : Math.max(end - overlap, i + 1);
  }
  return chunks;
}

// Embedding contract — MUST match the query path or cosine is meaningless
// (asset-intelligence.searchKB embeds with nomic-embed-text; column is vector(768)).
export const EMBED_MODEL = "nomic-embed-text";
export const EMBED_DIM = 768;
const EMBED_BATCH = 16; // chunks embedded per SELECT→embed→UPDATE round
// Kill switch (default ON). Set NODE_EMBED_ON_WRITE=0 to disable the trailing
// embed pass without a redeploy if the embedder is ever overloaded — chunks stay
// BM25-live regardless. Honors the #1385 caution: ingest never depends on embeds.
const EMBED_ON_WRITE = (process.env.NODE_EMBED_ON_WRITE ?? "1") !== "0";

/** Is the trailing embed pass on? Read by the document list so an unembedded
 *  document is reported as "still indexing" only when something will index it. */
export function embedOnWriteEnabled(): boolean {
  return EMBED_ON_WRITE;
}

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
 * One embed of a fixed string with the write path's own model and dimension —
 * the health probe for the embedder (capabilities/embed-retry-sweep.ts). Same
 * return shape as the write path, so a probe failure carries the same code an
 * upload would hit.
 */
export function probeEmbedder(): Promise<{ vec: number[] } | { code: EmbedFailureCode }> {
  return embedText("embedder health probe");
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
      const writable: { id: string; vec: number[]; contentMd5: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = results[i];
        if ("vec" in r) {
          // The write below is fenced on the content this vector was computed
          // FROM: if a repair (scripts/repair-garbled-chunks.ts) rewrote the row
          // while the HTTP call was in flight, the stale vector is rejected and
          // the next sweep embeds the repaired text (Codex r2 F2 on #4486).
          writable.push({ id: rows[i].id, vec: r.vec, contentMd5: createHash("md5").update(rows[i].content).digest("hex") });
        } else {
          code ??= r.code; // keep the FIRST reason — it explains the stall
        }
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
                WHERE id = $1 AND embedding IS NULL AND md5(content) = $3`,
              [w.id, `[${w.vec.join(",")}]`, w.contentMd5],
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
  /** Set ONLY by the upload route, when the text is what OCR read off an
   *  uploaded photo. Recorded on every passage as `metadata.derived_from`, the
   *  record retrieval asks for before it reads a document as a photo's text
   *  rather than by its cover. Never taken from the request or the file. */
  derivedFrom?: "photo_ocr";
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
  /** Per-page repair marker (index-aligned with `pages`), recorded on every
   *  chunk of that page as `metadata.text_repair` so a decoded row is
   *  auditable and reversible (TQ-05/06). Absent = untouched extraction. */
  repairs?: ReadonlyArray<TextRepair | null>,
  /** Per-page printed label from the PDF's own /PageLabels tree (index-aligned
   *  with `pages`), recorded as `metadata.page_label` (#4508). Absent = none. */
  pageLabels?: ReadonlyArray<string | null> | null,
  /** Per-page table read (index-aligned with `pages`), from `pageWithTables` — null for a page
   *  with no qualifying table (or whose layout read was skipped/failed). When present, the
   *  page's OWN text is chunked from `remainder` (the table's lines excluded) and one extra row
   *  is written per `TableChunk`, carrying `metadata.table_models` (+`table_unqualified` for the
   *  one flat-text chunk) instead of the page's ordinary chunk text. */
  tables?: ReadonlyArray<PageTable | null> | null,
): Promise<number> {
  const { tenantId, uploadId, filename } = opts;
  const sourceUrl = nodeDocSourceUrl(uploadId, filename);

  const idx = await withTenantContext(tenantId, (c) => insertChunkRows(c, pages, opts, repairs, pageLabels, tables));

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

/** Unique per attachment so same-named files on different nodes never false-dedup
 *  against the partial UNIQUE (tenant_id, source_url, metadata->>'chunk_index'). */
function nodeDocSourceUrl(uploadId: string, filename: string): string {
  return `node-doc/${uploadId}/${filename}`;
}

/**
 * The ONE chunk INSERT (garage pilot PR-6 factored it out of
 * `writeChunkRowsForNode`, unchanged). Takes any `{ query }` client — the
 * upload runs it under `withTenantContext`; `reprocessNodeDocument` runs it on
 * the owner pool inside its own BEGIN/DELETE/…/COMMIT, because factorylm_app
 * cannot DELETE knowledge_entries. Same SQL text, same `is_private … true`
 * literal, same `ON CONFLICT … DO NOTHING`, same metadata — so a reprocessed
 * document is byte-for-byte what a fresh upload of it would be. Returns the
 * generated chunk count (attempted, not post-ON-CONFLICT).
 */
async function insertChunkRows(
  c: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  pages: string[],
  opts: NodeChunkOpts,
  repairs?: ReadonlyArray<TextRepair | null>,
  pageLabels?: ReadonlyArray<string | null> | null,
  tables?: ReadonlyArray<PageTable | null> | null,
): Promise<number> {
  const { tenantId, uploadId, nodeId, unsPath, filename, derivedFrom } = opts;
  const sourceUrl = nodeDocSourceUrl(uploadId, filename);

  type ChunkRow = {
    content: string;
    page: number;
    idx: number;
    repair: TextRepair | null;
    label: string | null;
    tableModels?: string[];
    tableUnqualified?: boolean;
    tableScope?: SectionScope;
    tableHeader?: string;
  };
  let idx = 0;
  let batch: ChunkRow[] = [];

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
          extraction_version: EXTRACTION_VERSION,
          ...(derivedFrom ? { derived_from: derivedFrom } : {}),
          ...(r.repair ? { text_repair: r.repair } : {}),
          ...(r.label ? { page_label: r.label } : {}),
          ...(r.tableModels ? { table_models: r.tableModels } : {}),
          ...(r.tableUnqualified ? { table_unqualified: true } : {}),
          ...(r.tableScope ? { table_scope: r.tableScope } : {}),
          ...(r.tableHeader ? { table_header: r.tableHeader } : {}),
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
    const table = tables?.[p] ?? null;
    // A page with a qualifying table chunks its own text from the REMAINDER
    // (the table's row-grid lines excluded, so a drive's column values never
    // bleed into the flat-text chunk) and pushes ONE extra, un-re-chunked row
    // per TableChunk — the ingest contract asserts exactly one row per model
    // tag (`table-rows.test.ts`), so TableChunk.text goes in verbatim.
    const textToChunk = table ? table.remainder : pageText;
    for (const section of table?.sections ?? [{ text: textToChunk }]) {
      let searchFrom = 0;
      const headerAt = section.sharedHeader ? section.text.indexOf(section.sharedHeader) : -1;
      for (const piece of chunkText(section.text)) {
        const pieceAt = section.text.indexOf(piece, searchFrom);
        searchFrom = pieceAt >= 0 ? pieceAt + 1 : searchFrom;
        const tableHeader = section.sharedHeader && headerAt >= pieceAt && pieceAt >= 0 &&
          headerAt + section.sharedHeader.length <= pieceAt + piece.length ? section.sharedHeader : undefined;
        batch.push({
          content: piece,
          page: p + 1,
          idx: idx++,
          repair: repairs?.[p] ?? null,
          label: pageLabels?.[p] ?? null,
          tableModels: section.models,
          tableScope: section.scope,
          tableHeader,
          tableUnqualified: section.scope === "unresolved",
        });
        if (batch.length >= BATCH_ROWS) await flush();
      }
    }
    if (table) {
      for (const tc of table.chunks) {
        batch.push({
          content: tc.text,
          page: p + 1,
          idx: idx++,
          repair: repairs?.[p] ?? null,
          label: pageLabels?.[p] ?? null,
          tableModels: tc.models,
          tableUnqualified: tc.unqualified,
          tableScope: tc.scope,
        });
        if (batch.length >= BATCH_ROWS) await flush();
      }
    }
  }
  await flush();
  return idx;
}

/** `metadata.text_repair` values — how a page's text was changed after
 *  extraction, or (`unmapped_glyph`) that it was flagged and NOT changed.
 *  `shift29_partial` = the decoder repaired part of the page and
 *  cipher-looking text remains (Codex r2 F3 on #4486): still searchable where
 *  decoded, still eligible for the backfill and the OCR seam.
 *  `unmapped_glyph` (garage pilot L2) = the page carries U+FFFD between two
 *  digits — a number whose glyph the PDF cannot map ("5�1" for 5.1); the
 *  text is stored as extracted, the document list counts the page as one that
 *  did not read cleanly, and the acquisition never promotes such a document. */
export type TextRepair = "shift29" | "shift29_partial" | "ocr" | "unmapped_glyph";

/**
 * TQ-05 / TQ-06 (2026-10-17 prod test): repair garbled extraction IN PLACE
 * before chunking. A page whose text came out as the fixed +29 cipher (the
 * PLC-5 manual: ",QDGGLWLRQ" for "Inaddition") is decoded deterministically;
 * a garbled page that is NOT the fixed shift is left as-is and — only behind
 * NOTEBOOK_GARBLE_OCR_FALLBACK=1 — offered to the OCR seam, which may return
 * replacement text. An ordinary page is never touched (the detector requires
 * the decode to read like English and the original not to). Returns the
 * index-aligned repair markers for `writeChunkRowsForNode`. Never throws:
 * a repair failure means the page is written exactly as extracted.
 *
 * Default ON — `NOTEBOOK_GARBLE_DECODE=0` is the kill switch. It shipped
 * default-off (#4486) as a second lock after the round-2 review found the
 * detector damaging clean English in 18 of 21 non-PLC-5 manuals before the
 * lowercase guard existed. But no environment ever set the flag, so the repair
 * never ran: on staging the real 1785-rm001 manual was stored as cipher and
 * TQ-05/06 found nothing (Release 2 Lane B, 2026-10-18, traces
 * ee1494fcc921d964c48b27c70eca5c06 / fce2e5796fff061f8781822942642d54).
 * Measured with the guard in, through unpdf as below: 0 pages rewritten across
 * 9 clean OEM manuals (1,451 pages); 274 of 372 PLC-5 pages decoded.
 */
async function repairGarbledPages(pages: string[], opts: NodeChunkOpts): Promise<Array<TextRepair | null>> {
  const repairs: Array<TextRepair | null> = new Array(pages.length).fill(null);
  if (process.env.NOTEBOOK_GARBLE_DECODE === "0") return repairs;
  const ocrFallback = process.env.NOTEBOOK_GARBLE_OCR_FALLBACK === "1";
  const originalPages = [...pages];
  let decoded = 0;
  let unrepaired = 0;
  for (let p = 0; p < pages.length; p++) {
    let verdict: PageRepair;
    try {
      verdict = repairExtractedPage(pages[p]);
    } catch (err) {
      console.warn(`[node-ingest] garble detector failed on ${opts.filename} p.${p + 1} (page kept as extracted):`, err instanceof Error ? err.message : err);
      continue;
    }
    if (verdict.repair) {
      pages[p] = verdict.text;
      // A partly-decoded page keeps the decoded text (already more searchable)
      // but is marked partial, counted unrepaired, and still offered to OCR —
      // the `continue` that used to sit here discarded that signal (Codex r2 F3).
      repairs[p] = verdict.unrepaired ? "shift29_partial" : verdict.repair;
      decoded++;
      if (!verdict.unrepaired) continue;
    } else if (!verdict.unrepaired) {
      continue;
    }
    unrepaired++;
    if (!ocrFallback) continue;
    try {
      // OCR sees the ORIGINAL extraction, not the half-decoded text.
      const ocrText = await ocrExtractPage({ tenantId: opts.tenantId, uploadId: opts.uploadId, filename: opts.filename, page: p + 1, extracted: originalPages[p] });
      if (ocrText && ocrText.trim()) {
        pages[p] = ocrText;
        repairs[p] = "ocr";
        unrepaired--;
      }
    } catch (err) {
      console.warn(`[node-ingest] OCR fallback failed on ${opts.filename} p.${p + 1} (page kept as extracted):`, err instanceof Error ? err.message : err);
    }
  }
  if (decoded > 0) {
    console.info(`[node-ingest] garbled extraction decoded (shift29) on ${decoded}/${pages.length} pages of ${opts.filename}`);
  }
  if (unrepaired > 0) {
    console.warn(`[node-ingest] garbled extraction left unrepaired on ${unrepaired}/${pages.length} pages of ${opts.filename} (not the fixed shift; OCR fallback ${ocrFallback ? "returned nothing" : "off"})`);
  }
  return repairs;
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
    const { pages, markers, labels, pageTables } = await parsePdfForNode(buffer, rest);
    return await writeChunkRowsForNode(pages, rest, markers, labels, pageTables);
  } finally {
    release();
  }
}

/** Everything the row writer needs from one PDF: page text (repaired in place
 *  where the garble decoder applied), the per-page repair/flag markers, the
 *  printed page labels, and the per-page table read. Index-aligned. */
interface ParsedPdfForNode {
  pages: string[];
  markers: Array<TextRepair | null>;
  labels: Array<string | null> | null;
  pageTables: Array<PageTable | null>;
}

/**
 * The ONE PDF parse (garage pilot PR-6 factored it out of
 * `writePdfChunksForNode`, unchanged): unpdf text → garble repair → printed
 * page labels → per-page table read → unmapped-glyph flag. Shared by the
 * upload and by `reprocessNodeDocument`, so a reprocessed document is parsed
 * exactly as a fresh upload would be. Does NOT take the ingest slot — the
 * caller holds it around this call (it is the heavy, memory-peaking step).
 */
async function parsePdfForNode(buffer: Buffer | Uint8Array, rest: NodeChunkOpts): Promise<ParsedPdfForNode> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  // Copy rather than alias: writeChunkRowsForNode releases each page's text
  // in place (`pages[p] = ""`) to bound peak memory, and `text` may be the
  // SAME array a caller/mock holds a reference to (e.g. a test re-using its
  // fixture array across two writePdfChunksForNode calls) — mutating that
  // array out from under the caller is a bug the release optimization must
  // not cause.
  const pages: string[] = Array.isArray(text) ? [...text] : [text];
  const repairs = await repairGarbledPages(pages, rest);
  const labels = await printedPageLabels(
    { getPageLabels: () => readPageLabelsBounded(buffer, rest.filename) },
    pages.length,
    rest.filename,
  );
  // Table rows at upload (garage pilot plan row 1-A): read each page's
  // positioned text items and recover any qualifying table, skipping a page
  // whose text was itself repaired (garbled extraction has no reliable x/y
  // geometry to key columns off of). A read/detect failure is warned and
  // treated as "no table on this page" — it must never fail the upload.
  const pageTables: Array<PageTable | null> = [];
  // undefined means unreadable/repaired geometry; null means a successful unheaded page.
  const sectionLayouts: Array<ReturnType<typeof sectionTableLayout> | undefined> = [];
  const outputs = new Map<string, boolean | null>();
  // Even a failed layout read must not erase a visibly present type inventory. Its model
  // applicability then stays unknown, with a warning and unresolved relay-section metadata.
  let outputInventoryObserved = pages.some((page) => /(?:^|\n)\s*Output\s+circuit\s+type\b/i.test(page));
  for (let p = 0; p < pages.length; p++) {
    if (repairs[p] !== null) {
      pageTables.push(null);
      sectionLayouts.push(undefined);
      continue;
    }
    try {
      const items = await pageLayoutItems(pdf, p + 1);
      const table = items.length > 0 ? pageWithTables(items) : null;
      if (table) {
        outputInventoryObserved ||= table.chunks.some((c) => /\bOutput circuit type\b/i.test(c.text));
      }
      // Boundary detection must not depend on whether the type table is earlier or later.
      let layout: ReturnType<typeof sectionTableLayout>;
      // #5474 item 5: a contact-ratings table's make / break / continuous columns, read from the
      // same positioned items, are written under the table in the page text (and in the table
      // remainder, which is what a page with a model table chunks). The flat rows stay as they
      // were. Its own guard: a failure here must not cost the page its table read.
      try {
        const rating = contactRatingTable(items);
        layout = sectionTableLayout(items, true, table?.remainderItems,
          rating ? { after: rating.lastRow, lines: columnLines(rating.rows) } : undefined);
        if (rating) {
          // Preserve the legacy path for documents without an output inventory. The scoped
          // path below uses the physically attached annotations in layout.text instead.
          pages[p] = withColumnLines(pages[p], rating.rows);
          if (table) table.remainder = withColumnLines(table.remainder, rating.rows);
        }
      } catch (err) {
        layout = sectionTableLayout(items, true, table?.remainderItems);
        console.warn(`[node-ingest] contact-ratings column read failed on ${rest.filename} p.${p + 1} (page kept without column lines):`, err instanceof Error ? err.message : err);
      }
      if (table) {
        table.chunks = scopeTableChunks(table.chunks, layout);
        mergeOutputTypes(outputs, readOutputTypes(table.chunks));
      }
      // Geometry is page-local; retain only the text/chunks after deriving source boundaries.
      pageTables.push(table ? { remainder: table.remainder, chunks: table.chunks } : null);
      sectionLayouts.push(items.length > 0 ? layout : undefined);
    } catch (err) {
      console.warn(`[node-ingest] table read failed on ${rest.filename} p.${p + 1} (page kept as flat text):`, err instanceof Error ? err.message : err);
      pageTables.push(null);
      sectionLayouts.push(undefined);
    }
  }
  if (outputInventoryObserved && (outputs.size === 0 || [...outputs.values()].includes(null))) {
    console.warn(`[node-ingest] output-type applicability unresolved in ${rest.filename}; relay sections with unreadable model applicability are marked unresolved`);
  }
  const sectionModels = [...new Set(sectionLayouts.flatMap(modelSectionModels))];
  const sectionScopeObserved = outputInventoryObserved || sectionModels.length > 0;
  const scope = new SectionTableScope(outputs, sectionScopeObserved, sectionModels);
  for (let p = 0; p < pages.length; p++) {
    if (!sectionScopeObserved) break;
    const table = pageTables[p];
    const layout = sectionLayouts[p];
    const remainder = layout && (table || layout.hasTables) ? layout.text : table?.remainder ?? pages[p];
    const sections = layout === undefined ? scope.unreadable(remainder) : scope.split(remainder, layout);
    pageTables[p] = { remainder, chunks: table?.chunks ?? [], sections };
  }
  // Garage pilot L2 (plan row 5-A): a page whose numbers carry a replacement
  // character between two digits ("5�1" for 5.1 A — the PDF's ToUnicode
  // map has no entry for the decimal-point glyph; the GS10 chapter file) is
  // FLAGGED, never repaired: no decode, no OCR, the text is stored exactly as
  // extracted. The flag is merged only into what the row writer stamps, and
  // only AFTER the table read above: the page's positions are reliable, so its
  // table rows are written (flagged) rather than dropped. A page the repair
  // touched keeps its repair marker. Independent of NOTEBOOK_GARBLE_DECODE —
  // this is detection, not a repair.
  const markers: Array<TextRepair | null> = repairs.map((r, p) => r ?? (hasUnmappedGlyphBetweenDigits(pages[p]) ? "unmapped_glyph" : null));
  return { pages, markers, labels, pageTables };
}

/**
 * #4508 — the PDF's own printed page labels (/PageLabels, via pdfjs
 * `getPageLabels()`), index-aligned with the extracted pages. The Safety
 * chapter reader maps a printed page ("Safety ... 17") through these instead of
 * guessing an offset. Returns null — never a guess — when the PDF has no label
 * tree, the tree cannot be read, or its length does not match the pages. A
 * non-string or blank entry is null for that page only. Never throws: a label
 * failure must not fail the upload.
 *
 * Size-bounded (#5065 Codex r3 F1): each label is copied onto every chunk of its
 * page, and a /PageLabels prefix can be megabytes. One label over
 * MAX_PAGE_LABEL_BYTES, or all labels together over MAX_PAGE_LABELS_TOTAL_BYTES
 * (UTF-8), drops the whole document's labels — never truncated, never partial.
 * The character-length check runs first so an oversized label is rejected
 * before trim or byte counting flattens it.
 */
export const MAX_PAGE_LABEL_BYTES = 64;
export const MAX_PAGE_LABELS_TOTAL_BYTES = 256 * 1024;

export async function printedPageLabels(
  pdf: { getPageLabels?: () => Promise<unknown> },
  pageCount: number,
  filename: string,
): Promise<Array<string | null> | null> {
  let raw: unknown;
  try {
    raw = await pdf.getPageLabels?.();
  } catch (err) {
    console.warn(`[node-ingest] page labels unreadable for ${filename}:`, err);
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== pageCount) return null;
  const labels: Array<string | null> = [];
  let total = 0;
  for (const l of raw) {
    if (typeof l !== "string") {
      labels.push(null);
      continue;
    }
    if (l.length > MAX_PAGE_LABEL_BYTES * 4) return oversized(filename);
    const t = l.trim();
    const bytes = Buffer.byteLength(t, "utf8");
    total += bytes;
    if (bytes > MAX_PAGE_LABEL_BYTES || total > MAX_PAGE_LABELS_TOTAL_BYTES) return oversized(filename);
    labels.push(t || null);
  }
  return labels;
}

function oversized(filename: string): null {
  console.warn(`[node-ingest] page labels over the size limit for ${filename}; storing none`);
  return null;
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
  /** See NodeChunkOpts.derivedFrom. */
  derivedFrom?: "photo_ocr";
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
  /** See NodeChunkOpts.derivedFrom. */
  derivedFrom?: "photo_ocr";
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
      ...(opts.derivedFrom ? { derivedFrom: opts.derivedFrom } : {}),
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

/** Why a stored document was recomputed (materialized-evidence rule 2 — a
 *  recomputation is observable, with its reason). `recomputed_algorithm_changed`
 *  = its chunks predate the current EXTRACTION_VERSION; `recomputed_human_requested`
 *  = an owner forced it although the chunks were already current. */
export type ReprocessReason = "recomputed_algorithm_changed" | "recomputed_human_requested";

export type ReprocessRefusal = "no_upload" | "no_node" | "no_bytes" | "no_upload_hash" | "sha_mismatch";

export type ReprocessResult =
  /** Every stored chunk already carries the current version and nobody forced it: nothing touched. */
  | {
      action: "noop";
      version: number;
      chunkCount: number;
      /** The upload's `kb_chunk_count` disagreed with the stored rows (a status write after an earlier
       *  COMMIT failed) and was repaired with the write that step would have made. */
      countRepaired?: true;
      /** Same disagreement, but `opts.dryRun` was set: nothing was written (a dry run writes
       *  nothing — Codex #5429 r1 F2) and the repair is still owed on a real run. */
      countRepairPending?: true;
    }
  /** The document could not be proven re-readable: nothing touched, the reason named. */
  | { action: "refused"; reason: ReprocessRefusal }
  /** `dryRun`: what a real run would do, after the bytes were proven — no parse, no write. */
  | {
      action: "plan";
      reason: ReprocessReason;
      from: number | null;
      to: number;
      /** Rows that would be deleted. */
      chunkCount: number;
      bytesFrom: "local_pdf" | "parked_original";
    }
  | {
      action: "reprocessed";
      reason: ReprocessReason;
      /** The version the stored chunks carried before — null when any chunk was unstamped (pre-PR-1). */
      from: number | null;
      to: number;
      deleted: number;
      inserted: number;
      /** The awaited embed pass — reported, never thrown. */
      embed: EmbedPassResult;
    };

/**
 * Garage pilot PR-6 (plan row 16-A) — re-extract ONE already-stored node
 * document through the upload's own parse + row writer and swap its chunks.
 *
 * Why this exists: the pilot's manuals were stored as flat lines before the
 * table step (PR-1) and the glyph flag (PR-3). Those only reach a document
 * uploaded AFTER the deploy — unless the stored document is reprocessed.
 *
 * Order, and why:
 *   1. Read the upload for THIS tenant (filename, node, uns_path, sha, parked
 *      file). Another tenant's upload id reads as "no upload".
 *   2. Idempotency on `metadata.extraction_version` (materialized-evidence
 *      rule 7): every chunk already at EXTRACTION_VERSION → noop, unless
 *      `force` (reason `recomputed_human_requested`).
 *   3. Bytes. The v2 upload's bytes are NOT kept after parsing, so they come
 *      from (a) `bytes` the caller supplies, accepted ONLY when sha256 equals
 *      `hub_uploads.content_sha256` (`uploadIdentity`, the page-label
 *      backfill's rule) — an upload with no recorded hash cannot prove a
 *      local file is itself and is refused; else (b) the parked original in
 *      `namespace_direct_uploads` (what the viewer serves); else refused.
 *      Never "best effort".
 *   4. Parse under the ingest slot (`parsePdfForNode`, the upload's parse).
 *   5. ONE transaction on the owner pool (factorylm_app has no DELETE grant on
 *      knowledge_entries — migrations 011/049/079): BEGIN → DELETE this
 *      tenant's, this doc's `node_attachment` rows → `insertChunkRows` (the
 *      upload's INSERT, `is_private … true` literal, version stamp) → COMMIT.
 *      Delete-then-insert, not the reverse: the INSERT is `ON CONFLICT
 *      (tenant_id, source_url, chunk_index) DO NOTHING`, so inserting first
 *      would collide on chunk_index 0..N and silently drop every new row.
 *      Any throw → ROLLBACK, the old rows stay.
 *   6. The embed pass is AWAITED (the upload fires and forgets) and its result
 *      reported, never thrown — the caller is a script, not a request.
 *   7. `kb_chunk_count` through `updateUploadStatus`, the call the upload makes.
 *
 * Non-goal: no `proposeDocumentEdgesForNode` — the upload already filed that
 * document's graph proposal; filing it again would duplicate it.
 */
export async function reprocessNodeDocument(opts: {
  tenantId: string;
  uploadId: string;
  /** A local copy of the uploaded PDF. Used only when its sha256 equals the upload's recorded hash. */
  bytes?: Uint8Array | null;
  /** Recompute even when every chunk is already at the current version. */
  force?: boolean;
  /** Report the plan after proving the bytes; parse nothing, write nothing. */
  dryRun?: boolean;
}): Promise<ReprocessResult> {
  const { tenantId, uploadId } = opts;

  const upload = (
    await pool.query<{
      filename: string;
      kg_entity_id: string | null;
      uns_path: string | null;
      content_sha256: string | null;
      file_id: string | null;
      kb_chunk_count: number | null;
    }>(
      `SELECT u.filename, u.kg_entity_id::text AS kg_entity_id, u.uns_path, u.content_sha256,
              u.kb_chunk_count, d.id::text AS file_id
         FROM hub_uploads u
         LEFT JOIN namespace_direct_uploads d ON d.upload_id = u.id
        WHERE u.id = $1::uuid AND u.tenant_id = $2
        LIMIT 1`,
      [uploadId, tenantId],
    )
  ).rows[0];
  if (!upload) return { action: "refused", reason: "no_upload" };
  // Every v2 node document is attached to a node and every chunk names it
  // (`metadata.node_id`); an upload with none is not a node document — refuse
  // rather than write rows with an empty node.
  if (!upload.kg_entity_id) return { action: "refused", reason: "no_node" };

  // Owner pool, explicit tenant + doc predicates (the same shape as listSources'
  // counts): these are this tenant's own rows, not the hybrid OEM read.
  const v = (
    await pool.query<{ n: number; current: number; unstamped: number; min_version: number | null }>(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE (metadata->>'extraction_version')::int = $3)::int AS current,
              count(*) FILTER (WHERE metadata->>'extraction_version' IS NULL)::int AS unstamped,
              min((metadata->>'extraction_version')::int)::int AS min_version
         FROM knowledge_entries
        WHERE tenant_id = $1::uuid AND doc_id = $2::uuid AND source_type = 'node_attachment'`,
      [tenantId, uploadId, EXTRACTION_VERSION],
    )
  ).rows[0] ?? { n: 0, current: 0, unstamped: 0, min_version: null };
  const n = Number(v.n ?? 0);
  const current = Number(v.current ?? 0);
  const allCurrent = n > 0 && current === n;
  if (allCurrent && !opts.force) {
    // The count is written after COMMIT (below). If that write failed on an earlier run the rows
    // are current and the retry lands here — make the write it would have made, nothing else.
    // A dry run writes nothing (Codex #5429 r1 F2): report the repair as pending instead.
    if (Number(upload.kb_chunk_count ?? -1) !== n) {
      if (opts.dryRun) {
        return { action: "noop", version: EXTRACTION_VERSION, chunkCount: n, countRepairPending: true };
      }
      await updateUploadStatus(uploadId, tenantId, "parsed", null, { kbChunkCount: n });
      console.info(`[node-ingest] reprocess noop doc=${uploadId}: repaired kb_chunk_count ${upload.kb_chunk_count ?? "null"}→${n}`);
      return { action: "noop", version: EXTRACTION_VERSION, chunkCount: n, countRepaired: true };
    }
    return { action: "noop", version: EXTRACTION_VERSION, chunkCount: n };
  }
  const from: number | null =
    allCurrent ? EXTRACTION_VERSION : n > 0 && Number(v.unstamped ?? 0) === 0 && v.min_version != null ? Number(v.min_version) : null;
  const reason: ReprocessReason = allCurrent ? "recomputed_human_requested" : "recomputed_algorithm_changed";

  const chunkOpts: NodeChunkOpts = {
    tenantId,
    uploadId,
    nodeId: upload.kg_entity_id,
    unsPath: upload.uns_path,
    filename: upload.filename,
  };

  // Prove the bytes BEFORE taking the slot: a sha check needs no memory and a
  // refusal should never wait behind a parse.
  if (opts.bytes) {
    const check = uploadIdentity(upload.content_sha256, createHash("sha256").update(opts.bytes).digest("hex"));
    if (!check.ok) return { action: "refused", reason: check.reason };
  } else if (!upload.file_id) {
    return { action: "refused", reason: "no_bytes" };
  } else {
    // The parked original must be PRESENT before a plan or a slot — presence only, no bytes read
    // (the bytes are read under the slot below).
    const present = await withTenantContext(tenantId, async (c) => {
      const res = await c.query(
        `SELECT 1 FROM namespace_direct_uploads WHERE id = $1 AND tenant_id = $2 AND content IS NOT NULL`,
        [upload.file_id, tenantId],
      );
      return (res.rowCount ?? res.rows.length) > 0;
    });
    if (!present) return { action: "refused", reason: "no_bytes" };
  }
  if (opts.dryRun) {
    return { action: "plan", reason, from, to: EXTRACTION_VERSION, chunkCount: n, bytesFrom: opts.bytes ? "local_pdf" : "parked_original" };
  }

  // Bytes + parse under the ingest slot — the parked original is read there
  // too, so a waiting reprocess never holds a whole PDF in memory (the same
  // discipline as document-text.ts).
  let parsed: ParsedPdfForNode;
  const release = await acquireIngestSlot();
  try {
    let bytes: Uint8Array | null = opts.bytes ?? null;
    if (!bytes && upload.file_id) {
      const parked = await withTenantContext(tenantId, async (c) => {
        const res = await c.query<{ content: Buffer }>(
          `SELECT content FROM namespace_direct_uploads WHERE id = $1 AND tenant_id = $2`,
          [upload.file_id, tenantId],
        );
        return res.rows[0] ?? null;
      });
      if (parked?.content) bytes = new Uint8Array(parked.content);
      // #5432: the parked copy is proven against the recorded hash before the swap, exactly as
      // a local file is — a stale or corrupted parked row must never replace the stored chunks.
      // No recorded hash → there is nothing to compare, and the parked row is the system's own
      // copy (the local-file path refuses in that case because that file is foreign input).
      if (bytes && upload.content_sha256) {
        const check = uploadIdentity(upload.content_sha256, createHash("sha256").update(bytes).digest("hex"));
        if (!check.ok) return { action: "refused", reason: check.reason };
      }
    }
    if (!bytes) return { action: "refused", reason: "no_bytes" };
    parsed = await parsePdfForNode(bytes, chunkOpts);
  } finally {
    release();
  }

  const client = await pool.connect();
  let deleted = 0;
  let inserted = 0;
  try {
    await client.query("BEGIN");
    const del = await client.query(
      `DELETE FROM knowledge_entries
        WHERE tenant_id = $1::uuid AND doc_id = $2::uuid AND source_type = 'node_attachment'`,
      [tenantId, uploadId],
    );
    deleted = del.rowCount ?? 0;
    inserted = await insertChunkRows(client, parsed.pages, chunkOpts, parsed.markers, parsed.labels, parsed.pageTables);
    if (inserted === 0) throw new NoExtractableTextError(upload.filename);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const embed = await embedPendingNodeChunks(tenantId, nodeDocSourceUrl(uploadId, upload.filename));
  await updateUploadStatus(uploadId, tenantId, "parsed", null, { kbChunkCount: inserted });
  console.info(
    `[node-ingest] reprocessed doc=${uploadId} reason=${reason} from=${from === null ? "unstamped" : `v${from}`} to=v${EXTRACTION_VERSION} rows=${deleted}→${inserted} embedded=${embed.embedded} embed_state=${embed.state}`,
  );
  return { action: "reprocessed", reason, from, to: EXTRACTION_VERSION, deleted, inserted, embed };
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
