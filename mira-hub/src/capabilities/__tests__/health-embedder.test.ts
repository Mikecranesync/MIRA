/**
 * The embedder's health is visible, and the retry sweep starts on its own
 * (2026-10-05 outage): the canary could not tell "embedder down" from "no uploads
 * today", and nothing re-ran a failed embed. /api/health/embedder must stay 200
 * and fast while the embedder is down and must never carry the embedder's URL;
 * /api/health (polled by Docker's healthcheck from boot) starts the sweep once.
 *
 * Run: npx vitest run src/capabilities/__tests__/health-embedder.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/node-knowledge-ingest", () => ({
  probeEmbedder: probe,
  embedPendingNodeChunks: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import { GET as embedderGET } from "@/app/api/health/embedder/route";
import { GET as healthGET } from "@/app/api/health/route";
import {
  __resetEmbedderStatusForTests,
  __resetSweepStartForTests,
  ensureEmbedRetrySweep,
} from "@/capabilities/embed-retry-sweep";

const saved = { ...process.env };

beforeEach(() => {
  __resetEmbedderStatusForTests();
  __resetSweepStartForTests();
  probe.mockReset();
  process.env.NEON_DATABASE_URL = "postgres://u:p@h/db";
  process.env.INGEST_URL = "http://ingest";
  process.env.OLLAMA_BASE_URL = "http://100.86.236.11:11434";
});

afterEach(() => {
  process.env = { ...saved };
});

describe("/api/health/embedder", () => {
  it("stays 200 while the embedder is unreachable, and reports it", async () => {
    probe.mockResolvedValue({ code: "embedder_unavailable" });
    const first = await embedderGET().json();
    expect(first.embedder).toMatchObject({
      status: "unknown",
      model: "nomic-embed-text",
    });
    await vi.waitFor(async () =>
      expect((await embedderGET().json()).embedder.status).toBe("unreachable"),
    );
    expect(embedderGET().status).toBe(200);
  });

  it("reports ok once a probe returns a vector", async () => {
    probe.mockResolvedValue({ vec: new Array(768).fill(0.1) });
    embedderGET();
    await vi.waitFor(async () =>
      expect((await embedderGET().json()).embedder.status).toBe("ok"),
    );
  });

  it("never exposes the embedder URL or host", async () => {
    probe.mockResolvedValue({ code: "embedder_timeout" });
    embedderGET();
    await vi.waitFor(async () =>
      expect((await embedderGET().json()).embedder.status).toBe("timeout"),
    );
    const text = JSON.stringify(await embedderGET().json());
    expect(text).not.toContain("100.86.236.11");
    expect(text).not.toContain("11434");
  });
});

describe("retry sweep start", () => {
  it("/api/health starts the sweep, and only once per process", () => {
    healthGET();
    // already started by the health call above → a second start is refused
    const start = vi.fn(() => () => {});
    expect(ensureEmbedRetrySweep(start)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts with the documented cadence, once", () => {
    const start = vi.fn(() => () => {});
    expect(ensureEmbedRetrySweep(start)).toBe(true);
    expect(ensureEmbedRetrySweep(start)).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({
      firstDelayMs: 60_000,
      intervalMs: 600_000,
      maxTargets: 25,
    });
  });

  it("is off with NODE_EMBED_RETRY_SWEEP=0", () => {
    process.env.NODE_EMBED_RETRY_SWEEP = "0";
    const start = vi.fn(() => () => {});
    expect(ensureEmbedRetrySweep(start)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("/api/health keeps its response shape (the sweep adds no field)", async () => {
    const body = await healthGET().json();
    expect(body.status).toBe("ok");
    expect(body).not.toHaveProperty("embedder");
  });
});
