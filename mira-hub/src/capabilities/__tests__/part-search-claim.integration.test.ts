/**
 * #4171 Codex F3 — a photo part-search proposal authorizes exactly ONE search,
 * proven against real Postgres (the guarantee lives in the conditional UPDATE,
 * which no mock can prove).
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
    await client.query(
      `INSERT INTO equipment_notebook_turns (id, notebook_id, tenant_id, question, evidence, owner_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Look up the PDF manual',
               '[{"kind":"part_search_proposal","candidate":"SS5Y3-DUW01302","manufacturer":"SMC"}]'::jsonb, $4)`,
      [TURN, NB, TENANT, OWNER],
    );
  });

  const claim = async () => {
    const { claimPartSearchProposal } = await import("../part-search-claim");
    return claimPartSearchProposal({ tenantId: TENANT, notebookId: NB, proposalTurnId: TURN, ownerUserId: OWNER });
  };

  it("two concurrent confirmations: exactly one wins", async () => {
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
        proposalTurnId: TURN,
        ownerUserId: "55555555-5555-4555-8555-555555555555",
      }),
    ).toBe(false);
  });

  it("a turn without a proposal cannot be 'spent'", async () => {
    await client.query(`UPDATE equipment_notebook_turns SET evidence = '[]'::jsonb WHERE id = $1::uuid`, [TURN]);
    expect(await claim()).toBe(false);
  });

  // #4193 Codex F3: a re-show persists a COPY of the same logical offer onto
  // a NEW turn row (same stable `id`, new turn id) — this proves that once
  // the original has been consumed, confirming the copy (racing or retried)
  // cannot mint a second spendable search for the same underlying offer.
  // No mock can prove this: the guarantee is the cross-row NOT EXISTS clause
  // actually evaluated by real Postgres inside the conditional UPDATE.
  it("a re-shown copy of an already-consumed offer is not independently spendable", async () => {
    const { claimPartSearchProposal } = await import("../part-search-claim");
    const PROPOSAL_ID = "proposal-abc-123";
    const RESHOWN_TURN = "66666666-6666-4666-8666-666666666666";

    // The original proposal (age: 1) is confirmed first — the real-world
    // ordering a race can produce: a confirmation observes it and claims it
    // BEFORE a concurrent, unrelated reply's stale read of the same evidence
    // gets persisted as a re-show.
    await client.query(
      `UPDATE equipment_notebook_turns
          SET evidence = '[{"kind":"part_search_proposal","candidate":"SS5Y3-DUW01302","manufacturer":"SMC","age":1,"id":"${PROPOSAL_ID}"}]'::jsonb
        WHERE id = $1::uuid`,
      [TURN],
    );
    expect(
      await claimPartSearchProposal({
        tenantId: TENANT,
        notebookId: NB,
        proposalTurnId: TURN,
        ownerUserId: OWNER,
        proposalId: PROPOSAL_ID,
      }),
    ).toBe(true);

    // The re-show, read before the confirmation above landed, now persists a
    // SEPARATE turn carrying a copy of the SAME offer (same id, age bumped).
    await client.query(`DELETE FROM equipment_notebook_turns WHERE id = $1::uuid`, [RESHOWN_TURN]);
    await client.query(
      `INSERT INTO equipment_notebook_turns (id, notebook_id, tenant_id, question, evidence, owner_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'What is the warranty on this?',
               $4::jsonb, $5)`,
      [
        RESHOWN_TURN,
        NB,
        TENANT,
        `[{"kind":"part_search_proposal","candidate":"SS5Y3-DUW01302","manufacturer":"SMC","age":2,"id":"${PROPOSAL_ID}"}]`,
        OWNER,
      ],
    );

    // A later confirmation against the re-shown copy must NOT trigger a
    // second discovery call — the claim on the copy's own turn id must fail
    // because the same proposal id was already consumed elsewhere.
    expect(
      await claimPartSearchProposal({
        tenantId: TENANT,
        notebookId: NB,
        proposalTurnId: RESHOWN_TURN,
        ownerUserId: OWNER,
        proposalId: PROPOSAL_ID,
      }),
    ).toBe(false);

    await client.query(`DELETE FROM equipment_notebook_turns WHERE id = $1::uuid`, [RESHOWN_TURN]);
  });
});
