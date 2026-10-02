/**
 * #4193 Codex round 3 F7 (HIGH) — a fresh proposal's `originTurnId` must be
 * the ACTUAL persisted database row id, never route.ts's tracing/client-
 * request id. route.ts:912: `const turnId = clientRequestId ?? crypto.randomUUID();`
 * — the comment there says plainly it is never the DB row id. Persisted
 * turns get their id from `gen_random_uuid()` (migration 073; INSERTs in
 * `equipment-notebooks.ts` never supply `id`), independently of `turnId`.
 *
 * The regression (route.ts:2152, now fixed): `const originTurnId =
 * partSearch.originTurnId ?? turnId;` persisted the tracing id onto a FRESH
 * proposal (which has no `originTurnId` of its own yet). `claimPartSearchProposal`'s
 * `WHERE id = originTurnId` then matched no row, and a technician's very
 * first, never-before-claimed confirmation was refused as "already used".
 *
 * Proven here against REAL Postgres — `recordTurn`/`listTurns` are the real
 * `equipment-notebooks.ts` functions, not mocks: fresh proposal -> persisted
 * -> confirmed, using the real `partSearchDecision()` and
 * `claimPartSearchProposal()`. Exactly one claim succeeds and a re-shown
 * copy afterward cannot spend it again. Both with and without a
 * `clientRequestId` (recordTurn's insert-vs-reuse path differs).
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… node scripts/setup-integration-db.mjs
 *      then: npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/part-search-fresh-origin.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT = "55555555-0000-4000-8000-0000000007f7";
const OWNER = "f7-owner-integration";

// vi.mock factories are hoisted above every import, so the pool the mock
// hands to `@/lib/db` must itself be created in a hoisted block.
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});
vi.mock("@/lib/db", () => ({ default: pool }));

import { listTurns, recordTurn } from "../../lib/equipment-notebooks";
import { PART_SEARCH_PROPOSAL_KIND, partSearchConfirmation, partSearchDecision } from "../photo-part-lookup";
import { claimPartSearchProposal } from "../part-search-claim";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function q(sql: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    return await c.query(sql, values);
  } finally {
    c.release();
  }
}

let nb = "";

run("#4193 F7: a fresh proposal's origin is the real persisted row id (real Postgres)", () => {
  beforeAll(async () => {
    const r = await q(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'F7 origin test', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT],
    );
    nb = r.rows[0].id;
  });
  afterAll(async () => {
    await q(`DELETE FROM equipment_notebook_turns WHERE tenant_id = $1::uuid`, [TENANT]);
    await q(`DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid`, [TENANT]);
    await pool.end();
  });

  it.each([
    ["with a clientRequestId", "66666666-0000-4000-8000-0000000007f7"],
    ["without a clientRequestId (pure tracing UUID)", null],
  ] as const)(
    "fresh proposal %s: persisted origin is the REAL row id — confirm succeeds exactly once, a re-show cannot spend it again",
    async (_label, clientRequestId) => {
      const CANDIDATE = "F7-" + Math.random().toString(36).slice(2, 10).toUpperCase();

      // route.ts's own tracing-id derivation (route.ts:912) — kept here only
      // to prove it is NEVER what gets persisted as the origin below (the
      // Codex F7 regression: it used to be exactly this value).
      const turnId = clientRequestId ?? crypto.randomUUID();

      const decision = partSearchDecision({
        message: "Look up the PDF manual",
        candidate: CANDIDATE,
        manufacturer: null,
        previousEvidence: [],
      });
      // A fresh propose carries NO origin from the pure decision yet.
      expect(decision).toEqual({ action: "propose", candidate: CANDIDATE, age: 1 });
      if (decision.action !== "propose") throw new Error("unreachable");

      // route.ts's FIXED line (route.ts:2152): `const originTurnId =
      // partSearch.originTurnId;` — NEVER falls back to `turnId`. For a
      // fresh propose this is `undefined`, omitted entirely from the
      // persisted evidence (the true-legacy shape F6 already resolves).
      const originTurnId = decision.originTurnId;
      expect(originTurnId).toBeUndefined();

      const freshRowId = await recordTurn(TENANT, nb, {
        question: "Look up the PDF manual",
        answerStatus: "insufficient_evidence",
        answerText: "proposal",
        enabledSourceDocIds: [],
        evidence: [{ kind: PART_SEARCH_PROPOSAL_KIND, candidate: CANDIDATE, manufacturer: null, age: 1, originTurnId }],
        model: null,
        ownerUserId: OWNER,
        clientRequestId,
      });
      expect(freshRowId).toBeTruthy();
      // The tracing id this proposal did NOT persist is never the
      // database-generated row id it DID persist under.
      expect(turnId).not.toBe(freshRowId);

      // The technician's very next message confirms the offer. route.ts
      // reads it back out of history exactly like this.
      const last = (await listTurns(TENANT, nb, 1, { viewerUserId: OWNER })).at(-1);
      expect(last?.id).toBe(freshRowId);
      const confirmDecision = partSearchDecision({
        message: partSearchConfirmation(CANDIDATE),
        candidate: CANDIDATE,
        manufacturer: null,
        previousEvidence: last!.evidence,
        previousTurnId: last!.id,
      });
      if (confirmDecision.action !== "search") throw new Error(`expected search, got ${confirmDecision.action}`);

      // The resolved origin is the REAL persisted row — never the tracing
      // id. Before the fix, this was `turnId` and the claim below failed.
      expect(confirmDecision.originTurnId).toBe(freshRowId);
      const claimed = await claimPartSearchProposal({
        tenantId: TENANT,
        notebookId: nb,
        originTurnId: confirmDecision.originTurnId,
        ownerUserId: OWNER,
      });
      // The technician's first-ever, never-claimed confirmation succeeds.
      expect(claimed).toBe(true);

      // A retried confirmation of the SAME offer must not spend it twice.
      expect(
        await claimPartSearchProposal({ tenantId: TENANT, notebookId: nb, originTurnId: freshRowId!, ownerUserId: OWNER }),
      ).toBe(false);

      // A re-shown copy, persisted on a NEW turn carrying the SAME origin,
      // must also be rejected once that origin is already consumed.
      const reshowRowId = await recordTurn(TENANT, nb, {
        question: "What is the warranty on this?",
        answerStatus: "insufficient_evidence",
        answerText: "re-shown proposal",
        enabledSourceDocIds: [],
        evidence: [{ kind: PART_SEARCH_PROPOSAL_KIND, candidate: CANDIDATE, manufacturer: null, age: 2, originTurnId: freshRowId }],
        model: null,
        ownerUserId: OWNER,
      });
      expect(reshowRowId).toBeTruthy();
      expect(
        await claimPartSearchProposal({ tenantId: TENANT, notebookId: nb, originTurnId: freshRowId!, ownerUserId: OWNER }),
      ).toBe(false);
    },
  );
});
