/**
 * Table rows at upload (garage pilot, plan row 1-A; ledger L3/L4/L5).
 *
 * A specification table stored as flat lines loses its columns: "CT Rated Input Current A 5.1 7.3
 * 10.8 16.5 24.2" lets the answer read 7.3 A for a GS11N-20P2 whose column says 5.1 A (22 of 35
 * wrong on staging, `.planning/2026-11-10-garage-pilot/evidence/table-scope-2026-11-11/`). This
 * module reads the page's text items WITH positions (the same `getTextContent()` items the work
 * packet's caption reader uses) and rebuilds each model-column table as rows
 * "<MODEL>: <row label> <value> <unit>", one chunk per model column, so the model-visible text for
 * a drive holds only that drive's column (the Arm-4 shape that measured 5 of 5).
 *
 * Fixtures are the real pages' items (`__fixtures__/table-rows/*.json`, dumped by
 * `.planning/2026-11-10-garage-pilot/evidence/phase0-2026-11-11/items_dump.mjs` from the pilot's
 * own manuals). The expected tuples below are typed from the printed page, not derived from the
 * extractor: GS10 user manual rev C page 1-12 (PDF p.26) says GS11N-20P2 rated input current is
 * 5.1 A (CT) and 5.8 A (VT); GS11N-20P5 is 7.3 / 8.3 A.
 *
 * Rules (the structure is the manual's own; nothing here keys on what a model number "looks like"
 * beyond "an identifier cell": letters AND digits, ≥5 chars, no spaces):
 *  - Lines: items grouped by y (gap ≤ 2.5 pt), sorted by x.
 *  - Header line: a line whose non-label cells are ≥2 distinct identifier cells. Its cells are the
 *    models; `exactModelKey` = uppercase alphanumerics, a trailing "(…)" group dropped, so the
 *    Micro820's "2080-LC20-20AWB(R)" keys as 2080LC2020AWB.
 *  - Columns: each header cell's column x is the median x of the cells beneath it (GS10 centres
 *    values ~20 pt right of the header; the Micro820 left-aligns them). A cell belongs to a column
 *    when |x − column x| ≤ max(6, 0.15 × column pitch). The label area is left of column 0.
 *  - Block: from the header line to the last line that has a column cell; a gap > 3 × the median
 *    line pitch, or a new header line, ends it. Lines after that (footnotes) are not in the block.
 *  - Value line: ≥1 column cell, no unassigned cell. A line with any unassigned non-label cell (the
 *    Micro820 wire-size sub-table at x=263/324) is UNQUALIFIED: kept as flat text, never a row.
 *  - Row: cells == header count → per-model; exactly one cell → MERGED (printed once for all
 *    models; the Micro820 prints these in column 0, the GS10 centres them); any other count →
 *    unqualified ("Cooling Method Convective Fan").
 *  - Label: the label-area items joined; a leading 1–2 digit token is a footnote mark and is
 *    dropped; a trailing unit token (supporting-quote's closed unit table, also "(kg)" / "(VAC)" /
 *    "(Hz)") becomes `unit`. A label-only line attaches to the adjacent value row above/below
 *    (within 14 pt) when that row's label has < 2 words or the line is itself a unit token
 *    ("Max Motor Output" between the "hp" and "kW" rows; "kW" below its values). A label-only line
 *    that attaches to neither row is kept as unqualified flat text (nothing inside the block is
 *    lost). A pure-number label-only line is a footnote mark and is dropped.
 *  - A page's block qualifies with ≥ 2 rows of which ≥ 1 is per-model; an all-merged "table" (the
 *    shape a sentence with two model-number items plus trailing numbers takes) is not a table.
 *  - Continuation: a value line with no label, or a label starting lowercase, within 14 pt of the
 *    previous row whose label has ≥ 2 words and whose cells are not number-shaped, extends that
 *    row (the Micro820's 11-line "Isolation voltage" cell; "Power supply" + "voltage range").
 *    GS10's "1/4 1/2 1 2 3" under "Frame Size A1 A3 …" is number-shaped → a new row, not a
 *    continuation.
 *  - A row with an empty label after assembly is unqualified.
 *  - Serialised chunk per model: first line `<caption> — <header label> — <MODEL>` (caption = up to
 *    two title lines directly above the header, ≤ 40 pt), then one line per row
 *    `<MODEL>: <label> <value>[ <unit>]`. The chunk never names another header model. One extra
 *    chunk carries the unqualified lines, tagged with ALL the block's models and `unqualified`.
 *  - Model-keyed table (#5450, GS10 p.394): a run of ≥ 3 lines each with exactly one identifier
 *    cell as its leftmost item at one shared x (± 6 pt) beside ≥ 1 number-shaped value, starting
 *    beneath a line with no identifier cell, is ONE unqualified chunk (its tight header band
 *    included, caption = the band's first line) tagged with every model of the run. No row is ever
 *    emitted from it: cells merged down a group of models cannot be bounded from positions.
 *  - Pure and deterministic; zero tokens.
 */
