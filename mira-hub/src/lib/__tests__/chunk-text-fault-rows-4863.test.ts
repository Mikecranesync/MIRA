import { describe, it, expect } from "vitest";
import { chunkText } from "../node-knowledge-ingest";

// #4863 (systemic: Rockwell + ABB) and #4851 (variable-length rows).
// A fault-table row (code, name, cause, corrective action) must land whole in one chunk,
// or a fault-code answer cites the row but loses its action text.
// Fixtures are synthetic; no manual text is committed.

const SIZE = 1000;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Rows that are whole in at least one chunk are not "split"; a row is split when no
// chunk contains its full normalized text.
function splitRows(chunks: string[], rows: string[]): string[] {
  const normed = chunks.map(norm);
  return rows.filter((r) => !normed.some((c) => c.includes(norm(r)))).map((r) => r.slice(0, 16));
}

// A row of exactly-ish `len` characters: code line, then sentences ending in ". ".
function sizedRow(code: string, len: number): string {
  const head = `${code} Synthetic Fault ${code} 1 Bus value exceeded limit\n`;
  const filler = "Check the supply line for transient events and tighten the terminals. ";
  let body = "";
  while (head.length + body.length < len) body += filler;
  return (head + body).slice(0, len).trimEnd() + "\n";
}

// #4851: rows of ~400, ~700, ~400 chars. The middle row starts before the 50% mark of
// the window, so the old rule cut through it.
function variableRowTable(): { page: string; rows: string[] } {
  const lens = [400, 700, 400, 700, 400, 700];
  const codes = lens.map((_, k) => `F${String(k + 1).padStart(3, "0")}`);
  const rows = lens.map((len, k) => sizedRow(codes[k], len));
  return { page: rows.join(""), rows };
}

// #4863 (ABB shape): ACS355-style table, plain 4-digit codes, multi-line CAUSE and
// WHAT TO DO text. Plain numeric codes must count as table rows.
function abbTable(n: number): { page: string; rows: string[] } {
  const rows: string[] = [];
  for (let k = 1; k <= n; k++) {
    const code = String(k).padStart(4, "0");
    rows.push(
      `${code} OVERCURRENT Output current is excessive for drive ${k}. Check motor load\n` +
        `and mechanics. Check acceleration time (2202 and 2205) for the ramp ${k}.\n` +
        `Check that motor data (Group 99) is equal to motor rating plate values and\n` +
        `perform the ID run (9910) after the first start of the drive ${k}.\n` +
        `Replace the drive if the fault still appears after the motor cable and\n` +
        `connections are checked for phasing and the STO cabling is verified ${k}.\n` +
        "Check the sizing of the drive against the load profile and record the result.\n".repeat(k % 3),
    );
  }
  return { page: rows.join(""), rows };
}

describe("chunkText keeps variable-length fault rows whole (#4851)", () => {
  it("every row up to the window length is whole in some chunk", () => {
    const { page, rows } = variableRowTable();
    expect(page.length).toBeGreaterThan(SIZE);
    // Precondition for the test to mean anything: each row fits the window.
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(SIZE);
    expect(splitRows(chunkText(page), rows)).toEqual([]);
  });

  it("every chunk stays within the window", () => {
    const { page } = variableRowTable();
    for (const c of chunkText(page)) expect(c.length).toBeLessThanOrEqual(SIZE);
  });
});

describe("chunkText keeps plain-numeric-code (ABB) fault rows whole (#4863)", () => {
  it("ABB table: detected as a table, so every chunk after the first starts at a row", () => {
    const { page, rows } = abbTable(12);
    expect(page.length).toBeGreaterThan(SIZE);
    expect(rows.some((r) => r.length > SIZE * 0.4)).toBe(true);
    const chunks = chunkText(page);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks.slice(1)) expect(c).toMatch(/^\d{4} OVERCURRENT/);
  });
});
