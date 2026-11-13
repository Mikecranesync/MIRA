// #5474 item 5 — which column each figure of a contact-ratings table belongs to, read at upload
// from where the page prints it.
//
// The flattened page text gives "120 V AC 15 A 1.5 A 2 A 1800 180" under heads that come out of
// order, so nothing downstream can tell the make figure from the continuous one. On staging
// 2199f449a (CV-101 S7, 2026-11-13) the answer read the row as "make 1.5 A, break 2 A".
//
// The expected values below are typed from the printed page (Rockwell 2080-IN009B-EN-P, April
// 2014, page 19, read by eye on 2026-11-13), not derived from the reader:
//
//   Maximum Volts | Amperes: Make | Break | Amperes Continuous | Volt-Amperes: Make | Break
//   120 V AC      | 15 A          | 1.5 A | 2 A (one cell, also covers 240 V AC) | 1800 | 180
//   240 V AC      | 7.5 A         | 0.75 A|
//   24 V DC       | 1.0 A (one cell across Make and Break) | 1 A (also covers 125 V DC) | 28
//   125 V DC      | 0.22 A (one cell across Make and Break)
//
// Run: npx vitest run src/capabilities/__tests__/contact-ratings-table.test.ts
import { describe, expect, it } from "vitest";
import { COLUMN_LINES_HEAD, columnLines, contactRatingColumns, readColumnLines, withColumnLines, type ColumnRow } from "../contact-ratings-table";
import type { LayoutItem } from "../pdf-layout-items";
import p19 from "../__fixtures__/contact-ratings/micro820-in009b-p19.json";
import gs10p26 from "../__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p27 from "../__fixtures__/table-rows/gs10-p27-230v-3ph.json";
import gs10p394 from "../__fixtures__/table-rows/gs10-p394-cable-length.json";
import micro820p15 from "../__fixtures__/table-rows/micro820-in009-p15.json";
import micro820p16 from "../__fixtures__/table-rows/micro820-in009-p16.json";
import relayP1 from "../__fixtures__/table-rows/ca3kn22bd-p1.json";

const ITEMS = p19.items as LayoutItem[];
const PRINTED: ColumnRow[] = [
  { label: "120 V AC", make: "15 A", break: "1.5 A", continuous: "2 A", unread: [] },
  { label: "240 V AC", make: "7.5 A", break: "0.75 A", continuous: null, unread: [] },
  { label: "24 V DC", make: null, break: null, continuous: "1 A", unread: ["1.0 A"] },
  { label: "125 V DC", make: null, break: null, continuous: null, unread: ["0.22 A"] },
];
// Page 19 as the hub's flat text extraction returns it (same string as rating-column.test.ts).
const P19_TEXT =
  "Micro820 20-Point Programmable Controllers 19\nPublication 2080-IN009B-EN-P - April 2014\nRelay Contact Ratings\nMaximum\nVolts Amperes Amperes\n"
  + "Continuous Volt-Amperes\nMake Break Make Break\n120 V AC 15 A 1.5 A 2 A 1800 180\n240 V AC 7.5 A 0.75 A\n24 V DC 1.0 A 1 A 28\n125 V DC 0.22 A\n"
  + "Analog Output Specifications\nAttribute Value\nOutput count range 0...4008";

/** The page with one item changed, moved or removed. */
const edited = (fn: (i: LayoutItem) => LayoutItem | null): LayoutItem[] => ITEMS.flatMap((i) => { const o = fn({ ...i }); return o ? [o] : []; });

describe("contactRatingColumns — the real page", () => {
  it("gives each figure the column it is printed under, and no column to a figure it cannot place", () => {
    expect(contactRatingColumns(ITEMS)).toEqual(PRINTED);
  });
  it("a figure alone at the make position, with nothing at the break position, gets no column (the page prints it across both)", () => {
    const rows = contactRatingColumns(ITEMS)!;
    expect(rows[2]).toMatchObject({ make: null, break: null, unread: ["1.0 A"] });
    expect(rows[3]).toMatchObject({ make: null, break: null, continuous: null, unread: ["0.22 A"] });
  });
  it("a continuous figure printed once is given only to the row it is printed on", () => {
    expect(contactRatingColumns(ITEMS)![1].continuous).toBeNull();
  });
  it("volt-ampere figures are never read as amperes", () => {
    const all = JSON.stringify(contactRatingColumns(ITEMS));
    expect(all).not.toContain("1800");
    expect(all).not.toContain("180\"");
    expect(all).not.toContain("28");
  });
});

