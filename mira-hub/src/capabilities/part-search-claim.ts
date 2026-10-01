/**
 * One-time spend of a photo part-search proposal (#4171 Codex F3; widened
 * #4193 Codex F3).
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
 * #4193 Codex F3: a re-shown offer is no longer the SAME turn row — a
 * non-matching reply persists a copy of the proposal onto a NEW turn (same
 * candidate, same stable `id`, new turn id), so a turn-id-only claim leaves
 * that copy independently spendable even after the original has already been
 * consumed. `proposalId`, when the proposal carries one, additionally
 * requires that NO turn in this notebook already carries a consumed marker
 * for that same id — scoped to the notebook (not just the one turn being
 * updated) — so a confirmation that races a stale re-show snapshot can
 * consume the underlying offer at most once, no matter which physical turn
 * row the confirmed copy lives on. `proposalId: null` (a legacy proposal
 * minted before this field existed) falls back to the turn-id-only claim it
 * always had.
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
  /** #4193 Codex F3: the offer's stable identity, carried unchanged through
   *  every re-show copy. Pass `null` (or omit) for a legacy proposal that
   *  predates this field — the claim then falls back to being scoped by
   *  `proposalTurnId` alone, exactly as before. */
  proposalId?: string | null;
}): Promise<boolean> {
  try {
    return await withTenantContext(opts.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE equipment_notebook_turns
            SET evidence = evidence || jsonb_build_array(
                  jsonb_build_object('kind', $5::text, 'at', now(), 'proposal_id', $7::text)
                )
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
            AND notebook_id = $3::uuid
            AND owner_user_id::text = $4
            AND evidence @> jsonb_build_array(jsonb_build_object('kind', $6::text))
            AND NOT evidence @> jsonb_build_array(jsonb_build_object('kind', $5::text))
            AND (
              $7::text IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM equipment_notebook_turns t2
                 WHERE t2.tenant_id = $2::uuid
                   AND t2.notebook_id = $3::uuid
                   AND t2.owner_user_id::text = $4
                   AND t2.evidence @> jsonb_build_array(
                         jsonb_build_object('kind', $5::text, 'proposal_id', $7::text)
                       )
              )
            )
          RETURNING id`,
        [
          opts.proposalTurnId,
          opts.tenantId,
          opts.notebookId,
          opts.ownerUserId,
          PART_SEARCH_CONSUMED_KIND,
          PART_SEARCH_PROPOSAL_KIND,
          opts.proposalId ?? null,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    });
  } catch (err) {
    console.error("[part-search] proposal claim failed (no search):", err instanceof Error ? err.message : err);
    return false;
  }
}
