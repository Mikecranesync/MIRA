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
 * from the referring chunk's own printed label (front matter shifts it). Hub uploads store no label,
 * so then the printed page is found in the document itself: the PDF page, at most
 * SAFETY_CHAPTER_MAX_SHIFT pages after the printed number, whose running header or footer prints
 * that number, with a neighbouring page printing the next or previous number (#5059 Codex r2 F1).
 * Only the first line of a page's first chunk and the last line of its last chunk count, a line
 * longer than HEADER_MAX_CHARS or with a contents leader (". . .") never does. When no page proves
 * the mapping the document adds nothing: the offset is never assumed.
 *
 * The chapter is read by its own bounded query, not #4509's notice reader (that one stops at the first
 * statement per page, which is right for a notice and wrong for grounding, Codex #5056 r5 F11). Each
 * page keeps at most SAFETY_CHAPTER_ROWS_PER_PAGE rows, ranked so real safety statements come first
 * and, among them, the ones carrying a procedure (wait time, voltage check, isolation). Each manual
 * then gets SAFETY_CHAPTER_BUDGET_CHARS of excerpt text, filled procedure-first, emitted in page
 * order. Rounds 1, 3, 4 and 5 all showed that a bound which ignores content can cut the procedure.
 *
 * Read-only and fail-open: no write, and the caller keeps the retrieved chunks on any error.
 */
import type { PoolClient } from "pg";
import { extractManualSafetyStatement } from "@/capabilities/manual-safety-statement";
import {
  approvalGateEnabled,
  approvedSourceFilterSql,
  MAX_CONTENT_CHARS,
  PAGE_LABEL_SQL,
  type ManualChunk,
} from "@/lib/manual-rag";

/** One grammar for both matchers: an optional straight or curly quote around "Safety". */
const QUOTE = '["\u201c\u201d]?';
/** "chapter Safety on page 17" — the manual's cross-reference to its own Safety chapter. */
export const SAFETY_CHAPTER_REF = new RegExp(`\\bchapter\\s+${QUOTE}safety${QUOTE}\\s+on\\s+page\\s+(\\d{1,4})\\b`, "i");
/** The same reference as a Postgres regex, for the document-level lookup (no \\b: it means backspace there). */
export const SAFETY_CHAPTER_REF_SQL = `chapter\\s+${QUOTE}safety${QUOTE}\\s+on\\s+page\\s+[0-9]{1,4}`;
/** Pages read from the referenced first page on (ACS355: 17 opens the chapter, 18-20 hold the warnings). */
export const SAFETY_CHAPTER_SPAN = 4;
/** Rows read per chapter page, after ranking: bounds memory against a dense or hostile upload. */
export const SAFETY_CHAPTER_ROWS_PER_PAGE = 40;
/** Excerpt characters per manual (each chunk counted as the prompt renders it): bounds the prompt. */
export const SAFETY_CHAPTER_BUDGET_CHARS = 6_000;
/**
 * A line opening with a printed safety marker, as extractManualSafetyStatement reads it. One string for
 * Postgres (case-sensitive ~) and JS, so the SQL ranking and the JS check agree.
 */
export const SAFETY_MARKER_LINE = "(^|\\n)[\\s•*▪●■◆►▶⚠!-]*(WARNING|DANGER|CAUTION|ATTENTION|SHOCK HAZARD|BURN HAZARD)[:!\\s]";
/**
 * The prerequisite steps a hands-on answer must carry, one pattern per kind: wait time, discharge, and
 * the zero-voltage check. A chunk ranks by how many kinds it names, so generic isolation warnings can
 * never tie with it. One string each for Postgres (~*) and JS (flag i).
 */
export const SAFETY_PREREQUISITE_KINDS = ["wait|minute", "discharg", "measur|multimeter|voltage"];
/** Isolation words: a procedure, but ranked below every chunk that names a prerequisite kind. */
export const SAFETY_ISOLATION_WORDS = "isolat|disconnect|lock.?out|de-?energi";
const PREREQUISITE_RES = SAFETY_PREREQUISITE_KINDS.map((k) => new RegExp(k, "i"));
const ISOLATION_RE = new RegExp(SAFETY_ISOLATION_WORDS, "i");

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

/** How many pages of front matter may sit before printed page 1 when the printed page is found from headers. */
export const SAFETY_CHAPTER_MAX_SHIFT = 40;
/** A running header or footer is short; a longer line is body text. */
const HEADER_MAX_CHARS = 60;

/** A printed chapter reference: the printed page, and the offset when the chunk's own label gives it. */
type ChapterRef = { printed: number; offset: number | null };

function chapterRef(text: string, pdfPage: number | null, pageLabel: string | null | undefined): ChapterRef | null {
  const printed = safetyChapterPage(text);
  if (printed === null) return null;
  const numericLabel = pdfPage !== null && Number.isInteger(pdfPage) && /^\d{1,4}$/.test(String(pageLabel ?? "").trim());
  return { printed, offset: numericLabel ? printedPageOffset(pdfPage, pageLabel) : null };
}

/** The standalone page numbers a header or footer line prints; none for body text or a contents leader. */
export function headerPageNumbers(line: string): number[] {
  const l = line.trim();
  if (l.length === 0 || l.length > HEADER_MAX_CHARS || /\.\s*\.\s*\./.test(l)) return [];
  return [...l.matchAll(/(?:^|\s)(\d{1,4})(?=\s|$)/g)].map((m) => Number(m[1]));
}

/**
 * The PDF page that prints `printed`, from each page's first and last line (rows in chunk order):
 * the lowest page in [printed, printed + SAFETY_CHAPTER_MAX_SHIFT] that shows the number while a
 * neighbouring page shows the next or previous one. Null when no page proves it.
 */
export function pdfPageForPrinted(
  printed: number,
  rows: ReadonlyArray<{ page: number; first_line: string; last_line: string }>,
): number | null {
  const shows = new Map<number, Set<number>>();
  const firstSeen = new Set<number>();
  const lastOf = new Map<number, string>();
  for (const r of rows) {
    const set = shows.get(r.page) ?? new Set<number>();
    if (!firstSeen.has(r.page)) {
      firstSeen.add(r.page);
      for (const n of headerPageNumbers(r.first_line)) set.add(n);
    }
    lastOf.set(r.page, r.last_line);
    shows.set(r.page, set);
  }
  for (const [page, line] of lastOf) for (const n of headerPageNumbers(line)) shows.get(page)!.add(n);
  const has = (page: number, n: number) => shows.get(page)?.has(n) ?? false;
  for (let p = printed; p <= printed + SAFETY_CHAPTER_MAX_SHIFT; p++) {
    if (has(p, printed) && (has(p + 1, printed + 1) || has(p - 1, printed - 1))) return p;
  }
  return null;
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
  const refs = new Map<string, ChapterRef>();
  for (const c of chunks) {
    const ref = c.docId ? chapterRef(c.content, c.sourcePage, c.pageLabel) : null;
    if (ref !== null && c.docId && !refs.has(c.docId)) refs.set(c.docId, ref);
  }
  // Bind the admission set only when the gate is on: with it off the filter emits no clause, and an
  // extra value with no placeholder is a Postgres error (same rule as retrieveNodeChunks).
  const approved = approvedSourceDocIds.filter(Boolean);
  const admitApproved = approved.length > 0 && approvalGateEnabled();
  const missing = docs.filter((d) => !refs.has(d.docId));
  if (missing.length > 0) await lookupRefs(client, tenantId, missing, refs, admitApproved, approved);
  return resolveStarts(client, tenantId, refs, admitApproved, approved);
}

/** References from any chunk of the documents no retrieved chunk referred from (one bounded query). */
async function lookupRefs(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  missing: readonly Doc[],
  refs: Map<string, ChapterRef>,
  admitApproved: boolean,
  approved: readonly string[],
): Promise<void> {
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
    const ref = chapterRef(String(r.content ?? ""), pdfPage, r.page_label == null ? null : String(r.page_label));
    if (ref !== null) refs.set(String(r.doc_id), ref);
  }
}

