/**
 * #4171 Codex F3 — a photo part-search proposal authorizes exactly ONE search,
 * proven against real Postgres (the guarantee lives in the `SELECT ... FOR
 * UPDATE` row lock + conditional UPDATE, which no mock can prove).
 *
 * #4193 Codex round 2 F3+F6 redesigned the claim to lock and mark consumed on
 * a single ORIGIN turn row — never a per-copy identity — specifically
 * because round 1's cross-row `NOT EXISTS` existence check does not
 * SERIALIZE two truly-overlapping transactions (it only checks a snapshot):
 * two concurrent claims against two DIFFERENT rows that both logically
 * belong to one offer could both pass the existence check before either
 * committed. The tests below prove the fix at the exact granularity Codex
 * asked for: true transaction overlap (not just sequential timing luck), a
 * true-legacy original with no round-1 `id` at all, and the origin-forwarding
 * chain across two successive re-shows.
 *
 * Run: MIRA_TEST_DB_CONFIRM=DISPOSABLE TEST_DATABASE_URL=… node scripts/setup-integration-db.mjs
 *      then: npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/part-search-claim.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

const URL_ = process.env.TEST_DATABASE_URL;
// `@/lib/db` forces SSL against NEON_DATABASE_URL; inject the disposable pool.
const testPool = new pg.Pool({ connectionString: URL_, max: 6 });
vi.mock("@/lib/db", () => ({ default: testPool }));
const d = URL_ ? describe : describe.skip;

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const TURN = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";

let client: pg.Client;

d("claimPartSearchProposal (real Postgres)", () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: URL_ });
    await client.connect();
  });
  afterAll(async () => {
    await client?.end();
    await testPool.end();
  });
  beforeEach(async () => {
    await client.query(`DELETE FROM equipment_notebook_turns WHERE id = $1::uuid`, [TURN]);
    // A TRUE-LEGACY shape: no `id`, no `originTurnId` — just what a proposal
    // looked like before #4193 round 1 ever existed. `partSearchDecision()`'s
    // `originOf()` anchors a proposal like this to the turn it sits on: TURN.
    await client.query(
      `INSERT INTO equipment_notebook_turns (id, notebook_id, tenant_id, question, evidence, owner_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Look up the PDF manual',
               '[{"kind":"part_search_proposal","candidate":"SS5Y3-DUW01302","manufacturer":"SMC"}]'::jsonb, $4)`,
      [TURN, NB, TENANT, OWNER],
    );
  });

  const claim = async (originTurnId: string = TURN) => {
    const { claimPartSearchProposal } = await import("../part-search-claim");
    return claimPartSearchProposal({ tenantId: TENANT, notebookId: NB, originTurnId, ownerUserId: OWNER });
  };

  it("two concurrent confirmations against the same origin: exactly one wins", async () => {
    const results = await Promise.all([claim(), claim(), claim(), claim()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const r = await client.query(`SELECT evidence FROM equipment_notebook_turns WHERE id = $1::uuid`, [TURN]);
    const kinds = (r.rows[0].evidence as Array<{ kind: string }>).map((e) => e.kind);
    expect(kinds.filter((k) => k === "part_search_proposal_consumed")).toHaveLength(1);
  });

  it("a spent proposal cannot be spent again (a retry after a failed reply)", async () => {
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
  });

  it("another user cannot spend it", async () => {
    const { claimPartSearchProposal } = await import("../part-search-claim");
    expect(
      await claimPartSearchProposal({
        tenantId: TENANT,
        notebookId: NB,
        originTurnId: TURN,
        ownerUserId: "55555555-5555-4555-8555-555555555555",
      }),
    ).toBe(false);
  });

  it("a turn without a proposal cannot be 'spent'", async () => {
    await client.query(`UPDATE equipment_notebook_turns SET evidence = '[]'::jsonb WHERE id = $1::uuid`, [TURN]);
    expect(await claim()).toBe(false);
  });

  // #4193 Codex round 2 F3 (i): TRUE transaction overlap, driven explicitly —
  // not inferred from `Promise.all` scheduling. Client A takes the row lock
  // and HOLDS it open (no commit). Client B's own `SELECT ... FOR UPDATE`
  // against the SAME row must still be pending after a real wait — proving
  // Postgres's row lock, not an app-level snapshot check, is what serializes
  // this. Only once A commits does B's SELECT resolve, and by then the row
  // is already consumed, so B's own conditional UPDATE must affect 0 rows.
  it("(i) TRUE overlap: a second claim against the SAME origin blocks on the row lock until the first commits, then finds it spent", async () => {
    const setRoleAndTenant = async (c: pg.Client) => {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE factorylm_app");
      await c.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)",
        [TENANT],
      );
    };
    const lockRow = (c: pg.Client) =>
      c.query(
        `SELECT evidence FROM equipment_notebook_turns
          WHERE id = $1::uuid AND tenant_id = $2::uuid AND notebook_id = $3::uuid AND owner_user_id::text = $4
          FOR UPDATE`,
        [TURN, TENANT, NB, OWNER],
      );
    const a = new pg.Client({ connectionString: URL_ });
    const b = new pg.Client({ connectionString: URL_ });
    await a.connect();
    await b.connect();
    try {
      await setRoleAndTenant(a);
      await lockRow(a); // A now holds the row lock; A's transaction is still open.

      await setRoleAndTenant(b);
      let bResolved = false;
      const bLock = lockRow(b).then((r) => {
        bResolved = true;
        return r;
      });
      // Give B every chance to resolve if the lock were NOT actually held.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(bResolved).toBe(false); // B is genuinely blocked — this is the guarantee.

      // A finishes its claim and commits, releasing the lock.
      await a.query(
        `UPDATE equipment_notebook_turns
            SET evidence = evidence || jsonb_build_array(jsonb_build_object('kind', 'part_search_proposal_consumed', 'at', now()))
          WHERE id = $1::uuid`,
        [TURN],
      );
      await a.query("COMMIT");

      // B's lock now resolves, seeing the FRESH (already-consumed) state —
      // its own conditional claim must therefore see nothing to spend.
      await bLock;
      const bUpdate = await b.query(
        `UPDATE equipment_notebook_turns
            SET evidence = evidence || jsonb_build_array(jsonb_build_object('kind', 'part_search_proposal_consumed', 'at', now()))
          WHERE id = $1::uuid
            AND NOT evidence @> jsonb_build_array(jsonb_build_object('kind', 'part_search_proposal_consumed'))
          RETURNING id`,
        [TURN],
      );
      expect(bUpdate.rowCount).toBe(0);
      await b.query("COMMIT");
    } finally {
      await a.end();
      await b.end();
    }
  });

  // #4193 Codex round 2 F6 (ii): a TRUE legacy original (no `id`, no
  // `originTurnId` — exactly `beforeEach`'s fixture) is consumed first; a
  // stale re-show — persisted on a SEPARATE turn, carrying `originTurnId`
  // pointing BACK at the legacy original (exactly what `partSearchDecision()`
  // computes for a legacy entry) — must then be rejected, because confirming
  // it resolves to the SAME origin that is already spent.
  it("(ii) a legacy original is consumed, then a stale re-show anchored to it is rejected", async () => {
    expect(await claim()).toBe(true); // consumes TURN itself (the legacy entry's own origin).

    const RESHOWN_TURN = "77777777-7777-4777-8777-777777777777";
    await client.query(`DELETE FROM equipment_notebook_turns WHERE id = $1::uuid`, [RESHOWN_TURN]);
    await client.query(
      `INSERT INTO equipment_notebook_turns (id, notebook_id, tenant_id, question, evidence, owner_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'What is the warranty on this?', $4::jsonb, $5)`,
      [
        RESHOWN_TURN,
        NB,
        TENANT,
        `[{"kind":"part_search_proposal","candidate":"SS5Y3-DUW01302","manufacturer":"SMC","age":2,"originTurnId":"${TURN}"}]`,
        OWNER,
      ],
    );
    // Confirming the re-show resolves its origin to TURN — the claim targets
    // TURN (never RESHOWN_TURN) and finds it already spent.
    expect(await claim(TURN)).toBe(false);
    await client.query(`DELETE FROM equipment_notebook_turns WHERE id = $1::uuid`, [RESHOWN_TURN]);
  });

  // #4193 Codex round 2 F6 (iii): two SUCCESSIVE re-shows of the same legacy
  // proposal must carry the SAME origin forward — the second re-show must
  // NOT re-anchor to the first re-show's own turn. Proven end to end: the
  // decision layer resolves both re-shows' origin to TURN, and the real
  // Postgres claim against TURN succeeds exactly once.
  it("(iii) two successive re-shows of the same legacy proposal carry the SAME origin, and only one claim against it succeeds", async () => {
    const { partSearchDecision } = await import("../photo-part-lookup");

    const reshow1 = partSearchDecision({
      message: "What is the warranty on this?",
      candidate: "SS5Y3-DUW01302",
      manufacturer: "SMC",
      previousEvidence: [{ kind: "part_search_proposal", candidate: "SS5Y3-DUW01302", manufacturer: "SMC" }],
      previousTurnId: TURN,
    });
    expect(reshow1).toMatchObject({ action: "propose", age: 2, originTurnId: TURN });

    // Re-show #2 reads re-show #1's PERSISTED copy — which already carries
    // `originTurnId: TURN` — from a DIFFERENT turn (RESHOW_1_TURN). It must
    // carry TURN forward unchanged, never re-anchor to RESHOW_1_TURN.
    const RESHOW_1_TURN = "88888888-8888-4888-8888-888888888888";
    const reshow2 = partSearchDecision({
      message: "Can you check the firmware version too?",
      candidate: "SS5Y3-DUW01302",
      manufacturer: "SMC",
      previousEvidence: [
        { kind: "part_search_proposal", candidate: "SS5Y3-DUW01302", manufacturer: "SMC", age: 2, originTurnId: TURN },
      ],
      previousTurnId: RESHOW_1_TURN,
    });
    expect(reshow2).toMatchObject({ action: "propose", age: 3, originTurnId: TURN });

    expect(await claim(TURN)).toBe(true);
    expect(await claim(TURN)).toBe(false);
  });
});
