/**
 * AR-2026-11-03 / #4863: an all-zero PowerFlex 525 fault-history ask cites the
 * readout rows (b007–b009 / F604–F610) and must also retrieve the parameter
 * that writes those buffers (A551 [Fault Clear] option 2 Clear Buffer).
 *
 * Lives under capabilities/ so the hermetic fixture does not expand the
 * guarded historical `mira-hub/src/lib/__tests__` bucket. The #5030 chunker
 * is not this miss — A551 lives on a different page that never entered the
 * cited set. Related Parameters on the readout rows do not name A551. This
 * fixture fails unless retrieveNodeChunks expands from the DISPLAY role to
 * the CONTROL role and keeps that chunk next to the history rows.
 * Zero tokens; mocked pg client dispatches on SQL shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

afterEach(() => {
  delete process.env.NOTEBOOK_LEXICAL_V2;
  delete process.env.NOTEBOOK_HYBRID_RETRIEVAL;
  delete process.env.NOTEBOOK_QUERY_REWRITE;
  delete process.env.NOTEBOOK_RERANK;
  delete process.env.RERANKER_URL;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Row = Record<string, unknown>;
type Call = { sql: string; params: unknown[] };

const HISTORY_P79 =
  "b007 [Fault 1 Code] is the most recent fault, b008/b009 are the next two, and repetitive faults are only recorded once. Related Parameters: F604…F610.";
const HISTORY_P144 =
  "F604…F610 are the older fault codes in the 10-fault history. Related Parameters: b007…b009.";
const INDEX_P75 =
  "Modified group P034 Motor NP FLA P035 Motor NP Poles P036 Motor NP RPM(1) 641 Fault 9 Current(1)";
const CONTROL_P135 =
  "A551 [Fault Clear] 1 Reset Fault — buffers are kept. 2 Clear Buffer — resets the active fault and clears all fault buffers to 0.";
const F004_TABLE =
  "F004 Undervoltage. The DC bus voltage fell below the undervoltage trip point. Check incoming AC line.";

const EMPTY_HISTORY_ASK =
  "PowerFlex 525: missing fault codes. HMI shows only the newest three. F604 through F610 are all zero on a drive in service since May 2024. Why is the extended fault history missing?";
const FAULT_MEANING_ASK = "What does PowerFlex 525 fault F004 mean?";

const row = (page: number, content: string, rank: number, lexemes: string[]): Row => ({
  content,
  doc_id: "d-520-um001",
  source_url: "node-doc/d-520-um001/520-um001.pdf",
  source_page: page,
  page_start: page,
  page_label: String(page),
  section_path: null,
  filename: "520-um001.pdf",
  document_heading: "PowerFlex 520-Series Adjustable Frequency AC Drive User Manual",
  verified: true,
  rank,
  lexemes,
});

const DISPLAY_ROWS = [
  row(144, HISTORY_P144, 1.0, ["fault", "histori", "f604", "f610"]),
  row(79, HISTORY_P79, 0.9, ["fault", "code", "b007", "b008", "b009"]),
  row(75, INDEX_P75, 0.85, ["modifi", "group", "p034", "fault"]),
];
const CONTROL_ROW = row(135, CONTROL_P135, 0.4, ["fault", "clear", "buffer", "a551"]);
const F004_ROW = row(161, F004_TABLE, 1.0, ["fault", "f004", "undervolt"]);

const isAnd = (sql: string) =>
  sql.includes("plainto_tsquery('english', $2)") &&
  !sql.includes("replace(") &&
  !sql.includes("names_document") &&
  !sql.includes("quote_literal");
const isOr = (sql: string) => sql.includes("replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')");
const isIlike = (sql: string) => sql.includes("ILIKE ANY(");
const CONTROL_QUERY = /fault clear|clear history|reset history|clear buffer|reset buffer|clear queue|reset queue/i;
const isControlQuery = (params: unknown[]) =>
  typeof params[1] === "string" && CONTROL_QUERY.test(params[1]);
const isControlIlike = (params: unknown[]) =>
  Array.isArray(params[2]) && (params[2] as string[]).some((p) => CONTROL_QUERY.test(String(p)));

function makeClient(handler: (sql: string, params: unknown[]) => Row[]) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: handler(sql, params) };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const ask = (client: PoolClient, q: string) =>
  retrieveNodeChunks(client, "t-1", q, {
    nodeId: "n-1",
    unsPath: null,
    topK: 3,
    docIds: ["d-520-um001"],
    rawQuery: q,
    validatedDocScope: true,
  });

function corpus(sql: string, params: unknown[]): Row[] {
  if (isAnd(sql)) return DISPLAY_ROWS;
  if (isOr(sql) && isControlQuery(params)) return [CONTROL_ROW];
  if (isIlike(sql) && isControlIlike(params)) return [CONTROL_ROW];
  if (isOr(sql) || isIlike(sql)) return DISPLAY_ROWS;
  return [];
}

describe("retrieveNodeChunks — empty fault-history ask surfaces A551 Clear Buffer", () => {
  it("cites a history readout AND the Clear Buffer control row (AR-2026-11-03)", async () => {
    const { client, calls } = makeClient(corpus);
    const out = await ask(client, EMPTY_HISTORY_ASK);
    expect(calls.some((c) => isOr(c.sql) && isControlQuery(c.params))).toBe(true);
    const pages = out.map((c) => c.sourcePage);
    const texts = out.map((c) => c.content);
    expect(pages).toContain(135);
    expect(texts.some((t) => /A551/.test(t) && /Clear Buffer/.test(t))).toBe(true);
    expect(texts.some((t) => /Fault 1 Code|10-fault history/.test(t))).toBe(true);
  });

  it("control: a fault-meaning ask does not run the history-control expansion", async () => {
    const { client, calls } = makeClient((sql, params) => {
      if (isAnd(sql) || isOr(sql) || isIlike(sql)) return [F004_ROW, ...DISPLAY_ROWS];
      return corpus(sql, params);
    });
    const out = await ask(client, FAULT_MEANING_ASK);
    expect(calls.filter((c) => isOr(c.sql) && isControlQuery(c.params))).toEqual([]);
    expect(out.map((c) => c.content).join("\n")).not.toMatch(/Clear Buffer/);
  });

  it("control: when the corpus has no control row the expansion invents nothing", async () => {
    const { client } = makeClient((sql, params) => {
      if (isOr(sql) && isControlQuery(params)) return [];
      if (isIlike(sql) && isControlIlike(params)) return [];
      if (isAnd(sql) || isOr(sql) || isIlike(sql)) return DISPLAY_ROWS;
      return [];
    });
    const out = await ask(client, EMPTY_HISTORY_ASK);
    expect(out.map((c) => c.sourcePage)).not.toContain(135);
    expect(out.some((c) => /Fault 1 Code|10-fault history/.test(c.content))).toBe(true);
  });
});

function assertHistoryAndClearBuffer(out: Awaited<ReturnType<typeof ask>>) {
  const pages = out.map((c) => c.sourcePage);
  const texts = out.map((c) => c.content);
  expect(pages).toContain(135);
  expect(texts.some((t) => /A551/.test(t) && /Clear Buffer/.test(t))).toBe(true);
  expect(texts.some((t) => /Fault 1 Code|10-fault history/.test(t))).toBe(true);
}

describe("A551 Clear Buffer survives NOTEBOOK_RERANK on and off (#5181)", () => {
  it("flag off: the control row is kept and the reranker is never called", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
    const svc = vi.fn();
    vi.stubGlobal("fetch", svc);
    const { client } = makeClient(corpus);
    const out = await ask(client, EMPTY_HISTORY_ASK);
    expect(svc).not.toHaveBeenCalled();
    assertHistoryAndClearBuffer(out);
  });

  it("flag on: the control row is kept even when the cross-encoder scores it last", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    vi.stubEnv("RERANKER_URL", "http://mira-reranker:8088");
    vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
    const svc = vi.fn(async (_url: string, init: RequestInit) => {
      const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
      return new Response(
        JSON.stringify({ scores: passages.map((p) => (/A551/.test(p) ? -100 : 1)) }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", svc);
    const { client } = makeClient(corpus);
    const diagnostics: { rerank?: string } = {};
    const out = await retrieveNodeChunks(client, "t-1", EMPTY_HISTORY_ASK, {
      nodeId: "n-1",
      unsPath: null,
      topK: 3,
      docIds: ["d-520-um001"],
      rawQuery: EMPTY_HISTORY_ASK,
      validatedDocScope: true,
      diagnostics,
    });
    expect(svc).toHaveBeenCalled();
    expect(diagnostics.rerank).toBe("ran");
    assertHistoryAndClearBuffer(out);
  });
});