/**
 * Each reference's PDF start page: from the label offset when there is one, else from the pages'
 * own printed numbers (one bounded query for every unlabelled document). A document whose printed
 * page cannot be proven, or whose start falls before page 1, is left out.
 */
async function resolveStarts(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  refs: ReadonlyMap<string, ChapterRef>,
  admitApproved: boolean,
  approved: readonly string[],
): Promise<Map<string, ChapterStart>> {
  const starts = new Map<string, ChapterStart>();
  const unlabelled: Array<[string, number]> = [];
  for (const [docId, ref] of refs) {
    if (ref.offset === null) unlabelled.push([docId, ref.printed]);
    else if (ref.printed + ref.offset > 0) starts.set(docId, { pdfPage: ref.printed + ref.offset, offset: ref.offset });
  }
  if (unlabelled.length === 0) return starts;
  const params: unknown[] = [
    tenantId,
    unlabelled.map(([d]) => d),
    unlabelled.map(([, n]) => Math.max(1, n - 1)),
    unlabelled.map(([, n]) => n + SAFETY_CHAPTER_MAX_SHIFT + 1),
  ];
  if (admitApproved) params.push(approved);
  await client.query("SET LOCAL statement_timeout = '2s'");
  const res = await client.query(
    // Only each page's first and last chunk come back (at most 2 rows per page, 86 per document), so
    // the LIMIT cannot cut a later document's pages short.
    `SELECT doc_id, page, first_line, last_line
       FROM (
         SELECT doc_id::text AS doc_id, COALESCE(page_start, source_page) AS page, id,
                ${CHUNK_INDEX_SQL} AS chunk_index,
                left(split_part(content, E'\\n', 1), 200) AS first_line,
                right(regexp_replace(content, '^.*\\n', ''), 200) AS last_line,
                ROW_NUMBER() OVER (PARTITION BY doc_id, COALESCE(page_start, source_page)
                                   ORDER BY ${CHUNK_INDEX_SQL} NULLS LAST, id) AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY doc_id, COALESCE(page_start, source_page)
                                   ORDER BY ${CHUNK_INDEX_SQL} DESC NULLS FIRST, id DESC) AS rn_last
           FROM knowledge_entries
          WHERE tenant_id = $1
            AND ingest_route = 'v2'
            ${approvedSourceFilterSql(admitApproved ? 5 : null)}
            AND (doc_id::text, COALESCE(page_start, source_page)) IN (
              SELECT w.doc, g FROM unnest($2::text[], $3::int[], $4::int[]) AS w(doc, lo, hi), generate_series(w.lo, w.hi) AS g
            )
       ) edges
      WHERE rn_first = 1 OR rn_last = 1
      ORDER BY doc_id, page, chunk_index NULLS LAST, id
      LIMIT 5000`,
    params,
  );
  const byDoc = new Map<string, Array<{ page: number; first_line: string; last_line: string }>>();
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const list = byDoc.get(String(r.doc_id)) ?? [];
    list.push({ page: Number(r.page), first_line: String(r.first_line ?? ""), last_line: String(r.last_line ?? "") });
    byDoc.set(String(r.doc_id), list);
  }
  for (const [docId, printed] of unlabelled) {
    const pdfPage = pdfPageForPrinted(printed, byDoc.get(docId) ?? []);
    if (pdfPage !== null) starts.set(docId, { pdfPage, offset: pdfPage - printed });
  }
  return starts;
}

