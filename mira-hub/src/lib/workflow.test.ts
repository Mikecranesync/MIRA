/**
 * Tests for the Hub-side WorkflowRun primitive (migration 044).
 *
 * Framework-free — runs with `bun test src/lib/workflow.test.ts` without
 * `bun install`. DB access is exercised through an in-memory fake WorkflowStore,
 * so no Postgres is required; the SQL itself is proven by the Python wrapper's
 * round-trip test against an ephemeral pg (the SQL is identical).
 */
import { expect, test, describe } from "vitest";
import {
  type CreateRowInput,
  type CreateRowResult,
  type FinalizeInput,
  type WorkflowStore,
  boundedJson,
  buildStepRecord,
  computeFinalStatus,
  runWorkflow,
} from "./workflow";

// A silent logger so test output stays clean.
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

class FakeStore implements WorkflowStore {
  creates: CreateRowInput[] = [];
  finals: FinalizeInput[] = [];
  // Configure a pre-existing run to simulate an idempotency conflict.
  existing: CreateRowResult | null = null;
  throwOnCreate = false;

  async create(row: CreateRowInput): Promise<CreateRowResult | null> {
    this.creates.push(row);
    if (this.throwOnCreate) throw new Error("db down");
    if (this.existing) return this.existing;
    return { runId: row.runId, alreadySucceeded: false, retryCount: row.retryCount };
  }

  async finalize(input: FinalizeInput): Promise<void> {
    this.finals.push(input);
  }
}

// --------------------------------------------------------------------------- //
// Pure helpers
// --------------------------------------------------------------------------- //

describe("computeFinalStatus", () => {
  test("clean → ok", () => expect(computeFinalStatus(false, false)).toBe("ok"));
  test("clean + degraded → degraded", () => expect(computeFinalStatus(false, true)).toBe("degraded"));
  test("threw always → failed", () => expect(computeFinalStatus(true, true)).toBe("failed"));
});

describe("boundedJson", () => {
  test("null/undefined → null", () => {
    expect(boundedJson(null)).toBeNull();
    expect(boundedJson(undefined)).toBeNull();
  });
  test("small object round-trips", () => {
    expect(boundedJson({ a: 1 })).toBe('{"a":1}');
  });
  test("oversized → truncated marker", () => {
    const out = boundedJson({ blob: "z".repeat(20_000) });
    expect(out).toContain('"_truncated":true');
  });
});

describe("buildStepRecord", () => {
  test("ok step has no error/artifact keys", () => {
    const rec = buildStepRecord({ stepName: "p", status: "ok", startedAt: new Date(0), finishedAt: new Date(5) });
    expect(rec.step_name).toBe("p");
    expect(rec.duration_ms).toBe(5);
    expect("error" in rec).toBe(false);
    expect("artifact" in rec).toBe(false);
  });
  test("artifact stored as parsed JSON value", () => {
    const rec = buildStepRecord({
      stepName: "p",
      status: "ok",
      startedAt: new Date(0),
      finishedAt: new Date(1),
      artifact: { chunks: 7 },
    });
    expect(rec.artifact).toEqual({ chunks: 7 });
  });
  test("error truncated to 2000 chars", () => {
    const rec = buildStepRecord({
      stepName: "p",
      status: "failed",
      startedAt: new Date(0),
      finishedAt: new Date(1),
      error: "E".repeat(5000),
    });
    expect(rec.error?.length).toBe(2000);
  });
});

// --------------------------------------------------------------------------- //
// Lifecycle via runWorkflow + FakeStore
// --------------------------------------------------------------------------- //

describe("runWorkflow", () => {
  test("happy path → ok, create + finalize, steps recorded", async () => {
    const store = new FakeStore();
    const out = await runWorkflow(
      { workflowName: "unit", tenantId: "t1", input: { k: 1 }, store, logger: quiet },
      async (run) => {
        const v = await run.step("double", () => 21 * 2);
        run.setOutput({ answer: v });
        return v;
      },
    );
    expect(out).toBe(42);
    expect(store.creates.length).toBe(1);
    expect(store.finals.length).toBe(1);
    expect(store.finals[0].status).toBe("ok");
    const steps = JSON.parse(store.finals[0].stepArtifacts);
    expect(steps.map((s: { step_name: string }) => s.step_name)).toEqual(["double"]);
    expect(store.finals[0].output).toBe('{"answer":42}');
  });

  test("tolerated step failure → degraded, returns null", async () => {
    const store = new FakeStore();
    await runWorkflow({ workflowName: "unit", store, logger: quiet }, async (run) => {
      const r = await run.step(
        "boom",
        () => {
          throw new Error("nope");
        },
        { tolerate: true },
      );
      expect(r).toBeNull();
    });
    expect(store.finals[0].status).toBe("degraded");
    const steps = JSON.parse(store.finals[0].stepArtifacts);
    expect(steps[0].status).toBe("failed");
    expect(steps[0].error).toContain("nope");
  });

  test("untolerated step failure → failed + rethrows", async () => {
    const store = new FakeStore();
    await expect(
      runWorkflow({ workflowName: "unit", store, logger: quiet }, async (run) => {
        await run.step("boom", () => {
          throw new Error("kaboom");
        });
      }),
    ).rejects.toThrow("kaboom");
    expect(store.finals[0].status).toBe("failed");
    expect(store.finals[0].errorDetail).toContain("kaboom");
  });

  test("recordStep failed marks the run degraded", async () => {
    const store = new FakeStore();
    await runWorkflow({ workflowName: "unit", store, logger: quiet }, async (run) => {
      run.recordStep("manual", "failed", { error: "partial" });
    });
    expect(store.finals[0].status).toBe("degraded");
  });

  test("alreadySucceeded surfaced from a conflicting run", async () => {
    const store = new FakeStore();
    store.existing = { runId: "existing-id", alreadySucceeded: true, retryCount: 3 };
    await runWorkflow(
      { workflowName: "unit", idempotencyKey: "k", store, logger: quiet },
      async (run) => {
        expect(run.runId).toBe("existing-id");
        expect(run.alreadySucceeded).toBe(true);
        expect(run.retryCount).toBe(3);
      },
    );
  });

  test("fail-open: store.create throwing does NOT break the body", async () => {
    const store = new FakeStore();
    store.throwOnCreate = true;
    let ran = false;
    const out = await runWorkflow({ workflowName: "unit", store, logger: quiet }, async (run) => {
      await run.step("work", () => {
        ran = true;
        return 1;
      });
      return "done";
    });
    expect(ran).toBe(true);
    expect(out).toBe("done");
    // create failed → not recorded → finalize is skipped (no row to update)
    expect(store.finals.length).toBe(0);
  });
});
