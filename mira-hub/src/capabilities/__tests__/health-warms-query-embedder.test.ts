/**
 * Docker's healthcheck polls /api/health from boot, so it is the one call
 * guaranteed to reach a fresh container: it warms the query embedder (a no-op
 * unless NOTEBOOK_HYBRID_RETRIEVAL=1, once per process), so the first
 * technician turn after a deploy does not pay the cold model load (2026-10-19).
 *
 * Run: npx vitest run src/capabilities/__tests__/health-warms-query-embedder.test.ts
 */
import { describe, expect, it, vi } from "vitest";

const warm = vi.hoisted(() => vi.fn(async () => "ok" as const));
vi.mock("@/capabilities/hybrid-retrieval", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  warmQueryEmbedder: warm,
}));
vi.mock("@/capabilities/embed-retry-sweep", () => ({ ensureEmbedRetrySweep: vi.fn(() => false) }));

import { GET } from "../../app/api/health/route";

describe("/api/health warms the query embedder", () => {
  it("calls warmQueryEmbedder on every health poll (it no-ops after the first)", async () => {
    expect(warm).not.toHaveBeenCalled();
    await GET();
    await GET();
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("a rejected warm-up never breaks the health response", async () => {
    warm.mockRejectedValueOnce(new Error("boom"));
    const res = await GET();
    expect([200, 503]).toContain(res.status);
  });
});
