/**
 * #4130 — withTenantContext's preamble is two round trips: `BEGIN; SET LOCAL
 * ROLE factorylm_app` (one parameterless query) and one SELECT that writes BOTH
 * transaction-local tenant keys. Pinned here with a recording client; the RLS
 * effect itself is proven against real Postgres by the Beta Gate integration
 * suite (visual-evidence-context.integration.test.ts R3 cross-tenant isolation),
 * which runs whenever tenant-context.ts changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { text: string; params?: unknown[] }[]);
const client = vi.hoisted(() => ({
  query: vi.fn(async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (text === "SELECT boom") throw new Error("boom");
    return { rows: [] };
  }),
  release: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn(async () => client) } }));

import { withTenantContext } from "@/lib/tenant-context";

const TENANT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  calls.length = 0;
  client.query.mockClear();
  client.release.mockClear();
});

describe("withTenantContext preamble (#4130)", () => {
  it("sets the role and both tenant keys in two statements, before the callback, then commits", async () => {
    const out = await withTenantContext(TENANT, async (c) => {
      await c.query("SELECT 1");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toEqual([
      { text: "BEGIN; SET LOCAL ROLE factorylm_app", params: undefined },
      {
        text: "SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)",
        params: [TENANT],
      },
      { text: "SELECT 1", params: undefined },
      { text: "COMMIT", params: undefined },
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("the role switch never carries a parameter (it must use the simple protocol to batch)", async () => {
    await withTenantContext(TENANT, async () => null);
    expect(calls[0].params).toBeUndefined();
    expect(calls[0].text).toMatch(/^BEGIN; SET LOCAL ROLE factorylm_app$/);
  });

  it("rolls back and releases when the callback throws", async () => {
    await expect(withTenantContext(TENANT, async (c) => c.query("SELECT boom"))).rejects.toThrow("boom");
    expect(calls.map((c) => c.text).slice(-1)).toEqual(["ROLLBACK"]);
    expect(calls.some((c) => c.text === "COMMIT")).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