describe("contactRatingColumns — position decides, not order", () => {
  it("the same figures printed under other heads take those heads", () => {
    // Swap the positions of the 120 V AC row's make and continuous cells.
    const swapped = edited((i) => (i.str === "15 A" ? { ...i, x: 299.52 } : i.str === "2 A" ? { ...i, x: 206.41 } : i));
    expect(contactRatingColumns(swapped)![0]).toEqual({ label: "120 V AC", make: "2 A", break: "1.5 A", continuous: "15 A", unread: [] });
  });
  it("a figure that sits under no head is not placed, and takes the row's other figures with it", () => {
    const off = edited((i) => (i.str === "1.5 A" ? { ...i, x: 232 } : i));
    expect(contactRatingColumns(off)![0]).toEqual({ label: "120 V AC", make: null, break: null, continuous: null, unread: ["15 A", "1.5 A", "2 A"] });
  });
  it("two figures under one head: the row is not placed", () => {
    const doubled = edited((i) => (i.str === "1.5 A" ? { ...i, x: 206.41 } : i));
    expect(contactRatingColumns(doubled)![0]).toMatchObject({ make: null, break: null, continuous: null });
  });
});

describe("contactRatingColumns — a head word printed twice (the page's Volt-Amperes Make and Break)", () => {
  it("an ampere figure under the second Make or Break is not a make or break figure: the row is not placed", () => {
    // 125 V DC with a figure under the amperes Make, one under Continuous, and one under the
    // volt-ampere Break head (x 418.44).
    const y = ITEMS.find((r) => r.str === "125 V DC")!.y;
    const under: LayoutItem[] = [
      ...ITEMS.filter((i) => i.str !== "0.22 A"),
      { str: "0.22 A", x: 206.4, y, w: 20, size: 7 },
      { str: "0.5 A", x: 299.52, y, w: 15, size: 7 },
      { str: "0.1 A", x: 418.44, y, w: 15, size: 7 },
    ];
    const row = contactRatingColumns(under)![3];
    expect(row).toEqual({ label: "125 V DC", make: null, break: null, continuous: null, unread: ["0.22 A", "0.5 A", "0.1 A"] });
  });
  it("control: the first Make and Break still place their figures", () => {
    expect(contactRatingColumns(ITEMS)![0]).toMatchObject({ make: "15 A", break: "1.5 A" });
  });
});

describe("contactRatingColumns — one voltage on two rows", () => {
  it("two rows for one voltage (say resistive and inductive) cannot be told apart by the lines: the page is not read", () => {
    const y = ITEMS.find((r) => r.str === "125 V DC")!.y - 9;
    const twice: LayoutItem[] = [
      ...ITEMS,
      { str: "120 V AC", x: 147.72, y, w: 30, size: 7 },
      { str: "15 A", x: 206.4, y, w: 15, size: 7 },
      { str: "0.5 A", x: 252.25, y, w: 15, size: 7 },
      { str: "1 A", x: 299.52, y, w: 10, size: 7 },
    ];
    expect(contactRatingColumns(twice)).toBeNull();
  });
});

describe("contactRatingColumns — where the table ends", () => {
  it("the rows are the unbroken run under the heads: a voltage line further down the page is not one", () => {
    // Under the page's other text, a line that opens with a voltage and has a figure at the make position.
    const lower: LayoutItem[] = [
      ...ITEMS,
      { str: "24 V DC", x: 147.72, y: 60, w: 23, size: 7 },
      { str: "9 A", x: 206.4, y: 60, w: 10, size: 7 },
      { str: "8 A", x: 252.26, y: 60, w: 10, size: 7 },
    ];
    expect(contactRatingColumns(lower)).toEqual(PRINTED);
  });
});

