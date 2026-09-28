import type { PoolClient } from "pg";
import { boundBm25Query, type ManualChunk } from "@/lib/manual-rag";

/** Cap on how many MATCHING confirmed documents one general ask searches —
 *  bounds the uuid[] parameter; candidates are already chosen by relevance. */
export const CONFIRMED_SOURCE_LIMIT = 200;

/**
 * The tenant's own documents a person has CONFIRMED as a source in any
 * notebook (`match_state IN ('user_confirmed','verified')`, not superseded)
 * that contain a match for this question.
 *
 * Confirmation is the same trust signal validateChatSources uses for notebook
 * chat (#3437/#3468): retrieval admission for the tenant's private chunks,
 * never promotion to globally verified. The general ask has no notebook, so it
 * admits what the tenant confirmed anywhere, ignoring one notebook's per-chat
 * `enabled_by_default` toggle (that narrows a chat, it does not revoke trust).
 *
 * Candidates are chosen by the question, not by an unordered page: only
 * documents whose own chunks match the OR-form of the query are returned,
 * newest confirmation first, so the cap bounds the uuid[] parameter without
 * hiding a relevant manual behind 200 irrelevant ones. Tenant-scoped on both
 * tables; the chunk probe is a pure-tenant read of the tenant's own rows.
 */
export async function confirmedSourceDocIds(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  query: string,
): Promise<string[]> {
  const q = boundBm25Query(query.trim());
  if (!q) return [];
  const res = await client.query(
    `SELECT s.doc_id::text AS doc_id
       FROM equipment_notebook_sources s
      WHERE s.tenant_id = $1::uuid
        AND s.match_state IN ('user_confirmed', 'verified')
        AND s.superseded_at IS NULL
        AND EXISTS (
          SELECT 1 FROM knowledge_entries k
           WHERE k.tenant_id = $1::uuid
             AND k.doc_id = s.doc_id
             AND k.ingest_route = 'v2'
             AND k.content_tsv @@ to_tsquery('english',
                   replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')))
      GROUP BY s.doc_id
      ORDER BY MAX(s.created_at) DESC
      LIMIT ${CONFIRMED_SOURCE_LIMIT}`,
    [tenantId, q],
  );
  return res.rows.map((r: Record<string, unknown>) => String(r.doc_id));
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
  failed: { library: boolean; ownDocuments: boolean },
): string {
  const ownNote = failed.ownDocuments
    ? "\n\n(NOTE: the technician's own uploaded manuals could NOT be searched for this question — do not say their manuals lack this information.)"
    : "";
  if (context) return `CONTEXT:\n${context}${ownNote}\n\n---\n\nUSER QUESTION:\n${question}`;
  if (failed.library || failed.ownDocuments) {
    return `CONTEXT: (plant-document search was UNAVAILABLE for this question — the manuals were NOT searched; answer from general knowledge and say the document search was unavailable, not that the documents did not match)\n\n---\n\nUSER QUESTION:\n${question}`;
  }
  return `CONTEXT: (no manual excerpt matched this question — answer from general knowledge)\n\n---\n\nUSER QUESTION:\n${question}`;
}
