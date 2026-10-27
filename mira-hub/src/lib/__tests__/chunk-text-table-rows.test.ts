import { describe, it, expect } from "vitest";
import { chunkText } from "../node-knowledge-ingest";

// #4842: a fault-table row (code, name, cause, corrective action) must land whole in
// one chunk. On main, chunkText broke at a mid-row ". ", which separated the PowerFlex
// 525 F005 cause from "Extend the decel time", so retrieval never saw the fix.
// Fixtures are synthetic; no manual text is committed.

const SIZE = 1000;
const OVERLAP = 120;

// The pre-#4842 algorithm, kept verbatim as the control for non-table pages.
function legacyChunkText(text: string, size = SIZE, overlap = OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const brk = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (brk > size * 0.5) end = i + brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function rowsOf(page: string, codeRe: RegExp): string[] {
  const starts = [...page.matchAll(codeRe)].map((m) => m.index ?? 0);
  return starts.map((s, k) => norm(page.slice(s, starts[k + 1] ?? page.length)));
}

function splitRows(chunks: string[], rows: string[]): string[] {
  const normed = chunks.map(norm);
  return rows.filter((r) => !normed.some((c) => c.includes(r))).map((r) => r.split(" ")[0]);
}

// F005-shaped table: each row's action cell spans several lines and sentences, and one
// continuation line starts with a parameter code (A485) that must not count as a row.
function fTable(n: number): string {
  const rows: string[] = [];
  for (let k = 1; k <= n; k++) {
    const code = `F${String(k).padStart(3, "0")}`;
    rows.push(
      `${code} Synthetic Fault ${k} 1 Bus value exceeded limit ${k}\n` +
        `Monitor the supply line for condition ${k} or transient events on\n` +
        `the input side and confirm the wiring terminals are tight and that\n` +
        `the enclosure stays inside its rated ambient temperature range\n` +
        `excursions can also come from load regeneration. Extend the ramp\n` +
        `time or install the braking option.\n` +
        (k % 4 === 0 ? `A485 [Limit ${k}] stays above setpoint for too long.\n` : ""),
    );
  }
  return rows.join("");
}

function hexTable(n: number): string {
  const rows: string[] = [];
  for (let k = 1; k <= n; k++) {
    const code = `0xF${(0x100 + k).toString(16).toUpperCase()}`;
    rows.push(
      `${code} Recoverable The module connection faulted for reason ${k}\n` +
        `while the controller was running and the user program stayed loaded\n` +
        `in memory with the retained data intact across the power cycle and\n` +
        `the fault log recorded the event with its time stamp and the slot\n` +
        `number of the module concerned. Remove and reseat the module, then\n` +
        `upgrade the firmware to a compatible revision before the next start.\n`,
    );
  }
  return rows.join("");
}

function prose(sentences: number): string {
  const out: string[] = [];
  for (let k = 1; k <= sentences; k++) {
    out.push(`Paragraph sentence number ${k} describes general maintenance practice in plain words.`);
    if (k % 5 === 0) out.push("\n\n");
  }
  return out.join(" ");
}

describe("chunkText keeps fault-table rows whole (#4842)", () => {
  it("F-code table: every row is whole in some chunk, where the old algorithm split one", () => {
    const page = fTable(12);
    const rows = rowsOf(page, /^F\d{3} /gm);
    expect(rows).toHaveLength(12);
    // Precondition: the old rule really splits a row here; otherwise this test proves nothing.
    expect(splitRows(legacyChunkText(page), rows).length).toBeGreaterThan(0);
    expect(splitRows(chunkText(page), rows)).toEqual([]);
  });

  it("0x hex-code table: every row is whole in some chunk, where the old algorithm split one", () => {
    const page = hexTable(14);
    const rows = rowsOf(page, /^0xF[0-9A-F]{3} /gm);
    expect(rows).toHaveLength(14);
    expect(splitRows(legacyChunkText(page), rows).length).toBeGreaterThan(0);
    expect(splitRows(chunkText(page), rows)).toEqual([]);
  });

  it("table chunks start at a row of the table's own code family, never at an A485 action line", () => {
    const chunks = chunkText(fTable(12));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks.slice(1)) expect(c).toMatch(/^F\d{3} /);
  });

  it("no chunk exceeds the window", () => {
    for (const page of [fTable(12), hexTable(14), prose(60)]) {
      for (const c of chunkText(page)) expect(c.length).toBeLessThanOrEqual(SIZE);
    }
  });

  it("control: a prose page is byte-identical to the old algorithm", () => {
    const page = prose(60);
    expect(page.length).toBeGreaterThan(SIZE);
    expect(chunkText(page)).toEqual(legacyChunkText(page));
  });

  it("control: a page with only two code lines is not a table and is unchanged", () => {
    const page = `F001 Synthetic Fault 1 First line of text.\n${prose(20)}\nF002 Synthetic Fault 2 Second line.\n${prose(20)}`;
    expect(page.length).toBeGreaterThan(SIZE);
    expect(chunkText(page)).toEqual(legacyChunkText(page));
  });

  it("control: a short page is a single chunk", () => {
    const page = fTable(2);
    expect(page.length).toBeLessThanOrEqual(SIZE);
    expect(chunkText(page)).toEqual([page.trim()]);
  });
});
