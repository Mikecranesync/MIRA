/**
 * One-hop "see page N" expansion for the notebook (v2) path (#6030 F2/F3).
 *
 * When a passage retrieval already admitted says "see page 45", the page it points to can hold the
 * answer and still sit outside the top-K. This reads that page, BEFORE the citations and the prompt
 * are frozen, so the same evidence set drives the prompt, the source chips, the cited-page safety
 * read and the answer validators. Nothing here changes ranking: retrieval is untouched and the
 * added chunks carry rank 0.
 *
 * What a reference means:
 *  - It names a PRINTED page. The physical page is the one PDF page whose stored `page_label`
 *    (the PDF's own /PageLabels, saved at ingest — the same source manual-safety-chapter.ts uses) is
 *    that printed number, within the referring chunk's OWN document. No label, or two pages with
 *    that label, and the reference adds nothing: an offset is never guessed and "printed N" is never
 *    assumed to be "PDF page N". The physical page stays the citation page (`sourcePage`).
 *  - A section number is NOT a page; section references are never followed (no authoritative
 *    section-to-page mapping exists in a chunk pool).
 *  - "Same manual" is the originating document identity AND file: targets are (doc_id, source_url,
 *    label) tuples bound with unnest, never the cross product of a set of pages and a set of URLs.
 *  - The read is pinned to the tenant, the v2 route, the validated notebook document set and the
 *    approval predicate retrieval uses, so it can neither widen scope nor admit an unselected,
 *    unapproved or other-tenant row.
 *
 * Supported lane: notebook (v2) chunks that carry a docId. Shared-OEM rows have no docId and are not
 * expanded. One hop only: references found in the added pages are never followed. Read-only and
 * fail-open at the caller: on any error the turn keeps exactly the retrieved chunks.
 */
import type { PoolClient } from "pg";
import { exactModelKey } from "@/capabilities/table-rows";
import { approvalGateEnabled, approvedSourceFilterSql, PAGE_LABEL_SQL, tableExclusionFor, type ManualChunk } from "@/lib/manual-rag";

/** Printed-page targets per turn, across all documents. */
export const REFERENCE_MAX_TARGETS = 5;
/** Chunks read per target page (ingest splits a page into ~1000-character chunks). */
export const REFERENCE_ROWS_PER_PAGE = 8;
/** Chunks added per turn, in total. */
export const REFERENCE_MAX_ROWS = 20;
/** Wall-clock bound across the two queries, enforced on each query's own timeout and re-checked after each. */
export const REFERENCE_DEADLINE_MS = 4_000;
/** Per-query ceilings; each is also capped by what is left of REFERENCE_DEADLINE_MS. */
export const REFERENCE_LABEL_TIMEOUT_MS = 2_000;
export const REFERENCE_PAGE_TIMEOUT_MS = 3_000;

export type PageReference = { docId: string; sourceUrl: string; label: string };

// A printed page label token: digits, optionally "N-M" (chapter-section labels such as "2-15" are
// exact labels, never numeric ranges). The lookahead rejects "17A" and "17.5".
const LABEL = "[0-9]{1,4}(?:-[0-9]{1,4})?";
const END = "(?![0-9A-Za-z_]|\\.[0-9])";
const VERB = "(?:see|refer(?:s)?\\s+to|consult|check)";
const SINGLE_RE = new RegExp(`\\b${VERB}\\s+(?:page|p\\.?)\\s*(${LABEL})${END}`, "gi");
const LIST_RE = new RegExp(
  `\\b${VERB}\\s+(?:pages|pp\\.?)\\s*(${LABEL}(?:\\s*(?:,\\s*and|,|and|&)\\s*${LABEL})+)${END}`,
  "gi",
);
const AND_PAGE_RE = new RegExp(`\\b(?:and|&)\\s+(?:page|p\\.?)\\s*(${LABEL})${END}`, "gi");
const SECTION_RE = /\b(?:see|refer(?:s)?\s+to|consult|check)\s+(?:section|sec\.?|§)\s*[0-9][0-9.]*/gi;

