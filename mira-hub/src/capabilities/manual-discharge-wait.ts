/**
 * Answer Test Q11 (2026-11-27): "I just killed power to the GS10. How long until I can open it up?"
 * MIRA answered "the excerpt gives no fixed wait time" from a page about the DC bus falling below the
 * Lv level (p. 235). The same manual says to wait at least 5 minutes (p. 6-3) and 10 minutes after
 * the display lamps go out, then meter DC+ to DC- (p. 326, the warning MIRA itself showed on Q9).
 * Top-K retrieval found the page that matched the words, not the page that holds the wait.
 *
 * So, when the question is about getting into or touching equipment after power is removed, each
 * retrieved document's own discharge-wait warnings join the excerpts: chunks of that same document
 * that name a wait in minutes together with the capacitors, the DC bus or discharge. They are
 * appended after the retrieved chunks (no citation number moves), and the directive tells the model
 * to give the manual's wait and voltage check and never to say the manual gives none.
 *
 * Read-only and fail-open, pinned like retrieval (tenant, v2 rows, the admitted documents, the
 * approval predicate). Bounded: at most DISCHARGE_WAIT_ROWS_PER_DOC rows per document and
 * DISCHARGE_WAIT_BUDGET_CHARS of text per document.
 */
import type { PoolClient } from "pg";
import { approvalGateEnabled, approvedSourceFilterSql, MAX_CONTENT_CHARS, PAGE_LABEL_SQL, type ManualChunk } from "@/lib/manual-rag";

export const DISCHARGE_WAIT_ROWS_PER_DOC = 3;
export const DISCHARGE_WAIT_BUDGET_CHARS = 2_400;
/** Documents read per turn, in retrieval order. */
export const DISCHARGE_WAIT_MAX_DOCS = 3;

/** One string each for Postgres (~*) and JS (flag i): a chunk must match all three. */
export const DISCHARGE_WAIT_SQL = {
  wait: "\\m(wait|waiting|allow)\\M",
  minutes: "\\m([0-9]+|one|two|three|four|five|ten|fifteen)\\s*(minutes?|mins?)\\M",
  energy: "capacitor|discharg|dc[ -]?bus|bus voltage|charge (led|lamp|indicator)|residual voltage|stored (energy|charge)",
} as const;
const WAIT_RE = /\b(?:wait|waiting|allow)\b/i;
const MINUTES_RE = /\b(?:\d+|one|two|three|four|five|ten|fifteen)\s*(?:minutes?|mins?)\b/i;
const ENERGY_RE = /capacitor|discharg|dc[ -]?bus|bus voltage|charge (?:led|lamp|indicator)|residual voltage|stored (?:energy|charge)/i;

/** True when a chunk's own text holds a discharge-wait statement (the same test the SQL applies). */
export function isDischargeWaitText(content: string): boolean {
  return WAIT_RE.test(content) && MINUTES_RE.test(content) && ENERGY_RE.test(content);
}

/**
 * The question asks about getting into, touching or servicing equipment once power is removed, or
 * about the discharge wait itself. Narrow on purpose: an ordinary fault or parameter question reads
 * nothing extra.
 */
