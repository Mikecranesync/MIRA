// Light-review TOCTOU finding on PR #4195 (HIGH, confirm route ~L130-173):
// two concurrent confirms for DIFFERENT identities on the SAME unconfirmed
// notebook used to both pass a read-then-write guard and both return 200,
// the second write silently winning. `confirmNotebookIdentity`
// (notebook-manual-acquisition.ts) folds the guard into the UPDATE's own
// WHERE clause so Postgres's row lock serializes the race.
//
// Requires a disposable Postgres. From mira-hub/ :
//
//   docker run -d --name mira4195-pg -e POSTGRES_PASSWORD=testpw `
//     -e POSTGRES_DB=mira_test -p 55671:5432 postgres:16
//   $env:TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:55671/mira_test"
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   $env:MIRA_INTEGRATION_EXTRA_MIGRATIONS="100_notebook_manual_acquisition.sql," +
//     "101_notebook_manual_acquisition_revoke_trigger.sql," +
//     "102_notebook_manual_acquisition_revoke_spares_confirmed.sql," +
//     "104_notebook_manual_acquisition_confirm_promotes.sql"
//   node scripts/setup-integration-db.mjs
//   npx vitest run --config vitest.integration.config.ts "src/capabilities/__tests__/notebook-identity-confirm.integration.test.ts"
//
// NOTE: CI does not currently run this file. `turn-lifecycle-reconciliation`
// (.github/workflows/ci.yml) is the only CI job that runs mira-hub's
// *.integration.test.ts suite under real Postgres, and it hardcodes its own
// two test files by name rather than globbing the directory — the SAME
// status as the sibling `node-files-links.integration.test.ts` (see that
// file's own header), which this file's harness pattern is copied from.
// Wiring this file into that job (or a new one) is left for a follow-up PR:
// `.github/workflows/**` is guarded control-plane under the FactoryLM
// Unified UI Cutover charter's defense-in-depth rule
// (`.claude/rules/factorylm-unified-ui-cutover.md`), and this remediation
// does not touch workflow files. This is a local/manual proof until then.
//
// WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST.
// The sibling unit suite (notebook-manual-acquisition.test.ts) mocks
// `withTenantContext` to a fake client — it can assert the SQL TEXT is
// generated correctly, but it cannot prove the race is actually closed,
// because that proof is a property of Postgres's row-lock + EvalPlanQual
// behavior under REAL concurrent connections, which a mocked client cannot
// model. Only two real sockets racing a real UPDATE against the same row
// exercise the guarantee this fix depends on.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { confirmNotebookIdentity } from "@/capabilities/notebook-manual-acquisition";

const TENANT = "4195beef-0000-4000-8000-000000000001";
// node_id carries no hard FK to kg_entities (073's own header) — a bare
// UUID is a valid, app-validated reference, so no kg_entities row is needed.
const NODE_ID = "4195beef-0000-4000-8000-000000000002";

async function makeNotebook(): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name)
     VALUES ($1::uuid, $2::uuid, 'TOCTOU bench')
     RETURNING id::text AS id`,
    [TENANT, NODE_ID],
  );
  return res.rows[0].id;
}

async function wipe() {
  await testPool.query(`DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid`, [TENANT]);
}

beforeAll(async () => {
  await wipe();
});

afterAll(async () => {
  await wipe();
  await testPool.end();
});

beforeEach(async () => {
  await wipe();
});

describe("confirmNotebookIdentity — TOCTOU race (light-review finding, PR #4195)", () => {
  it("exactly one of two concurrent confirms for DIFFERENT identities on an unconfirmed notebook wins; the loser gets the 409 guard, never a silent overwrite", async () => {
    const notebookId = await makeNotebook();

    const [a, b] = await Promise.all([
      confirmNotebookIdentity(TENANT, notebookId, {
        manufacturer: "SMC",
        model: "SS5Y3-DUW01302",
        catalogNumber: "",
      }),
      confirmNotebookIdentity(TENANT, notebookId, {
        manufacturer: "Rockwell Automation",
        model: "PowerFlex 525",
        catalogNumber: "",
      }),
    ]);

    const results = [a, b];
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    // The headline assertion: the race has EXACTLY one winner, not zero
    // (both blocked) and not two (both silently wrote). Without the atomic
    // WHERE-clause guard, this is the assertion that fails — both calls
    // would report `ok: true` because each ran its own unconditional
    // read-then-write with no shared lock to serialize against.
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    const loss = losses[0];
    if (loss.ok) throw new Error("unreachable — loss must be the ok:false branch");
    expect(loss.error).toBe("identity_already_confirmed");

    // The persisted row matches whichever call actually won — never a
    // hybrid of the two, never neither.
    const row = await testPool.query<{
      manufacturer: string;
      model: string;
      identity_status: string;
    }>(
      `SELECT manufacturer, model, identity_status
         FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [TENANT, notebookId],
    );
    expect(row.rows[0].identity_status).toBe("user_confirmed");
    const smcWon = a.ok;
    expect(row.rows[0].manufacturer).toBe(smcWon ? "SMC" : "Rockwell Automation");
    expect(row.rows[0].model).toBe(smcWon ? "SS5Y3-DUW01302" : "PowerFlex 525");
  });

  it("confirming the SAME identity concurrently twice is idempotent — both calls succeed, never a false 409", async () => {
    const notebookId = await makeNotebook();
    const identity = { manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "" };

    // Settle the identity first so both racing calls see an ALREADY
    // user_confirmed row with the SAME key — the idempotent-re-click case,
    // not the first-confirm race above.
    const first = await confirmNotebookIdentity(TENANT, notebookId, identity);
    expect(first.ok).toBe(true);

    const [a, b] = await Promise.all([
      confirmNotebookIdentity(TENANT, notebookId, identity),
      confirmNotebookIdentity(TENANT, notebookId, identity),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("a confirm for a DIFFERENT identity against an ALREADY-settled notebook is rejected deterministically, not merely under a race", async () => {
    const notebookId = await makeNotebook();
    const first = await confirmNotebookIdentity(TENANT, notebookId, {
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      catalogNumber: "",
    });
    expect(first.ok).toBe(true);

    const second = await confirmNotebookIdentity(TENANT, notebookId, {
      manufacturer: "Rockwell Automation",
      model: "PowerFlex 525",
      catalogNumber: "",
    });
    expect(second.ok).toBe(false);
    if (second.ok || second.error !== "identity_already_confirmed") {
      throw new Error("expected identity_already_confirmed");
    }
    expect(second.manufacturer).toBe("SMC");
    expect(second.model).toBe("SS5Y3-DUW01302");

    // Unchanged — the rejected confirm never touched the row.
    const row = await testPool.query<{ manufacturer: string }>(
      `SELECT manufacturer FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [TENANT, notebookId],
    );
    expect(row.rows[0].manufacturer).toBe("SMC");
  });

  it("reports confirm_failed (not identity_already_confirmed) when the notebook no longer exists", async () => {
    const ghostId = "4195beef-0000-4000-8000-0000000000ff";
    const result = await confirmNotebookIdentity(TENANT, ghostId, {
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      catalogNumber: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — result must be the ok:false branch");
    expect(result.error).toBe("confirm_failed");
  });
});
