/**
 * Trust gate T-1 (#4875 row 5): real forum questions find the right manual page.
 *
 * The 2026-10-29 IMIB run at a051e322b put the right page in the top 5 for 8 of 19
 * real forum questions, every miss a ranking miss (evidence chunk in scope, never
 * surfaced). These tests pin the five mechanisms that fix was built from, each on
 * the forum wording that exposed it:
 *   1. zero-padding spellings of a code ("F081" for the manual's "F81");
 *   2. "parameter 60" and catalog fragments ("12QWB") as whole-token codes;
 *   3. the OR recall pass runs when the AND pass found nothing, even if an exact
 *      lane returned a few rows (it used to key on the pool being empty);
 *   4. a code that names the product (on more than 5% of the scope) is not a code;
 *   5. IDF coverage of the question scales the lexical base in the rerank, each
 *      lexical pass normalised to its own max, cover-page words left out.
 * Zero tokens: a mocked pg client dispatches on SQL shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { codeSpellings, codeTokenMatcher, expandIndustrialQuery, rerankChunks } from "@/lib/notebook-query";

afterEach(() => {
  delete process.env.NOTEBOOK_LEXICAL_V2;
});

describe("codeSpellings — the technician's zero padding and the manual's", () => {
  it("adds the other spelling and keeps the typed one", () => {
    expect(codeSpellings("F081")).toEqual(["F081", "F81"]);
    expect(codeSpellings("A51")).toEqual(["A51", "A051"]);
    expect(codeSpellings("F81")).toEqual(["F81", "F081"]);
  });
  it("never produces a one-digit form, and leaves a three-digit unpadded ID alone", () => {
    expect(codeSpellings("F004")).toEqual(["F004"]);
    expect(codeSpellings("A410")).toEqual(["A410"]);
    expect(codeSpellings("P042")).toEqual(["P042", "P42"]);
  });
  it("passes anything that is not letter+digits through unchanged", () => {
    expect(codeSpellings("oC")).toEqual(["oC"]);
    expect(codeSpellings("parameter 60")).toEqual(["parameter 60"]);
    expect(codeSpellings("12QWB")).toEqual(["12QWB"]);
  });
});

describe("expandIndustrialQuery — forum wording", () => {
  it("fn-pf40-6: 'A51-A54' searches the manual's A051 and A054 too", () => {
    const e = expandIndustrialQuery("Then I enter in a speed setting using A51-A54. Not sure how to adjust the speed.");
    expect(e.exactTokens).toEqual(expect.arrayContaining(["A51", "A051", "A54", "A054"]));
  });
  it("fn-pf40-4: 'F081 Error' binds the whole-token code in both spellings", () => {
    const e = expandIndustrialQuery("when they power back up i get an F081 Error (Comms lost) on the master drive");
    expect(e.codeTokens).toEqual(expect.arrayContaining(["F081", "F81"]));
    expect(e.exactTokens).toEqual(expect.arrayContaining(["F081", "F81"]));
  });
  it("fn-e3plus-2: 'parameter 60' is a whole-token phrase, and 60 alone is not", () => {
    const e = expandIndustrialQuery("Parameter 60 is set to 100, and parameters 61 - 3 read the currents.");
    expect(e.codeTokens).toContain("parameter 60");
    expect(e.codeTokens).not.toContain("60");
    expect(codeTokenMatcher("parameter 60").re.test("Input Assembly, Parameter\n60. These values")).toBe(true);
    expect(codeTokenMatcher("parameter 60").re.test("Parameter 600 sets the")).toBe(false);
  });
  it("oem-fault: a hexadecimal controller code is a code without any fault keyword", () => {
    expect(expandIndustrialQuery("What does 0xF003 mean on a Micro810 controller?").codeTokens).toContain("0xF003");
    expect(codeTokenMatcher("0xF003").re.test("0xF003 Fault: a non-recoverable fault")).toBe(true);
    expect(codeTokenMatcher("0xF003").re.test("0xF0031")).toBe(false);
  });
  it("a catalog fragment or family name is not a code (it names the product, on every page)", () => {
    expect(expandIndustrialQuery("I hav a AB micro 810 12QWB controller. Can it connect to a PV component?").codeTokens).toEqual([]);
    expect(expandIndustrialQuery("my PF40 and GS10 won't start").codeTokens).toEqual([]);
    // Zero padding is for one-letter IDs; a two-letter family name is left alone.
    expect(codeSpellings("GS10")).toEqual(["GS10"]);
  });
});

describe("rerankChunks — IDF coverage scales the lexical base", () => {
  const expanded = expandIndustrialQuery("how do I disable bootp so I can set the address over ethernet");
  const chunk = (page: number, rank: number, idfCover: number) => ({
    content: `page ${page} text about the controller`,
    rank,
    sourcePage: page,
    docId: "d",
    idfCover,
  });
  it("at equal lexical rank the chunk holding the question's rare words leads", () => {
    const out = rerankChunks(expanded, [chunk(1, 1, 0.1), chunk(2, 1, 0.9)], { idfCoverWeight: 6 });
    expect(out.map((c) => c.sourcePage)).toEqual([2, 1]);
  });
  it("without a weight (or without cover) the order is the lexical order", () => {
    expect(rerankChunks(expanded, [chunk(1, 1, 0.1), chunk(2, 1, 0.9)]).map((c) => c.sourcePage)).toEqual([1, 2]);
    expect(rerankChunks(expanded, [chunk(1, 0.5, 0), chunk(2, 0.4, 0)], { idfCoverWeight: 6 }).map((c) => c.sourcePage)).toEqual([1, 2]);
  });
  it("cover alone cannot lift a chunk that scored nothing on the question's words", () => {
    // Forum chatter ("decided", "small project") is rare in a manual; a chunk
    // that holds only that must not outrank one that matches the question.
    const out = rerankChunks(expanded, [chunk(1, 0, 1), chunk(2, 0.3, 0)], { idfCoverWeight: 6 });
    expect(out.map((c) => c.sourcePage)).toEqual([2, 1]);
  });
});

// ---------------------------------------------------------------------------
// retrieveNodeChunks with a mocked client. Dispatch is by SQL shape; every row
// carries the columns the real lanes return (lexemes included).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Call = { sql: string; params: unknown[] };
const row = (page: number, content: string, rank: number, lexemes: string[]): Row => ({
  content,
  doc_id: "d-1",
  source_url: "node-doc/d-1/manual.pdf",
  source_page: page,
  page_start: page,
  page_label: null,
  section_path: null,
  filename: "manual.pdf",
  document_heading: "Controller User Manual",
  verified: true,
  rank,
  lexemes,
});
const isAnd = (sql: string) => sql.includes("plainto_tsquery('english', $2)") && !sql.includes("replace(") && !sql.includes("names_document") && !sql.includes("quote_literal");
const isOr = (sql: string) => sql.includes("replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')");
const isRare = (sql: string) => sql.includes("string_agg(quote_literal(lex), ' | ')::tsquery");
const isCount = (sql: string) => sql.includes("WITH ORDINALITY");
const isIdf = (sql: string) => sql.includes("names_document");
const isRegexLane = (sql: string) => sql.includes("content ~* ANY(");

function makeClient(handler: (sql: string, params: unknown[]) => Row[]) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return { rows: handler(sql, params) };
  });
  return { client: { query } as unknown as PoolClient, calls };
}
const ask = (client: PoolClient, q: string) =>
  retrieveNodeChunks(client, "t-1", q, { nodeId: "n-1", unsPath: null, topK: 6, docIds: ["d-1"], rawQuery: q, validatedDocScope: true });

describe("retrieveNodeChunks — the OR recall pass keys on lexical coverage, not pool size", () => {
  it("t4-77 tq-42: an exact lane that found two rows no longer silences the OR pass", async () => {
    const q = "Walk me through locking out the M340 rack so I can swap the BMXAMI0810. What do I lock and in what order?";
    const { client, calls } = makeClient((sql) => {
      if (isRegexLane(sql)) return [row(58, "BMXAMI0810 wiring", 0, ["bmxami0810"]), row(374, "BMXAMI0810 spec", 0, ["bmxami0810"])];
      return [];
    });
    await ask(client, q);
    const orPasses = calls.filter((c) => isOr(c.sql) && c.params[1] === q);
    expect(orPasses.length).toBeGreaterThanOrEqual(1);
  });
  it("control: when the AND pass itself found rows, the last-resort OR pass does not run", async () => {
    const q = "Walk me through locking out the M340 rack so I can swap the BMXAMI0810. What do I lock and in what order?";
    const { client, calls } = makeClient((sql) => {
      if (isAnd(sql)) return [row(19, "Lockout procedure for the rack", 1, ["lockout", "rack"])];
      return [];
    });
    await ask(client, q);
    expect(calls.filter((c) => isOr(c.sql) && c.params[1] === q)).toEqual([]);
  });
});

describe("retrieveNodeChunks — a code that names the product is not a code", () => {
  const q = "F1 fault on the 2080-LC20-20QWB after every power cycle";
  const pattern = codeTokenMatcher("F1").sql;
  const countRows = (params: unknown[], n: number, scope: number) =>
    (params[2] as string[]).map((p, i) => ({ i: i + 1, n: p === pattern ? n : 0, scope }));
  it("a code on 7 of 53 chunks (more than 5%, more than four) is dropped before the whole-token lane runs", async () => {
    const { client, calls } = makeClient((sql, params) => (isCount(sql) ? countRows(params, 7, 53) : []));
    await ask(client, q);
    expect(calls.filter((c) => isRegexLane(c.sql)).flatMap((c) => c.params[2] as string[])).not.toContain(pattern);
  });
  it("a code on 9 of 261 chunks (3.4%) stays a code; so does one on 4 chunks of a 20-chunk sheet", async () => {
    const a = makeClient((sql, params) => (isCount(sql) ? countRows(params, 9, 261) : []));
    await ask(a.client, q);
    expect(a.calls.filter((c) => isRegexLane(c.sql)).flatMap((c) => c.params[2] as string[])).toContain(pattern);
    const b = makeClient((sql, params) => (isCount(sql) ? countRows(params, 4, 20) : []));
    await ask(b.client, q);
    expect(b.calls.filter((c) => isRegexLane(c.sql)).flatMap((c) => c.params[2] as string[])).toContain(pattern);
  });
  it("a code the count query cannot see (no row, or an error) is kept", async () => {
    const { client, calls } = makeClient((sql) => {
      if (isCount(sql)) throw new Error("count unavailable");
      return [];
    });
    await ask(client, q);
    expect(calls.filter((c) => isRegexLane(c.sql)).flatMap((c) => c.params[2] as string[])).toContain(pattern);
  });
});

describe("retrieveNodeChunks — IDF coverage in the rerank", () => {
  const q = "I was able to communicate yesterday but I had to disable BOOTP so now I can't even communicate. Can I just use an ethernet cable?";
  // Lexeme table the IDF query returns: "bootp" is rare, "communic" common,
  // "control" sits on the cover (names the document) and must count for nothing.
  const idfRows = [
    { lex: "bootp", df: 2, n: 200, names_document: false },
    { lex: "communic", df: 60, n: 200, names_document: false },
    { lex: "cabl", df: 30, n: 200, names_document: false },
    { lex: "control", df: 1, n: 200, names_document: true },
  ];
  const common = row(145, "RS-232 communication cable wiring and the communication channel", 1.0, ["communic", "cabl", "rs-232"]);
  const bootp = row(160, "Configure using BOOTP: the controller broadcasts BOOTP requests at power-up", 0.4, ["bootp", "configur", "control"]);
  const cover = row(1, "Controller User Manual, controller controller", 0.5, ["control"]);

  it("fn-ml1100-8: the BOOTP page outranks the page dense in common words", async () => {
    const { client } = makeClient((sql) => {
      if (isIdf(sql)) return idfRows;
      if (isOr(sql)) return [common, bootp];
      if (isRare(sql)) return [bootp];
      return [];
    });
    const out = await ask(client, q);
    expect(out.map((c) => c.sourcePage).slice(0, 2)).toEqual([160, 145]);
  });
  it("a lexeme on the document's cover contributes nothing to cover", async () => {
    const { client } = makeClient((sql) => {
      if (isIdf(sql)) return idfRows;
      if (isOr(sql)) return [common, cover];
      return [];
    });
    const out = await ask(client, q);
    // Same base as `common` would lose on rank; with "control" counted, the cover
    // page would have the largest IDF share (df 1) and lead. It must not.
    expect(out.map((c) => c.sourcePage)[0]).toBe(145);
  });
  it("fails open: when the IDF query errors the order is the lexical order", async () => {
    const { client } = makeClient((sql) => {
      if (isIdf(sql)) throw new Error("idf unavailable");
      if (isOr(sql)) return [common, bootp];
      return [];
    });
    const out = await ask(client, q);
    expect(out.map((c) => c.sourcePage).slice(0, 2)).toEqual([145, 160]);
  });
  it("each lexical pass is normalised to its own max before pooling", async () => {
    // The AND pass scores on a tiny scale, the rare lane on a large one. The
    // AND row matched every question word and must not be squashed to nothing.
    const andRow = row(14, "RFI jumper location on frame D0", 0.002, ["rfi", "jumper", "frame", "d0"]);
    const rareRow = row(26, "RFI filter notes", 8.0, ["rfi"]);
    const { client } = makeClient((sql) => {
      if (isAnd(sql)) return [andRow];
      if (isRare(sql)) return [rareRow];
      return [];
    });
    const out = await ask(client, "Where's the RFI jumper on frame D0?");
    expect(out.map((c) => c.sourcePage)[0]).toBe(14);
  });
  it("NOTEBOOK_LEXICAL_V2 keeps the IDF-sum scale untouched", async () => {
    process.env.NOTEBOOK_LEXICAL_V2 = "1";
    const { client, calls } = makeClient(() => []);
    await ask(client, "bootp address");
    // The flag's own scorer runs; no pass is renormalised (ranks come back as the SQL produced them).
    expect(calls.some((c) => c.sql.includes("ln((n.n - df.df + 0.5)"))).toBe(true);
  });
});
