// Codex round 1, F2 (PR #5024): a transient capability-probe failure must not
// be cached for the life of the worker, and a definitive answer must expire so
// an Atlas upgrade is noticed without a restart.
import { describe, expect, it } from "vitest";
import { AtlasHttpError, type AtlasComment } from "@/lib/atlas/client";
import { AtlasWriteProvider, CAPABILITY_TTL_MS, type AtlasCommentApi } from "@/lib/cmms/atlas-write-provider";
import { markerFor, type WorkLogNote } from "@/lib/cmms/write-contract";

type Mode = "v16" | "legacy";

function fakeApi(opts: { mode: () => Mode; probeFailuresBeforeSuccess?: number }): AtlasCommentApi & { probes: number; comments: AtlasComment[] } {
  let failures = opts.probeFailuresBeforeSuccess ?? 0;
  let nextId = 100;
  const comments: AtlasComment[] = [];
  const api = {
    probes: 0,
    comments,
    async countComments() {
      api.probes++;
      if (opts.mode() === "legacy") throw new AtlasHttpError(404, "Not Found", "/comments/count/1");
      if (failures > 0) {
        failures--;
        throw new AtlasHttpError(500, "boom", "/comments/count/1");
      }
      return { count: comments.length };
    },
    async createComment(payload: { workOrder: { id: number }; content: string }) {
      if (opts.mode() === "legacy") throw new AtlasHttpError(404, "Not Found", "/comments");
      const c: AtlasComment = { id: nextId++, content: payload.content, system: false, createdAt: new Date().toISOString() };
      comments.push(c);
      return c;
    },
    async searchComments() {
      if (opts.mode() === "legacy") throw new AtlasHttpError(404, "Not Found", "/comments/search/1");
      return [...comments];
    },
  };
  return api;
}

const target = { providerId: "atlas", externalWorkOrderId: "1" };
function note(eventId: string): WorkLogNote {
  return { idempotencyKey: `k-${eventId}`, marker: markerFor(eventId), text: "Recorded fix — fix: tightened", attributionLabel: "Technician", occurredAt: "2026-10-31T00:00:00.000Z", sourceRef: `asset_fix_records:${eventId}` };
}
const EV = "11111111-1111-4111-8111-111111111111";

describe("AtlasWriteProvider capability cache (Codex F2)", () => {
  it("does not cache a transient probe failure: the next append re-probes and delivers", async () => {
    const api = fakeApi({ mode: () => "v16", probeFailuresBeforeSuccess: 1 });
    const provider = new AtlasWriteProvider(api);
    const first = await provider.appendWorkLog(target, note(EV));
    expect(first.kind).toBe("retryable_failure");
    expect("reason" in first && first.reason).toBe("capability_unknown");
    const second = await provider.appendWorkLog(target, note(EV));
    expect(second.kind).toBe("verified_by_readback");
    expect(api.comments).toHaveLength(1);
    expect(api.probes).toBe(2);
  });

  it("caches a definitive answer until the TTL, then re-probes and notices an upgrade", async () => {
    let mode: Mode = "legacy";
    let t = 1_000_000;
    const api = fakeApi({ mode: () => mode });
    const provider = new AtlasWriteProvider(api, { now: () => t });
    expect((await provider.appendWorkLog(target, note(EV))).kind).toBe("unsupported");
    expect((await provider.appendWorkLog(target, note(EV))).kind).toBe("unsupported");
    expect(api.probes).toBe(1); // definitive 404 cached inside the TTL

    mode = "v16"; // Atlas upgraded underneath the running worker
    t += CAPABILITY_TTL_MS + 1;
    const after = await provider.appendWorkLog(target, note(EV));
    expect(after.kind).toBe("verified_by_readback");
    expect(api.probes).toBe(2);
    expect(api.comments).toHaveLength(1);
  });

  it("invalidateCapabilities() forces a fresh probe immediately", async () => {
    let mode: Mode = "legacy";
    const api = fakeApi({ mode: () => mode });
    const provider = new AtlasWriteProvider(api);
    expect((await provider.appendWorkLog(target, note(EV))).kind).toBe("unsupported");
    mode = "v16";
    provider.invalidateCapabilities();
    expect((await provider.appendWorkLog(target, note(EV))).kind).toBe("verified_by_readback");
  });
});
