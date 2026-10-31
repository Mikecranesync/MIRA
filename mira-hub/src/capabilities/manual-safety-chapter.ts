/**
 * The cited manual's own Safety chapter, read into the answer's grounding (#4508).
 *
 * A manual often keeps its electrical-safety procedure in one Safety chapter and points to it from
 * every task page ("WARNING! Read and follow the instructions in chapter Safety on page 17"). Top-K
 * retrieval returns the task page, not the chapter, so the answer can tell a technician to replace a
 * fan without the chapter's wait and zero-voltage check (Stranger Walk acs355-q3, acs355-q4).
 *
 * This follows the manual's OWN cross-reference, never a question phrase rule: when a document the
 * turn already retrieved says where its Safety chapter is, the chapter's warning chunks join the
 * excerpts. The model then carries the steps in the answer and cites the chapter page, and the cited
 * page's statement becomes the notice (#4509). A page the answer does not cite shows nothing.
 *
 * The reference names a PRINTED page; chunks are keyed by PDF page. The offset between them is read
 * from the referring chunk's own printed label (front matter shifts it); with no numeric label the
 * printed and PDF page are assumed equal (true for the ACS355).
 *
 * Read-only and fail-open: no write, and the caller keeps the retrieved chunks on any error.
 */
import type { PoolClient } from "pg";
import { extractManualSafetyStatement } from "@/capabilities/manual-safety-statement";
import {
  approvalGateEnabled,
  approvedSourceFilterSql,
  PAGE_LABEL_SQL,
  retrieveCitedPageChunks,
  type ManualChunk,
} from "@/lib/manual-rag";

/** One grammar for both matchers: an optional straight or curly quote around "Safety". */
const QUOTE = '["\u201c\u201d]?';
/** "chapter Safety on page 17" — the manual's cross-reference to its own Safety chapter. */
export const SAFETY_CHAPTER_REF = new RegExp(`\\bchapter\\s+${QUOTE}safety${QUOTE}\\s+on\\s+page\\s+(\\d{1,4})\\b`, "i");
/** The same reference as a Postgres regex, for the document-level lookup (no \\b: it means backspace there). */
export const SAFETY_CHAPTER_REF_SQL = `chapter\\s+${QUOTE}safety${QUOTE}\\s+on\\s+page\\s+[0-9]{1,4}`;
/**
 * Pages read from the referenced first page on (ACS355: 17 opens the chapter, 18-20 hold the warnings).
 * This page span is the only bound: every safety-statement chunk on those pages is kept, because any
 * chunk-count cap can cut off the page that holds the procedure (Codex #5056 r1, r3, r4).
 */
export const SAFETY_CHAPTER_SPAN = 4;

/** The first page of the Safety chapter a text refers to, or null. */
export function safetyChapterPage(text: string): number | null {
  const m = SAFETY_CHAPTER_REF.exec(text);
  const page = m ? Number(m[1]) : NaN;
  return Number.isInteger(page) && page > 0 ? page : null;
}

/** PDF page minus printed page for one chunk, from its own printed label; 0 when the label is not a plain number. */
export function printedPageOffset(pdfPage: number | null, pageLabel: string | null | undefined): number {
  const label = String(pageLabel ?? "").trim();
  if (pdfPage === null || !Number.isInteger(pdfPage) || !/^\d{1,4}$/.test(label)) return 0;
  return pdfPage - Number(label);
}

type ChapterStart = { pdfPage: number; offset: number };

/** Where a printed chapter reference lands (PDF page + the offset), or null when it falls before page 1. */
function chapterStart(text: string, pdfPage: number | null, pageLabel: string | null | undefined): ChapterStart | null {
  const printed = safetyChapterPage(text);
  if (printed === null) return null;
  const offset = printedPageOffset(pdfPage, pageLabel);
  return printed + offset > 0 ? { pdfPage: printed + offset, offset } : null;
}

type Doc = { docId: string; sourceUrl: string; template: ManualChunk };

function retrievedDocs(chunks: readonly ManualChunk[]): Doc[] {
  const out = new Map<string, Doc>();
  for (const c of chunks) {
    if (!c.docId || !c.sourceUrl || out.has(c.docId)) continue;
    out.set(c.docId, { docId: c.docId, sourceUrl: c.sourceUrl, template: c });
  }
  return [...out.values()];
}

/**
 * The PDF page where each retrieved document's Safety chapter starts: from a retrieved chunk's own
 * reference first, else from any chunk of the same document (one bounded query). Pinned to the tenant, the
 * documents retrieval already admitted, and the same approval predicate retrieval uses.
 */
