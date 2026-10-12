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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFaultCodes, retrieveManualChunks, retrieveNodeChunks } from "@/lib/manual-rag";
import {
  buildRetrievalQuery,
  codeTokenMatcher,
  expandIndustrialQuery,
  prioritizeCurrentCodeEvidence,
  rerankChunks,
  withRawCodeTokens,
  type ChatHistoryTurn,
} from "@/lib/notebook-query";

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

// ---------------------------------------------------------------------------
// Codex r1 on #4360 — in a REAL thread the follow-up is conversation-augmented.
// buildRetrievalQuery("oC", history) is "oC F0004 fault": three words (the bare
// terse rule is silent) whose only keyword-adjacent code is the previous turn's
// F0004. Without the raw message the lane bound F0004 and the current oC stayed
// on BM25 — the exact failure this PR claims to fix.
// ---------------------------------------------------------------------------

const THREAD: ChatHistoryTurn[] = [
  { role: "user", content: "PowerFlex 525 fault F0004 on startup" },
  { role: "assistant", content: "F0004 on the PowerFlex 525 is an undervoltage fault; check the DC bus." },
];

const DOC = "11111111-1111-4111-8111-111111111111";

describe("a real thread: the terse follow-up arrives conversation-augmented", () => {
  it.each(["F4", "oC", "OC"])("%s: augmentation alone drops it; the raw message restores it (pure)", (msg) => {
    const augmented = buildRetrievalQuery(msg, THREAD);
    // Preconditions — the defect's exact input shape, not assumed.
    expect(augmented).not.toBe(msg);
    expect(augmented).toMatch(/F0004/);
    expect(expandIndustrialQuery(augmented).codeTokens).not.toContain(msg);
    const merged = withRawCodeTokens(expandIndustrialQuery(augmented), msg);
    expect(merged.codeTokens).toContain(msg);
    // Idempotent and non-duplicating: same raw twice, or raw equal to the query.
    expect(withRawCodeTokens(merged, msg).codeTokens).toEqual(merged.codeTokens);
    expect(withRawCodeTokens(expandIndustrialQuery(msg), msg).codeTokens).toEqual([msg]);
    expect(withRawCodeTokens(merged, undefined)).toBe(merged);
  });

  it.each(["F4", "oC", "OC"])("%s → OEM lane (retrieveManualChunks) binds the current code's pattern", async (msg) => {
    const augmented = buildRetrievalQuery(msg, THREAD);
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, "tenant-1", augmented, { topK: 6, rawQuery: msg });
    expect(boundPatterns(calls)).toContain(codeTokenMatcher(msg).sql);
    // The thread's F0004 still belongs to the #1875 F-code pass, never this lane.
    expect(boundPatterns(calls)).not.toContain(codeTokenMatcher("F0004").sql);
    expect(fCodeCalls(calls, "F0004").length).toBeGreaterThan(0);
  });

  it.each(["F4", "oC", "OC"])("%s → attached-document lane (retrieveNodeChunks) binds the current code's pattern", async (msg) => {
    const augmented = buildRetrievalQuery(msg, THREAD);
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, "tenant-1", augmented, {
      nodeId: "node-1",
      unsPath: null,
      topK: 6,
      docIds: [DOC],
      rawQuery: msg,
      validatedDocScope: true,
    });
    expect(boundPatterns(calls)).toContain(codeTokenMatcher(msg).sql);
  });

  it("the rerank boost sees the current code too: the chunk naming oC outranks a higher-BM25 chunk that does not", () => {
    const augmented = buildRetrievalQuery("oC", THREAD);
    // Neither chunk names the thread's F0004, so the ONLY code boost in play is the
    // current message's oC; BM25 rank alone puts the generic chunk first.
    const chunks = [
      { content: "Output current limit: set P033 [Motor OL Current] to the motor nameplate FLA.", rank: 1.0, sourcePage: 1, docId: DOC },
      { content: "oC — overcurrent. Output current exceeded 200% of drive rating.", rank: 0.2, sourcePage: 2, docId: DOC },
    ];
    const before = rerankChunks(expandIndustrialQuery(augmented), chunks);
    expect(before[0].sourcePage).toBe(1); // without the raw message the oC chunk gets no boost
    const after = rerankChunks(withRawCodeTokens(expandIndustrialQuery(augmented), "oC"), chunks);
    expect(after[0].sourcePage).toBe(2);
  });

  it("control: without the raw message the augmented query binds only the thread's code (the defect, pinned)", async () => {
    const augmented = buildRetrievalQuery("oC", THREAD);
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, "tenant-1", augmented, { topK: 6 });
    expect(boundPatterns(calls)).not.toContain(codeTokenMatcher("oC").sql);
    const node = makeClient();
    await retrieveNodeChunks(node.client, "tenant-1", augmented, { nodeId: "node-1", unsPath: null, topK: 6, docIds: [DOC] });
    expect(boundPatterns(node.calls)).not.toContain(codeTokenMatcher("oC").sql);
    expect(boundPatterns(node.calls)).toContain(codeTokenMatcher("F0004").sql);
  });

  it("the current message's code tokens are marked, so final selection can tell subject from context", () => {
    const merged = withRawCodeTokens(expandIndustrialQuery(buildRetrievalQuery("oC", THREAD)), "oC");
    expect(merged.currentCodeTokens).toEqual(["oC"]);
    expect(expandIndustrialQuery("fault F0004").currentCodeTokens).toBeUndefined();
    expect(withRawCodeTokens(expandIndustrialQuery("what does it mean"), "what does it mean").currentCodeTokens).toBeUndefined();
  });

  it("prioritizeCurrentCodeEvidence: current-code chunks lead, rerank order kept inside each group, no-op without tokens", () => {
    const ranked = [
      { content: "F0004 a", id: 1 },
      { content: "F0004 b", id: 2 },
      { content: "oC overcurrent", id: 3 },
      { content: "F0004 c", id: 4 },
      { content: "OC on the display", id: 5 },
    ];
    expect(prioritizeCurrentCodeEvidence(ranked, ["oC"]).map((c) => c.id)).toEqual([3, 5, 1, 2, 4]); // whole token, case-insensitive
    expect(prioritizeCurrentCodeEvidence(ranked, undefined)).toBe(ranked);
    expect(prioritizeCurrentCodeEvidence(ranked, [])).toBe(ranked);
    expect(prioritizeCurrentCodeEvidence(ranked, ["ovA"])).toBe(ranked); // nothing matches → unchanged
  });

  // Codex r2 on #4360 — a POPULATED attached-document retrieval: six chunks that
  // name the thread's F0004 (each earns the exact-ID AND the code boost) and ONE
  // chunk documenting the fault the technician just typed. topK is six.
  function populatedClient(currentCode: string) {
    const row = (page: number, content: string) => ({
      content,
      doc_id: DOC,
      source_url: "manual.pdf",
      source_page: page,
      page_start: page,
      section_path: null,
      filename: "manual.pdf",
      verified: true,
      rank: 0.5,
    });
    const history = [1, 2, 3, 4, 5, 6].map((p) => row(p, `Fault F0004 undervoltage note ${p}: DC bus below limit, see parameter P0${p}.`));
    const current = row(100, `${currentCode} — overcurrent: output current exceeded 200% of the drive rating.`);
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("content ~* ANY(")) {
        // The bound regex array is the string[] whose entries are whole-token
        // SQL patterns (the node-id list is a string[] too, bound earlier).
        const patterns =
          params.find(
            (p): p is string[] => Array.isArray(p) && p.every((x) => typeof x === "string" && x.startsWith("(^|")),
          ) ?? [];
        const hit = patterns.includes(codeTokenMatcher(currentCode).sql);
        return { rows: hit ? [current] : patterns.includes(codeTokenMatcher("F0004").sql) ? history : [] };
      }
      if (sql.includes("content_tsv @@")) return { rows: history }; // BM25 passes: the thread's code dominates
      return { rows: [] };
    });
    return { client: { query } as unknown as PoolClient, calls };
  }

  it.each(["F4", "oC", "OC"])("%s after F0004: the current fault's chunk survives the top six (and leads)", async (msg) => {
    const augmented = buildRetrievalQuery(msg, THREAD);
    const { client } = populatedClient(msg);
    const out = await retrieveNodeChunks(client, "tenant-1", augmented, {
      nodeId: "node-1",
      unsPath: null,
      topK: 6,
      docIds: [DOC],
      rawQuery: msg,
      validatedDocScope: true,
    });
    expect(out).toHaveLength(6);
    expect(out[0].sourcePage).toBe(100);
    expect(out.map((c) => c.sourcePage)).toContain(100);
    // History still fills the remaining slots as context — not discarded.
    expect(out.filter((c) => c.sourcePage !== 100)).toHaveLength(5);
  });

  // Codex r3 on #4360 — the same crowd-out in the identity-bound OEM lane: the
  // widened BM25 OR pass returns six F0004 rows ranked above a current-code row
  // that the whole-token lane ALSO returns; dedup kept the low-ranked copy and
  // the manufacturer merge sorted by rank and cut it. Allen-Bradley PowerFlex 525.
  function populatedOemClient(currentCode: string) {
    const row = (page: number, content: string, rank: number) => ({
      content,
      manufacturer: "Allen-Bradley",
      model_number: "PowerFlex 525",
      source_url: "pf525.pdf",
      source_page: page,
      chunk_index: page,
      title: "PowerFlex 525 User Manual",
      verified: true,
      rank,
    });
    const history = [1, 2, 3, 4, 5, 6].map((p) =>
      row(p, `Fault F0004 UnderVoltage note ${p}: DC bus voltage fell below the limit, see parameter P0${p}.`, 0.5),
    );
    const current = row(100, `${currentCode} — Overcurrent: output current exceeded 200% of the drive rating.`, 0.1);
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("content ~* ANY(")) {
        const patterns =
          params.find(
            (p): p is string[] => Array.isArray(p) && p.every((x) => typeof x === "string" && x.startsWith("(^|")),
          ) ?? [];
        return { rows: patterns.includes(codeTokenMatcher(currentCode).sql) ? [current] : [] };
      }
      // Every BM25 pass (AND, OR, the #1875 terse F-code re-query): the thread's
      // code dominates the ranking and the current code sits at the bottom.
      if (sql.includes("content_tsv @@")) return { rows: [...history, current] };
      return { rows: [] };
    });
    return { client: { query } as unknown as PoolClient, calls };
  }

  it.each(["F4", "oC", "OC"])("%s after F0004 (OEM, identity-bound PowerFlex 525): the current fault's chunk survives the top six (and leads)", async (msg) => {
    const augmented = buildRetrievalQuery(msg, THREAD);
    const { client } = populatedOemClient(msg);
    const out = await retrieveManualChunks(client, "tenant-1", augmented, {
      manufacturer: "Allen-Bradley",
      model: "PowerFlex 525",
      topK: 6,
      allowTenantFallback: false,
      rawQuery: msg,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].sourcePage).toBe(100);
    expect(out.map((c) => c.sourcePage)).toContain(100);
    expect(out.filter((c) => c.sourcePage !== 100).length).toBeGreaterThan(0); // history still present as context
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it("control (OEM): without the raw message the six F0004 rows exhaust the slots (the defect, pinned)", async () => {
    const augmented = buildRetrievalQuery("oC", THREAD);
    const { client } = populatedOemClient("oC");
    const out = await retrieveManualChunks(client, "tenant-1", augmented, {
      manufacturer: "Allen-Bradley",
      model: "PowerFlex 525",
      topK: 6,
      allowTenantFallback: false,
    });
    expect(out.map((c) => c.sourcePage)).not.toContain(100);
  });

  it("control: without the raw message the six F0004 chunks exhaust the slots (the defect, pinned)", async () => {
    const augmented = buildRetrievalQuery("oC", THREAD);
    const { client } = populatedClient("oC");
    const out = await retrieveNodeChunks(client, "tenant-1", augmented, { nodeId: "node-1", unsPath: null, topK: 6, docIds: [DOC], validatedDocScope: true });
    expect(out.map((c) => c.sourcePage)).not.toContain(100);
  });

  it("source contract: the notebook route hands the raw message to BOTH retrieval strategies", () => {
    const route = readFileSync(
      resolve(__dirname, "../../app/api/equipment-notebooks/[id]/chat/route.ts"),
      "utf8",
    );
    const oem = route.slice(route.indexOf("retrieveManualChunks(client, ctx.tenantId, retrievalQuery"));
    expect(oem.slice(0, oem.indexOf("});"))).toMatch(/rawQuery: message/);
    const attached = route.slice(route.indexOf("retrieveNodeChunks(client, ctx.tenantId, retrievalQuery"));
    expect(attached.slice(0, attached.indexOf("})"))).toMatch(/rawQuery: message/);
  });
});
