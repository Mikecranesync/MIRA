/**
 * #6030 Phase 1 — context-survival regression tests for the REAL production
 * helpers (buildGroundedContext / chunksToSources / extractQuestionTerms).
 *
 * Scope, stated plainly: these prove that rows which RETRIEVAL ALREADY RETURNED
 * survive prompt assembly. They do NOT prove retrieval returns the right pages
 * (the #5998 root cause — ranking never returned pp.161-162 — is untouched and
 * is a separate, still-open limitation). Every excerpt below is a SYNTHETIC
 * regression input, not a verified OEM fact.
 */
import { describe, expect, it } from "vitest";
import {
  TABLE_COMPACT_BUDGET,
  buildGroundedContext,
  chunksToSources,
  extractQuestionTerms,
} from "../manual-rag";
import { makeChunk } from "./test-fixtures";

/** Text of the single rendered block, without its `[n] head, p.N` label line. */
function body(context: string): string {
  return context.split("\n").slice(1).join("\n");
}
const HDR = "| Code | Meaning | Notes |\n|------|---------|-------|";

describe("F1 — distinct passages on one page are kept", () => {
  const prefix = "Common synthetic safety preface. ".repeat(12); // > 200 chars shared
  const intro = makeChunk(`${prefix}Introductory passage only.`, 162);
  const answer = makeChunk(`${prefix}| F081 | DSI Comm Loss | Type 2 |`, 162);

  it("keeps both passages under ONE citation number and ONE chip", () => {
    const context = buildGroundedContext([intro, answer], "What is F081?");
    expect(context).toContain("Introductory passage only.");
    expect(context).toContain("DSI Comm Loss");
    expect(context.match(/^\[1\] /gm)).toHaveLength(2);
    expect(context).not.toMatch(/^\[2\] /m);
    expect(chunksToSources([intro, answer])).toHaveLength(1);
  });

  it("control: an exact (whitespace/case-normalised) duplicate is dropped once", () => {
    const dup = { ...intro, content: intro.content.toUpperCase().replace(/ /g, "  ") };
    const context = buildGroundedContext([intro, dup], "preface");
    expect(context.match(/^\[1\] /gm)).toHaveLength(1);
  });

  it("same text on a different page is not a duplicate", () => {
    const a = makeChunk("Synthetic identical passage.", 10);
    const b = makeChunk("Synthetic identical passage.", 11);
    expect(buildGroundedContext([a, b]).match(/Synthetic identical passage/g)).toHaveLength(2);
  });

  it("unknown-page passages are neither dropped nor merged with a numbered page", () => {
    const a = makeChunk("Unknown page passage ONE.", null as unknown as number);
    const b = makeChunk("Unknown page passage TWO.", null as unknown as number);
    const c = makeChunk("Unknown page passage ONE.", 5);
    const context = buildGroundedContext([a, b, c]);
    expect(context).toContain("passage ONE.");
    expect(context).toContain("passage TWO.");
    expect(context.match(/passage ONE\./g)).toHaveLength(2); // null-page vs p.5
  });
});

