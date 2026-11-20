import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { PUBLIC_MANUAL_SOURCE_TYPES, publicManualSeries } from "../public-model-proof";

const client = (impl: (sql: string, params: unknown[]) => unknown) =>
  ({ query: vi.fn(async (sql: string, params: unknown[]) => impl(sql, params)) }) as unknown as PoolClient & { query: ReturnType<typeof vi.fn> };

describe("#5268 option A: a code is offered only when the maker's public manuals print it", () => {
  it("returns the matching document's series, querying the shared corpus by maker and exact code only", async () => {
    const c = client(() => ({ rows: [{ model_number: "GS10" }] }));
    expect(await publicManualSeries(c, "AutomationDirect", "GS11N-20P2")).toBe("GS10");
    const [sql, params] = c.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("is_private = false");
    expect(sql).toContain("source_type = ANY ($3::text[])");
    expect(params).toEqual(["automationdirect", "(^|[^A-Za-z0-9])(?<![A-Za-z0-9][-._/])GS11N-20P2(?![-._/]?[A-Za-z0-9])", [...PUBLIC_MANUAL_SOURCE_TYPES]]);
  });

  // Codex #5706 r5 F13: only maker manual documents prove a code public.
  it("only maker manual source types count — never seeded assets, photos, work orders or transcripts", () => {
    expect([...PUBLIC_MANUAL_SOURCE_TYPES].sort()).toEqual(["equipment_manual", "gdrive", "installation_manual", "manual", "oem_manual"]);
    for (const t of ["atlas_asset", "equipment_photo", "work_order_history", "youtube_transcript", "curriculum"]) {
      expect(PUBLIC_MANUAL_SOURCE_TYPES as readonly string[]).not.toContain(t);
    }
  });

  // The same whole-identifier boundary the Hub's applicability matcher uses,
  // checked here with JS regex semantics (the pattern uses only constructs
  // Postgres ARE shares: a staging read-only probe returned the same verdicts).
  it.each([
    ["Model GS11N-20P2 rated", true],
    ["the GS11N-20P2.", true],
    ["(GS11N-20P2)", true],
    ["GS11N-20P2-EX", false],
    ["GS11N-20P2/EX", false],
    ["X-GS11N-20P2", false],
    ["GS11N-20P25", false],
    ["1.GS11N-20P2.A1 = 1/4.", false],
  ])("the proof pattern on %j → %s", async (text, hit) => {
    const c = client(() => ({ rows: [] }));
    await publicManualSeries(c, "AutomationDirect", "GS11N-20P2");
    const pattern = (c.query.mock.calls[0] as [string, unknown[]])[1][1] as string;
    expect(new RegExp(pattern, "i").test(text)).toBe(hit);
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
    expect((c.query.mock.calls[0] as [string, unknown[]])[1][1]).toBe("(^|[^A-Za-z0-9])(?<![A-Za-z0-9][-._/])6ES7\\.214\\+1\\(AG\\)(?![-._/]?[A-Za-z0-9])");
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
