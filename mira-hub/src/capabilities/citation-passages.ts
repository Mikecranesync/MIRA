/**
 * Citation integrity (#5955): which page a citation may SHOW, and which passages are the same.
 *
 * Two corruptions put a wrong page on a citation chip, and both were shipped as fact:
 *   1. Legacy ingest stamped `source_page` with the chunk ORDINAL (p.715, p.1254 on a 274-page
 *      manual). A row is that shape exactly when `sourcePage === chunkIndex` (#2910).
 *   2. A legacy copy stamped EVERY row of a document with one page (989 rows of the PowerFlex 525
 *      all `source_page = 1`), so the chip says p.1 — the cover — for a fact on p.161.
 *
 * The stored value can be neither repaired nor guessed here: the true page is not recoverable
 * from the row. So the rule is conservative and display-only (nothing stored is changed):
 * a page that cannot be shown to be real is UNKNOWN — no page label, no page deep-link — and the
 * answer text is untouched.
 *
 * What counts as trustworthy page provenance:
 *   - ANCHORED: the row carries `page_start`, which the v2 ingest (node-knowledge-ingest.ts)
 *     writes from the PDF page it actually read. An anchored row's page is trusted, including
 *     in a genuinely one-page document. (`page_start` is the only explicit marker; the legacy
 *     `source_page` column is not one — it is where both corruptions live.)
 *   - Otherwise the DOCUMENT must show page diversity: at least two distinct pages across every
 *     authorized, approved row of that document (not the retrieved top-K), and fewer than half
 *     its rows ordinal-stamped. Counting is a necessary signal, never sufficient proof — a
 *     document that shows it is trusted only as far as its stamps are unproven; a one-page or
 *     one-row document with no anchor stays UNKNOWN because the count cannot tell a real
 *     one-page document from an all-page-1 stamp.
 * A chunk that is itself `sourcePage === chunkIndex` is unknown even inside a trusted document.
 *
 * Identity: `passageKey` is the ONE key the model's `[n]` context blocks, the source chips, the
 * route's citations, the quote/safety/shadow re-derivations and the cited match all group by, so
 * `[n]` means the same passage everywhere. A known page identifies a passage by (document, page);
 * an unknown page identifies it by (document, content), so several distinct passages of one
 * document with no page all survive, and the same passage twice still collapses.
 */
import { createHash } from "node:crypto";
import { displayPage } from "@/capabilities/citation-page-display";

export type PageTrust = "trusted" | "unknown";

/** The chunk fields page display and passage identity read (a subset of ManualChunk). */
export type PassageChunk = {
  content: string;
  docId?: string | null;
  sourceUrl: string;
  sourcePage: number | null;
  chunkIndex?: number | null;
  /** `page_start` supplied this row's page (real PDF page from v2 ingest). */
  pageAnchored?: boolean;
  /** The document-level verdict, set by `annotatePageTrust`; absent = never assessed. */
  pageTrust?: PageTrust;
};

export { displayPage };

const digest = (text: string) => createHash("sha1").update(text.replace(/\s+/g, " ").trim()).digest("hex");

/** Stable identity of the passage a chunk is. See the module header. */
export function passageKey(c: PassageChunk): string {
  const doc = `${c.docId ?? ""}\u0000${c.sourceUrl ?? ""}`;
  const page = displayPage(c);
  return page != null ? `${doc}\u0000p${page}` : `${doc}\u0000x${digest(c.content ?? "")}`;
}

/** Chunks grouped by passage in first-appearance order: citation number n is group n. */
export function groupPassages<T extends PassageChunk>(chunks: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const c of chunks) {
    const k = passageKey(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.values()];
}

