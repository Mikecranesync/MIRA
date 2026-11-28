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
  MAX_CONTENT_CHARS,
  TABLE_COMPACT_BUDGET,
  buildGroundedContext,
  chunksToSources,
  extractQuestionTerms,
} from "../manual-rag";
import { makeChunk } from "./test-fixtures";
import { pagesByCitation } from "@/capabilities/supporting-quote";

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

  it("control: a whitespace-only duplicate is dropped once", () => {
    const dup = { ...intro, content: intro.content.replace(/ /g, "  ") + "\n" };
    const context = buildGroundedContext([intro, dup], "preface");
    expect(context.match(/^\[1\] /gm)).toHaveLength(1);
  });

  it("case-different passages stay distinct (4 mV vs 4 MV)", () => {
    const context = buildGroundedContext([makeChunk("Output range: 4 mV.", 10), makeChunk("Output range: 4 MV.", 10)]);
    expect(context).toContain("4 mV");
    expect(context).toContain("4 MV");
  });

  it("same text on a different page is not a duplicate", () => {
    const a = makeChunk("Synthetic identical passage.", 10);
    const b = makeChunk("Synthetic identical passage.", 11);
    expect(buildGroundedContext([a, b]).match(/Synthetic identical passage/g)).toHaveLength(2);
  });

  // Native review 2 F1: one page retrieved twice, once with its line breaks and once flattened to
  // a single line. They are the same passage, but only the line-broken copy lets row selection
  // keep the requested row; whichever order they arrive in, the model must see that copy.
  describe("a flattened and a line-broken copy of one page", () => {
    const hdr = "| Model | Parameter | Meaning |\n|---|---|---|";
    const filler = Array.from({ length: 95 }, (_, i) => `| GS10 | A${100 + i} | synthetic unrelated filler ${i} |`);
    const row = "| All variants | P06.53 | This is the complete requested synthetic definition |";
    const structured = ["# GS10 parameters", hdr, ...filler, row].join("\n");
    const flat = structured.replace(/\s+/g, " ");
    it.each([
      ["flattened first", [flat, structured]],
      ["line-broken first", [structured, flat]],
    ])("%s: the requested row reaches the model once, under one citation", (_name, order) => {
      expect(flat).not.toContain("\n"); // precondition: the flat copy really has no line structure
      const chunks = order.map((t) => makeChunk(t, 88));
      const context = buildGroundedContext(chunks, "What does P06.53 mean?");
      expect(context).toContain(row);
      expect(context.match(/^\[1\] /gm)).toHaveLength(1);
      expect(context).not.toMatch(/^\[2\] /m);
    });
    it.each([
      ["flattened first", [flat, structured]],
      ["line-broken first", [structured, flat]],
    ])("%s: the validators read the same single line-broken copy the model saw", (_name, order) => {
      const chunks = order.map((t) => makeChunk(t, 88));
      expect(pagesByCitation(chunks)).toEqual([[structured]]);
    });
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

  it("PF525-style F081 / p.162 / Type 2 row (synthetic) in a 100+ row table survives complete", () => {
    const f081 = "| F081 | DSI Comm Loss | Type 2 | Manual reset required |";
    const rows = Array.from({ length: 120 }, (_, i) =>
      i === 80 ? f081 : `| F${String(i + 1).padStart(3, "0")} | Fault ${i + 1} | Type 1 | Auto reset |`,
    );
    const text = ["# Fault codes", "| Code | Name | Type | Reset |\n|---|---|---|---|", ...rows].join("\n");
    expect(rows.filter((r) => r.includes("F081"))).toEqual([f081]);
    const context = buildGroundedContext([makeChunk(text, 162)], "What does F081 mean?");
    expect(context).toContain(f081);
    expect(context).toContain("| Code | Name | Type | Reset |");
    expect(context).toContain("p.162");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  // --- data-preservation classes (no clipping, no compact mode) ---
  const filler = Array.from({ length: 100 }, (_, i) => `| A${String(i).padStart(3, "0")} | Synthetic filler ${i} |`);
  const header2 = "| Code | Meaning |\n|---|---|";

  it("a requested row longer than 500 chars is emitted complete when it fits", () => {
    const row = `| F205 | ${"synthetic explanation ".repeat(35)}TAIL CONDITION APPLIES |`;
    expect(row.length).toBeGreaterThan(500);
    const text = ["# Model B only", header2, ...filler, row].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain(row);
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  it("a heading longer than 160 chars keeps its trailing applicability text", () => {
    const qualifier = `# ${"Synthetic applicability context ".repeat(7)}Model B only`;
    expect(qualifier.length).toBeGreaterThan(160);
    const text = [qualifier, header2, ...filler, "| F205 | Synthetic answer |"].join("\n");
    expect(buildGroundedContext([makeChunk(text, 20)], "What is F205?")).toContain(qualifier);
  });

  it("with three long exact rows, qualifiers/notes stay and whole rows are held with a marker", () => {
    const preamble = [
      `# Model B only ${"qualifier ".repeat(13)}`,
      `Applicable firmware 2 only ${"context ".repeat(17)}`,
      `Digital inputs option only ${"detail ".repeat(17)}`,
    ];
    const notes = Array.from({ length: 3 }, (_, i) => `* note ${i} ${"important qualification ".repeat(6)}`);
    const h = `| Code | ${"Meaning ".repeat(25)}| State |\n|---|---|---|`;
    const rows = [205, 206, 207].map((n) => `| F${n} | ${"described ".repeat(45)}| value |`);
    const text = [...preamble, h, ...filler, ...rows, ...notes].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "F205 F206 F207");
    for (const l of [...preamble, ...notes]) expect(context).toContain(l);
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
    const shown = rows.filter((r) => context.includes(r));
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThan(3);
    // every row line that is emitted is whole; the shortfall is announced
    expect(context).toContain("matching rows not shown");
    for (const r of rows) if (!context.includes(r)) expect(context).not.toContain(r.slice(0, 60));
  });

  it("an impossible giant row is held explicitly, never rendered partially", () => {
    const giant = `| F205 | ${"x".repeat(3000)} |`;
    const text = ["# Model B only", header2, ...filler, giant].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain("matching rows not shown");
    expect(context).not.toContain("xxxxx");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  // --- qualifier blocks are structural, not line-count capped ---
  it("keeps the model heading and every qualifying line above the table (no 3-line cap)", () => {
    const qualifiers = ["# Model B only", "Firmware 2 required", "Digital input option required", "Read all conditions below", "Applicable to this table"];
    const text = [...qualifiers, header2, ...filler, "| F205 | Synthetic answer |"].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    for (const q of qualifiers) expect(context).toContain(q);
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  it("keeps a long footnote block (7 notes) including the one defining the row's type", () => {
    const notes = Array.from({ length: 6 }, (_, i) => `* General note ${i + 1}`).concat(["* Type 2 requires manual reset (synthetic regression input)"]);
    const row = "| F081 | DSI Comm Loss | Type 2 |";
    const text = ["# Model B only", header2, ...filler, row, ...notes].join("\n");
    const context = buildGroundedContext([makeChunk(text, 162)], "What does F081 Type 2 mean?");
    expect(context).toContain(row);
    for (const n of notes) expect(context).toContain(n);
  });

  it("qualifier block that cannot fit with the row holds the table instead of showing an unqualified row", () => {
    const qualifiers = ["# Model B only", ...Array.from({ length: 30 }, (_, i) => `Qualifier ${i} ${"must apply ".repeat(8)}`)];
    const text = [...qualifiers, header2, ...filler, "| F205 | Synthetic answer |"].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain("matching rows not shown");
    expect(context).not.toContain("| F205 |");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  // --- structural boundaries: plain captions, separated footnotes, mixed prose+table ---
  it("a plain caption separated from its table by a blank line is kept", () => {
    const text = ["Model B only", "", header2, ...filler, "| F205 | Synthetic answer |"].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain("Model B only");
    expect(context).toContain("| F205 | Synthetic answer |");
  });

  // native-review-2 F6 changed this: a multi-line paragraph above a headingless table is NOT assumed
  // to be harmless prose ("These limits are valid / for Model B only" is a wrapped qualifier). With no
  // heading, the table's whole block since the previous table scopes it, and stays with the row.
  it("blank-separated one-line qualifiers AND the wrapped paragraph above them all stay with the row", () => {
    const prose = ["Synthetic intro line one.", "Synthetic intro line two."];
    const text = [...prose, "", "Model B only", "", "Firmware 2 required", "", header2, ...filler, "| F205 | Synthetic answer |"].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain("| F205 | Synthetic answer |");
    expect(context).toContain("Model B only");
    expect(context).toContain("Firmware 2 required");
    expect(context).toContain("Synthetic intro line one.");
    expect(context).toContain("Synthetic intro line two.");
  });

  it("two plain-captioned tables are never conflated: the Model B row carries only Model B's caption", () => {
    const a = Array.from({ length: 150 }, (_, i) => `| A${i} | Synthetic A ${i} |`);
    const text = ["Model A only", "", header2, ...a, "", "Model B only", "", header2, "| F205 | Synthetic B answer |"].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain("Model B only");
    expect(context).not.toContain("Model A only");
    expect(context).not.toContain("| A0 |");
  });

  it("blank-separated footnotes all stay with the rows they qualify", () => {
    const notes = ["* General note", "", "* Type 2 requires manual reset (synthetic)", "", "* Third note"];
    const text = ["# Model B only", header2, ...filler, "| F081 | DSI Comm Loss | Type 2 |", ...notes].join("\n");
    const context = buildGroundedContext([makeChunk(text, 162)], "What does F081 Type 2 mean?");
    for (const n of notes.filter(Boolean)) expect(context).toContain(n);
    // native-review-2 F6: a blank-separated statement below the rows without a note marker ("Applies
    // to Model B only") still scopes them, so the whole text up to the next heading/table stays...
    const text2 = [text, "", "Applies to Model B only (synthetic)."].join("\n");
    expect(buildGroundedContext([makeChunk(text2, 162)], "What does F081 Type 2 mean?")).toContain("Applies to Model B only (synthetic).");
    // ...but text under the NEXT heading belongs to that section, not to these rows.
    const text3 = [text, "", "# Unrelated synthetic section", "Unrelated synthetic prose paragraph."].join("\n");
    expect(buildGroundedContext([makeChunk(text3, 162)], "What does F081 Type 2 mean?")).not.toContain("Unrelated synthetic prose");
  });

  // --- native-review-2 F6: the row keeps its COMPLETE scope, or is withheld whole ---
  const codes95 = Array.from({ length: 95 }, (_, i) => `| A${100 + i} | Synthetic filler ${i} |`);
  const f205 = "| F205 | Synthetic target description |";
  const codeTable = [header2, ...codes95, f205];
  it("a parent heading above the table's own heading stays with the row", () => {
    const text = ["## Model B only", "### Fault codes", ...codeTable].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What does F205 mean?");
    expect(context).toContain(f205);
    expect(context).toContain("## Model B only");
    expect(context).toContain("### Fault codes");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });
  it("a parent heading's lead text stays; a sibling section's text does not; a shared parent is printed once", () => {
    const t1 = [header2, ...Array.from({ length: 60 }, (_, i) => `| B${i} | Synthetic sibling ${i} |`), "| F206 | Synthetic second target |"];
    const text = ["## Model B only", "", "Synthetic lead: these limits are valid", "for Model B units.", "", "### Sibling section", "Synthetic sibling prose.", ...t1, "### Fault codes", ...codeTable].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What do F205 and F206 mean?");
    expect(context).toContain(f205);
    expect(context).toContain("| F206 | Synthetic second target |");
    expect(context).toContain("Synthetic lead: these limits are valid");
    expect(context).toContain("for Model B units.");
    expect(context.split("## Model B only").length - 1).toBe(1);
    const onlyF205 = buildGroundedContext([makeChunk(text, 20)], "What does F205 mean?");
    expect(onlyF205).toContain(f205);
    expect(onlyF205).not.toContain("Synthetic sibling prose.");
  });
  it("a cue-free note between two tables stays with the first table's row and is printed once", () => {
    const a = [header2, ...Array.from({ length: 70 }, (_, i) => `| A${i} | Synthetic A ${i} |`), "| F207 | Synthetic rating row |"];
    const b = [header2, ...Array.from({ length: 70 }, (_, i) => `| C${i} | Synthetic C ${i} |`), "| F208 | Synthetic other row |"];
    const text = ["# Ratings", ...a, "", "Ratings above are for 480 V units.", "", ...b].join("\n");
    const first = buildGroundedContext([makeChunk(text, 20)], "What is F207?");
    expect(first).toContain("| F207 | Synthetic rating row |");
    expect(first).toContain("Ratings above are for 480 V units.");
    const both = buildGroundedContext([makeChunk(text, 20)], "What are F207 and F208?");
    expect(both.split("Ratings above are for 480 V units.").length - 1).toBe(1);
  });
  it("text before the next table is marked as running into it, so another table's caption cannot read as this row's scope", () => {
    const a = Array.from({ length: 150 }, (_, i) => `| A${i} | Synthetic A ${i} |`);
    const text = ["Model A only", "", header2, ...a, "| F209 | Synthetic A target |", "", "Model B only", "", header2, "| F205 | Synthetic B answer |"].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F209?");
    expect(context).toContain("| F209 | Synthetic A target |");
    expect(context).toContain("Model A only");
    expect(context).toMatch(/Model B only\n\[… the text above is followed directly by another table …\]/);
  });
  it("control: when the complete scope cannot fit with the row, the row is withheld whole", () => {
    const lead = Array.from({ length: 30 }, (_, i) => `Synthetic scope line ${i} ${"applies only to Model B ".repeat(4)}`);
    const text = ["## Model B only", ...lead, "### Fault codes", ...codeTable].join("\n");
    const context = buildGroundedContext([makeChunk(text, 20)], "What does F205 mean?");
    expect(context).toContain("matching rows not shown");
    expect(context).not.toContain("| F205 |");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
  });

  const prose80 = Array.from({ length: 80 }, () => "Synthetic surrounding descriptive prose.");
  it("a late row of a small table in a mostly-prose passage survives with its heading, within the plain limit", () => {
    const text = [...prose80, "# Model B only", header2, "| F205 | Synthetic answer |"].join("\n");
    expect(text.length).toBeGreaterThan(MAX_CONTENT_CHARS);
    const context = buildGroundedContext([makeChunk(text, 20)], "What is F205?");
    expect(context).toContain("# Model B only");
    expect(context).toContain("| F205 | Synthetic answer |");
    expect(body(context).length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });

  it("controls: prose with no matching table row keeps the old prefix; a giant row in a mixed passage is held whole", () => {
    const text = [...prose80, "# Model B only", header2, "| F205 | Synthetic answer |"].join("\n");
    const prefix = buildGroundedContext([makeChunk(text, 20)], "What is the weather?");
    expect(prefix).toContain("Synthetic surrounding descriptive prose.");
    expect(prefix).not.toContain("F205");
    const giant = [...prose80, "# Model B only", header2, `| F205 | ${"x".repeat(1500)} |`].join("\n");
    const held = buildGroundedContext([makeChunk(giant, 20)], "What is F205?");
    expect(held).toContain("matching rows not shown");
    expect(held).not.toContain("xxxxx");
    expect(body(held).length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });

  // --- identifier coverage: the requested parameter outranks rows that only repeat the model word ---
  const gs10 = (extra: string[] = []) => {
    const rows = Array.from({ length: 100 }, (_, i) => `| GS10 | P07.${String(i).padStart(2, "0")} | Synthetic generic parameter |`);
    return ["# GS10 parameter table", "| Model | Parameter | Function |", "|---|---|---|", ...rows, ...extra].join("\n");
  };
  it("the exact parameter row survives when every row also repeats the model the question names", () => {
    const requested = "| GS10 | P06.53 | Synthetic requested overload row |";
    const context = buildGroundedContext([makeChunk(gs10([requested]), 223)], "What is parameter P06.53 on the GS10?");
    expect(context).toContain(requested);
    expect(context).toContain("# GS10 parameter table");
    expect(context).toContain("| Model | Parameter | Function |");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
    expect(context).not.toContain("matching rows not shown"); // model-only rows are context, never "requested rows"
  });
  it("controls: several requested parameters are all kept; a model-only question keeps model rows; no prefix/substring credit", () => {
    const r1 = "| GS10 | P06.53 | Synthetic requested row one |";
    const r2 = "| GS10 | P06.54 | Synthetic requested row two |";
    const both = buildGroundedContext([makeChunk(gs10([r1, "| GS10 | P06.530 | Prefix collision |", r2]), 223)], "What are P06.53 and P06.54 on the GS10?");
    expect(both).toContain(r1);
    expect(both).toContain(r2);
    const modelOnly = buildGroundedContext([makeChunk(gs10(), 223)], "Which GS10 parameters exist?");
    expect(modelOnly).toContain("| GS10 | P07.00 |");
    const collision = buildGroundedContext([makeChunk(gs10(["| GS10 | P06.530 | Prefix collision |"]), 223)], "What is parameter P06.53 on the GS10?");
    expect(collision).not.toContain("Prefix collision");
  });

  // native-review-2 F4: the requested row does NOT repeat the model word ("All variants"), so it only
  // ties the 95+ model-only rows on identifier count. A ubiquitous term must not outrank a rare one.
  it("a late 'All variants' P06.53 row survives 100 earlier rows that only repeat GS10", () => {
    const requested = "| All variants | P06.53 | Synthetic requested overload row |";
    const context = buildGroundedContext([makeChunk(gs10([requested]), 223)], "What does P06.53 do on the GS10?");
    expect(context).toContain(requested);
    expect(context).toContain("# GS10 parameter table");
    expect(context).toContain("| Model | Parameter | Function |");
    expect(body(context).length).toBeLessThanOrEqual(TABLE_COMPACT_BUDGET);
    expect(context).not.toContain("matching rows not shown");
  });
  it("controls: two requested codes with different frequencies both stay requested; the held marker fires when the target itself cannot fit", () => {
    const a = "| All variants | P06.53 | Synthetic requested row A |";
    const b1 = "| All variants | P06.54 | Synthetic requested row B first |";
    const b2 = "| All variants | P06.54 | Synthetic requested row B second |";
    const both = buildGroundedContext([makeChunk(gs10([a, b1, b2]), 223)], "What do P06.53 and P06.54 do on the GS10?");
    expect(both).toContain(a);
    expect(both).toContain(b1);
    expect(both).toContain(b2);
    const giant = `| All variants | P06.53 | ${"y".repeat(2600)} |`;
    const held = buildGroundedContext([makeChunk(gs10([giant]), 223)], "What does P06.53 do on the GS10?");
    expect(held).toContain("matching rows not shown");
    expect(held).not.toContain("yyyyy");
  });
});

