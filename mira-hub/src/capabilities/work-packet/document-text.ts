/**
 * Work Packet (#4982) — document loading.
 *
 * Turns a notebook's attached sources into `DocText[]` (contract: `./types.ts`),
 * the only input the parsers and the draft builder ever see:
 *   - a source whose original bytes are kept (`namespace_direct_uploads`) is
 *     re-extracted page-by-page with unpdf, the same loader
 *     `node-knowledge-ingest.ts` uses for ingest (`via:"file"`);
 *   - everything else falls back to its materialized `knowledge_entries`
 *     chunks, grouped by page and stitched back into page text — the stored
 *     chunks overlap by ~120 chars at each boundary (`via:"chunks"`).
 *
 * Read-only: no notebook, source or knowledge_entries row is ever written here.
 */

import { extractText, getDocumentProxy, getResolvedPDFJS } from "unpdf";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { listSources } from "@/lib/equipment-notebooks";
import { acquireIngestSlot } from "@/lib/node-knowledge-ingest";
import { figureLinesForPage, figuresForPage, imageBoxesFromOps, type LayoutItem } from "./pdf-figure-lines";
import { decodedImageToPng, type DecodedImage } from "./pdf-image-png";
import type { DocText, PageFigure, PageText } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The stored overlap between two consecutive chunks of the same page is
// ~120 chars (node-knowledge-ingest's CHUNK_OVERLAP); 20..400 is a wide band
// around that so a slightly shorter/longer real boundary still matches, while
// a short coincidental repeat (a few words) in unrelated chunks does not.
const OVERLAP_MIN = 20;
const OVERLAP_MAX = 400;

/**
 * A notebook doc's `knowledge_entries` rows are read ONCE, capped here —
 * never with a LIMIT that would silently drop the tail of a long manual. 2000
 * is a sane ceiling (a few hundred pages at a handful of chunks per page);
 * hitting it is logged so a truncated document is never a silent gap.
 */
const MAX_DOC_CHUNK_ROWS = 2000;

/**
 * Join consecutive stored chunks into one page's text, removing the largest
 * suffix/prefix overlap between each pair (20..400 chars — see OVERLAP_MIN/
 * MAX above). Falls back to a bare "\n" join when no overlap in that range is
 * found, so two chunks are never silently mashed together without a boundary.
 * Verified against the real 5CP6120_G / CPSvc5 stored chunks (see the task's
 * real-document acceptance numbers): every page reconstructs byte-for-byte.
 */
export function stitchChunks(chunks: string[]): string {
  if (chunks.length === 0) return "";
  let out = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const maxK = Math.min(out.length, next.length, OVERLAP_MAX);
    let overlap = 0;
    for (let k = maxK; k >= OVERLAP_MIN; k--) {
      if (out.slice(-k) === next.slice(0, k)) {
        overlap = k;
        break;
      }
    }
    out = overlap > 0 ? out + next.slice(overlap) : out + "\n" + next;
  }
  return out;
}

interface UploadBytesRow {
  content: Buffer;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("PDF processing was cancelled", "AbortError");
}

/** Stop awaiting a PDF operation on cancellation. Handlers remain attached to
 * its outcome so worker teardown cannot create an unhandled rejection. */
function untilAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("PDF processing was cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then((value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

async function pdfSlot(signal?: AbortSignal): Promise<() => void> {
  checkAborted(signal);
  const pending = acquireIngestSlot();
  try { return await untilAbort(pending, signal); }
  catch (error) {
    // The shared limiter does not remove waiters. A cancelled waiter must
    // return its eventual grant, without fetching bytes or starting a parser.
    void pending.then((release) => release(), () => {});
    throw error;
  }
}

/**
 * The kept original's own page text via unpdf — same call shape
 * (`getDocumentProxy` + `extractText(pdf, { mergePages: false })`) as
 * `writePdfChunksForNode` in `@/lib/node-knowledge-ingest`. That function also
 * writes chunk rows, which this read-only loader must not, so the unpdf call is
 * reused directly — but the parse holds the SAME concurrency slot ingest does
 * (`acquireIngestSlot`), because a whole PDF in memory is the documented OOM
 * term whether it is being ingested or re-read (Codex #5062 F17). Returns null when no row matches (wrong tenant, or the file
 * was never parked) so the caller can fall back to the chunk text.
 *
 * Each page also carries `figureLines` — the lines its layout places in the caption band directly
 * under a photo (`pdf-figure-lines.ts`). If reading a page's layout fails, that page simply has none, and the
 * parser treats every unplaced line on it as content (Codex #5062 F15).
 */
async function fileDocPages(tenantId: string, fileId: string, signal?: AbortSignal): Promise<PageText[] | null> {
  const release = await pdfSlot(signal);
  try {
    checkAborted(signal);
    // Admit before reading/copying the kept original, not just before parsing.
    // Waiting requests retain source IDs, never whole PDF byte buffers.
    const row = await withTenantContext(tenantId, async (c) => {
      const res = await c.query<UploadBytesRow>(
        `SELECT content FROM namespace_direct_uploads WHERE id = $1 AND tenant_id = $2`,
        [fileId, tenantId],
      );
      return res.rows[0] ?? null;
    });
    checkAborted(signal);
    if (!row) return null;
    return await readPdfPages(new Uint8Array(row.content), signal);
  } finally { release(); }
}

/** A PDF's own pages: unpdf page text plus each page's layout-derived `figureLines`. Holds one
 *  shared PDF-parse slot for the whole read, released on success and on failure. */
export async function pdfDocPages(bytes: Uint8Array, signal?: AbortSignal): Promise<PageText[]> {
  const release = await pdfSlot(signal);
  try {
    checkAborted(signal);
    return await readPdfPages(bytes, signal);
  } finally {
    release();
  }
}

async function readPdfPages(bytes: Uint8Array, signal?: AbortSignal): Promise<PageText[]> {
  checkAborted(signal);
  // Keep the slot until opening resolves: unpdf does not expose its loading
  // task. A cancellation during open is checked before extraction, then the
  // newly acquired PDF is destroyed before another parse may be admitted.
  const pdf = await getDocumentProxy(bytes);
  let destruction: Promise<void> | undefined;
  const destroy = () => destruction ??= Promise.resolve().then(() => pdf.destroy());
  const abort = () => { void destroy().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    checkAborted(signal);
    const { text } = await untilAbort(extractText(pdf, { mergePages: false }), signal);
    const texts = Array.isArray(text) ? text : [text];
    const pages: PageText[] = [];
    for (let i = 0; i < texts.length; i++) {
      checkAborted(signal);
      const page: PageText = { page: i + 1, text: texts[i] };
      let pg: Awaited<ReturnType<typeof pdf.getPage>> | undefined;
      try {
        const { OPS } = await getResolvedPDFJS();
        pg = await untilAbort(pdf.getPage(i + 1), signal);
        const content = await untilAbort(pg.getTextContent(), signal);
        const items: LayoutItem[] = [];
        for (const it of content.items) {
          if (!("str" in it) || !("transform" in it)) continue;
          const [, b, , d, x, y] = it.transform as number[];
          items.push({ str: it.str, x, y, w: it.width, size: Math.round(Math.hypot(b, d) * 10) / 10 });
        }
        const ops = await untilAbort(pg.getOperatorList(), signal);
        const boxes = imageBoxesFromOps(ops.fnArray, ops.argsArray, OPS);
        page.figureLines = figureLinesForPage(items, boxes, texts[i]);
        const figures: PageFigure[] = [];
        for (const f of figuresForPage(items, boxes)) {
          figures.push({ image: f.box.name ? await untilAbort(photoPng(pg, f.box.name), signal) : null, caption: f.caption });
        }
        if (figures.length > 0) page.figures = figures;
      } catch (err) {
        checkAborted(signal);
        console.error(`[work-packet/document-text] page ${i + 1} layout read failed (no figure lines):`, err instanceof Error ? err.message : err);
      } finally {
        // All required captions and encoded figure bytes have been captured.
        // Do not retain every page's operator lists/decoded images until EOF.
        if (pg && !pg.cleanup() && !signal?.aborted) throw new Error("PDF page resources could not be released");
      }
      pages.push(page);
    }
    return pages;
  } finally {
    signal?.removeEventListener("abort", abort);
    await destroy();
  }
}

/** The decoded pixels of one page image as a PNG data URL; null if pdf.js cannot hand them over. */
async function photoPng(pg: { objs: PdfObjs; commonObjs: PdfObjs }, name: string): Promise<string | null> {
  try {
    const store = name.startsWith("g_") ? pg.commonObjs : pg.objs;
    const img = await new Promise<unknown>((resolve) => store.get(name, resolve));
    return img && typeof img === "object" && "data" in img ? decodedImageToPng(img as DecodedImage) : null;
  } catch (err) {
    console.error(`[work-packet/document-text] image ${name} could not be read:`, err instanceof Error ? err.message : err);
    return null;
  }
}

interface PdfObjs {
  get(name: string, callback: (data: unknown) => void): unknown;
}

interface ChunkRow {
  source_page: number | null;
  content: string;
  chunk_index: number | null;
}

/**
 * The doc's materialized chunk text, grouped by page and stitched. Same hybrid
 * read law as `sources/[docId]/passage/route.ts`
 * (`is_private = false OR tenant_id = $caller`, raw pool, never
 * `withTenantContext` — RLS would hide shared OEM rows) and the same
 * notebook-source membership IDOR guard, even though every `docId` passed in
 * here already came from `listSources(tenantId, notebookId)` for this exact
 * pair — belt-and-suspenders against a future caller passing an unchecked id.
 */
async function chunkDocPages(tenantId: string, notebookId: string, docId: string): Promise<PageText[]> {
  const attached = await pool.query(
    `SELECT 1 FROM equipment_notebook_sources
      WHERE notebook_id = $1::uuid AND doc_id = $2::uuid AND tenant_id = $3::uuid
      LIMIT 1`,
    [notebookId, docId, tenantId],
  );
  if (attached.rows.length === 0) return [];

  const rows = await pool.query<ChunkRow>(
    `SELECT source_page, content, (metadata->>'chunk_index')::int AS chunk_index
       FROM knowledge_entries
      WHERE doc_id = $1::uuid
        AND (is_private = false OR tenant_id = $2::uuid)
      ORDER BY source_page ASC NULLS LAST, chunk_index ASC NULLS LAST
      LIMIT $3`,
    [docId, tenantId, MAX_DOC_CHUNK_ROWS],
  );
  if (rows.rows.length >= MAX_DOC_CHUNK_ROWS) {
    console.warn(
      `[work-packet/document-text] doc ${docId} hit the ${MAX_DOC_CHUNK_ROWS}-row chunk cap — later pages may be missing`,
    );
  }

  const byPage = new Map<number, string[]>();
  for (const r of rows.rows) {
    // A row with no page locator still carries text; it is grouped under page
    // 0 rather than dropped, so an unanchored doc still contributes something
    // instead of silently losing content.
    const page = r.source_page ?? 0;
    const bucket = byPage.get(page);
    if (bucket) bucket.push(r.content);
    else byPage.set(page, [r.content]);
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, pageChunks]) => ({ page, text: stitchChunks(pageChunks) }));
}