import { describe, expect, it } from "vitest";
import {
  detectModelTables,
  exactModelKey,
  pageWithTables,
  tableChunks,
  type LayoutItem,
  type TableBlock,
  type TableCell,
  type TableRow,
} from "./table-rows";
import gs10p26 from "./__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p27 from "./__fixtures__/table-rows/gs10-p27-230v-3ph.json";
import micro820p15 from "./__fixtures__/table-rows/micro820-in009-p15.json";
import micro820p16 from "./__fixtures__/table-rows/micro820-in009-p16.json";
import relayP1 from "./__fixtures__/table-rows/ca3kn22bd-p1.json";
import gs10p394 from "./__fixtures__/table-rows/gs10-p394-cable-length.json";

const items = (f: { items: LayoutItem[] }): LayoutItem[] => f.items;

function row(block: TableBlock, label: RegExp, unit?: string | null): TableRow {
  const hits = block.rows.filter((r) => label.test(r.label) && (unit === undefined || r.unit === unit));
  expect(hits, `one row matching ${label}${unit === undefined ? "" : ` unit ${unit}`}`).toHaveLength(1);
  return hits[0];
}

function cell(r: TableRow, model: string): string {
  const c = r.cells.find((x) => x.model === model);
  expect(c, `cell for ${model} in "${r.label}"`).toBeDefined();
  return c!.value;
}

describe("exactModelKey", () => {
  it("keeps the whole catalog number, not the family", () => {
    expect(exactModelKey("GS11N-20P2")).toBe("GS11N20P2");
    expect(exactModelKey("gs11n 20p2")).toBe("GS11N20P2");
    expect(exactModelKey("GS13N-20P2")).toBe("GS13N20P2");
  });
  it("drops a trailing parenthesised variant suffix", () => {
    expect(exactModelKey("2080-LC20-20AWB(R)")).toBe("2080LC2020AWB");
    expect(exactModelKey("2080-LC20-20AWB")).toBe("2080LC2020AWB");
  });
});

