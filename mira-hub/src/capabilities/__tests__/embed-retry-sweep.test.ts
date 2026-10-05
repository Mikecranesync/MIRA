/**
 * Failed embeds are retried (2026-10-05 embedding outage).
 *
 * embedPendingNodeChunks runs ONCE per upload; when the embedder is unreachable
 * the chunks stay BM25-only forever. The sweep finds every (tenant, upload) that
 * still has node_attachment chunks without a vector and re-runs that same pass
 * under the owning tenant's context — so a chunk recovers as soon as the embedder
 * does, without an operator.
 *
 * Run: npx vitest run src/capabilities/__tests__/embed-retry-sweep.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/node-knowledge-ingest", () => ({
  embedPendingNodeChunks: vi.fn(),
  probeEmbedder: vi.fn(),
}));

import {
  listPendingEmbedTargets,
  sweepPendingEmbeds,
  startEmbedRetrySweep,
  embedderStatus,
  __resetEmbedderStatusForTests,
  __resetSweepCooldownForTests,
} from "@/capabilities/embed-retry-sweep";

const T1 = { tenantId: "11111111-1111-4111-8111-111111111111", sourceUrl: "node://a/manual-1.pdf" };
const T2 = { tenantId: "22222222-2222-4222-8222-222222222222", sourceUrl: "node://b/manual-2.pdf" };
const T3 = { tenantId: "11111111-1111-4111-8111-111111111111", sourceUrl: "node://a/manual-3.pdf" };

const ok = (embedded: number) => ({ embedded, state: "complete" as const, permanent: false });
const down = { embedded: 0, state: "degraded" as const, code: "embedder_unavailable" as const, permanent: false };

describe("listPendingEmbedTargets", () => {
  it("returns tenant + upload pairs only (never content), oldest first, bounded", async () => {
    const query = vi.fn(async () => ({ rows: [{ tenant_id: T1.tenantId, source_url: T1.sourceUrl }] }));
    const out = await listPendingEmbedTargets(25, { query });
    expect(out).toEqual([T1]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/source_type = 'node_attachment'/);
    expect(sql).toMatch(/embedding IS NULL/);
    expect(sql).not.toMatch(/\bcontent\b/);
    expect(params).toEqual([25]);
  });
});

describe("sweepPendingEmbeds", () => {
  it("re-runs the per-tenant pass for every pending upload, under that upload's tenant", async () => {
    const embed = vi.fn(async () => ok(3));
    const r = await sweepPendingEmbeds({ maxTargets: 10 }, { list: async () => [T1, T2, T3], embed });
    expect(embed.mock.calls).toEqual([
      [T1.tenantId, T1.sourceUrl],
      [T2.tenantId, T2.sourceUrl],
      [T3.tenantId, T3.sourceUrl],
    ]);
    expect(r).toMatchObject({ targets: 3, embedded: 9, stoppedOn: null });
  });

  it("stops at the first upload the embedder could not serve (no spinning on a dead embedder)", async () => {
    const embed = vi.fn(async () => down);
    const r = await sweepPendingEmbeds({ maxTargets: 10 }, { list: async () => [T1, T2, T3], embed });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ embedded: 0, stoppedOn: "embedder_unavailable" });
  });

  it("keeps going when an upload is partly embedded before a blip", async () => {
    const embed = vi
      .fn()
      .mockResolvedValueOnce({ ...down, embedded: 5 })
      .mockResolvedValueOnce(ok(2));
    const r = await sweepPendingEmbeds({ maxTargets: 10 }, { list: async () => [T1, T2], embed });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ embedded: 7, stoppedOn: null });
  });

  it("does nothing when embed-on-write is switched off", async () => {
    const embed = vi.fn(async () => ({ embedded: 0, state: "disabled" as const, permanent: false }));
    const r = await sweepPendingEmbeds({ maxTargets: 10 }, { list: async () => [T1, T2], embed });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(r.stoppedOn).toBe("disabled");
  });

  it("is single-flight: a sweep already running is joined, not duplicated", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const list = vi.fn(async () => {
      await gate;
      return [T1];
    });
    const embed = vi.fn(async () => ok(1));
    const a = sweepPendingEmbeds({ maxTargets: 10 }, { list, embed });
    const b = sweepPendingEmbeds({ maxTargets: 10 }, { list, embed });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
  });

  it("an upload-specific failure does not block later uploads (Codex #4293 F1)", async () => {
    __resetSweepCooldownForTests();
    const httpErr = { embedded: 0, state: "degraded" as const, code: "embedder_http_error" as const, permanent: false };
    const embed = vi.fn(async (_t: string, url: string) => (url === T1.sourceUrl ? httpErr : ok(4)));
    const probe = vi.fn(async () => ({ vec: [0.1] }));
    let now = 0;
    const deps = { list: async () => [T1, T2], embed, probe, now: () => now };
    const r1 = await sweepPendingEmbeds({ maxTargets: 10 }, deps);
    expect(r1).toMatchObject({ embedded: 4, stoppedOn: null });
    expect(probe).toHaveBeenCalledTimes(1);
    // the failing upload cools down; the next sweeps do not retry it every time
    now += 10 * 60_000;
    await sweepPendingEmbeds({ maxTargets: 10 }, deps);
    expect(embed.mock.calls.filter(([, u]) => u === T1.sourceUrl)).toHaveLength(1);
    // ...but it stays retryable once the cooldown has passed
    now += 60 * 60_000;
    await sweepPendingEmbeds({ maxTargets: 10 }, deps);
    expect(embed.mock.calls.filter(([, u]) => u === T1.sourceUrl)).toHaveLength(2);
  });

  it("an upload-specific code with a failing probe is a global outage: stop", async () => {
    __resetSweepCooldownForTests();
    const httpErr = { embedded: 0, state: "degraded" as const, code: "embedder_http_error" as const, permanent: false };
    const embed = vi.fn(async () => httpErr);
    const probe = vi.fn(async () => ({ code: "embedder_http_error" as const }));
    const r = await sweepPendingEmbeds({ maxTargets: 10 }, { list: async () => [T1, T2], embed, probe });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(r.stoppedOn).toBe("embedder_http_error");
  });

  it("a cooling-down upload does not use up the bounded listing", async () => {
    __resetSweepCooldownForTests();
    const httpErr = { embedded: 0, state: "degraded" as const, code: "embedder_http_error" as const, permanent: false };
    const embed = vi.fn(async (_t: string, url: string) => (url === T1.sourceUrl ? httpErr : ok(1)));
    const probe = vi.fn(async () => ({ vec: [0.1] }));
    const list = vi.fn(async (limit: number) => [T1, T2, T3].slice(0, limit));
    await sweepPendingEmbeds({ maxTargets: 1 }, { list, embed, probe, now: () => 0 });
    // T1 is cooling down: a 1-target sweep must still reach a different upload
    const r = await sweepPendingEmbeds({ maxTargets: 1 }, { list, embed, probe, now: () => 1 });
    expect(r.embedded).toBe(1);
    expect(embed.mock.calls.at(-1)?.[1]).toBe(T2.sourceUrl);
  });

  it("never throws: a listing failure is reported, not raised", async () => {
    const r = await sweepPendingEmbeds(
      { maxTargets: 10 },
      { list: async () => { throw new Error("db down"); }, embed: vi.fn() },
    );
    expect(r.stoppedOn).toBe("list_failed");
  });
});

describe("startEmbedRetrySweep", () => {
  it("runs after the first delay, then on the interval, and can be stopped", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async () => ({ targets: 0, embedded: 0, stoppedOn: null }));
      const stop = startEmbedRetrySweep({ firstDelayMs: 1000, intervalMs: 5000, maxTargets: 5 }, run);
      await vi.advanceTimersByTimeAsync(999);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(run).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(20000);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("embedderStatus (health)", () => {
  it("reports unknown until the first probe lands, then the probe's verdict, and never the URL", async () => {
    __resetEmbedderStatusForTests();
    const probe = vi.fn(async () => ({ code: "embedder_timeout" as const }));
    const first = embedderStatus({ probe, now: () => 1_000 });
    expect(first.status).toBe("unknown");
    await vi.waitFor(() => expect(embedderStatus({ probe, now: () => 1_001 }).status).toBe("timeout"));
    const shown = JSON.stringify(embedderStatus({ probe, now: () => 1_002 }));
    expect(shown).not.toMatch(/http|11434|ollama/i);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("probes at most once per minute", async () => {
    __resetEmbedderStatusForTests();
    const probe = vi.fn(async () => ({ vec: new Array(768).fill(0) }));
    embedderStatus({ probe, now: () => 0 });
    await vi.waitFor(() => expect(embedderStatus({ probe, now: () => 1 }).status).toBe("ok"));
    embedderStatus({ probe, now: () => 59_000 });
    expect(probe).toHaveBeenCalledTimes(1);
    embedderStatus({ probe, now: () => 61_000 });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("maps each failure code to a status", async () => {
    const cases: [string, string][] = [
      ["embedder_not_configured", "not_configured"],
      ["embedder_unavailable", "unreachable"],
      ["embedder_http_error", "http_error"],
      ["embedder_timeout", "timeout"],
      ["embedding_dimension_mismatch", "dimension_mismatch"],
    ];
    for (const [code, status] of cases) {
      __resetEmbedderStatusForTests();
      const probe = vi.fn(async () => ({ code }) as never);
      embedderStatus({ probe, now: () => 0 });
      await vi.waitFor(() => expect(embedderStatus({ probe, now: () => 1 }).status).toBe(status));
    }
  });
});
