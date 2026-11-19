/** Real SQL regression probes; only the owned WF-01 loopback fixture is allowed. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

const { testPool, lockPool } = await vi.hoisted(async () => {
  const value = process.env.TEST_DATABASE_URL;
  const { workflowDatabaseConfig } = await import("./disposable-db");
  const config = workflowDatabaseConfig(value, process.env.MIRA_TEST_DB_CONFIRM);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ ...config, max: 5, application_name: "wf01-observation-test" }) as Pool,
    lockPool: new PgPool({ ...config, max: 1 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
import { pgWorkflowStore, runWorkflow } from "@/lib/workflow";
import { observation } from "@/lib/__tests__/workflow-fixture";

const quiet = { info() {}, warn() {}, error() {} };
beforeAll(async () => {
  const { rows } = await testPool.query("SELECT current_database() AS db");
  expect(rows[0].db).toBe("mira_wf01_test");
  const ledger = await testPool.query("SELECT file_name FROM integration_schema_migrations WHERE file_name = '044_workflow_runs.sql'");
  expect(ledger.rowCount).toBe(1);
});
afterAll(async () => { await testPool.end(); await lockPool.end(); });

describe("workflow observation persistence isolation", () => {
  it("fences a delayed checkpoint after the observing attempt finishes waiting", async () => {
    const obs = observation(); obs.identity.attemptId = randomUUID();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let late: Promise<void> | undefined;
    const sink = { ...pgWorkflowStore, checkpoint: (input: Parameters<NonNullable<typeof pgWorkflowStore.checkpoint>>[0]) => {
      late = gate.then(() => pgWorkflowStore.checkpoint!(input)); return late;
    } };
    try {
      await runWorkflow({ workflowName: obs.definition.name, observation: obs, observationTimeoutMs: 10, store: sink, logger: quiet }, async (run) => {
        await run.checkpoint(obs);
        run.setObservation({ ...obs, state: "waiting", cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
      });
      release(); await late;
      const { rows } = await testPool.query("SELECT output, finished_at FROM workflow_runs WHERE run_id = $1", [obs.identity.attemptId]);
      expect(rows[0].output.workflow).toMatchObject({ state: "waiting", cancellation: { requested: true } });
      expect(rows[0].finished_at).not.toBeNull();
    } finally { release(); await late; }
  });

  it("drops locked observation writes without starving ordinary work on the five-connection pool", async () => {
    const locker = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    let completed = false;
    let completedBeforeUnlock = false;
    try {
      await locker.query("BEGIN; LOCK TABLE workflow_runs IN ACCESS EXCLUSIVE MODE");
      for (let i = 0; i < 5; i++) {
        const obs = observation(); obs.identity.attemptId = randomUUID();
        pending.push(runWorkflow({ workflowName: obs.definition.name, observation: obs, logger: quiet }, async () => {
          const { rows } = await testPool.query("SELECT 42 AS domain_result"); return rows[0].domain_result;
        }));
        if (i === 0) {
          // Establish real lock contention before the other requests start.
          await vi.waitFor(async () => {
            const result = await locker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'wf01-observation-test' AND wait_event_type = 'Lock'");
            expect(result.rows[0].n).toBeGreaterThan(0);
          }, { timeout: 500, interval: 5 });
        }
        // Separate request arrivals, while their database writes still overlap.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await Promise.race([
        Promise.all(pending).then((values) => { completed = values.every((v) => v === 42); }),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      completedBeforeUnlock = completed;
    } finally {
      await locker.query("ROLLBACK"); locker.release();
      await Promise.allSettled(pending);
    }
    expect(completedBeforeUnlock).toBe(true);
    expect(testPool.waitingCount).toBe(0);
    expect((await testPool.query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("0");
  });
});