describe("GS10 230V 1-phase table (PDF p.26, printed 1-12) — the pilot's own drive", () => {
  const blocks = detectModelTables(items(gs10p26));
  const block = blocks[0];
  const M = ["GS11N-20P2", "GS11N-20P5", "GS11N-21P0", "GS11N-22P0", "GS11N-23P0"];

  it("finds exactly one table whose header cells are the five GS11N models", () => {
    expect(blocks).toHaveLength(1);
    expect(block.models).toEqual(M);
    expect(block.modelKeys).toEqual(["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"]);
  });

  it("reads the rated input current rows column by column, with the unit beside each value", () => {
    const ct = row(block, /^CT Rated Input Current$/, "A");
    expect(ct.cells.map((c) => [c.model, c.value])).toEqual([
      ["GS11N-20P2", "5.1"], ["GS11N-20P5", "7.3"], ["GS11N-21P0", "10.8"], ["GS11N-22P0", "16.5"], ["GS11N-23P0", "24.2"],
    ]);
    expect(ct.merged).toBe(false);
    const vt = row(block, /^VT Rated Input Current$/, "A");
    expect(vt.cells.map((c) => c.value)).toEqual(["5.8", "8.3", "11.3", "18.5", "27.5"]);
  });

  it("reads the output current, capacity, frame, motor output and weight rows", () => {
    expect(row(block, /^CT Rated Output Current$/, "A").cells.map((c) => c.value)).toEqual(["1.6", "2.8", "4.8", "7.5", "11"]);
    expect(row(block, /^VT Rated Output Current$/, "A").cells.map((c) => c.value)).toEqual(["1.8", "3.2", "5", "8.5", "12.5"]);
    expect(row(block, /^Frame Size$/, null).cells.map((c) => c.value)).toEqual(["A1", "A3", "B2", "C1", "C1"]);
    expect(row(block, /Max Motor Output/, "hp").cells.map((c) => c.value)).toEqual(["1/4", "1/2", "1", "2", "3"]);
    expect(row(block, /Max Motor Output/, "kW").cells.map((c) => c.value)).toEqual(["0.2", "0.4", "0.75", "1.5", "2.2"]);
    expect(row(block, /^Weight$/, "kg").cells.map((c) => c.value)).toEqual(["0.4", "0.5", "0.8", "1", "1"]);
    expect(row(block, /IE2 Efficiency/, null).cells.map((c) => c.value)).toEqual(["4.7%", "3.1%", "2.7%", "2.5%", "2.4%"]);
    const kva = block.rows.filter((r) => /^Rated Output Capacity$/.test(r.label) && r.unit === "kVA");
    expect(kva.map((r) => r.cells.map((c) => c.value))).toEqual([
      ["0.6", "1.1", "1.8", "2.9", "4.2"], ["0.7", "1.2", "1.9", "3.2", "4.8"],
    ]);
  });

  it("copies a value printed once across the table to every model, marked merged", () => {
    const v = row(block, /^Rated Voltage\/Frequency$/);
    expect(v.merged).toBe(true);
    expect(v.cells.map((c) => c.model)).toEqual(M);
    expect(new Set(v.cells.map((c) => c.value))).toEqual(new Set(["One-phase 200-240 VAC (-15% to +10%), 50/60 Hz"]));
    const range = row(block, /^Operating Voltage Range$/, "VAC");
    expect(range.merged).toBe(true);
    expect(cell(range, "GS11N-20P2")).toBe("170–265");
    const ip = row(block, /^IP Rating$/);
    expect(ip.merged).toBe(true);
    expect(cell(ip, "GS11N-23P0")).toBe("IP20");
    expect(row(block, /Frequency Tolerance/, "Hz").cells.map((c) => c.value)).toEqual(["47–63", "47–63", "47–63", "47–63", "47–63"]);
  });

  it("keeps a row it cannot qualify as flat text, never as a row", () => {
    expect(block.rows.some((r) => /Cooling Method/.test(r.label))).toBe(false);
    expect(block.unqualified.some((l) => /Cooling Method/.test(l) && /Convective/.test(l) && /Fan/.test(l))).toBe(true);
  });

  it("never emits a row with an empty label, and keeps footnote marks out of labels", () => {
    for (const r of block.rows) {
      expect(r.label.trim()).not.toBe("");
      expect(r.label).not.toMatch(/^\d{1,2}\b/);
    }
  });

  it("ends the block before the footnotes, which stay in the page remainder", () => {
    const page = pageWithTables(items(gs10p26));
    expect(page).not.toBeNull();
    expect(page!.remainder).toMatch(/1 - For use with three-phase motors only\./);
    expect(page!.remainder).toMatch(/Chapter 1: Getting Started/);
    expect(page!.remainder).not.toMatch(/Rated Input Current/);
  });

  it("serialises one chunk per model that names only that model and its own values", () => {
    const chunks = tableChunks(block);
    const own = chunks.find((c) => c.models.length === 1 && c.models[0] === "GS11N20P2");
    expect(own).toBeDefined();
    expect(own!.unqualified).toBe(false);
    expect(own!.text).toMatch(/^.*230V Class – 1-Phase Model-Specific Specifications.*GS11N-20P2\n/);
    expect(own!.text).toContain("\nGS11N-20P2: CT Rated Input Current 5.1 A\n");
    expect(own!.text).toContain("\nGS11N-20P2: VT Rated Input Current 5.8 A\n");
    expect(own!.text).toContain("\nGS11N-20P2: Rated Voltage/Frequency One-phase 200-240 VAC (-15% to +10%), 50/60 Hz\n");
    expect(own!.text).toContain("GS11N-20P2: Max Motor Output 1/4 hp");
    expect(own!.text).toContain("GS11N-20P2: Weight 0.4 kg");
    expect(own!.text).not.toContain("7.3");
    expect(own!.text).not.toContain("GS11N-20P5");
    expect(own!.text).not.toContain("GS11N-23P0");
    expect(own!.text).not.toContain("Convective");
    // The five model chunks plus one unqualified chunk tagged with every model of the block.
    expect(chunks.filter((c) => !c.unqualified).map((c) => c.models[0])).toEqual(block.modelKeys);
    const flat = chunks.filter((c) => c.unqualified);
    expect(flat).toHaveLength(1);
    expect(flat[0].models).toEqual(block.modelKeys);
    expect(flat[0].text).toMatch(/Cooling Method/);
  });

  it("is deterministic", () => {
    expect(detectModelTables(items(gs10p26))).toEqual(blocks);
    expect(pageWithTables(items(gs10p26))).toEqual(pageWithTables(items(gs10p26)));
  });
});

describe("GS10 230V 3-phase table (PDF p.27) — the look-alike sibling", () => {
  const blocks = detectModelTables(items(gs10p27));
  it("is its own table of GS13N models; no chunk is tagged with a GS11N number", () => {
    expect(blocks).toHaveLength(1);
    expect(blocks[0].models).toEqual(["GS13N-20P2", "GS13N-20P5", "GS13N-21P0", "GS13N-22P0"]);
    for (const c of tableChunks(blocks[0])) {
      expect(c.models.every((m) => m.startsWith("GS13N"))).toBe(true);
      expect(c.text).not.toMatch(/GS11N/);
    }
  });
  it("reads the GS13N-20P2 rated input current as 1.9 A (CT) and 2.2 A (VT), with the label carried across lines", () => {
    const b = blocks[0];
    const ct = b.rows.filter((r) => /Rated Input Current/.test(r.label) && /CT/.test(r.label) && r.unit === "A");
    expect(ct).toHaveLength(1);
    expect(cell(ct[0], "GS13N-20P2")).toBe("1.9");
    expect(cell(ct[0], "GS13N-22P0")).toBe("9.0");
    const vt = b.rows.filter((r) => /Rated Input Current/.test(r.label) && /VT/.test(r.label) && r.unit === "A");
    expect(vt).toHaveLength(1);
    expect(cell(vt[0], "GS13N-20P2")).toBe("2.2");
    expect(cell(row(b, /^Rated Voltage\/Frequency$/), "GS13N-20P2")).toBe("3-phase 200-240 VAC (-15% to +10%), 50/60 Hz");
  });
});

