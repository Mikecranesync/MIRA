import type { PoolClient } from "pg";
import type { ManualChunk } from "@/lib/manual-rag";
import { resolveVendor } from "@/lib/vendor-relevance";

/** Bound on the admitted uuid[] parameter. It is a safety bound, not a
 *  relevance filter: every confirmed document up to it is handed to
 *  retrieveNodeChunks, which ranks and applies synonym expansion itself. */
export const CONFIRMED_SOURCE_LIMIT = 5000;

/**
 * The tenant's own documents a person has CONFIRMED as a source in any
 * notebook (`match_state IN ('user_confirmed','verified')`, not superseded).
 *
 * Confirmation is the same trust signal validateChatSources uses for notebook
 * chat (#3437/#3468): retrieval admission for the tenant's private chunks,
 * never promotion to globally verified. The general ask has no notebook, so it
 * admits what the tenant confirmed anywhere, ignoring one notebook's per-chat
 * `enabled_by_default` toggle (that narrows a chat, it does not revoke trust).
 *
 * No question-based prefilter (review of #4087, round 2): choosing candidates
 * here with the raw question dropped documents that retrieval's own synonym
 * expansion would find ("slow down ramp" → "deceleration"), and any
 * recency-ordered cap can drop the most relevant older manual. Retrieval ranks.
 * The bound only protects the parameter; hitting it is reported, not silent.
 */
export async function confirmedSourceDocIds(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  manufacturer?: string | null,
): Promise<{ docIds: string[]; truncated: boolean }> {
  const res = await client.query(
    `SELECT s.doc_id::text AS doc_id,
            array_agg(DISTINCT n.manufacturer) AS manufacturers
       FROM equipment_notebook_sources s
       LEFT JOIN equipment_notebooks n
         ON n.id = s.notebook_id AND n.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1::uuid
        AND s.match_state IN ('user_confirmed', 'verified')
        AND s.superseded_at IS NULL
      GROUP BY s.doc_id
      ORDER BY MAX(s.created_at) DESC
      LIMIT ${CONFIRMED_SOURCE_LIMIT + 1}`,
    [tenantId],
  );
  // Round 3 F1: own-document chunks carry no manufacturer tag, so the later
  // vendor-conflict filter keeps them all. When the technician chose a maker,
  // drop a document confirmed ONLY in notebooks bound to a different maker;
  // unknown or unbound notebooks stay (never over-refuse).
  const wanted = resolveVendor(manufacturer ?? null);
  const rows = (res.rows as Array<{ doc_id: unknown; manufacturers: unknown }>).filter((r) => {
    if (!wanted) return true;
    const makers = Array.isArray(r.manufacturers) ? r.manufacturers : [];
    return makers.some((m) => {
      const v = resolveVendor(typeof m === "string" ? m : null);
      return v === null || v === wanted;
    }) || makers.length === 0;
  });
  const all = rows.map((r) => String(r.doc_id));
  return {
    docIds: all.slice(0, CONFIRMED_SOURCE_LIMIT),
    truncated: res.rows.length > CONFIRMED_SOURCE_LIMIT,
  };
}

const chunkKey = (c: ManualChunk) => `${c.sourceUrl}|${c.sourcePage}|${c.content.slice(0, 120)}`;

/**
 * The technician's own confirmed documents first, then the library, without
 * letting one passage occupy two citation slots. Capped at `topK`.
 */
export function preferOwnDocuments(
  own: readonly ManualChunk[],
  library: readonly ManualChunk[],
  topK: number,
): ManualChunk[] {
  const seen = new Set(own.map(chunkKey));
  return [...own, ...library.filter((c) => !seen.has(chunkKey(c)))].slice(0, topK);
}

/**
 * The general ask's user turn. An unavailable search must never be reported to
 * the model as "nothing matched" (#3682 F3), and that holds per lane: when the
 * OEM library answered but the technician's own manuals could not be searched,
 * the model is told so, rather than implying their manuals lack the answer.
 */
export function askUserContent(
  context: string,
  question: string,
  failed: { library: boolean; ownDocuments: boolean; ownDocumentsPartial?: boolean },
): string {
  const ownNote = failed.ownDocuments
    ? "\n\n(NOTE: the technician's own uploaded manuals could NOT be searched for this question — do not say their manuals lack this information.)"
    : failed.ownDocumentsPartial
      ? "\n\n(NOTE: only the most recently confirmed of the technician's manuals were searched — do not say their manuals lack this information.)"
      : "";
  if (context) return `CONTEXT:\n${context}${ownNote}\n\n---\n\nUSER QUESTION:\n${question}`;
  if (!failed.library && !failed.ownDocuments && failed.ownDocumentsPartial) {
    return `CONTEXT: (no excerpt matched in the manuals searched, but only the most recently confirmed of the technician's manuals were searched — answer from general knowledge and do not say their manuals lack this information)\n\n---\n\nUSER QUESTION:\n${question}`;
  }
  if (failed.library || failed.ownDocuments) {
    return `CONTEXT: (plant-document search was UNAVAILABLE for this question — the manuals were NOT searched; answer from general knowledge and say the document search was unavailable, not that the documents did not match)\n\n---\n\nUSER QUESTION:\n${question}`;
  }
  return `CONTEXT: (no manual excerpt matched this question — answer from general knowledge)\n\n---\n\nUSER QUESTION:\n${question}`;
}