type ChapterRow = { id: string; content: string; sourceUrl: string; sourcePage: number; chunkIndex: number | null };

/** The chunk's position within its upload (ingest writes it on every v2 row); NULL when absent or not an integer. */
const CHUNK_INDEX_SQL = "CASE WHEN metadata->>'chunk_index' ~ '^[0-9]+$' THEN (metadata->>'chunk_index')::int END";

/**
 * Every chapter page's rows in ONE query, at most SAFETY_CHAPTER_ROWS_PER_PAGE per page, ranked
 * marker line first, then prerequisite kinds named, then isolation words, then chunk order. No early
 * exit and no keyword filter: a page is read whole up to its rank cap, because ingest splits a page
 * into ~1000-character chunks and a warning's later steps land in chunks with no marker or keyword
 * of their own (#5059 Codex r1 F1). Pinned like retrieval: tenant, v2 route, the admitted (doc, file, page) tuples, and
 * the approval predicate (the admission set bound only with the gate on).
 */
async function readChapterRows(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  pages: ReadonlyArray<{ docId: string; sourceUrl: string; page: number }>,
  approvedSourceDocIds: readonly string[],
): Promise<ChapterRow[]> {
  const approved = approvedSourceDocIds.filter(Boolean);
  const admitApproved = approved.length > 0 && approvalGateEnabled();
  const params: unknown[] = [
    tenantId,
    pages.map((p) => p.docId),
    pages.map((p) => p.sourceUrl),
    pages.map((p) => p.page),
    SAFETY_MARKER_LINE,
    SAFETY_PREREQUISITE_KINDS,
    SAFETY_ISOLATION_WORDS,
    SAFETY_CHAPTER_ROWS_PER_PAGE,
  ];
  if (admitApproved) params.push(approved);
  await client.query("SET LOCAL statement_timeout = '3s'");
  const res = await client.query(
    `SELECT id::text AS id, content, source_url, page, chunk_index
       FROM (
         SELECT id, content, source_url, COALESCE(page_start, source_page) AS page,
                ${CHUNK_INDEX_SQL} AS chunk_index,
                ROW_NUMBER() OVER (
                  PARTITION BY source_url, COALESCE(page_start, source_page)
                  ORDER BY (content ~ $5) DESC,
                           (SELECT count(*) FROM unnest($6::text[]) AS kind WHERE content ~* kind) DESC,
                           (content ~* $7) DESC, ${CHUNK_INDEX_SQL} NULLS LAST, id
                ) AS rn
           FROM knowledge_entries
          WHERE tenant_id = $1
            AND ingest_route = 'v2'
            ${approvedSourceFilterSql(admitApproved ? 9 : null)}
            AND (doc_id::text, source_url, COALESCE(page_start, source_page)) IN (
              SELECT * FROM unnest($2::text[], $3::text[], $4::int[])
            )
       ) ranked
      WHERE rn <= $8
      ORDER BY source_url, page, chunk_index NULLS LAST, id`,
    params,
  );
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id ?? ""),
    content: String(r.content ?? ""),
    sourceUrl: String(r.source_url ?? ""),
    sourcePage: Number(r.page),
    chunkIndex: r.chunk_index === null || r.chunk_index === undefined ? null : Number(r.chunk_index),
  }));
}