describe("Micro820 install sheet (2080-IN009, p.15–16) — attribute × catalog grid, do-not-regress", () => {
  const p15 = detectModelTables(items(micro820p15));
  const p16 = detectModelTables(items(micro820p16));
  const K = ["2080LC2020AWB", "2080LC2020QBB", "2080LC2020QWB"];

  it("finds the General Specifications grid on both pages with the (R) suffix dropped from the keys", () => {
    expect(p15).toHaveLength(1);
    expect(p16).toHaveLength(1);
    expect(p15[0].models).toEqual(["2080-LC20-20AWB(R)", "2080-LC20-20QBB(R)", "2080-LC20-20QWB(R)"]);
    expect(p15[0].modelKeys).toEqual(K);
    expect(p16[0].modelKeys).toEqual(K);
  });

  it("copies a cell printed once in the first column to all three controllers", () => {
    const io = row(p15[0], /^Number of I\/O$/);
    expect(io.merged).toBe(true);
    expect(io.cells.map((c) => c.value)).toEqual(["12 inputs, 8 outputs", "12 inputs, 8 outputs", "12 inputs, 8 outputs"]);
    const psu = p16[0].rows.filter((r) => /^Power supply/.test(r.label));
    expect(psu).toHaveLength(1);
    expect(psu[0].merged).toBe(true);
    expect(psu[0].label).toMatch(/Power supply voltage range/);
    expect(cell(psu[0], "2080-LC20-20QBB(R)")).toMatch(/^20\.4…26\.4 V DC, Class 2, or Limited Voltage Limited Current Source \(LVLC\)$/);
    expect(cell(row(p16[0], /^Power input$/), "2080-LC20-20AWB(R)")).toBe("24V DC");
  });

  it("keeps per-controller cells apart and whole across many lines", () => {
    const io = row(p16[0], /^I\/O rating$/);
    expect(io.merged).toBe(false);
    expect(cell(io, "2080-LC20-20AWB(R)")).toMatch(/^Input: 120V AC 16 mA/);
    expect(cell(io, "2080-LC20-20QBB(R)")).toMatch(/Input: 24V DC, 8\.8 mA/);
    expect(cell(io, "2080-LC20-20QBB(R)")).toMatch(/0\.3 A per point/);
    expect(cell(io, "2080-LC20-20AWB(R)")).not.toMatch(/0\.3 A per point/);
    const iso = row(p16[0], /^Isolation voltage$/);
    expect(cell(iso, "2080-LC20-20AWB(R)")).toMatch(/3250 V DC/);
    expect(cell(iso, "2080-LC20-20AWB(R)")).toMatch(/1950 V DC Input to Aux and Network\./);
    expect(cell(iso, "2080-LC20-20QBB(R)")).toMatch(/720 V DC/);
    expect(cell(iso, "2080-LC20-20QBB(R)")).not.toMatch(/3250/);
    expect(cell(row(p16[0], /^Pilot duty rating$/), "2080-LC20-20QBB(R)")).toBe("–");
    const out = row(p16[0], /^Output circuit type$/);
    expect(cell(out, "2080-LC20-20QBB(R)")).toBe("24V DC source (standard and high-speed)");
    expect(cell(out, "2080-LC20-20QWB(R)")).toBe("Relay");
  });

  it("leaves the wire-size sub-table (its own Min/Max columns) unqualified rather than mis-assigning it", () => {
    const b = p15[0];
    expect(b.rows.some((r) => r.cells.some((c) => /0\.14 mm|26 AWG|rated @ 90/.test(c.value)))).toBe(false);
    expect(b.unqualified.join("\n")).toMatch(/0\.14 mm/);
    expect(b.unqualified.join("\n")).toMatch(/rated @ 90 °C/);
  });

  it("F1: keeps the AWB I/O-rating cell whole, out of the QBB cell, even though a fragment's x (261.78/266.46) lands nearer the QBB anchor than the AWB/QBB midpoint (~260.3)", () => {
    const io = row(p16[0], /^I\/O rating$/);
    // Typed from the fixture items at y=466.68/458.64/450.66 (AWB column, x≈216–266), not derived
    // from the parser output.
    expect(cell(io, "2080-LC20-20AWB(R)")).toBe("Input: 120V AC 16 mA Output: 2 A, 240 V AC 2A, 24V DC");
    const qbb = cell(io, "2080-LC20-20QBB(R)");
    expect(qbb).not.toContain("240");
    expect(qbb).not.toContain("V AC");
    expect(qbb).not.toContain("2A, 24V DC");
  });
});

