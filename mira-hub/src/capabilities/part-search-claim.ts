/**
 * One-time spend of a photo part-search proposal (#4171 Codex F3; redesigned
 * #4193 Codex round 2 F3+F6).
 *
 * A confirmation must authorize exactly ONE paid search. Two confirmations
 * racing (different client request ids), or a retry after the reply failed to
 * persist, would otherwise both read the same completed proposal turn and both
 * search.
 *
 * #4193 Codex round 1 F3 tried to solve this with a cross-row `NOT EXISTS`
 * existence check scoped by a stable `proposalId`. Codex round 2 F3 found that
 * insufficient: an existence check alone does not SERIALIZE two overlapping
 * transactions — if both read "no consumed marker yet" before either commits,
 * both can still update (two different rows) and both see rowCount = 1. Round
 * 2 F6 additionally found that a re-shown LEGACY proposal (no round-1 `id`)
 * minted a fresh random id on every re-show, so it never shared an identity
 * with the original at all — a cross-row check keyed on that id could never
 * have caught it either.
 *
 * The fix anchors every copy of one logical offer — fresh or re-shown,
 * round-2 or true-legacy — to a single ORIGIN TURN ROW (see
 * `PartSearchProposalEntry.originTurnId` / `partSearchDecision()` in
 * `photo-part-lookup.ts`), and claims it with Postgres's own serialization
 * primitive instead of an existence check:
 *
 *   1. `SELECT … FOR UPDATE` the origin row. This takes a row lock for the
 *      rest of the transaction — a concurrent claim against the SAME origin
 *      row blocks here until this transaction commits or rolls back, then
 *      re-reads the fresh (now-consumed) state. That is what actually
 *      serializes two truly-overlapping claims; an existence check in a
 *      plain `UPDATE ... WHERE NOT EXISTS (...)` does not block a concurrent
 *      transaction, it only checks a snapshot.
 *   2. Check, under that lock, that the row still carries an UNCONSUMED
 *      `part_search_proposal` entry.
 *   3. If so, append the consumed marker to THAT row (never to whichever row
 *      holds the copy actually being confirmed) and commit.
 *
 * Every copy of the offer — however many times it was re-shown, onto however
 * many different turn rows — is claimed against this ONE row, so marking it
 * consumed makes every copy permanently unable to claim again, regardless of
 * which copy's turn id a later confirmation reads.
 *
 * Fail closed: any error means "not claimed" — no search.
 */
import { withTenantContext } from "@/lib/tenant-context";
import { PART_SEARCH_CONSUMED_KIND, PART_SEARCH_PROPOSAL_KIND } from "./photo-part-lookup";

export async function claimPartSearchProposal(opts: {
  tenantId: string;
  notebookId: string;
  /** The ORIGIN turn — the one canonical row every copy of this offer is
   *  claimed against (see `PartSearchProposalEntry.originTurnId`). */
  originTurnId: string;
  ownerUserId: string;
}): Promise<boolean> {
  try {
    return await withTenantContext(opts.tenantId, async (c) => {
      // Row lock for the rest of THIS transaction. A concurrent claim against
      // the same origin row blocks here, not at the UPDATE below — that is
      // the serialization guarantee a plain existence check cannot provide.
      const locked = await c.query(
        `SELECT evidence FROM equipment_notebook_turns
          WHERE id = $1::uuid AND tenant_id = $2::uuid AND notebook_id = $3::uuid AND owner_user_id::text = $4
          FOR UPDATE`,
        [opts.originTurnId, opts.tenantId, opts.notebookId, opts.ownerUserId],
      );
      if (locked.rowCount !== 1) return false; // no such origin row for this owner/tenant/notebook
      const evidence = (locked.rows[0].evidence ?? []) as Array<{ kind?: unknown }>;
      const hasProposal = evidence.some((e) => e?.kind === PART_SEARCH_PROPOSAL_KIND);
      const alreadyConsumed = evidence.some((e) => e?.kind === PART_SEARCH_CONSUMED_KIND);
      if (!hasProposal || alreadyConsumed) return false;
      const r = await c.query(
        `UPDATE equipment_notebook_turns
            SET evidence = evidence || jsonb_build_array(jsonb_build_object('kind', $5::text, 'at', now()))
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
            AND notebook_id = $3::uuid
            AND owner_user_id::text = $4
            AND NOT evidence @> jsonb_build_array(jsonb_build_object('kind', $5::text))
          RETURNING id`,
        [opts.originTurnId, opts.tenantId, opts.notebookId, opts.ownerUserId, PART_SEARCH_CONSUMED_KIND],
      );
      return (r.rowCount ?? 0) === 1;
    });
  } catch (err) {
    console.error("[part-search] proposal claim failed (no search):", err instanceof Error ? err.message : err);
    return false;
  }
}
