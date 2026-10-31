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

// A line that starts a code-keyed table row: "F005 OverVoltage …", "0xF003 Recoverable …".
// Plain 4-digit codes (ABB: "0001 OVERCURRENT") count too (#4863), so an ABB table is a table.
const TABLE_ROW_START = /^(0x[0-9A-Fa-f]{3,4}|\d{4}(?!\d)|[A-Za-z]{1,3}\d{1,4}[A-Za-z]?)\s+[A-Z][A-Za-z]/gm;
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
      // The last row start inside the window is the row that would cross `end`, so
      // cut at its start even before the 50% mark (#4851). Only a row longer than the
      // whole window falls through to the sentence fallback.
      const rowBreak = rowStarts.filter((s) => s > i && s < end).pop();
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
): Promise<number> {
  const { tenantId, uploadId, nodeId, unsPath, filename } = opts;

  // Unique per attachment so same-named files on different nodes never false-dedup
  // against the partial UNIQUE (tenant_id, source_url, metadata->>'chunk_index').
  const sourceUrl = `node-doc/${uploadId}/${filename}`;

  type ChunkRow = { content: string; page: number; idx: number; repair: TextRepair | null };
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
            ...(r.repair ? { text_repair: r.repair } : {}),
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
        batch.push({ content: piece, page: p + 1, idx: idx++, repair: repairs?.[p] ?? null });
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

/** `metadata.text_repair` values — how a page's text was changed after
 *  extraction. `shift29_partial` = the decoder repaired part of the page and
 *  cipher-looking text remains (Codex r2 F3 on #4486): still searchable where
 *  decoded, still eligible for the backfill and the OCR seam. */
export type TextRepair = "shift29" | "shift29_partial" | "ocr";

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
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages: string[] = Array.isArray(text) ? text : [text];
    const repairs = await repairGarbledPages(pages, rest);
    return await writeChunkRowsForNode(pages, rest, repairs);
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