const POWER_REMOVED =
  /\b(?:(?:killed|cut|pulled|removed|shut|turned|switched|kill|cut|pull|remove|shut|turn|switch)\s+(?:off\s+)?(?:the\s+)?(?:main\s+)?(?:power|breaker|disconnect)(?:\s+off)?|power(?:ed)?\s+(?:off|down)|power\s+(?:is|'s|was)\s+(?:off|out|removed)|de-?energi[sz](?:ed|e)|locked\s+(?:it\s+)?out|lock(?:ed)?\s+(?:it\s+)?out|after\s+(?:a\s+)?power[-\s]?(?:off|down)|with\s+(?:the\s+)?power\s+off)\b/i;
const GET_IN =
  /\b(?:open(?:ing)?(?:\s+(?:it|the\s+(?:drive|cover|panel|cabinet|enclosure|door|vfd|inverter)))?(?:\s+up)?|take\s+(?:the\s+)?(?:cover|front|lid)\s+off|remov(?:e|ing)\s+(?:the\s+)?(?:cover|front\s+cover|lid)|touch(?:ing)?|reach\s+in|get\s+(?:in|inside|into)|work(?:ing)?\s+(?:on|inside|in)|servic(?:e|ing)|(?:re)?wir(?:e|ing)|replac(?:e|ing))\b/i;
const HOW_LONG = /\b(?:how\s+long|how\s+many\s+minutes|wait(?:ing)?(?:\s+time)?|safe\s+to|ok(?:ay)?\s+to|until|before)\b/i;
const DISCHARGE_ASK = /\b(?:discharg\w*|capacitors?|dc[-\s]?bus|bus\s+voltage|charge\s+(?:led|lamp|light))\b[^.?!]{0,80}\b(?:wait|how\s+long|minutes?|safe|before|until)\b|\b(?:wait|how\s+long)\b[^.?!]{0,60}\b(?:discharg\w*|capacitors?|dc[-\s]?bus)\b/i;

export function asksDischargeWait(question: string): boolean {
  const q = (question || "").normalize("NFKC");
  if (DISCHARGE_ASK.test(q)) return true;
  return POWER_REMOVED.test(q) && GET_IN.test(q) && HOW_LONG.test(q);
}

type Doc = { docId: string; sourceUrl: string; template: ManualChunk };

function retrievedDocs(chunks: readonly ManualChunk[]): Doc[] {
  const out = new Map<string, Doc>();
  for (const c of chunks) {
    if (!c.docId || !c.sourceUrl || out.has(c.docId)) continue;
    out.set(c.docId, { docId: c.docId, sourceUrl: c.sourceUrl, template: c });
    if (out.size >= DISCHARGE_WAIT_MAX_DOCS) break;
  }
  return [...out.values()];
}

/** Each retrieved document's discharge-wait chunks, ready to append after the retrieved ones. */
export async function retrieveDischargeWaitChunks(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  chunks: readonly ManualChunk[],
  opts: { approvedSourceDocIds?: string[] } = {},
): Promise<ManualChunk[]> {
  const docs = retrievedDocs(chunks);
  if (docs.length === 0) return [];
  const approved = (opts.approvedSourceDocIds ?? []).filter(Boolean);
  const admitApproved = approved.length > 0 && approvalGateEnabled();
  const params: unknown[] = [
    tenantId,
    docs.map((d) => d.docId),
    docs.map((d) => d.sourceUrl),
    DISCHARGE_WAIT_SQL.wait,
    DISCHARGE_WAIT_SQL.minutes,
    DISCHARGE_WAIT_SQL.energy,
    DISCHARGE_WAIT_ROWS_PER_DOC,
  ];
  if (admitApproved) params.push(approved);
  await client.query("SET LOCAL statement_timeout = '3s'");
  const res = await client.query(
    `SELECT id::text AS id, doc_id::text AS doc_id, content, source_url, page, page_label
       FROM (
         SELECT id, doc_id, content, source_url, COALESCE(page_start, source_page) AS page,
                ${PAGE_LABEL_SQL},
                ROW_NUMBER() OVER (
                  PARTITION BY doc_id
                  ORDER BY (content ~ '(^|\\n)[\\s•*!-]*(WARNING|DANGER|CAUTION|ATTENTION)') DESC,
                           COALESCE(page_start, source_page) NULLS LAST, id
                ) AS rn
           FROM knowledge_entries
          WHERE tenant_id = $1
            AND ingest_route = 'v2'
            ${approvedSourceFilterSql(admitApproved ? 8 : null)}
            AND (doc_id::text, source_url) IN (SELECT * FROM unnest($2::text[], $3::text[]))
            AND content ~* $4 AND content ~* $5 AND content ~* $6
       ) ranked
      WHERE rn <= $7
      ORDER BY doc_id, rn`,
    params,
  );
  const seen = new Set(chunks.map((c) => `${c.sourceUrl ?? ""}\u0000${c.content}`));
  const byDoc = new Map(docs.map((d) => [d.docId, d] as const));
  const used = new Map<string, number>();
  const out: ManualChunk[] = [];
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const doc = byDoc.get(String(r.doc_id ?? ""));
    const content = String(r.content ?? "");
    if (!doc || !isDischargeWaitText(content)) continue;
    const key = `${doc.sourceUrl}\u0000${content}`;
    if (seen.has(key)) continue;
    const cost = Math.min(content.length, MAX_CONTENT_CHARS);
    const spent = used.get(doc.docId) ?? 0;
    if (spent + cost > DISCHARGE_WAIT_BUDGET_CHARS) continue;
    seen.add(key);
    used.set(doc.docId, spent + cost);
    const page = Number(r.page);
    const label = typeof r.page_label === "string" && r.page_label.trim() ? r.page_label.trim() : null;
    out.push({
      ...doc.template,
      content,
      sourcePage: Number.isInteger(page) && page > 0 ? page : null,
      pageLabel: label,
      chunkIndex: null,
      rank: 0,
    });
  }
  // Retrieval order across documents.
  const order = new Map(docs.map((d, i) => [d.docId, i] as const));
  return out.sort((a, b) => (order.get(a.docId ?? "") ?? 0) - (order.get(b.docId ?? "") ?? 0));
}

/** The prompt rule that rides with the discharge-wait excerpts; only sent when some were added. */
export const DISCHARGE_WAIT_DIRECTIVE = `

DISCHARGE WAIT — this turn's excerpts include the manual's own warnings on how long to wait after power is removed before opening or touching the equipment:
- Give that wait in the manual's own terms (its stated minutes and what it counts from, such as the display or charge lamp going out), then its voltage check before touching (for example, measure DC+ to DC-), and cite the page.
- If the manual gives more than one wait, give the longer one or say which applies to which case.
- Never say the manual gives no wait time when one of these excerpts states one.`;