/** The printed page labels a text points to, in order of appearance (deduped), and whether it also points to sections. */
export function extractPageReferences(text: string): { labels: string[]; sectionRefs: number } {
  const hits: Array<{ at: number; label: string }> = [];
  for (const m of text.matchAll(LIST_RE)) {
    let at = m.index ?? 0;
    for (const part of m[1].split(/\s*(?:,\s*and|,|and|&)\s*/i)) {
      const label = part.trim();
      if (label) hits.push({ at: at++, label });
    }
  }
  for (const m of text.matchAll(SINGLE_RE)) {
    const at = m.index ?? 0;
    hits.push({ at, label: m[1] });
    // "see page 15 for specs and page 20 for wiring": a coordinated page in the same sentence.
    const rest = text.slice(at + m[0].length);
    const sentence = rest.split(/[.;](?=\s|$)/)[0];
    for (const c of sentence.matchAll(AND_PAGE_RE)) hits.push({ at: at + m[0].length + (c.index ?? 0), label: c[1] });
  }
  hits.sort((a, b) => a.at - b.at);
  const labels: string[] = [];
  for (const h of hits) if (!labels.includes(h.label)) labels.push(h.label);
  return { labels, sectionRefs: [...text.matchAll(SECTION_RE)].length };
}

/**
 * Targets named by the RETRIEVED chunks only (never by chunks this module added: one hop). A chunk
 * without a document id or file is not expanded. A reference to the chunk's own printed page is
 * skipped. At most REFERENCE_MAX_TARGETS, in retrieval order.
 */