/**
 * Every enabled, non-rejected, non-superseded source attached to this
 * notebook (`listSources` already drops superseded rows), as `DocText[]`:
 * the kept original's own pages when its bytes are still parked (`via:"file"`),
 * otherwise its materialized chunk text (`via:"chunks"`). A source whose
 * `fileId` is set but whose bytes cannot be re-extracted (row gone, or unpdf
 * fails on it) falls back to its chunk text rather than dropping the document
 * — a notebook's draft should degrade, never silently lose a source.
 */
export async function loadNotebookDocTexts(tenantId: string, notebookId: string, options: { signal?: AbortSignal } = {}): Promise<DocText[]> {
  checkAborted(options.signal);
  const sources = await listSources(tenantId, notebookId);
  checkAborted(options.signal);
  const usable = sources.filter((s) => s.enabledByDefault && s.matchState !== "rejected");

  const out: DocText[] = [];
  for (const s of usable) {
    checkAborted(options.signal);
    let pages: PageText[] | null = null;
    let via: DocText["via"] = "chunks";
    if (s.fileId && UUID_RE.test(s.fileId)) {
      try {
        const filePages = await fileDocPages(tenantId, s.fileId, options.signal);
        if (filePages) {
          pages = filePages;
          via = "file";
        }
      } catch (err) {
        checkAborted(options.signal);
        if (err instanceof Error && err.name === "AbortError") throw err;
        console.error(
          `[work-packet/document-text] doc ${s.docId} file re-extraction failed (falling back to chunks):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    checkAborted(options.signal);
    if (!pages) {
      pages = await chunkDocPages(tenantId, notebookId, s.docId);
      checkAborted(options.signal);
      via = "chunks";
    }
    out.push({ docId: s.docId, fileId: s.fileId, filename: s.filename, pages, via });
  }
  return out;
}