describe("table-rows run-grouping (Codex #5429 r1 F1)", () => {
  it("keeps a cell fragmented across the midpoint between column anchors together in column 1", () => {
    const page: LayoutItem[] = [
      // Header: three identifier-shaped model cells, columns at x=200/300/400.
      { str: "GS11N-20P2", x: 200, y: 700, w: 60, size: 9 },
      { str: "GS11N-20P5", x: 300, y: 700, w: 60, size: 9 },
      { str: "GS11N-21P0", x: 400, y: 700, w: 60, size: 9 },
      // Label + fragmented column-1 cell (gap from "Output:" end (249) to "2A" start (251) is 2pt,
      // tiny — same cell; "2A" at x=251 is nevertheless closer to the column-2 anchor (300, dist 49)
      // than to column 1's anchor (200, dist 51) by raw per-item distance — the exact shape of
      // #5429 r1 F1. "Vac"/"X" sit exactly on their header x's so the computed column positions
      // don't drift off the seed values, keeping the arithmetic above exact.
      { str: "Spec", x: 72, y: 688, w: 30, size: 9 },
      { str: "Output:", x: 210, y: 688, w: 39, size: 9 },
      { str: "2A", x: 251, y: 688, w: 10, size: 9 },
      { str: "Vac", x: 300, y: 688, w: 15, size: 9 },
      { str: "X", x: 400, y: 688, w: 10, size: 9 },
    ];
    const blocks = detectModelTables(page);
    expect(blocks).toHaveLength(1);
    const r = row(blocks[0], /^Spec$/);
    expect(cell(r, "GS11N-20P2")).toBe("Output: 2A");
    expect(cell(r, "GS11N-20P5")).toBe("Vac");
    expect(cell(r, "GS11N-21P0")).toBe("X");
  });

  it("emits a line as unqualified, not a row, when two runs fall in the same column", () => {
    const page: LayoutItem[] = [
      { str: "GS11N-20P2", x: 200, y: 700, w: 60, size: 9 },
      { str: "GS11N-20P5", x: 300, y: 700, w: 60, size: 9 },
      { str: "GS11N-21P0", x: 400, y: 700, w: 60, size: 9 },
      // Three runs, far enough apart to stay separate (gaps > tol), but B (x=295) and C (x=330)
      // both resolve to the middle column by nearest-anchor distance — not n distinct columns.
      { str: "Weird Row", x: 72, y: 688, w: 50, size: 9 },
      { str: "A", x: 205, y: 688, w: 10, size: 9 },
      { str: "B", x: 295, y: 688, w: 10, size: 9 },
      { str: "C", x: 330, y: 688, w: 10, size: 9 },
    ];
    const blocks = detectModelTables(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].rows.some((r) => /Weird Row/.test(r.label))).toBe(false);
    expect(blocks[0].unqualified.some((l) => /Weird Row/.test(l) && /\bA\b/.test(l) && /\bB\b/.test(l) && /\bC\b/.test(l))).toBe(true);
  });
});

