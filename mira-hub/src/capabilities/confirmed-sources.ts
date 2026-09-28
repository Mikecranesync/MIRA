import type { PoolClient } from "pg";
import type { ManualChunk } from "@/lib/manual-rag";

/** Cap on how many confirmed documents one general ask searches. The ask is
 *  tenant-wide, so this bounds the uuid[] parameter, not relevance. */
export const CONFIRMED_SOURCE_LIMIT = 200;

/**
 * The tenant's own documents a person has CONFIRMED as a source in any
 * notebook: `match_state IN ('user_confirmed','verified')`, not superseded.
 *
 * This is the same trust signal validateChatSources uses for notebook chat
 * (#3437/#3468): confirmation is retrieval admission for the tenant's private
 * chunks, without ever promoting them to globally verified. The general ask
 * (`/api/hub/ask`) has no notebook, so it admits everything the tenant has
 * confirmed anywhere. It deliberately ignores a notebook's per-chat
 * `enabled_by_default` toggle, which narrows one notebook's scope and says
 * nothing about whether the document is trusted.
 *
 * Runs on the caller's client with an explicit `tenant_id` predicate; it never
 * returns another tenant's documents.
 */
export async function confirmedSourceDocIds(
  client: Pick<PoolClient, "query">,
  tenantId: string,
): Promise<string[]> {
  const res = await client.query(
    `SELECT DISTINCT doc_id::text AS doc_id
       FROM equipment_notebook_sources
      WHERE tenant_id = $1::uuid
        AND match_state IN ('user_confirmed', 'verified')
        AND superseded_at IS NULL
      LIMIT ${CONFIRMED_SOURCE_LIMIT}`,
    [tenantId],
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
