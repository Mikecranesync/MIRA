/**
 * R15 acquisition span tree (#4160 gate NO-GO row, PRD v1.7.1 R15) — the
 * root `manual_acquisition.run` span for the background (detached) and
 * inline (awaited) acquisition runs, asserted against the REAL tracer
 * (tracing.ts's in-memory exporter).
 *
 * @/capabilities/manual-acquisition is mocked with the SAME explicit,
 * non-spread shape notebook-manual-acquisition.test.ts already uses
 * (`{ acquireManualForIdentity: vi.fn() }`) — every test here supplies its
 * own `acquire` via the `deps.acquire` override instead, exactly as that
 * suite does, so the real pipeline's own spans are out of scope here (see
 * manual-acquisition-spans.test.ts for those).
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-manual-acquisition-spans.test.ts
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing__installInMemoryExporter, withSpan } from "@/capabilities/observability/tracing";

const db = vi.hoisted(() => ({ claimRows: 1 }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) => {
        if (/RETURNING manual_acquisition->>'gen'/.test(sql)) {
          return { rowCount: db.claimRows, rows: db.claimRows ? [{ gen: "g1" }] : [] };
        }
        return { rowCount: 1, rows: [] };
      }),
    }),
  ),
}));
vi.mock("@/lib/workspace-files", () => ({ attachFileToTargetsTx: vi.fn(async () => ({ ok: true, links: [] })) }));
// The real pipeline is covered by manual-acquisition-spans.test.ts; here it
// is a seam — every test supplies its own `acquire` via deps.
vi.mock("@/capabilities/manual-acquisition", () => ({ acquireManualForIdentity: vi.fn() }));

import { runManualAcquisition, startManualAcquisition } from "@/capabilities/notebook-manual-acquisition";

const confirmed = { identityStatus: "user_confirmed", manufacturer: "M", model: "TEST-123", catalogNumber: null };
const input = { tenantId: "t", userId: "u", notebookId: "nb", nodeId: "node", identity: confirmed };
const ON = { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" };

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
beforeAll(() => {
  handle = __testing__installInMemoryExporter();
});
beforeEach(() => {
  handle.reset();
  db.claimRows = 1;
});

describe("startManualAcquisition — root span (background, detached)", () => {
  it("carries a link to the turn span it was started inside, and is NOT a child of it (root:true)", async () => {
    const acquire = vi.fn(async () => ({ status: "no_manual_found" as const, payload: {} }));

    let started = false;
    await withSpan("test.turn", {}, async () => {
      started = await startManualAcquisition(input, { acquire, env: ON });
    });
    expect(started).toBe(true);

    const turn = handle.finished().find((s) => s.name === "test.turn")!;
    expect(turn).toBeTruthy();

    await vi.waitFor(() => {
      expect(handle.finished().find((s) => s.name === "manual_acquisition.run")).toBeTruthy();
    });
    const run = handle.finished().find((s) => s.name === "manual_acquisition.run")!;

    expect(run.links.length).toBeGreaterThan(0);
    expect(run.links[0].context.traceId).toBe(turn.spanContext().traceId);
    expect(run.links[0].context.spanId).toBe(turn.spanContext().spanId);
    // The detached run is a NEW trace, not a child — the turn's span may
    // already have ended by the time this background run finishes.
    expect(run.spanContext().traceId).not.toBe(turn.spanContext().traceId);
    expect(run.parentSpanContext).toBeUndefined();

    expect(run.attributes["mira.acquisition.basis"]).toBe("confirmed");
    expect(run.attributes["mira.acquisition.started_this_turn"]).toBe(true);
    expect(run.attributes["mira.acquisition.outcome"]).toBe("no_manual_found");
  });

  it("started_this_turn is false when nothing is active when the run starts", async () => {
    const acquire = vi.fn(async () => ({ status: "no_manual_found" as const, payload: {} }));
    expect(await startManualAcquisition(input, { acquire, env: ON })).toBe(true);
    await vi.waitFor(() => {
      expect(handle.finished().find((s) => s.name === "manual_acquisition.run")).toBeTruthy();
    });
    const run = handle.finished().find((s) => s.name === "manual_acquisition.run")!;
    expect(run.links.length).toBe(0);
    expect(run.attributes["mira.acquisition.started_this_turn"]).toBe(false);
  });
});

describe("runManualAcquisition — root span (inline, awaited)", () => {
  it("is a child of the active turn span — no link needed, it genuinely runs inside the turn", async () => {
    const acquire = vi.fn(async (i: unknown) => ({ status: "complete" as const, payload: {}, _echo: i }) as never);

    await withSpan("test.turn", {}, async () => {
      const result = await runManualAcquisition(
        { tenantId: "t", userId: "u", notebookId: "nb", nodeId: "node", identity: { manufacturer: "M", model: "TEST-123" } },
        { acquire, env: ON },
      );
      expect(result.started).toBe(true);
    });

    const spans = handle.finished();
    const turn = spans.find((s) => s.name === "test.turn")!;
    const run = spans.find((s) => s.name === "manual_acquisition.run")!;
    expect(run.spanContext().traceId).toBe(turn.spanContext().traceId);
    expect(run.parentSpanContext?.spanId).toBe(turn.spanContext().spanId);
    expect(run.links.length).toBe(0);
    expect(run.attributes["mira.acquisition.outcome"]).toBe("complete");
  });
});