describe("tableChunks splits a long model's table at row boundaries (Codex #5429 r1 F4)", () => {
  // manual-rag.ts's buildGroundedContext truncates a chunk's content at MAX_CONTENT_CHARS=1200;
  // table-rows.ts stored one chunk per model holding EVERY row, so a long table's trailing rows
  // were silently dropped from what the model sees. The fix splits at TABLE_CHUNK_MAX_CHARS=1000,
  // never mid-row, with each continuation chunk re-starting with the prefix line plus " (cont.)".

  it("byte-identical for an existing short fixture (gs10p27 GS13N-20P2, 921 chars, under the 1000 limit)", () => {
    const blocks = detectModelTables(items(gs10p27));
    const chunks = tableChunks(blocks[0]);
    const own = chunks.find((c) => c.models.length === 1 && c.models[0] === "GS13N20P2")!;
    expect(own.text).toBe(
      "230V Class – 3-Phase Model-Specific Specifications / GS10 230V Class Specifications; Frame Size A, B — Model Name: GS13N-2xPx — GS13N-20P2\n" +
        "GS13N-20P2: Frame Size A1\n" +
        "GS13N-20P2: hp 1/4\n" +
        "GS13N-20P2: Max Motor Output hp [0.1]\n" +
        "GS13N-20P2: (3-phase [1-phase]) kW 0.2\n" +
        "GS13N-20P2: kW [0.1]\n" +
        "GS13N-20P2: Rated Output Capacity 0.6 kVA\n" +
        "GS13N-20P2: Rated Output Current 1.6\n" +
        "GS13N-20P2: (3-phase [1-phase]) [0.8]\n" +
        "GS13N-20P2: Carrier Frequency 2–15 kHz\n" +
        "GS13N-20P2: Rated Output Capacity 0.7 kVA\n" +
        "GS13N-20P2: VT Rated Output Current 1.8 A\n" +
        "GS13N-20P2: Carrier Frequency 2–15 kHz\n" +
        "GS13N-20P2: CT Rated Input Current 1.9 A\n" +
        "GS13N-20P2: VT Rated Input Current 2.2 A\n" +
        "GS13N-20P2: Rated Voltage/Frequency 3-phase 200-240 VAC (-15% to +10%), 50/60 Hz\n" +
        "GS13N-20P2: Operating Voltage Range 170–265 VAC\n" +
        "GS13N-20P2: Frequency Tolerance 47–63 Hz\n" +
        "GS13N-20P2: IE2 Efficiency - Relative Power Loss 4.7%\n" +
        "GS13N-20P2: Weight 0.4 kg\n" +
        "GS13N-20P2: IP Rating IP20\n",
    );
    expect(chunks.filter((c) => c.models.length === 1 && c.models[0] === "GS13N20P2")).toHaveLength(1);
  });

  function syntheticBlock(rowCount: number, cellValue: (i: number) => string): TableBlock {
    const model = "LONGMODEL1";
    const rows: TableRow[] = Array.from({ length: rowCount }, (_, i) => ({
      label: `Row${i}`,
      unit: null,
      cells: [{ model, value: cellValue(i) } as TableCell],
      merged: false,
    }));
    return { caption: "", header: "Spec", models: [model], modelKeys: [model], rows, unqualified: [], top: 0, bottom: 0 };
  }

  it("splits a long model table into multiple chunks, none over 1000 chars, every chunk prefixed and no row lost", () => {
    const block = syntheticBlock(15, () => "V".repeat(80));
    const chunks = tableChunks(block).filter((c) => !c.unqualified);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1000);
    // Every chunk is tagged with the one model, and begins with the prefix line — "(cont.)" on
    // every chunk after the first, never on the first.
    chunks.forEach((c, i) => {
      expect(c.models).toEqual(["LONGMODEL1"]);
      const firstLine = c.text.split("\n")[0];
      if (i === 0) expect(firstLine).toBe("Spec — LONGMODEL1");
      else expect(firstLine).toBe("Spec — LONGMODEL1 (cont.)");
    });
    // Every row survives exactly once, in order, across the chunks — never split mid-row.
    const allRowLines = chunks.flatMap((c) => c.text.trim().split("\n").slice(1));
    expect(allRowLines).toEqual(Array.from({ length: 15 }, (_, i) => `LONGMODEL1: Row${i} ${"V".repeat(80)}`));
  });

  it("a single row longer than the limit stays whole in its own chunk, never split mid-row", () => {
    const block = syntheticBlock(2, (i) => (i === 0 ? "X".repeat(1200) : "short"));
    const chunks = tableChunks(block).filter((c) => !c.unqualified);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe(`Spec — LONGMODEL1\nLONGMODEL1: Row0 ${"X".repeat(1200)}\n`);
    expect(chunks[1].text).toBe("Spec — LONGMODEL1 (cont.)\nLONGMODEL1: Row1 short\n");
  });

  it("control: a short model table (well under the limit) is still exactly one chunk", () => {
    const block = syntheticBlock(2, () => "ok");
    const chunks = tableChunks(block).filter((c) => !c.unqualified);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("Spec — LONGMODEL1\nLONGMODEL1: Row0 ok\nLONGMODEL1: Row1 ok\n");
  });

  it("the unqualified chunk gets the same bounded, row-boundary split", () => {
    const model = "LONGMODEL1";
    const block: TableBlock = {
      caption: "",
      header: "Spec",
      models: [model],
      modelKeys: [model],
      rows: [],
      unqualified: Array.from({ length: 15 }, (_, i) => `Note${i} ${"Y".repeat(80)}`),
      top: 0,
      bottom: 0,
    };
    const chunks = tableChunks(block).filter((c) => c.unqualified);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1000);
      expect(c.models).toEqual([model]);
    }
    chunks.forEach((c, i) => {
      const firstLine = c.text.split("\n")[0];
      if (i === 0) expect(firstLine).toBe("Spec — unqualified");
      else expect(firstLine).toBe("Spec — unqualified (cont.)");
    });
    const allLines = chunks.flatMap((c) => c.text.trim().split("\n").slice(1));
    expect(allLines).toEqual(Array.from({ length: 15 }, (_, i) => `Note${i} ${"Y".repeat(80)}`));
  });
});

describe("Schneider CA3KN22BD data sheet (p.1) — label/value pairs are not a model table", () => {
  it("detects no table and leaves the page alone", () => {
    expect(detectModelTables(items(relayP1))).toEqual([]);
    expect(pageWithTables(items(relayP1))).toBeNull();
  });
});

