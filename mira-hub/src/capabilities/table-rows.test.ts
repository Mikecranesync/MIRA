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
    const ct = row(block, /^Input Rating \/ CT \/ Rated Input Current$/, "A");
    expect(ct.cells.map((c) => [c.model, c.value])).toEqual([
      ["GS11N-20P2", "5.1"], ["GS11N-20P5", "7.3"], ["GS11N-21P0", "10.8"], ["GS11N-22P0", "16.5"], ["GS11N-23P0", "24.2"],
    ]);
    expect(ct.merged).toBe(false);
    const vt = row(block, /^Input Rating \/ VT \/ Rated Input Current$/, "A");
    expect(vt.cells.map((c) => c.value)).toEqual(["5.8", "8.3", "11.3", "18.5", "27.5"]);
  });

  it("reads the output current, capacity, frame, motor output and weight rows", () => {
    expect(row(block, /^Output Rating \/ CT \/ Rated Output Current$/, "A").cells.map((c) => c.value)).toEqual(["1.6", "2.8", "4.8", "7.5", "11"]);
    expect(row(block, /^Output Rating \/ VT \/ Rated Output Current$/, "A").cells.map((c) => c.value)).toEqual(["1.8", "3.2", "5", "8.5", "12.5"]);
    expect(row(block, /^Frame Size$/, null).cells.map((c) => c.value)).toEqual(["A1", "A3", "B2", "C1", "C1"]);
    expect(row(block, /Max Motor Output/, "hp").cells.map((c) => c.value)).toEqual(["1/4", "1/2", "1", "2", "3"]);
    expect(row(block, /Max Motor Output/, "kW").cells.map((c) => c.value)).toEqual(["0.2", "0.4", "0.75", "1.5", "2.2"]);
    expect(row(block, /^Weight$/, "kg").cells.map((c) => c.value)).toEqual(["0.4", "0.5", "0.8", "1", "1"]);
    expect(row(block, /IE2 Efficiency/, null).cells.map((c) => c.value)).toEqual(["4.7%", "3.1%", "2.7%", "2.5%", "2.4%"]);
    const kva = block.rows.filter((r) => /^Output Rating \/ (CT|VT) \/ Rated Output Capacity$/.test(r.label) && r.unit === "kVA");
    expect(kva.map((r) => r.cells.map((c) => c.value))).toEqual([
      ["0.6", "1.1", "1.8", "2.9", "4.2"], ["0.7", "1.2", "1.9", "3.2", "4.8"],
    ]);
  });

  it("copies a value printed once across the table to every model, marked merged", () => {
    const v = row(block, /^Input Rating \/ Rated Voltage\/Frequency$/);
    expect(v.merged).toBe(true);
    expect(v.cells.map((c) => c.model)).toEqual(M);
    expect(new Set(v.cells.map((c) => c.value))).toEqual(new Set(["One-phase 200-240 VAC (-15% to +10%), 50/60 Hz"]));
    const range = row(block, /^Input Rating \/ Operating Voltage Range$/, "VAC");
    expect(range.merged).toBe(true);
    expect(cell(range, "GS11N-20P2")).toBe("170–265");
    const ip = row(block, /^IP Rating$/);
    expect(ip.merged).toBe(true);
    expect(cell(ip, "GS11N-23P0")).toBe("IP20");
    expect(row(block, /Frequency Tolerance/, "Hz").cells.map((c) => c.value)).toEqual(["47–63", "47–63", "47–63", "47–63", "47–63"]);
  });

  it("reads cells printed across several models only when they tile the model columns exactly", () => {
    // "Convective" is centred on the first four model headers and "Fan" on the fifth.
    expect(row(block, /^Cooling Method$/, null).cells.map((c) => [c.model, c.value])).toEqual([
      ["GS11N-20P2", "Convective"], ["GS11N-20P5", "Convective"], ["GS11N-21P0", "Convective"], ["GS11N-22P0", "Convective"], ["GS11N-23P0", "Fan"],
    ]);
    expect(block.unqualified.some((l) => /Cooling Method/.test(l))).toBe(false);
  });

  it("keeps spanning cells that do not tile the columns as flat text, never as a row", () => {
    // Control: move "Fan" a third of a column left, off the fifth header's centre.
    const shifted = items(gs10p26).map((i) => (i.str === "Fan" && Math.abs(i.y - 485.82) < 0.5 ? { ...i, x: i.x - 18 } : i));
    const b = detectModelTables(shifted)[0];
    expect(b.rows.some((r) => /Cooling Method/.test(r.label))).toBe(false);
    expect(b.unqualified.some((l) => /Cooling Method/.test(l) && /Convective/.test(l) && /Fan/.test(l))).toBe(true);
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
    const parts = chunks.filter((c) => c.models.length === 1 && c.models[0] === "GS11N20P2");
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((c) => !c.unqualified)).toBe(true);
    const own = { text: parts.map((c) => c.text).join("") };
    expect(own!.text).toMatch(/^.*230V Class – 1-Phase Model-Specific Specifications.*GS11N-20P2\n/);
    expect(own!.text).toContain("\nGS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A\n");
    expect(own!.text).toContain("\nGS11N-20P2: Input Rating / VT / Rated Input Current 5.8 A\n");
    expect(own!.text).toContain("\nGS11N-20P2: Input Rating / Rated Voltage/Frequency One-phase 200-240 VAC (-15% to +10%), 50/60 Hz\n");
    expect(own!.text).toContain("GS11N-20P2: Output Rating / Max Motor Output 1/4 hp");
    expect(own!.text).toContain("GS11N-20P2: Weight 0.4 kg");
    expect(own!.text).not.toContain("7.3");
    expect(own!.text).not.toContain("GS11N-20P5");
    expect(own!.text).not.toContain("GS11N-23P0");
    expect(own!.text).toContain("GS11N-20P2: Cooling Method Convective");
    expect(own!.text).not.toContain("Fan");
    expect(chunks.filter((c) => c.models.length === 1 && c.models[0] === "GS11N23P0").map((c) => c.text).join("")).toContain("GS11N-23P0: Cooling Method Fan");
    // The five model chunks; anything left unqualified is tagged with every model of the block.
    expect([...new Set(chunks.filter((c) => !c.unqualified).map((c) => c.models[0]))]).toEqual(block.modelKeys);
    for (const flat of chunks.filter((c) => c.unqualified)) expect(flat.models).toEqual(block.modelKeys);
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
    expect(cell(row(b, /^Input Rating \/ Rated Voltage\/Frequency$/), "GS13N-20P2")).toBe("3-phase 200-240 VAC (-15% to +10%), 50/60 Hz");
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

  it("pins the exact gs10p27 GS13N-20P2 output: two chunks split at a row boundary, every line kept", () => {
    // Was a 921-char single chunk; the duty and group labels lengthen it past the 1000 limit.
    const blocks = detectModelTables(items(gs10p27));
    const own = tableChunks(blocks[0]).filter((c) => c.models.length === 1 && c.models[0] === "GS13N20P2");
    expect(own.map((c) => c.text)).toEqual([
      "230V Class – 3-Phase Model-Specific Specifications / GS10 230V Class Specifications; Frame Size A, B — Model Name: GS13N-2xPx — GS13N-20P2\n" +
      "GS13N-20P2: Frame Size A1\n" +
      "GS13N-20P2: hp 1/4\n" +
      "GS13N-20P2: Output Rating / Max Motor Output hp [0.1]\n" +
      "GS13N-20P2: Output Rating / (3-phase [1-phase]) kW 0.2\n" +
      "GS13N-20P2: Output Rating / kW [0.1]\n" +
      "GS13N-20P2: Output Rating / CT / Rated Output Capacity 0.6 kVA\n" +
      "GS13N-20P2: Output Rating / CT / Rated Output Current A 1.6\n" +
      "GS13N-20P2: Output Rating / CT / (3-phase [1-phase]) A [0.8]\n" +
      "GS13N-20P2: Output Rating / CT / Carrier Frequency 2–15 kHz\n" +
      "GS13N-20P2: Output Rating / VT / Rated Output Capacity 0.7 kVA\n" +
      "GS13N-20P2: Output Rating / VT / Rated Output Current 1.8 A\n" +
      "GS13N-20P2: Output Rating / VT / Carrier Frequency 2–15 kHz\n" +
      "GS13N-20P2: Input Rating / CT / Rated Input Current 1.9 A\n" +
      "GS13N-20P2: Input Rating / VT / Rated Input Current 2.2 A\n" +
      "GS13N-20P2: Input Rating / Rated Voltage/Frequency 3-phase 200-240 VAC (-15% to +10%), 50/60 Hz\n",
      "230V Class – 3-Phase Model-Specific Specifications / GS10 230V Class Specifications; Frame Size A, B — Model Name: GS13N-2xPx — GS13N-20P2 (cont.)\n" +
      "GS13N-20P2: Input Rating / Operating Voltage Range 170–265 VAC\n" +
      "GS13N-20P2: Input Rating / Frequency Tolerance 47–63 Hz\n" +
      "GS13N-20P2: IE2 Efficiency - Relative Power Loss 4.7%\n" +
      "GS13N-20P2: Weight 0.4 kg\n" +
      "GS13N-20P2: Cooling Method Convective\n" +
      "GS13N-20P2: IP Rating IP20\n",
    ]);
    for (const c of own) expect(c.text.length).toBeLessThanOrEqual(1000);
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

describe("duty stubs: placement is bounded, and stub text is never dropped (#5598 Codex F1, F2)", () => {
  const item = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 4, size: 8 });
  const header = (y: number) => [item("GS11N-20P2", 250, y), item("GS11N-20P5", 350, y)];
  /** `segments` rated-value segments of three rows each, a CT/VT stub inline on each middle row. */
  const stubbed = (segments: number) => {
    const items = header(760);
    for (let s = 0; s < segments; s++) for (let r = 0; r < 3; r++) {
      const y = 740 - 12 * (3 * s + r);
      if (r === 1) items.push(item(s % 2 === 0 ? "CT" : "VT", 50, y));
      items.push(item("Rated Value", 100, y), item(String(3 * s + r), 250, y), item(String(3 * s + r + 1), 350, y));
    }
    return items;
  };
  const allText = (items: ReturnType<typeof stubbed>) => {
    // No qualifying table: the writer stores the page text as read.
    const page = pageWithTables(items);
    return page ? [page.remainder, ...page.chunks.map((c) => c.text)].join("\n") : items.map((i) => i.str).join("\n");
  };

  it("60 rows under 20 stubs: the one centred split is found quickly and every row takes its own stub", () => {
    const started = performance.now();
    const blocks = detectModelTables(stubbed(20));
    expect(performance.now() - started).toBeLessThan(2000);
    const rows = blocks.flatMap((b) => b.rows);
    expect(rows).toHaveLength(60);
    rows.forEach((r, i) => expect(r.label, `row ${i}`).toBe(`${Math.floor(i / 3) % 2 === 0 ? "CT" : "VT"} / Rated Value`));
  }, 10000);

  it("a table too large to search within the work limit is withheld whole, its stub text kept", () => {
    const items = stubbed(100);
    const blocks = detectModelTables(items);
    expect(blocks.flatMap((b) => b.rows).filter((r) => /Rated Value/.test(r.label))).toHaveLength(0);
    const text = allText(items);
    expect(text.match(/\bCT\b/g)?.length ?? 0).toBe(50);
    expect(text.match(/\bVT\b/g)?.length ?? 0).toBe(50);
  }, 10000);

  it("two different splits both centre on the group cells: neither is chosen, the values stay unqualified and both labels survive", () => {
    // Rows at 740/728/716/704 under two rotated group cells. Their centres (739.4 and 715.4) fit
    // both [740][728 716 704] and [740 728][716 704] within tolerance, so placement is ambiguous.
    const group = (str: string, centre: number) => ({ str, x: 40, y: centre - 20, w: 40, size: 8, vertical: true });
    const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
      item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
      ...[740, 728, 716, 704].flatMap((y, i) => [item("Rated Value", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
      group("Output Rating", 739.4), group("Input Rating", 715.4)];
    const blocks = detectModelTables(items);
    expect(blocks.flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method"]);
    expect(blocks.flatMap((b) => b.unqualified).filter((l) => /Rated Value/.test(l))).toHaveLength(4);
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    const text = allText(items);
    expect(text).toContain("Output Rating");
    expect(text).toContain("Input Rating");
  });

  // #5615 Codex round 1 F1: a one-letter rotated group label is still a group label. A real PDF
  // also rotates blanks and footnote marks beside a label (GS10 pages 26 and 27); only those are
  // read as ordinary text.
  it.each([
    ["H and L", "H", "L", 8],
    ["1 and 2, printed full size (#5615 Codex F4)", "1", "2", 8],
    // Alone on its line a digit annotates nothing, so even a small one is a group label.
    ["1 and 2 at 6 pt over 8 pt text, each alone on its line", "1", "2", 6],
    ["Output Rating and Input Rating (control)", "Output Rating", "Input Rating", 8],
  ])("rotated group labels %s each keep their own rows", (_name, upper, lower, size) => {
    const group = (str: string, centre: number) => ({ str, x: 40, y: centre - 20, w: 40, size, vertical: true });
    const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
      item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
      ...[740, 728, 692, 680].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
      group(upper, 734), group(lower, 686)]; // one split only: [740 728] centred 734, [692 680] centred 686
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    const labels = detectModelTables(items).flatMap((b) => b.rows).map((r) => r.label);
    expect(labels).toEqual(["Frame Size", "Cooling Method",
      `${upper} / Rated Current`, `${upper} / Rated Current`, `${lower} / Rated Current`, `${lower} / Rated Current`]);
  });
  // #5615 Codex round 2 F4: a rotated digit that shares its line with row text is a mark only when
  // it is printed small against the table's text, not against the largest item on that line. Here
  // the digits are labels that this reader cannot centre, so their rows are withheld with the
  // digits kept as text. Read as marks they would be dropped, leaving bare affirmable rows.
  it.each([
    ["8 pt, beside one 11 pt label", 8, 11],
    ["7 pt, inside the ratio boundary", 7, 8],
  ])("a rotated digit sharing a row line at %s is a group label: withheld, never dropped", (_name, size, labelSize) => {
    const digit = (str: string, centre: number) => ({ str, x: 40, y: centre - 5, w: 10, size, vertical: true });
    const rated = (y: number) => ({ str: "Rated Current", x: 100, y, w: 52, size: y === 728 ? labelSize : 8 });
    const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
      item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
      ...[740, 728, 716, 704].flatMap((y, i) => [rated(y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
      digit("1", 734), digit("2", 710)]; // each digit's y (729, 705) lands on the lower row of its pair
    const onRowLine = (y: number) => items.filter((it) => Math.abs(it.y - y) <= 2.5).length;
    expect([onRowLine(728), onRowLine(704)], "precondition: each digit shares a row line").toEqual([4, 4]);
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    const blocks = detectModelTables(items);
    expect(blocks.flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method"]);
    expect(blocks.flatMap((b) => b.unqualified)).toEqual(expect.arrayContaining(["1", "2"]));
    expect(blocks.flatMap((b) => b.unqualified).filter((l) => /Rated Current/.test(l))).toHaveLength(4);
  });
  it.each([["blank", ""], ["space", " "], ["footnote mark", "2"], ["two-digit footnote mark", "12"], ["space-padded footnote mark (#5615 Codex F3)", " 2 "]])(
    "a rotated %s beside a rotated label is not a group label", (_name, str) => {
      const group = (s: string, centre: number) => ({ str: s, x: 40, y: centre - 20, w: 40, size: 8, vertical: true });
      const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
        item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
        ...[740, 728, 716, 704].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
        // As on GS10: raised 3 pt off the label's baseline, starting where its text ends (702 + 40).
        group("Output Rating", 722), { str, x: 37, y: 742, w: 3, size: 5, vertical: true }];
      expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
      expect(detectModelTables(items).flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method",
        ...Array(4).fill("Output Rating / Rated Current")]);
    });

  it("6 pt rotated group digits in their own column, each on its pair's lower row line, keep their rows (#5615 Codex F5)", () => {
    const digit = (str: string, centre: number) => ({ str, x: 40, y: centre - 5, w: 10, size: 6, vertical: true });
    const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
      item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
      ...[740, 728, 716, 704].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
      digit("1", 734), digit("2", 710)];
    const onRowLine = (y: number) => items.filter((it) => Math.abs(it.y - y) <= 2.5).length;
    expect([onRowLine(728), onRowLine(704)], "precondition: each digit shares a row line").toEqual([4, 4]);
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    expect(detectModelTables(items).flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method",
      "1 / Rated Current", "1 / Rated Current", "2 / Rated Current", "2 / Rated Current"]);
  });

  it("a 6 pt rotated 2 on a word label's baseline, before its text begins, keeps its own rows (#5615 Codex F7)", () => {
    const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
      item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
      ...[740, 730, 720, 710].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
      { str: "Continuous", x: 40, y: 721.9, w: 31, size: 8, vertical: true },
      { str: "2", x: 40, y: 715.3, w: 3.2, size: 6, vertical: true }];
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    expect(detectModelTables(items).flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method",
      "Continuous / Rated Current", "Continuous / Rated Current", "2 / Rated Current", "2 / Rated Current"]);
  });

  // #5615 Codex rounds 3 and 4, F5 and F7: a small rotated digit is a mark only when it is raised
  // off a rotated word label's baseline and starts where that label's text ends. Each case breaks one
  // condition; the digit is then a group label, placed or withheld, and never dropped. Read as a mark
  // it would vanish. The label spans 702 to 742.
  it.each([
    ["5 pt, 30 pt across from the label's baseline", { x: 67, y: 742, size: 5 }],
    ["5 pt, on the label's own baseline (not raised)", { x: 40, y: 742, size: 5 }],
    ["5 pt, raised, at the start of the label's text", { x: 37, y: 699, size: 5 }],
    ["8 pt, full size, raised at the label's end", { x: 37, y: 742, size: 8 }],
    ["7 pt, at or above 0.8 of the 8 pt text, raised at the label's end", { x: 37, y: 742, size: 7 }],
  ])("a rotated digit %s is a group label: never dropped", (_name, digit) => {
    const labelCentre = 722, labelLength = 40;
    const items = [...header(776), item("Frame Size", 30, 764), item("A1", 250, 764), item("A1", 350, 764),
      item("Cooling Method", 30, 752), item("Fan", 250, 752), item("Fan", 350, 752),
      ...[740, 728, 716, 704].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)]),
      { str: "Output Rating", x: 40, y: labelCentre - labelLength / 2, w: labelLength, size: 8, vertical: true },
      { str: "2", x: digit.x, y: digit.y, w: 3, size: digit.size, vertical: true }];
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    const blocks = detectModelTables(items);
    const labels = blocks.flatMap((b) => b.rows).map((r) => r.label);
    const kept = labels.some((l) => /^2 \/ /.test(l)) || blocks.flatMap((b) => b.unqualified).includes("2");
    expect(kept, `labels ${JSON.stringify(labels)}`).toBe(true);
    expect(labels.filter((l) => /Rated Current/.test(l) && !/\//.test(l))).toEqual([]);
  });

  // #5598 Codex round 2 F2: one stub kind places, the other fails; the rows are demoted and the
  // label that DID place must survive as text too.
  const vgroup = (str: string, y: number) => ({ str, x: 20, y, w: 48, size: 8, vertical: true });
  it.each([
    ["the group label places, the CT/VT labels cannot", [
      item("CT", 50, 714), item("VT", 50, 666), vgroup("Output Rating", 668.4),
      ...[714, 702, 690, 678, 666].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)])], 5],
    ["the CT/VT labels place, the group label cannot", [
      item("CT", 50, 714), item("VT", 50, 702), vgroup("Output Rating", 640),
      ...[714, 702].flatMap((y, i) => [item("Rated Current", 100, y), item(String(i + 3), 250, y), item(String(i + 4), 350, y)])], 2],
  ])("%s: the values stay unqualified and every label survives", (_name, rated, demoted) => {
    const items = [...header(750), item("Frame Size", 10, 738), item("A1", 250, 738), item("A1", 350, 738),
      item("Cooling Method", 10, 726), item("Fan", 250, 726), item("Fan", 350, 726), ...rated];
    const blocks = detectModelTables(items);
    expect(blocks.flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method"]);
    expect(blocks.flatMap((b) => b.unqualified).filter((l) => /Rated Current/.test(l))).toHaveLength(demoted);
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    const text = allText(items);
    for (const label of ["Output Rating", "CT", "VT"]) expect(text, label).toMatch(new RegExp(`\\b${label}\\b`));
  });

  it("two ordinary rows, then three rated rows CT and VT cannot be centred on: the values stay unqualified and CT and VT survive", () => {
    const items = [...header(750),
      item("Frame Size", 30, 738), item("A1", 250, 738), item("A1", 350, 738),
      item("Cooling Method", 30, 726), item("Fan", 250, 726), item("Fan", 350, 726),
      item("CT", 50, 714), item("Rated Current", 100, 714), item("3", 250, 714), item("4", 350, 714),
      item("Rated Current", 100, 702), item("4", 250, 702), item("5", 350, 702),
      item("VT", 50, 690), item("Rated Current", 100, 690), item("5", 250, 690), item("6", 350, 690)];
    const blocks = detectModelTables(items);
    // Precondition: the ordinary rows keep the table qualified.
    expect(blocks.flatMap((b) => b.rows).map((r) => r.label)).toEqual(["Frame Size", "Cooling Method"]);
    expect(blocks.flatMap((b) => b.unqualified).filter((l) => /Rated Current/.test(l))).toHaveLength(3);
    expect(pageWithTables(items), "precondition: the page is read as a table").not.toBeNull();
    const text = allText(items);
    expect(text).toMatch(/\bCT\b/);
    expect(text).toMatch(/\bVT\b/);
  });
});
