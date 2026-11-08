import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { publicManualSeries } from "../public-model-proof";

const client = (impl: (sql: string, params: unknown[]) => unknown) =>
  ({ query: vi.fn(async (sql: string, params: unknown[]) => impl(sql, params)) }) as unknown as PoolClient & { query: ReturnType<typeof vi.fn> };

describe("#5268 option A: a code is offered only when the maker's public manuals print it", () => {
  it("returns the matching document's series, querying the shared corpus by maker and exact code only", async () => {
    const c = client(() => ({ rows: [{ model_number: "GS10" }] }));
    expect(await publicManualSeries(c, "AutomationDirect", "GS11N-20P2")).toBe("GS10");
    const [sql, params] = c.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("is_private = false");
    expect(params).toEqual(["automationdirect", "(^|[^A-Za-z0-9])GS11N-20P2([^A-Za-z0-9]|$)"]);
  });

  it("is null when no public page prints the code", async () => {
    expect(await publicManualSeries(client(() => ({ rows: [] })), "SMC", "TP1200")).toBeNull();
  });

  it("an empty series still proves the code public", async () => {
    expect(await publicManualSeries(client(() => ({ rows: [{ model_number: null }] })), "SMC", "TP1200")).toBe("");
  });

  it("fails closed on a query error", async () => {
    const c = client(() => {
      throw new Error("db down");
    });
    expect(await publicManualSeries(c, "SMC", "TP1200")).toBeNull();
  });

  it("escapes regex characters in the code", async () => {
    const c = client(() => ({ rows: [] }));
    await publicManualSeries(c, "Siemens", "6ES7.214+1(AG)");
    expect((c.query.mock.calls[0] as [string, unknown[]])[1][1]).toBe("(^|[^A-Za-z0-9])6ES7\\.214\\+1\\(AG\\)([^A-Za-z0-9]|$)");
  });

  it.each([
    ["SMC", "1234"],
    ["SMC", "ABCD"],
    ["SMC", "A1"],
    ["S", "TP1200"],
  ])("never queries for a code or maker too weak to prove anything (%s, %s)", async (maker, code) => {
    const c = client(() => ({ rows: [{ model_number: "X" }] }));
    expect(await publicManualSeries(c, maker, code)).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });
});