describe("nothing inside a table block is lost (cheap review of PR-1, #5430 r1)", () => {
  // Two per-model rows with a standalone label-only line between them that attaches to neither:
  // the row above has a 2+ word label and the line is not a unit token, so no backward attach; the
  // row below also has a 2+ word label, so no forward attach. Before the fix the line fell out of
  // both the row chunks and the page remainder (the remainder drops every line inside the block).
  const page: LayoutItem[] = [
    { str: "Rated Input Current", x: 72, y: 700, w: 90, size: 9 },
    { str: "GS11N-20P2", x: 200, y: 700, w: 50, size: 9 },
    { str: "GS11N-20P5", x: 300, y: 700, w: 50, size: 9 },
    { str: "CT Rated Input Current A", x: 72, y: 688, w: 110, size: 9 },
    { str: "5.1", x: 220, y: 688, w: 14, size: 9 },
    { str: "7.3", x: 320, y: 688, w: 14, size: 9 },
    { str: "Values Shown Are Typical", x: 72, y: 676, w: 100, size: 9 },
    { str: "VT Rated Input Current A", x: 72, y: 664, w: 110, size: 9 },
    { str: "5.8", x: 220, y: 664, w: 14, size: 9 },
    { str: "8.3", x: 320, y: 664, w: 14, size: 9 },
    { str: "1. Footnote stays in the remainder.", x: 72, y: 630, w: 150, size: 8 },
  ];

  it("keeps a label-only line that attaches to no row as unqualified flat text", () => {
    const result = pageWithTables(page);
    expect(result).not.toBeNull();
    const allChunkText = result!.chunks.map((c) => c.text).join("\n");
    expect(allChunkText).toContain("Values Shown Are Typical");
    const unq = result!.chunks.filter((c) => c.unqualified);
    expect(unq).toHaveLength(1);
    expect(unq[0].text).toContain("Values Shown Are Typical");
    // ...and it did not leak into either row's label.
    for (const c of result!.chunks.filter((x) => !x.unqualified)) expect(c.text).not.toContain("Values Shown Are Typical");
    expect(result!.remainder).toContain("Footnote stays in the remainder");
    expect(result!.remainder).not.toContain("Values Shown Are Typical");
  });

  it("every text item of the page reaches a row chunk, the unqualified chunk, or the remainder", () => {
    const result = pageWithTables(page)!;
    const everything = `${result.chunks.map((c) => c.text).join("\n")}\n${result.remainder}`;
    // Labels lose their trailing unit token to `unit` (re-emitted beside each value), so check the
    // label text without it.
    for (const s of [
      "Rated Input Current",
      "GS11N-20P2",
      "GS11N-20P5",
      "CT Rated Input Current",
      "5.1 A",
      "7.3 A",
      "Values Shown Are Typical",
      "VT Rated Input Current",
      "5.8 A",
      "8.3 A",
      "1. Footnote stays in the remainder.",
    ])
      expect(everything, s).toContain(s);
  });
});

describe("prose", () => {
  it("is not a table when two identifier items share a line but no row has per-model cells", () => {
    // pdf.js often splits a sentence into several items; two model numbers as their own items make
    // an identifier-cell pair. The lines below each carry one trailing number under the first
    // identifier, which the parser reads as a single MERGED cell — a "table" with no column
    // information at all. A model-column table has at least one row whose cells differ per column.
    const prose: LayoutItem[] = [
      { str: "Both the", x: 72, y: 700, w: 40, size: 10 },
      { str: "GS11N-20P2", x: 120, y: 700, w: 50, size: 10 },
      { str: "and the", x: 175, y: 700, w: 35, size: 10 },
      { str: "GS13N-20P2", x: 215, y: 700, w: 50, size: 10 },
      { str: "need a line reactor when the supply exceeds", x: 72, y: 688, w: 200, size: 10 },
      { str: "500", x: 120, y: 676, w: 20, size: 10 },
      { str: "kVA; see the wiring chapter, page", x: 72, y: 664, w: 150, size: 10 },
      { str: "18", x: 120, y: 652, w: 10, size: 10 },
    ];
    expect(pageWithTables(prose)).toBeNull();
  });

  it("detects nothing on a page of sentences", () => {
    const prose: LayoutItem[] = [
      { str: "Disconnect power before servicing the GS11N-20P2 or GS13N-20P2 drive.", x: 72, y: 700, w: 300, size: 10 },
      { str: "Wait 5 minutes for the capacitors to discharge.", x: 72, y: 688, w: 220, size: 10 },
      { str: "See page 1-12 for the specifications of each model.", x: 72, y: 676, w: 240, size: 10 },
    ];
    expect(detectModelTables(prose)).toEqual([]);
    expect(pageWithTables(prose)).toBeNull();
  });
});

/**
 * #5450 — the GS10 manual's Appendix A cable-length table (PDF p.394) is a MODEL-KEYED table:
 * one model per line in a left column (`GS11N-10P2` … `GS13N-4010`, 22 of them), attributes as
 * columns ("VT Rated Current (Arms)", cable lengths), with the Ø / Volts cells merged across
 * groups of rows. No header line carries ≥ 2 model cells, so `detectModelTables` never fires and
 * the page stored FLAT — `GS11N-20P2 230 1.8` beside "VT Rated Current (Arms)" with no row
 * qualification — and on staging build 5e79ca713 that flat text answered "rated input current"
 * with the 1.8 A OUTPUT current (harness L3 wording 2, ask 7 of 10).
 *
 * Contract (fail closed, no invented cells): a run of ≥ 3 lines, each carrying exactly one
 * identifier cell at one shared x with only number-shaped values beside it (interior lines of
 * bare numbers — the merged Ø marks — allowed), together with its header band directly above,
 * is ONE unqualified chunk tagged with every model of the run. The vertically merged cells cannot
 * be bounded from text positions alone, so no value is attributed to any model; the existing
 * exclusion (manual-rag.ts `isUnresolvedTableLine`) then withholds the chunk from a record that
 * holds a catalog number and reports the page as unresolved instead of letting a flat line answer.
 */
