/**
 * Turn ownership and request-id fencing against REAL Postgres (migrations 086–089 applied by
 * scripts/setup-integration-db.mjs). Proves, on the actual schema and RLS:
 *
 *   - a legacy row (owner_user_id IS NULL) is readable by every tenant user
 *     and labeled sharedLegacy
 *   - User A's new turn is invisible to User B on the SAME shared notebook
 *   - a turn cannot be written into a notebook of another tenant (atomic
 *     INSERT … SELECT against equipment_notebooks)
 *   - stale lease holders cannot abandon or complete a successor's request
 *
 * Run: cd mira-hub && MIRA_TEST_DB_CONFIRM=DISPOSABLE TEST_DATABASE_URL=… npm run db:integration:setup && npx vitest run --config vitest.integration.config.ts src/lib/__tests__/notebook-turn-owner
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const USER_A = "user-a-integration";
const USER_B = "user-b-integration";

// vi.mock factories are hoisted above every import, so the pool the mock hands
// to `@/lib/db` must itself be created in a hoisted block.
const { pool } = await vi.hoisted(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl) {
    const target = new URL(databaseUrl);
    if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || /prod|prd|staging/i.test(`${target.hostname} ${target.pathname}`)) {
      throw new Error("Turn integration tests require a loopback TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM=DISPOSABLE");
    }
  }
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: databaseUrl }) };
});

vi.mock("@/lib/db", () => ({ default: pool }));

import {
  abandonNotebookTurnRequest,
  claimNotebookTurnRequest,
  listTurns,
  NotebookNotFoundError,
  recordTurn,
} from "../equipment-notebooks";
import { turnsFromPersisted, type HubNotebookMeta } from "../../factorylm-ui/to-interaction";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let nbA = "";
let nbB = "";
let fixtureVerified = false;

async function q(sql: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    return await c.query(sql, values);
  } finally {
    c.release();
  }
}

run("equipment_notebook_turns.owner_user_id (integration)", () => {
  beforeAll(async () => {
    const ledger = await q("SELECT to_regclass('public.integration_schema_migrations') AS ledger");
    if (!ledger.rows[0]?.ledger) throw new Error("Run db:integration:setup on the disposable fixture first");
    const required = ["081_notebook_asset_binding.sql", "086_notebook_turn_owner.sql", "089_notebook_turn_request_claim.sql"];
    const applied = await q("SELECT file_name FROM public.integration_schema_migrations WHERE file_name = ANY($1::text[])", [required]);
    if (applied.rows.length !== required.length) throw new Error("Required disposable turn fixture migrations are missing");
    fixtureVerified = true;
    const a = await q(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'Shared conveyor', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT_A],
    );
    nbA = a.rows[0].id;
    const b = await q(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'Other tenant notebook', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT_B],
    );
    nbB = b.rows[0].id;
    // A pre-086 row: ownerless, shared history.
    await q(
      `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_text) VALUES ($1::uuid, $2::uuid, 'legacy q', 'legacy a')`,
      [nbA, TENANT_A],
    );
  });

  afterAll(async () => {
    try {
      if (fixtureVerified) {
        const ownedNotebookIds = [nbA, nbB].filter(Boolean);
        await q(`DELETE FROM equipment_notebook_turns WHERE notebook_id = ANY($1::uuid[]) AND tenant_id IN ($2::uuid, $3::uuid)`, [ownedNotebookIds, TENANT_A, TENANT_B]);
        await q(`DELETE FROM equipment_notebooks WHERE id = ANY($1::uuid[]) AND tenant_id IN ($2::uuid, $3::uuid)`, [ownedNotebookIds, TENANT_A, TENANT_B]);
      }
    } finally {
      await pool.end();
    }
  });

  it("User A's new turn is private; legacy is shared and labeled; User B sees legacy only", async () => {
    await recordTurn(TENANT_A, nbA, {
      question: "A's private question",
      answerStatus: "answered",
      answerText: "A's answer",
      enabledSourceDocIds: [],
      evidence: [],
      model: null,
      ownerUserId: USER_A,
    });

    const seenByA = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_A });
    expect(seenByA.map((t) => [t.question, t.sharedLegacy])).toEqual([
      ["legacy q", true],
      ["A's private question", false],
    ]);

    const seenByB = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_B });
    expect(seenByB.map((t) => t.question)).toEqual(["legacy q"]);
    expect(seenByB[0].sharedLegacy).toBe(true);

    // The legacy row was never silently assigned an owner.
    const legacy = await q(`SELECT owner_user_id FROM equipment_notebook_turns WHERE tenant_id = $1::uuid AND question = 'legacy q'`, [TENANT_A]);
    expect(legacy.rows[0].owner_user_id).toBeNull();
  });

  it("round-trips the stored machine scope on a document-only answer through history and hydration", async () => {
    const machineId = "machine-snapshot-integration";
    await recordTurn(TENANT_A, nbA, {
      question: "machine snapshot without telemetry",
      answerStatus: "answered",
      answerText: "The applicable manual defines acceleration time.",
      enabledSourceDocIds: [], evidence: [], model: null,
      ownerUserId: USER_A, equipmentEntityId: machineId, assetUnsPath: "qa.garage.cv_101",
    });
    const stored = await q("SELECT equipment_entity_id, asset_uns_path FROM equipment_notebook_turns WHERE notebook_id = $1::uuid AND question = $2", [nbA, "machine snapshot without telemetry"]);
    expect(stored.rows[0]).toEqual({ equipment_entity_id: machineId, asset_uns_path: "qa.garage.cv_101" });
    const own = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_A });
    const saved = own.find((t) => t.question === "machine snapshot without telemetry")!;
    expect(saved).toMatchObject({ equipmentEntityId: machineId });
    const meta: HubNotebookMeta = { notebookId: nbA, title: "CV-101", tenantId: TENANT_A, capturedAt: new Date().toISOString(), asset: { id: machineId, name: "CV-101" }, identityConfirmed: true };
    const [, answer] = turnsFromPersisted(saved as Parameters<typeof turnsFromPersisted>[0], meta);
    expect(answer.context).toMatchObject({ machineId, machineIdentity: "confirmed", evidenceAuthorization: "authorized" });
    expect(answer.parts.some((p) => p.type === "machine_evidence")).toBe(false);
    const rebound = turnsFromPersisted(saved as Parameters<typeof turnsFromPersisted>[0], { ...meta, asset: { id: "other-machine", name: "Other conveyor" } })[1];
    expect(rebound.context).toMatchObject({ machineId, machineIdentity: "unconfirmed", evidenceAuthorization: "not_authorized" });
    const otherUser = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_B });
    expect(otherUser.some((t) => t.question === saved.question)).toBe(false);
    expect(await listTurns(TENANT_B, nbA, 50, { viewerUserId: USER_A })).toEqual([]);
  });

  it("a turn cannot be written into another tenant's notebook", async () => {
    await expect(
      recordTurn(TENANT_A, nbB, {
        question: "cross-tenant write",
        answerStatus: "answered",
        answerText: "should not land",
        enabledSourceDocIds: [],
        evidence: [],
        model: null,
        ownerUserId: USER_A,
      }),
    ).rejects.toBeInstanceOf(NotebookNotFoundError);
    const landed = await q(`SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE question = 'cross-tenant write'`);
    expect(landed.rows[0].n).toBe(0);
  });

  it("claims before inference, hides pending state, and replays one exact terminal turn", async () => {
    const clientRequestId = "cccccccc-0000-4000-8000-00000000000c";
    const requestPayload = { question: "idempotent safety question", image: null };
    const [first, second] = await Promise.all([
      claimNotebookTurnRequest(TENANT_A, nbA, {
        ownerUserId: USER_A,
        clientRequestId,
        question: "idempotent safety question",
        requestPayload,
      }),
      claimNotebookTurnRequest(TENANT_A, nbA, {
        ownerUserId: USER_A,
        clientRequestId,
        question: "idempotent safety question",
        requestPayload,
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual(["claimed", "in_progress"]);
    const claim = first.status === "claimed" ? first : second;
    if (claim.status !== "claimed") throw new Error("expected the first request to own the claim");
    const whilePending = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_A });
    expect(whilePending.some((turn) => turn.question === "idempotent safety question")).toBe(false);

    const turn = {
      question: "idempotent safety question",
      answerStatus: "answered" as const,
      answerText: "SAFETY STOP",
      enabledSourceDocIds: [] as string[],
      evidence: [
        { kind: "safety_notice", trigger: "smoke" },
        { kind: "safety_stop", trigger: "smoke" },
      ],
      model: null,
      ownerUserId: USER_A,
      clientRequestId,
      claimToken: claim.claimToken,
    };
    await recordTurn(TENANT_A, nbA, turn);

    const replay = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "idempotent safety question",
      requestPayload,
    });
    expect(replay).toMatchObject({
      status: "replay",
      turn: {
        question: "idempotent safety question",
        answerStatus: "answered",
        answerText: "SAFETY STOP",
        enabledSourceDocIds: [],
        evidence: [
          { kind: "safety_notice", trigger: "smoke" },
          { kind: "safety_stop", trigger: "smoke" },
        ],
        model: null,
        basis: null,
      },
    });
    const landed = await q(
      `SELECT count(*)::int AS n FROM equipment_notebook_turns
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );
    expect(landed.rows[0].n).toBe(1);
  });

  it("does not let a stale claimant abandon a successor's recovered lease", async () => {
    const clientRequestId = "dddddddd-0000-4000-8000-00000000000d";
    const requestPayload = { message: "lease takeover", sourceDocIds: [] };
    const first = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "lease takeover",
      requestPayload,
    });
    if (first.status !== "claimed") throw new Error("expected the first lease");

    await q(
      `UPDATE equipment_notebook_turns
          SET client_request_started_at = now() - interval '11 minutes'
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );

    const successor = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "lease takeover",
      requestPayload,
    });
    if (successor.status !== "claimed") throw new Error("expected the stale lease to be recovered");
    expect(successor.claimToken).not.toBe(first.claimToken);

    await abandonNotebookTurnRequest(TENANT_A, nbA, USER_A, clientRequestId, first.claimToken);
    await expect(
      claimNotebookTurnRequest(TENANT_A, nbA, {
        ownerUserId: USER_A,
        clientRequestId,
        question: "lease takeover",
        requestPayload,
      }),
    ).resolves.toEqual({ status: "in_progress" });

    const row = await q(
      `SELECT client_request_claim_token::text AS claim_token
         FROM equipment_notebook_turns
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );
    expect(row.rows[0].claim_token).toBe(successor.claimToken);
  });

  it("does not let a stale claimant accept a successor's completed turn", async () => {
    const clientRequestId = "ffffffff-0000-4000-8000-00000000000f";
    const requestPayload = { message: "completion takeover", sourceDocIds: [] };
    const first = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "completion takeover",
      requestPayload,
    });
    if (first.status !== "claimed") throw new Error("expected the first lease");

    await q(
      `UPDATE equipment_notebook_turns
          SET client_request_started_at = now() - interval '11 minutes'
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );
    const successor = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "completion takeover",
      requestPayload,
    });
    if (successor.status !== "claimed") throw new Error("expected the successor lease");

    const turn = {
      question: "completion takeover",
      answerStatus: "answered" as const,
      enabledSourceDocIds: [] as string[],
      evidence: [] as unknown[],
      model: null,
      ownerUserId: USER_A,
      clientRequestId,
    };
    await recordTurn(TENANT_A, nbA, {
      ...turn,
      answerText: "successor winner",
      claimToken: successor.claimToken,
    });
    await expect(
      recordTurn(TENANT_A, nbA, {
        ...turn,
        answerText: "stale divergent answer",
        claimToken: first.claimToken,
      }),
    ).rejects.toBeInstanceOf(NotebookNotFoundError);

    const row = await q(
      `SELECT answer_text
         FROM equipment_notebook_turns
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );
    expect(row.rows[0].answer_text).toBe("successor winner");
  });

  it("does not let a stale claimant insert after the successor abandons", async () => {
    const clientRequestId = "11111111-0000-4000-8000-000000000011";
    const requestPayload = { message: "abandoned takeover", sourceDocIds: [] };
    const first = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "abandoned takeover",
      requestPayload,
    });
    if (first.status !== "claimed") throw new Error("expected the first lease");

    await q(
      `UPDATE equipment_notebook_turns
          SET client_request_started_at = now() - interval '11 minutes'
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );
    const successor = await claimNotebookTurnRequest(TENANT_A, nbA, {
      ownerUserId: USER_A,
      clientRequestId,
      question: "abandoned takeover",
      requestPayload,
    });
    if (successor.status !== "claimed") throw new Error("expected the successor lease");
    await abandonNotebookTurnRequest(TENANT_A, nbA, USER_A, clientRequestId, successor.claimToken);

    await expect(
      recordTurn(TENANT_A, nbA, {
        question: "abandoned takeover",
        answerStatus: "answered",
        answerText: "stale answer after abandon",
        enabledSourceDocIds: [],
        evidence: [],
        model: null,
        ownerUserId: USER_A,
        clientRequestId,
        claimToken: first.claimToken,
      }),
    ).rejects.toBeInstanceOf(NotebookNotFoundError);

    const landed = await q(
      `SELECT count(*)::int AS n
         FROM equipment_notebook_turns
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND owner_user_id = $3 AND client_request_id = $4::uuid`,
      [TENANT_A, nbA, USER_A, clientRequestId],
    );
    expect(landed.rows[0].n).toBe(0);
  });

  it("fails closed on a keyed 088 row whose request payload was never backfilled", async () => {
    const clientRequestId = "eeeeeeee-0000-4000-8000-00000000000e";
    await q(
      `INSERT INTO equipment_notebook_turns
        (notebook_id, tenant_id, question, answer_status, answer_text,
         enabled_source_doc_ids, evidence, owner_user_id, client_request_id,
         client_request_state, client_request_payload)
       VALUES ($1::uuid, $2::uuid, 'legacy keyed request', 'answered', 'old answer',
               '[]'::jsonb, '[]'::jsonb, $3, $4::uuid, 'complete', NULL)`,
      [nbA, TENANT_A, USER_A, clientRequestId],
    );

    await expect(
      claimNotebookTurnRequest(TENANT_A, nbA, {
        ownerUserId: USER_A,
        clientRequestId,
        question: "legacy keyed request",
        requestPayload: { message: "legacy keyed request", sourceDocIds: ["changed"] },
      }),
    ).resolves.toEqual({ status: "mismatch" });
  });
});