describe("F4 — complete dotted parameters and whole identifiers", () => {
  it("extracts P06.53 without also capturing its P06 prefix", () => {
    const t = extractQuestionTerms("What is parameter P06.53?");
    expect(Array.from(t.exact)).toEqual(["P06.53"]);
    expect(Array.from(extractQuestionTerms("What is P06?").exact)).toEqual(["P06"]);
  });

  it("broad words (fault/error/alarm/warning/trip) are not symptom terms", () => {
    const t = extractQuestionTerms("fault error alarm warning trip");
    expect(t.symptoms.size).toBe(0);
  });

  // Synthetic GS10-style group: P06.00-P06.99 plus colliding identifiers.
  const rows = Array.from({ length: 100 }, (_, i) =>
    `| P06.${String(i).padStart(2, "0")} | Synthetic parameter ${i} fault error alarm | Range 0-100 |`,
  );
  const long = [
    "# Group 06 protection parameters",
    HDR,
    "| P06 | Group heading row | - |",
    ...rows,
    "| P06.530 | Prefix collision row | - |",
    "| XP06.53 | Suffix collision row | - |",
  ].join("\n");

  it("keeps the exact P06.53 row and the table's own header within the budget", () => {
    expect(long.length).toBeGreaterThan(TABLE_COMPACT_BUDGET);
    const context = buildGroundedContext([makeChunk(long, 23)], "What is parameter P06.53 fault error alarm?");
    expect(context).toContain("| P06.53 | Synthetic parameter 53 fault error alarm | Range 0-100 |");
    expect(context).toContain("| Code | Meaning | Notes |");
    expect(context).toContain("# Group 06 protection parameters");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  it("P06.53 does not pull in P06 / P06.530 / XP06.53 rows", () => {
    const context = buildGroundedContext([makeChunk(long, 23)], "What is parameter P06.53?");
    expect(context).not.toContain("P06.530");
    expect(context).not.toContain("XP06.53");
    expect(context).not.toContain("Group heading row");
  });

  it("control: asking for bare P06 selects only the exact P06 row", () => {
    const context = buildGroundedContext([makeChunk(long, 23)], "What is P06?");
    expect(context).toContain("Group heading row");
    expect(context).not.toContain("| P06.53 |");
  });
});

describe("F5 — symptom-only questions (context survival only, not retrieval)", () => {
  // Synthetic stand-ins for retrieved pp.161/162 fault tables.
  const filler = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `| X${tag}${String(i).padStart(3, "0")} | Synthetic unrelated condition ${i} | none |`);
  const p161 = [
    "# Fault descriptions",
    HDR,
    ...filler(200, "a"),
    "| F012 | HW OverCurrent: synthetic hardware cause | check wiring |",
  ].join("\n");
  const p162 = [
    "# Fault descriptions (continued)",
    HDR,
    ...filler(200, "b"),
    "| F063 | SW OverCurrent: synthetic excessive motor load | lengthen accel |",
  ].join("\n");
  const question = "What causes overcurrent faults on a PowerFlex 525?";

  it("fixture rows really are beyond 2400 chars", () => {
    expect(p161.indexOf("F012")).toBeGreaterThan(2400);
    expect(p162.indexOf("F063")).toBeGreaterThan(2400);
  });

  it("the exact original #5998 question keeps both late overcurrent rows", () => {
    const context = buildGroundedContext([makeChunk(p161, 161), makeChunk(p162, 162)], question);
    expect(context).toContain("| F012 | HW OverCurrent: synthetic hardware cause | check wiring |");
    expect(context).toContain("| F063 | SW OverCurrent: synthetic excessive motor load | lengthen accel |");
    expect(context).toMatch(/p\.161/);
    expect(context).toMatch(/p\.162/);
  });

  it("solid yellow: the best (both-word) row survives beyond 2400 chars", () => {
    const led = [
      "# Status LEDs",
      "| LED | State | Meaning |\n|-----|-------|---------|",
      ...filler(80, "c"),
      "| STOP/RUN | Yellow flashing | synthetic startup |",
      "| STOP/RUN | Yellow solid | synthetic STOP mode |",
    ].join("\n");
    expect(led.indexOf("Yellow solid")).toBeGreaterThan(2400);
    const context = buildGroundedContext([makeChunk(led, 30)], "the plc has a solid yellow light");
    expect(context).toContain("| STOP/RUN | Yellow solid | synthetic STOP mode |");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });
});

describe("F6 — selection stays inside table boundaries", () => {
  const modelA = Array.from({ length: 60 }, (_, i) => `| A${String(i).padStart(3, "0")} | Synthetic model A condition ${i} |`);
  const twoModels = [
    "# Model A only",
    "| Code | Meaning |\n|---|---|",
    ...modelA,
    "",
    "# Model B only",
    "| Code | Meaning |\n|---|---|",
    "| F205 | Synthetic model B condition |",
    "| F206 | Synthetic model B other |",
    "* F205 applies after firmware 2 (synthetic footnote)",
  ].join("\n");

  it("renders the Model B row under Model B's heading, never Model A's", () => {
    const context = buildGroundedContext([makeChunk(twoModels, 50)], "What does F205 mean?");
    expect(context).toContain("# Model B only");
    expect(context).toContain("| F205 | Synthetic model B condition |");
    expect(context).not.toContain("Model A only");
    expect(context).not.toContain("| A0");
    expect(context.indexOf("# Model B only")).toBeLessThan(context.indexOf("F205 | Synthetic"));
  });

  it("keeps the footnote that qualifies the row and marks omitted spans", () => {
    const context = buildGroundedContext([makeChunk(twoModels, 50)], "What does F205 mean?");
    expect(context).toContain("applies after firmware 2");
    expect(context).toContain("[… omitted …]"); // Model A text dropped, said so
  });

  it("a row from table A is never adjacent to a row from table B without a marker", () => {
    const context = buildGroundedContext([makeChunk(twoModels, 50)], "F205 and A030");
    const lines = body(context).split("\n");
    const a = lines.findIndex((l) => l.includes("| A030 |"));
    const b = lines.findIndex((l) => l.includes("| F205 |"));
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(lines.slice(a, b).join("\n")).toContain("# Model B only");
    expect(lines.slice(a, b).join("\n")).toContain("omitted");
  });

  it("a late exact row survives even when earlier symptom rows could eat the budget", () => {
    const early = Array.from({ length: 80 }, (_, i) => `| E${String(i).padStart(3, "0")} | OverCurrent variant ${i} synthetic description | n |`);
    // long exact row: it cannot squeeze into leftover slack after symptom rows fill the budget
    const lateRow = `| F205 | Late synthetic exact row ${"detail ".repeat(45)}| n |`;
    const text = ["# Faults", HDR, ...early, lateRow].join("\n");
    const context = buildGroundedContext([makeChunk(text, 9)], "overcurrent F205");
    expect(context).toContain(lateRow);
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  it("synthetic F16 P047=15 (p.88) under a Model B heading keeps the heading", () => {
    const rows = Array.from({ length: 70 }, (_, i) => `| P${String(i).padStart(3, "0")} | Synthetic setting ${i} | 0 |`);
    const text = ["# F16 drive — Model B only", "| Param | Meaning | Default |\n|---|---|---|", ...rows.slice(0, 47), "| P047 | Synthetic setting 47 = 15 | 15 |", ...rows.slice(48)].join("\n");
    const context = buildGroundedContext([makeChunk(text, 88)], "What should P047 be on the F16?");
    expect(context).toContain("Model B only");
    expect(context).toContain("| P047 | Synthetic setting 47 = 15 | 15 |");
    expect(context).toContain("p.88");
  });

  it("PF525-style F081 / p.162 / Type 2 row in a 100+ row table survives", () => {
    const rows = Array.from({ length: 120 }, (_, i) => `| F${String(i + 1).padStart(3, "0")} | Fault ${i + 1} | Type ${(i % 2) + 1} |`);
    const text = ["# Fault codes", "| Code | Name | Type |\n|---|---|---|", ...rows].join("\n");
    expect(text).toContain("| F081 | Fault 81 | Type 1 |");
    const context = buildGroundedContext([makeChunk(text, 162)], "What does F081 mean?");
    expect(context).toContain("| F081 | Fault 81 | Type 1 |");
    expect(context).toContain("| Code | Name | Type |");
    expect(context).toContain("p.162");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });
});