describe("a model-keyed (one model per line) table is stored as one unqualified chunk, never flat (#5450)", () => {
  const p394Models = [
    "GS11N-10P2", "GS11N-10P5", "GS11N-11P0", "GS11N-20P2", "GS11N-20P5", "GS11N-21P0", "GS11N-22P0", "GS11N-23P0",
    "GS13N-20P2", "GS13N-20P5", "GS13N-21P0", "GS13N-22P0", "GS13N-23P0", "GS13N-25P0", "GS13N-27P5",
    "GS13N-40P5", "GS13N-41P0", "GS13N-42P0", "GS13N-43P0", "GS13N-45P0", "GS13N-47P5", "GS13N-4010",
  ];

  it("recognises the p.394 cable-length table and stores every line of it as unqualified text tagged with all 22 models", () => {
    const page = pageWithTables(items(gs10p394));
    expect(page).not.toBeNull();
    expect(page!.chunks.length).toBeGreaterThan(0);
    for (const c of page!.chunks) {
      expect(c.unqualified).toBe(true);
      expect([...c.models].sort()).toEqual(p394Models.map(exactModelKey).sort());
    }
    const text = page!.chunks.map((c) => c.text).join("");
    expect(text).toMatch(/Maximum Recommended Cable Length - GS10/);
    expect(text).toMatch(/VT Rated/);
    expect(text).toMatch(/GS11N-20P2/);
    expect(text).toMatch(/\b1\.8\b/);
    expect(text).toMatch(/GS13N-4010/);
  });

  it("never emits a per-model row from it — no value is attributed to a model whose cell may be merged", () => {
    const page = pageWithTables(items(gs10p394))!;
    expect(page.chunks.every((c) => c.unqualified)).toBe(true);
    expect(page.chunks.some((c) => c.models.length === 1)).toBe(false);
    expect(detectModelTables(items(gs10p394))).toEqual([]);
  });

  it("keeps the page's other text (section title, footer) in the remainder and drops every table line from it", () => {
    const page = pageWithTables(items(gs10p394))!;
    expect(page.remainder).toMatch(/Appendix A: Accessories/);
    expect(page.remainder).toMatch(/Page A–15/);
    expect(page.remainder).not.toMatch(/GS11N-20P2/);
    expect(page.remainder).not.toMatch(/Maximum Recommended Cable Length/);
  });

  it("does not fire on the header-row tables or the relay sheet (do-not-regress controls: same output as before)", () => {
    // Before this detector: relay → null; Micro820 p.15 → null at the page level (its block is
    // all-merged rows under `pageWithTables`'s filter; the grid tests above read it through
    // `detectModelTables`); p.26 / p.27 / Micro820 p.16 → per-model chunks. All unchanged.
    expect(pageWithTables(items(relayP1))).toBeNull();
    expect(pageWithTables(items(micro820p15))).toBeNull();
    for (const f of [gs10p26, gs10p27, micro820p16]) {
      const page = pageWithTables(items(f))!;
      expect(page.chunks.some((c) => !c.unqualified)).toBe(true);
      expect(page.chunks.every((c) => c.models.length === 1 || c.unqualified)).toBe(true);
    }
  });

  it("does not fire on an identifier column that continues out of an unreadable table (GS10 p.227: P06.17–P06.22 with fault-code cells, then P06.63–P06.70 with numeric cells)", () => {
    // A key column starts beneath its header band. On p.227 the numeric P06.63… lines sit directly
    // under identifier lines whose cells are fault codes (not number-shaped), i.e. they are the
    // tail of one worked-example table the reader cannot qualify — leave the page flat rather than
    // tag parameter numbers as "models" and withhold the example from every drive record.
    const line = (y: number, cells: string[]): LayoutItem[] => cells.map((str, i) => ({ str, x: 134 + i * 56, y, w: 20, size: 8 }));
    const page = [
      ...line(324, ["Parameter", "1st fault", "2nd fault", "3rd fault"]),
      ...line(310, ["P06.17", "ocA", "ocd", "ocn"]),
      ...line(296, ["P06.18", "0", "ocA", "ocd"]),
      ...line(281, ["P06.19", "0", "0", "ocA"]),
      ...line(225, ["P06.63", "1000", "560", "120"]),
      ...line(210, ["P06.64", "0", "1", "2"]),
      ...line(196, ["P06.65", "0", "1000", "560"]),
      ...line(182, ["P06.66", "0", "0", "1"]),
    ];
    expect(pageWithTables(page)).toBeNull();
    // Codex r1 on #5451 (F1, MEDIUM): the same numeric run under a header band with no identifier
    // cell is a PARAMETER table (P06.63 … are parameter codes, not models). It must not become a
    // model-keyed table: tagged "P0663…" and stored unqualified, a confirmed drive record would have
    // it withheld and lose the parameter values. A key column is a model column only when the
    // model-number reader (manual-applicability.ts) reads its cells as model numbers.
    const keyed = [...line(324, ["Parameter", "1st fault", "2nd fault", "3rd fault"]), ...page.filter((it) => it.y <= 225)];
    expect(pageWithTables(keyed)).toBeNull();
  });
});
