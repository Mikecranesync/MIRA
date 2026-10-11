/**
 * #4224 (D2) — every way a technician types the fault code in one thread reaches
 * an exact-match lane, not just BM25.
 *
 * The live stranger-walk asked "PowerFlex 525 fault F0004 …" and got no
 * citation. #4245 added the whole-token code lane to the quickstart path, but
 * it fired only when a fault keyword came BEFORE the code. In a real thread the
 * next messages are terse: "F4", "oC", "OC", "overcurrent oC fault" — none of
 * which had a lane, so retrieval fell back to BM25 where a two-character token
 * loses to the question's ordinary words.
 *
 * Contract pinned here, for the six phrasings of one thread:
 *   - "F0004" and "fault F0004" → the #1875 terse F-code re-query (params[1]
 *     is the code alone) and NOT the whole-token lane (the two stay disjoint);
 *   - "F4", "oC", "OC", "overcurrent oC fault" → the whole-token lane runs with
 *     the code's whole-token pattern;
 *   - controls: "GS10 oC overcurrent" (a model word in front) and "hello there"
 *     take neither lane, and the original keyword-first shapes still work.
 *
 * Run: npx vitest run src/capabilities/__tests__/fault-code-thread-lane.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFaultCodes, retrieveManualChunks } from "@/lib/manual-rag";
import { codeTokenMatcher, expandIndustrialQuery } from "@/lib/notebook-query";

afterEach(() => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
});

function makeClient(): { client: PoolClient; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  // Every lane returns nothing: the contract is WHICH queries run, not ranking.
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const codes = (q: string) => expandIndustrialQuery(q).codeTokens;

const wholeTokenCalls = (calls: Array<{ sql: string; params: unknown[] }>) =>
  calls.filter((c) => c.sql.includes("content ~* ANY("));
const fCodeCalls = (calls: Array<{ sql: string; params: unknown[] }>, code: string) =>
  calls.filter((c) => c.params[1] === code);

/** The whole-token lane binds the pattern array as one param; find it. */
function boundPatterns(calls: Array<{ sql: string; params: unknown[] }>): string[] {
  return wholeTokenCalls(calls).flatMap((c) =>
    c.params.filter((p): p is string[] => Array.isArray(p) && p.every((x) => typeof x === "string")).flat(),
  );
}

describe("extractCodeTokens — the thread's six phrasings", () => {
  it("keyword-first (the original rule) still works", () => {
    expect(codes("What does fault ovA mean on this drive")).toEqual(["ovA"]);
    expect(codes("fault OC1 on startup")).toEqual(["OC1"]);
  });

  it("the keyword may come AFTER the code", () => {
    expect(codes("overcurrent oC fault")).toEqual(["oC"]);
    expect(codes("F4 trips every start")).toEqual(["F4"]);
  });

  it("a bare terse message IS the code: letter+digit, mixed case, caps mnemonic", () => {
    expect(codes("F4")).toEqual(["F4"]);
    expect(codes("oC")).toEqual(["oC"]);
    expect(codes("OC")).toEqual(["OC"]);
    expect(codes("fault F4")).toEqual(["F4"]);
  });

  it("controls: a model word in front, ordinary words, and long messages take the ordinary path", () => {
    expect(codes("GS10 oC overcurrent")).toEqual([]);
    expect(codes("oC overcurrent")).toEqual([]);
    expect(codes("hello there")).toEqual([]);
    expect(codes("PLC")).toEqual([]);
    expect(codes("PowerFlex 753 fault meaning")).toEqual([]); // a model number before "fault" is not a code
    expect(codes("what does this fault mean")).toEqual([]);
    expect(codes("the drive trips")).toEqual([]);
    expect(codes("Fault Code List please")).toEqual([]);
  });

  it("F0004 is a code token too, but the F-code pass owns it (checked at the lane below)", () => {
    expect(extractFaultCodes("F0004")).toEqual(["F0004"]);
    expect(extractFaultCodes("fault F0004")).toEqual(["F0004"]);
    expect(extractFaultCodes("F4")).toEqual([]); // the known #1875 limit this lane covers
  });
});

describe("retrieveManualChunks — one thread, six phrasings, each reaches a lane", () => {
  it.each(["F0004", "fault F0004"])("%s → the terse F-code re-query, not the whole-token lane", async (q) => {
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, "tenant-1", q, { topK: 6 });
    expect(fCodeCalls(calls, "F0004").length).toBeGreaterThan(0);
    expect(boundPatterns(calls)).not.toContain(codeTokenMatcher("F0004").sql);
  });

  it.each([
    ["F4", "F4"],
    ["oC", "oC"],
    ["OC", "OC"],
    ["overcurrent oC fault", "oC"],
  ])("%s → the whole-token lane with the %s pattern", async (q, tok) => {
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, "tenant-1", q, { topK: 6 });
    expect(wholeTokenCalls(calls).length).toBeGreaterThan(0);
    expect(boundPatterns(calls)).toContain(codeTokenMatcher(tok).sql);
  });

  it("control: a model-led message runs no whole-token lane and no F-code pass", async () => {
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, "tenant-1", "GS10 oC overcurrent", { topK: 6 });
    expect(wholeTokenCalls(calls)).toHaveLength(0);
    expect(calls.every((c) => !["oC", "OC"].includes(String(c.params[1])))).toBe(true);
  });
});
