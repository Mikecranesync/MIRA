/**
 * One-time spend of a photo part-search proposal (#4171 Codex F3).
 *
 * A confirmation must authorize exactly ONE paid search. Two confirmations
 * racing (different client request ids), or a retry after the reply failed to
 * persist, would otherwise both read the same completed proposal turn and both
 * search. Before any discovery call, the route appends a consumed marker to the
 * proposal's own turn with a single conditional UPDATE: Postgres row locking
 * lets exactly one caller see `rowCount = 1`; every other caller sees 0 and
 * does not search. The marker is persisted BEFORE the search, so a later
 * failure cannot make the proposal spendable again.
 *
 * Fail closed: any error means "not claimed" — no search.
 */
import { withTenantContext } from "@/lib/tenant-context";
import { PART_SEARCH_CONSUMED_KIND, PART_SEARCH_PROPOSAL_KIND } from "./photo-part-lookup";

export async function claimPartSearchProposal(opts: {
  tenantId: string;
  notebookId: string;
  proposalTurnId: string;
  ownerUserId: string;
}): Promise<boolean> {
  try {
    return await withTenantContext(opts.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE equipment_notebook_turns
            SET evidence = evidence || jsonb_build_array(jsonb_build_object('kind', $5::text, 'at', now()))
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
            AND notebook_id = $3::uuid
            AND owner_user_id::text = $4
            AND evidence @> jsonb_build_array(jsonb_build_object('kind', $6::text))
            AND NOT evidence @> jsonb_build_array(jsonb_build_object('kind', $5::text))
          RETURNING id`,
        [
          opts.proposalTurnId,
          opts.tenantId,
          opts.notebookId,
          opts.ownerUserId,
          PART_SEARCH_CONSUMED_KIND,
          PART_SEARCH_PROPOSAL_KIND,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    });
  } catch (err) {
    console.error("[part-search] proposal claim failed (no search):", err instanceof Error ? err.message : err);
    return false;
  }
}