/** passageKey → 1-based citation number. */
export function citationIndex(chunks: readonly PassageChunk[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (const c of chunks) {
    const k = passageKey(c);
    if (!idx.has(k)) idx.set(k, idx.size + 1);
  }
  return idx;
}

// ── document page facts ──────────────────────────────────────────────────────

export type DocumentPageFact = {
  rows: number;
  /** rows whose page comes from `page_start`. */
  anchored: number;
  /** distinct effective pages (COALESCE(page_start, source_page)). */
  pages: number;
  /** unanchored rows stamped with their own chunk ordinal. */
  ordinal: number;
};

/** A document with no anchored provenance is trusted only on diversity. */
export function documentPagesTrusted(f: DocumentPageFact | undefined): boolean {
  if (!f || f.rows <= 0) return false;
  const unanchored = f.rows - f.anchored;
  if (unanchored <= 0) return true;
  if (f.pages < 2) return false;
  return f.ordinal * 2 < unanchored;
}

/** Document identity for facts: the document id when the row has one, else its source address. */
export const documentFactKey = (c: Pick<PassageChunk, "docId" | "sourceUrl">): string =>
  c.docId ? `d:${c.docId}` : `u:${c.sourceUrl ?? ""}`;

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export type PageFactApproval = {
  /** SQL fragment ("AND …" or "") for rows keyed by document id; `p` is the first free param index. */
  forDocs: (p: number) => string;
  /** Extra params bound after the fixed ones, in `forDocs`'s order. */
  docParams: unknown[];
  /** SQL fragment for shared rows keyed by source address. */
  forUrls: string;
};

/**
 * ONE or TWO grouped reads over every authorized, approved row of the documents the chunks name
 * (never one query per chunk, never the retrieved sample). Scope = the retrieval's own: shared
 * rows or the caller's tenant, plus its approval predicate. Address-keyed facts count only
 * shared (`is_private = false`) rows with no document id, so a private row or another tenant's
 * row that happens to share a `source_url` can neither pool into nor skew a public document.
 */
export async function loadDocumentPageFacts(
  client: Queryable,
  tenantId: string,
  chunks: readonly PassageChunk[],
  approval: PageFactApproval,
): Promise<Map<string, DocumentPageFact>> {
  const docIds = new Set<string>();
  const urls = new Set<string>();
  for (const c of chunks) {
    if (c.pageAnchored) continue;
    if (c.docId) docIds.add(c.docId);
    else if (c.sourceUrl) urls.add(c.sourceUrl);
  }
  const AGG = `count(*)::int AS rows,
        count(*) FILTER (WHERE page_start IS NOT NULL)::int AS anchored,
        count(DISTINCT COALESCE(page_start, source_page))::int AS pages,
        count(*) FILTER (WHERE page_start IS NULL AND source_page IS NOT NULL
          AND CASE WHEN metadata->>'chunk_index' ~ '^[0-9]{1,9}$' THEN source_page = (metadata->>'chunk_index')::int ELSE false END)::int AS ordinal`;
  const out = new Map<string, DocumentPageFact>();
  const take = (rows: Record<string, unknown>[], prefix: string) => {
    for (const r of rows) {
      out.set(`${prefix}${String(r.k)}`, {
        rows: Number(r.rows),
        anchored: Number(r.anchored),
        pages: Number(r.pages),
        ordinal: Number(r.ordinal),
      });
    }
  };
  if (docIds.size > 0) {
    const params: unknown[] = [tenantId, [...docIds], ...approval.docParams];
    const res = await client.query(
      `SELECT doc_id::text AS k, ${AGG}
         FROM knowledge_entries
        WHERE (is_private = false OR tenant_id = $1)
          AND doc_id = ANY($2::uuid[])
          ${approval.forDocs(3)}
        GROUP BY doc_id`,
      params,
    );
    take(res.rows, "d:");
  }
  if (urls.size > 0) {
    const res = await client.query(
      `SELECT source_url AS k, ${AGG}
         FROM knowledge_entries
        WHERE is_private = false
          AND doc_id IS NULL
          AND source_url = ANY($1::text[])
          ${approval.forUrls}
        GROUP BY source_url`,
      [[...urls]],
    );
    take(res.rows, "u:");
  }
  return out;
}

/**
 * Stamp each chunk with the page-trust verdict of its document. Anchored chunks are trusted
 * without any read. Failure direction: if the facts cannot be read, every unanchored chunk is
 * UNKNOWN (a withheld page label), never a guessed one, and the turn is not failed.
 */
export async function annotatePageTrust<T extends PassageChunk>(
  client: Queryable,
  tenantId: string,
  chunks: T[],
  approval: PageFactApproval,
  /** Inside a transaction (the notebook path runs under withTenantContext) a failed read would
   *  abort the whole transaction; a savepoint confines the failure to this read. */
  opts: { savepoint?: boolean } = {},
): Promise<T[]> {
  if (chunks.length === 0) return chunks;
  let facts: Map<string, DocumentPageFact> | null = null;
  if (chunks.some((c) => !c.pageAnchored)) {
    const sp = opts.savepoint ? "cit_page_facts" : null;
    try {
      if (sp) await client.query(`SAVEPOINT ${sp}`);
      facts = await loadDocumentPageFacts(client, tenantId, chunks, approval);
      if (sp) await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
      if (sp) {
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        } catch {
          /* connection already unusable: the caller's own error handling owns it */
        }
      }
      console.warn("[citation-integrity] document page facts unreadable (pages withheld):", err instanceof Error ? err.message : err);
    }
  }
  return chunks.map((c) => ({
    ...c,
    pageTrust: c.pageAnchored || (facts !== null && documentPagesTrusted(facts.get(documentFactKey(c)))) ? "trusted" : "unknown",
  }));
}