/** Prerequisite kinds a chunk names (0-3), then whether it names isolation: the read's rank, in JS. */
function procedureRank(content: string): [number, number] {
  return [PREREQUISITE_RES.filter((re) => re.test(content)).length, ISOLATION_RE.test(content) ? 1 : 0];
}

/** Page, then chunk order (a row without a chunk index after those with one), then id. */
function byPage(a: ChapterRow, b: ChapterRow): number {
  const ca = a.chunkIndex ?? Number.MAX_SAFE_INTEGER;
  const cb = b.chunkIndex ?? Number.MAX_SAFE_INTEGER;
  return a.sourcePage - b.sourcePage || ca - cb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * One page's rows as warning runs: a chunk holding a safety statement starts a run, and the chunks
 * that follow it on the page (by chunk index) continue it, since ingest split one page's text into
 * them (#5059 Codex r1 F1). A row without a chunk index cannot be placed, so it stands alone and only
 * if it holds a statement. Chunks before the page's first statement are not part of any warning.
 */
function warningRuns(pageRows: readonly ChapterRow[]): ChapterRow[][] {
  const runs: ChapterRow[][] = [];
  let open: ChapterRow[] | null = null;
  for (const r of [...pageRows].sort(byPage)) {
    const statement = extractManualSafetyStatement(r.content) !== null;
    if (r.chunkIndex === null) {
      open = null;
      if (statement) runs.push([r]);
    } else if (open && !statement) {
      open.push(r);
    } else if (statement) {
      open = [r];
      runs.push(open);
    }
  }
  return runs;
}

/**
 * One manual's warning runs within its budget, filled by procedure rank (most prerequisite kinds
 * first, across the whole run), then page order. A run is spent in chunk order and stops at the
 * first chunk that no longer fits, so a warning is never kept without the steps before its last kept
 * chunk.
 */
function withinBudget(runs: readonly ChapterRow[][]): ChapterRow[] {
  const ranked = runs.map((run) => ({ run, rank: procedureRank(run.map((r) => r.content).join("\n")) }));
  ranked.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || byPage(a.run[0], b.run[0]));
  const picked: ChapterRow[] = [];
  let used = 0;
  for (const { run } of ranked) {
    for (const r of run) {
      const cost = Math.min(r.content.length, MAX_CONTENT_CHARS);
      if (used + cost > SAFETY_CHAPTER_BUDGET_CHARS) break;
      used += cost;
      picked.push(r);
    }
  }
  return picked.sort(byPage);
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
  const rows = await readChapterRows(client, tenantId, pages, opts.approvedSourceDocIds ?? []);
  // Warning runs per page (a statement chunk and its continuations); dedupe per document, so two
  // manuals with the same boilerplate warning each keep their own citable copy.
  const keyOf = (sourceUrl: string, content: string) => `${sourceUrl}\u0000${content}`;
  const seen = new Set(chunks.map((c) => keyOf(c.sourceUrl ?? "", c.content)));
  const byDocPage = new Map<string, ChapterRow[]>();
  for (const r of rows) byDocPage.set(`${r.sourceUrl}\u0000${r.sourcePage}`, [...(byDocPage.get(`${r.sourceUrl}\u0000${r.sourcePage}`) ?? []), r]);
  const perDoc = new Map(docs.map((d) => [d.sourceUrl, [] as ChapterRow[][]] as const));
  for (const pageRows of byDocPage.values()) {
    const list = perDoc.get(pageRows[0].sourceUrl);
    if (!list) continue;
    for (const run of warningRuns(pageRows)) {
      const fresh = run.filter((r) => {
        const key = keyOf(r.sourceUrl, r.content);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length > 0) list.push(fresh);
    }
  }
  // Retrieval order across documents, page order within each. sourcePage stays the PDF page (rereads
  // and citation keys use it); pageLabel is the manual's printed page (Codex #5056 r4 F8).
  return docs.flatMap((d) => {
    const offset = starts.get(d.docId)?.offset ?? 0;
    return withinBudget(perDoc.get(d.sourceUrl)!).map((r) => ({
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