describe("contactRatingColumns — pages that are not a contact-ratings table", () => {
  it.each([
    ["no Continuous head", edited((i) => (i.str === "Continuous" ? null : i))],
    ["no Break head", edited((i) => (i.str === "Break" ? null : i))],
    ["no row that opens with a voltage", edited((i) => (/^\d+ V (?:AC|DC)$/.test(i.str) ? null : i))],
    ["no figure with a column on any row", edited((i) => (/ A$/.test(i.str) ? { ...i, x: i.x + 20 } : i))],
    ["an empty page", [] as LayoutItem[]],
  ])("%s", (_name, items) => {
    expect(contactRatingColumns(items)).toBeNull();
  });
  it.each([
    ["GS10 p.26", gs10p26],
    ["GS10 p.27", gs10p27],
    ["GS10 p.394", gs10p394],
    ["Micro820 p.15", micro820p15],
    ["Micro820 p.16", micro820p16],
    ["Schneider CA3KN22BD p.1 (a relay data sheet with no such table)", relayP1],
  ])("control: %s", (_name, fixture) => {
    expect(contactRatingColumns(fixture.items as LayoutItem[])).toBeNull();
  });
});

describe("the stored lines", () => {
  const lines = columnLines(PRINTED);
  it("the head says a figure with no column read is not a rating for one column", () => {
    expect(COLUMN_LINES_HEAD).toMatch(/"column not read"/);
    expect(COLUMN_LINES_HEAD).toMatch(/not a rating for any one column/);
    expect(COLUMN_LINES_HEAD).not.toMatch(/\n/);
  });
  it("one line per row, under a fixed head", () => {
    expect(lines).toEqual([
      COLUMN_LINES_HEAD,
      "120 V AC: make 15 A, break 1.5 A, continuous 2 A",
      "240 V AC: make 7.5 A, break 0.75 A",
      "24 V DC: continuous 1 A (column not read: 1.0 A)",
      "125 V DC: (column not read: 0.22 A)",
    ]);
  });
  it("are read back exactly, and the rest of the text is returned without them", () => {
    const stored = withColumnLines(P19_TEXT, PRINTED);
    const back = readColumnLines(stored);
    expect(back.rows).toEqual(PRINTED);
    expect(back.rest).toBe(P19_TEXT);
  });
  it("are placed directly under the table's last row, with no blank line (a blank line invites a chunk break)", () => {
    const stored = withColumnLines(P19_TEXT, PRINTED).split("\n");
    const at = stored.indexOf("125 V DC 0.22 A");
    expect(stored[at + 1]).toBe(COLUMN_LINES_HEAD);
    expect(stored[at + 6]).toBe("Analog Output Specifications");
    expect(stored).not.toContain("");
  });
  it("go at the end when the text does not hold the table's rows", () => {
    const stored = withColumnLines("Some other text\nof the page", PRINTED);
    expect(stored.startsWith("Some other text\nof the page\n" + COLUMN_LINES_HEAD)).toBe(true);
    expect(readColumnLines(stored).rest).toBe("Some other text\nof the page");
  });
  it("text without the head has no column rows, and is returned whole", () => {
    expect(readColumnLines(P19_TEXT)).toEqual({ rows: [], rest: P19_TEXT });
  });
  it("a line under the head that is not in the stored form ends the block; nothing after it is taken", () => {
    const text = `${COLUMN_LINES_HEAD}\n120 V AC: make 15 A, break 1.5 A\n120 V AC: rated 15 A\n240 V AC: make 7.5 A, break 0.75 A`;
    const back = readColumnLines(text);
    expect(back.rows.map((r) => r.label)).toEqual(["120 V AC"]);
    expect(back.rest).toBe("120 V AC: rated 15 A\n240 V AC: make 7.5 A, break 0.75 A");
  });
});
