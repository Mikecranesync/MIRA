import type { PoolClient } from "pg";

/**
 * Page-split passage stitch (notebook retrieval).
 *
 * Hub ingest chunks each PDF page independently (`chunkText(pageText)`), so a
 * sentence or table that crosses a page break — or two chunks of one long page —
 * is stored as separate rows. Retrieval then ranks one half and never sees the
 * other. At read time, when a top-ranked chunk ends mid-passage, pull the next
 * adjacent chunk from the SAME tenant + document (same page or the next page)
 * and merge it into the evidence window. No re-ingest; existing manuals work.
 *
 * Neighbor reads reuse the retrieveNodeChunks scope shape (tenant_id, v2,
 * optional node/doc/approval clauses) — a strict subset of docs already in the
 * ranked window, never a corpus-wide widening. Same pinning pattern as #4469's
 * per-doc candidate windows / correlated heading read: same-tenant AND same-doc.
 */

export type PageSplitNeighborRow = {
  content: string;
  doc_id: string;
  source_url: string;
  source_page: number | null;
  page_start: number | null;
  section_path: string | null;
  filename: string | null;
  chunk_index: number | null;
  verified: boolean;
};

/** True when `content` looks like a truncated passage, not a finished sentence. */
export function endsMidPassage(content: string): boolean {
  const t = content.trim();
  if (t.length < 12) return false;
  // Finished sentence / paragraph. Optional trailing quote or bracket.
  if (/[.!?]["'”’)\]]?\s*$/.test(t)) return false;
  return true;
}

export function neighborPage(row: Pick<PageSplitNeighborRow, "page_start" | "source_page">): number | null {
  if (row.page_start != null) return Number(row.page_start);
  if (row.source_page != null) return Number(row.source_page);
  return null;
}

/** Dedupe key for the evidence window. Uses the FULL content: a prefix would
 *  collide for two chunks on one page that open the same way (repeated table
 *  headers), and the stitch would then skip the real continuation. */
export function evidenceKey(docId: string | null | undefined, page: number | null, content: string): string {
  return `${docId ?? ""}|${page ?? ""}|${content}`;
}

/**
 * The immediate next chunk after `current` in the same document: later on the
 * same page, or the first chunk of the next page. Neighbors must already be
 * ordered by page, chunk_index, id.
 */
export function pickNextAdjacentChunk(
  current: { docId: string; sourcePage: number; content: string },
  neighbors: PageSplitNeighborRow[],
): PageSplitNeighborRow | null {
  const sameDoc = neighbors.filter((row) => String(row.doc_id) === current.docId);
  if (sameDoc.length === 0) return null;

  const here = sameDoc.findIndex(
    (row) => neighborPage(row) === current.sourcePage && String(row.content) === current.content,
  );
  if (here >= 0) {
    const next = sameDoc[here + 1];
    if (!next) return null;
    const page = neighborPage(next);
    if (page == null) return null;
    if (page !== current.sourcePage && page !== current.sourcePage + 1) return null;
    if (String(next.content) === current.content) return null;
    return next;
  }

  const samePage = sameDoc.find(
    (row) => neighborPage(row) === current.sourcePage && String(row.content) !== current.content,
  );
  if (samePage) return samePage;
  const nextPage = sameDoc.find((row) => neighborPage(row) === current.sourcePage + 1);
  return nextPage ?? null;
}

/**
 * Fetch every v2 chunk on the truncated hits' pages and the next pages, pinned
 * to this tenant and the retrieved document ids. Callers supply the same
 * node/approval predicates retrieveNodeChunks used so the stitch cannot outrun
 * the ranked window's scope.
 */
export async function fetchPageSplitNeighbors(
  client: PoolClient,
  opts: {
    tenantId: string;
    docIds: string[];
    pages: number[];
    nodeIds: string[];
    docScopeOnly: boolean;
    admitApproved: boolean;
    approvedSourceDocIds: string[];
    approvalClause: string;
  },
): Promise<PageSplitNeighborRow[]> {
  if (opts.docIds.length === 0 || opts.pages.length === 0) return [];

  const nodeClause = opts.docScopeOnly
    ? "AND ($4::text[] IS NOT NULL)"
    : "AND (metadata->>'node_id') = ANY($4::text[])";
  const params: unknown[] = [opts.tenantId, opts.docIds, opts.pages, opts.nodeIds];
  if (opts.admitApproved) params.push(opts.approvedSourceDocIds);

  const res = await client.query(
    `SELECT
        content,
        doc_id::text AS doc_id,
        source_url,
        source_page,
        page_start,
        section_path,
        metadata->>'filename' AS filename,
        (metadata->>'chunk_index')::int AS chunk_index,
        verified
      FROM knowledge_entries
      WHERE tenant_id = $1
        AND ingest_route = 'v2'
        ${opts.approvalClause}
        ${nodeClause}
        AND doc_id = ANY($2::uuid[])
        AND COALESCE(page_start, source_page) = ANY($3::int[])
      ORDER BY doc_id, page_start NULLS LAST, source_page NULLS LAST,
        (metadata->>'chunk_index')::int NULLS LAST, id`,
    params,
  );
  return res.rows as PageSplitNeighborRow[];
}