export function referenceTargets(retrieved: readonly ManualChunk[]): PageReference[] {
  const out: PageReference[] = [];
  const seen = new Set<string>();
  for (const c of retrieved) {
    if (!c.docId || !c.sourceUrl) continue;
    for (const label of extractPageReferences(c.content).labels) {
      if (c.pageLabel && c.pageLabel === label) continue;
      const key = `${c.docId}\u0000${c.sourceUrl}\u0000${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ docId: c.docId, sourceUrl: c.sourceUrl, label });
      if (out.length >= REFERENCE_MAX_TARGETS) return out;
    }
  }
  return out;
}

const normalized = (s: string): string => s.replace(/\s+/g, " ").trim();
const identity = (docId: string | null | undefined, url: string, page: number | null, content: string): string =>
  [docId ?? "", url, page == null ? "?" : String(page), normalized(content)].join("\u0000");

function tableModelsOf(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? list.map((m) => exactModelKey(String(m))).filter((k) => k.length > 0) : [];
}

/**
 * The chunks of every page the retrieved chunks refer to, ready to append after the existing
 * evidence (so no citation number moves). `existing` is everything already in the turn's evidence;
 * exact duplicate passages (same document, file, page, whitespace-normalised text) are not repeated.
 */
export async function retrieveReferencedPageChunks(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  retrieved: readonly ManualChunk[],
  opts: {
    docIds: readonly string[];
    approvedSourceDocIds?: readonly string[];
    existing?: readonly ManualChunk[];
    /** The record number retrieval itself judged passages by (retrieveNodeChunks diagnostics.recordNumber:
     *  confirmed AND on record, else null). Added pages are held to the SAME table-admission rule.
     *  `undefined` means the caller did not say: applicability cannot then be judged, so any row whose
     *  table is tagged for specific models is left out (fail closed). `null` admits as retrieval does. */
    recordNumber?: string | null;
    now?: () => number;
  },
): Promise<ManualChunk[]> {
  const scope = opts.docIds.filter(Boolean);
  const targets = referenceTargets(retrieved).filter((t) => scope.includes(t.docId));
  if (targets.length === 0 || scope.length === 0) return [];
  const now = opts.now ?? Date.now;
  const deadline = now() + REFERENCE_DEADLINE_MS;
  const left = (): number => deadline - now();
  const approved = (opts.approvedSourceDocIds ?? []).filter(Boolean);
  const admitApproved = approved.length > 0 && approvalGateEnabled();

  // 1) printed label -> physical page, per (document, file): exactly one page or nothing.
  const p1: unknown[] = [tenantId, scope, targets.map((t) => t.docId), targets.map((t) => t.sourceUrl), targets.map((t) => t.label)];
  if (admitApproved) p1.push(approved);
  // SET LOCAL: scoped to the caller's transaction (withTenantContext), so it cannot leak to other uses.
  const t1 = Math.min(REFERENCE_LABEL_TIMEOUT_MS, left());
  if (t1 < 1) return [];
  await client.query(`SET LOCAL statement_timeout = '${Math.floor(t1)}ms'`);
  const resolved = await client.query(
    `SELECT doc_id::text AS doc_id, source_url, NULLIF(BTRIM(metadata->>'page_label'), '') AS printed,
            min(COALESCE(page_start, source_page)) AS first_pg, max(COALESCE(page_start, source_page)) AS last_pg
       FROM knowledge_entries
      WHERE tenant_id = $1
        AND ingest_route = 'v2'
        ${approvedSourceFilterSql(admitApproved ? 6 : null)}
        AND doc_id::text = ANY($2::text[])
        AND (doc_id::text, source_url, NULLIF(BTRIM(metadata->>'page_label'), '')) IN (
          SELECT * FROM unnest($3::text[], $4::text[], $5::text[])
        )
      GROUP BY doc_id, source_url, NULLIF(BTRIM(metadata->>'page_label'), '')`,
    p1,
  );
  const pages: Array<{ docId: string; sourceUrl: string; page: number }> = [];
  for (const r of resolved.rows as Array<Record<string, unknown>>) {
    const first = Number(r.first_pg);
    if (!Number.isInteger(first) || first < 1 || first !== Number(r.last_pg)) continue; // ambiguous or unnumbered
    pages.push({ docId: String(r.doc_id), sourceUrl: String(r.source_url), page: first });
  }
  if (pages.length === 0) return [];
  const t2 = Math.min(REFERENCE_PAGE_TIMEOUT_MS, left());
  if (t2 < 1) return [];

  // 2) those pages' chunks, bounded per page and in total.
  const p2: unknown[] = [tenantId, scope, pages.map((p) => p.docId), pages.map((p) => p.sourceUrl), pages.map((p) => p.page), REFERENCE_ROWS_PER_PAGE, REFERENCE_MAX_ROWS];
  if (admitApproved) p2.push(approved);
  await client.query(`SET LOCAL statement_timeout = '${Math.floor(t2)}ms'`);
  const read = await client.query(
    `SELECT id::text AS id, content, doc_id::text AS doc_id, source_url, pg, ${PAGE_LABEL_SQL}, verified,
            table_models, table_unqualified, table_scope, table_header
       FROM (
         SELECT id, content, doc_id, source_url, COALESCE(page_start, source_page) AS pg, metadata, verified,
                metadata->'table_models' AS table_models, metadata->'table_unqualified' AS table_unqualified,
                metadata->>'table_scope' AS table_scope, metadata->>'table_header' AS table_header,
                CASE WHEN metadata->>'chunk_index' ~ '^[0-9]+$' THEN (metadata->>'chunk_index')::int END AS cidx,
                rank() OVER (
                  PARTITION BY doc_id, source_url, COALESCE(page_start, source_page)
                  ORDER BY CASE WHEN metadata->>'chunk_index' ~ '^[0-9]+$' THEN (metadata->>'chunk_index')::int END NULLS LAST, id
                ) AS rk
           FROM knowledge_entries
          WHERE tenant_id = $1
            AND ingest_route = 'v2'
            ${approvedSourceFilterSql(admitApproved ? 8 : null)}
            AND doc_id::text = ANY($2::text[])
            AND (doc_id::text, source_url, COALESCE(page_start, source_page)) IN (
              SELECT * FROM unnest($3::text[], $4::text[], $5::int[])
            )
       ) t
      WHERE rk <= $6
      ORDER BY doc_id, source_url, pg, cidx NULLS LAST, id
      LIMIT $7`,
    p2,
  );
  // Fail open past the deadline: rows that arrived late are not added.
  if (left() < 0) return [];

  const templates = new Map<string, ManualChunk>();
  for (const c of retrieved) if (c.docId && c.sourceUrl && !templates.has(`${c.docId}\u0000${c.sourceUrl}`)) templates.set(`${c.docId}\u0000${c.sourceUrl}`, c);
  const seen = new Set((opts.existing ?? retrieved).map((c) => identity(c.docId, c.sourceUrl, c.sourcePage, c.content)));
  const out: ManualChunk[] = [];
  for (const r of read.rows as Array<Record<string, unknown>>) {
    const docId = String(r.doc_id);
    const sourceUrl = String(r.source_url);
    const tpl = templates.get(`${docId}\u0000${sourceUrl}`);
    // A table line the layout parser could not tie to one column is nobody's value (table-rows.ts).
    if (!tpl || r.table_scope === "unresolved" || r.table_unqualified === true || String(r.table_unqualified) === "true") continue;
    // The same passage-admission predicate retrieval applies for the confirmed record: another
    // model's explicit section/columns and untagged same-family sibling text are not evidence.
    if (opts.recordNumber === undefined ? tableModelsOf(r.table_models).length > 0 : tableExclusionFor(r, opts.recordNumber) !== null) continue;
    const content = String(r.content ?? "");
    const page = Number(r.pg);
    const key = identity(docId, sourceUrl, page, content);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof r.page_label === "string" && r.page_label.trim() ? r.page_label.trim() : null;
    out.push({
      ...tpl,
      content,
      docId,
      sourceUrl,
      sourcePage: page,
      pageLabel: label,
      chunkIndex: null,
      tableModels: tableModelsOf(r.table_models),
      rank: 0,
      verified: r.verified === true,
    });
  }
  return out;
}
