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

// Codex #4194 r3: the lifecycle wrappers make NO span of their own — the one
// manual_acquisition.run root is made inside acquireManualForIdentity (covered in
// manual-acquisition-spans.test.ts and acquisition-production-sampling.test.ts).
// Their only tracing job is to hand the chat turn's context through to it.
const TURN = { traceId: "1af7651916cd43dd8448eb211c80319c", spanId: "c7ad6b7169203331", traceFlags: 1 };

describe("startManualAcquisition — tracing seam (background, detached)", () => {
  it("passes the chat turn's span context through to the acquisition", async () => {
    const acquire = vi.fn(async (_i: unknown) => ({ status: "no_manual_found" as const, payload: {} }));
    expect(await startManualAcquisition({ ...input, turnSpanContext: TURN }, { acquire, env: ON })).toBe(true);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    expect((acquire.mock.calls[0][0] as { turnSpanContext?: unknown }).turnSpanContext).toEqual(TURN);
  });

  it("standalone (no turn): no turn context reaches the acquisition", async () => {
    const acquire = vi.fn(async (_i: unknown) => ({ status: "no_manual_found" as const, payload: {} }));
    expect(await startManualAcquisition(input, { acquire, env: ON })).toBe(true);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    expect("turnSpanContext" in (acquire.mock.calls[0][0] as object)).toBe(false);
  });

  it("makes no manual_acquisition.run of its own (exactly one root, made by the pipeline)", async () => {
    const acquire = vi.fn(async () => ({ status: "no_manual_found" as const, payload: {} }));
    await withSpan("test.turn", {}, async () => {
      await startManualAcquisition(input, { acquire, env: ON });
    });
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(handle.finished().filter((s) => s.name === "manual_acquisition.run")).toHaveLength(0);
  });
});

describe("runManualAcquisition — tracing seam (inline, awaited)", () => {
  it("passes its input (including any turn context) through and makes no run span of its own", async () => {
    const acquire = vi.fn(async (_i: unknown) => ({ status: "complete" as const, payload: {} }) as never);
    const result = await runManualAcquisition(
      { tenantId: "t", userId: "u", notebookId: "nb", nodeId: "node", identity: { manufacturer: "M", model: "TEST-123" }, turnSpanContext: TURN },
      { acquire, env: ON },
    );
    expect(result.started).toBe(true);
    expect((acquire.mock.calls[0][0] as { turnSpanContext?: unknown }).turnSpanContext).toEqual(TURN);
    expect(handle.finished().filter((s) => s.name === "manual_acquisition.run")).toHaveLength(0);
  });
});