async function chapterStarts(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  docs: readonly Doc[],
  chunks: readonly ManualChunk[],
  approvedSourceDocIds: readonly string[],
): Promise<Map<string, ChapterStart>> {
  const starts = new Map<string, ChapterStart>();
  for (const c of chunks) {
    const start = c.docId ? chapterStart(c.content, c.sourcePage, c.pageLabel) : null;
    if (start !== null && c.docId && !starts.has(c.docId)) starts.set(c.docId, start);
  }
  const missing = docs.filter((d) => !starts.has(d.docId));
  if (missing.length === 0) return starts;
  // Bind the admission set only when the gate is on: with it off the filter emits no clause, and a
  // fourth value with no $4 placeholder is a Postgres error (same rule as retrieveNodeChunks).
  const approved = approvedSourceDocIds.filter(Boolean);
  const admitApproved = approved.length > 0 && approvalGateEnabled();
  const params: unknown[] = [tenantId, missing.map((d) => d.docId), SAFETY_CHAPTER_REF_SQL];
  if (admitApproved) params.push(approved);
  await client.query("SET LOCAL statement_timeout = '2s'");
  const res = await client.query(
    `SELECT DISTINCT ON (doc_id) doc_id::text AS doc_id, content,
            COALESCE(page_start, source_page) AS page,
            ${PAGE_LABEL_SQL}
       FROM knowledge_entries
      WHERE tenant_id = $1
        AND ingest_route = 'v2'
        ${approvedSourceFilterSql(admitApproved ? 4 : null)}
        AND doc_id::text = ANY($2::text[])
        AND content ~* $3
      ORDER BY doc_id, id`,
    params,
  );
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const pdfPage = r.page == null ? null : Number(r.page);
    const start = chapterStart(String(r.content ?? ""), pdfPage, r.page_label == null ? null : String(r.page_label));
    if (start !== null) starts.set(String(r.doc_id), start);
  }
  return starts;
}

/**
 * The warning chunks of each retrieved document's Safety chapter, as excerpts ready to append after
 * the retrieved chunks (so no existing citation number moves). Chunks retrieval already returned are
 * not repeated. Empty when no retrieved document refers to a Safety chapter.
 */
export async function retrieveSafetyChapterChunks(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  chunks: readonly ManualChunk[],
  opts: { approvedSourceDocIds?: string[] } = {},
): Promise<ManualChunk[]> {
  const docs = retrievedDocs(chunks);
  if (docs.length === 0) return [];
  const starts = await chapterStarts(client, tenantId, docs, chunks, opts.approvedSourceDocIds ?? []);
  const pages = docs.flatMap((d) => {
    const first = starts.get(d.docId);
    return first === undefined
      ? []
      : Array.from({ length: SAFETY_CHAPTER_SPAN }, (_, i) => ({ docId: d.docId, sourceUrl: d.sourceUrl, page: first.pdfPage + i }));
  });
  if (pages.length === 0) return [];
  const rows = await retrieveCitedPageChunks(client, tenantId, pages, {
    approvedSourceDocIds: opts.approvedSourceDocIds,
    keep: (t) => extractManualSafetyStatement(t) !== null,
  });
  // Group per document, page order within each. Dedupe is per document: two manuals with the same
  // boilerplate warning each keep their own citable copy.
  const keyOf = (sourceUrl: string, content: string) => `${sourceUrl}\u0000${content}`;
  const seen = new Set(chunks.map((c) => keyOf(c.sourceUrl ?? "", c.content)));
  const perDoc = new Map(docs.map((d) => [d.sourceUrl, [] as typeof rows] as const));
  for (const r of rows) {
    const list = perDoc.get(r.sourceUrl);
    const key = keyOf(r.sourceUrl, r.content);
    if (!list || seen.has(key)) continue;
    seen.add(key);
    list.push(r);
  }
  // Retrieval order across documents, page order within each. sourcePage stays the PDF page (rereads
  // and citation keys use it); pageLabel is the manual's printed page (Codex #5056 r4 F8).
  return docs.flatMap((d) => {
    const offset = starts.get(d.docId)?.offset ?? 0;
    return perDoc
      .get(d.sourceUrl)!
      .sort((a, b) => a.sourcePage - b.sourcePage)
      .map((r) => ({
        ...d.template,
        content: r.content,
        sourcePage: r.sourcePage,
        pageLabel: String(r.sourcePage - offset > 0 ? r.sourcePage - offset : r.sourcePage),
        chunkIndex: null,
        rank: 0,
      }));
  });
}

/** The prompt rule that rides with the chapter excerpts; only sent when some were added. */
export const SAFETY_CHAPTER_DIRECTIVE = `

SAFETY CHAPTER — this turn's excerpts include pages from the manual's own Safety chapter, which the manual says applies to work on this equipment:
- When your answer tells the technician to physically work on the equipment, its cabling or its wiring, include the Safety chapter's applicable steps in that answer, in the manual's own terms (its stated wait time, how to verify no voltage, which circuits to isolate), and cite the Safety chapter page.
- Do not cite the Safety chapter for an answer that involves no physical work.`;
