/**
 * GS10 Rev B pages 26 and 27: every value keeps the group and duty labels the page prints for it
 * (#5503 follow-up, decision record .planning/2026-11-17-pdf-reader-decision).
 *
 * On these pages "Output Rating" and "Input Rating" are rotated cells, and "CT" / "VT" are cells
 * centred on the rows they cover. A value line stored without them cannot be told apart from its
 * sibling (page 26: CT and VT Rated Output Capacity; page 27: the CT values read as VT). Page and
 * gold are the captured real ones; the reader, the pins and the gate are production code, through
 * the real writer. No page is recorded as reviewed here: the gate stays closed by default.
 */
import { describe, expect, it, vi } from "vitest";
import gs10p26 from "../__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p27 from "../__fixtures__/table-rows/gs10-p27-230v-3ph.json";
import candidateP26 from "../__fixtures__/reviewed-pages/gs10-rev-b-p26.candidate.json";
import goldP27 from "../__fixtures__/reviewed-pages/gs10-rev-b-p27.gold.json";
import { affirmsModel, scopeDigest, type ScopedRow } from "../model-scope-gate";
import { layoutItemsFromTextContent } from "../pdf-layout-items";

vi.hoisted(() => { process.env.NODE_EMBED_ON_WRITE = "0"; });

type Item = { str: string; x: number; y: number; w: number; size: number; vertical?: boolean };
type Page = { page: number; text: string; items: Item[] };
type Gold = { model: string; property: string; condition: string | null; unit: string | null; value: string };
const pdf = vi.hoisted(() => ({ pages: [] as Page[], sha: null as string | null, reviewed: undefined as string | undefined }));
const gated = vi.hoisted(() => [] as Array<{ input: ScopedRow[]; output: ScopedRow[] }>);

vi.mock("../model-scope-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model-scope-gate")>();
  return { ...actual, gatePageRows: <Row extends ScopedRow>(rows: readonly Row[], reviewed: string | null | undefined) => {
    const output = actual.gatePageRows(rows, reviewed);
    gated.push({ input: [...rows], output });
    return output;
  } };
});
vi.mock("../table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../table-rule-pins")>();
  const { pinsDouble } = await import("../__fixtures__/pinned-rules-double");
  return { ...actual, rulePinsForSha: () => {
    if (!pdf.sha) return null;
    const pins = pinsDouble(actual, pdf.pages, [pdf.sha]);
    if (pdf.reviewed === undefined) return pins;
    return Object.fromEntries(Object.entries(pins).map(([k, pin]) => [k, { ...pin, reviewed: pdf.reviewed }]));
  } };
});
// The PDF boundary: a captured item becomes the pdf.js text item it was read from, rotation included.
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (n: number) => ({
      getTextContent: async () => ({ items: (pdf.pages.find((p) => p.page === n)?.items ?? []).map((i) => ({ str: i.str, width: i.w,
        transform: i.vertical ? [0, i.size, -i.size, 0, i.x, i.y] : [i.size, 0, 0, i.size, i.x, i.y] })) }),
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: Math.max(...pdf.pages.map((p) => p.page)) }, (_, i) => pdf.pages.find((p) => p.page === i + 1)?.text ?? "") })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
const captured = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }> }) => Promise<unknown>) =>
    fn({ query: async (sql, params) => { captured.push({ sql, params }); return { rows: [] }; } })),
}));

type Stored = { content: string; page: number; meta: Record<string, unknown> };
function stored(): Stored[] {
  const rows: Stored[] = [];
  for (const { sql, params } of captured) {
    if (!sql.includes("INTO knowledge_entries")) continue;
    for (let i = 3; i + 3 < params.length; i += 4) rows.push({ content: params[i + 1] as string, page: params[i + 2] as number, meta: JSON.parse(params[i + 3] as string) });
  }
  return rows;
}
/** The real writer over one captured page of the pinned GS10 file. Returns the rows the reader
 *  produced (what the gate was given) and the rows that were stored (what the gate returned). */
async function ingest(page: Page, reviewed?: string) {
  captured.length = 0; gated.length = 0;
  pdf.pages = [page]; pdf.sha = candidateP26.sha256; pdf.reviewed = reviewed;
  vi.resetModules();
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", nodeId: "node-1", unsPath: null,
    filename: "gs10usermanual.pdf", buffer: Buffer.from("%PDF stub standing for the pinned GS10 file") });
  return { read: gated.flatMap((g) => g.input), stored: stored() };
}
const P26 = { page: 26, text: gs10p26.text, items: gs10p26.items } as Page;
const P27 = { page: 27, text: gs10p27.text, items: gs10p27.items } as Page;
/** Model value lines the reader affirms: "<model>: <labels> <value> <unit>". */
const modelLines = (rows: ScopedRow[]) => rows.filter(affirmsModel).flatMap((r) => r.content.split("\n").slice(1).filter((l) => /^\S+: /.test(l)));
const norm = (t: string) => t.replace(/[\s–—-]+/g, "").toLowerCase();
const bare = (property: string) => property.replace(/\s*\([^)]*\)\s*$/, "");

/** The one line that states this gold value: its own model, the page's labels in printed order
 *  ("Output Rating / CT / "), the property, and the value with its unit as the last words. */
function linesFor(lines: readonly string[], g: Gold): string[] {
  const head = `${g.model}: ${g.condition ? `${g.condition} / ` : ""}`;
  return lines.filter((l) => {
    if (!l.startsWith(head)) return false;
    const rest = l.slice(head.length);
    if (!g.condition && /^(Output|Input) Rating \/ /.test(rest)) return false;
    if (/^(CT|VT) \/ /.test(rest)) return false; // a duty label the gold does not give
    if (!norm(rest).startsWith(norm(bare(g.property)))) return false;
    const value = norm(g.value);
    const unit = norm(g.unit ?? "");
    const r = norm(rest);
    return (r.endsWith(value + unit) || (unit !== "" && value.includes(unit) && r.endsWith(value))) &&
      !/[0-9.\/]$/.test(r.slice(0, r.length - (r.endsWith(value + unit) ? value.length + unit.length : value.length)));
  });
}

describe("rotation is read from the PDF, not guessed", () => {
  it("a text item turned 90 degrees is vertical; an upright one is not", () => {
    const items = layoutItemsFromTextContent({ items: [
      { str: "Output Rating", width: 56.86, transform: [0, 8.5, -8.5, 0, 102.22, 597.9] },
      { str: "CT", width: 10.39, transform: [8.5, 0, 0, 8.5, 115.58, 629.08] },
    ] } as never);
    expect(items[0]).toMatchObject({ str: "Output Rating", size: 8.5, vertical: true });
    expect(items[1].vertical).toBeUndefined();
  });
});

describe("GS10 page 26: all 90 values, each under its own model with the labels the page prints", () => {
  const gold = candidateP26.gold as Gold[];
  it("the captured page has the rotated group cells the reader depends on (precondition)", () => {
    expect(P26.items.filter((i) => i.vertical).map((i) => i.str.trim())).toEqual(["Output Rating", "Input Rating"]);
    expect(gold).toHaveLength(90);
  });
  for (const g of gold) {
    it(`${g.model} ${g.condition ?? "-"} / ${g.property} = ${g.value} ${g.unit ?? ""}`, async () => {
      const lines = modelLines((await ingest(P26)).read);
      expect(linesFor(lines, g)).toHaveLength(1);
    });
  }
  it("affirms exactly the 90 printed values: no extra, no duplicate, no other model's line", async () => {
    const lines = modelLines((await ingest(P26)).read);
    expect(lines).toHaveLength(90);
    expect(lines.filter((l) => gold.filter((g) => linesFor([l], g).length === 1).length !== 1)).toEqual([]);
  });
});

describe("GS10 page 27: the CT values are never stated as VT values, or the other way round", () => {
  const gold = goldP27.gold as Gold[];
  const rated = ["Rated Output Capacity", "Rated Output Current", "Rated Input Current"];
  const goldOf = (model: string, property: string, duty: "CT" | "VT") =>
    gold.find((g) => g.model === model && bare(g.property) === property && g.condition?.endsWith(`/ ${duty}`))!;
  it("the gold names a CT and a VT value for each model and rated property (precondition)", () => {
    for (const model of ["GS13N-20P2", "GS13N-20P5", "GS13N-21P0", "GS13N-22P0"]) for (const p of rated) {
      expect(goldOf(model, p, "CT").value).not.toEqual(goldOf(model, p, "VT").value);
    }
  });
  for (const model of ["GS13N-20P2", "GS13N-20P5", "GS13N-21P0", "GS13N-22P0"]) {
    it(`${model}: every rated line says CT or VT, and carries that duty's own value`, async () => {
      const lines = modelLines((await ingest(P27)).read).filter((l) => l.startsWith(`${model}: `));
      for (const p of rated) {
        const own = lines.filter((l) => l.includes(` ${p} `));
        expect(own.length).toBeGreaterThan(0);
        for (const l of own) {
          const duty = / \/ (CT|VT) \/ /.exec(l)?.[1] as "CT" | "VT" | undefined;
          expect(duty, l).toBeDefined();
          const first = (d: "CT" | "VT") => goldOf(model, p, d).value.split(" ")[0];
          const value = l.slice(l.indexOf(` ${p} `) + p.length + 2).split(" ")[0];
          expect(value, l).toBe(first(duty!));
          expect(value, l).not.toBe(first(duty === "CT" ? "VT" : "CT"));
        }
      }
    });
  }
});

describe("GS10 page 27: whatever the reader cannot place by duty is withheld, never stated without it", () => {
  const rated = ["Rated Output Capacity", "Rated Output Current", "Rated Input Current"];
  it("no affirmed line states a rated value without a CT or VT label", async () => {
    const lines = modelLines((await ingest(P27)).read);
    // Not vacuous by itself: the next test proves the rated values are still read and stored.
    const unlabelled = lines.filter((l) => rated.some((p) => l.includes(` ${p} `)) && !/ \/ (CT|VT) \/ /.test(l));
    expect(unlabelled).toEqual([]);
  });
  it("the CT and VT values are still stored, as text withheld from every catalog record", async () => {
    const { read } = await ingest(P27);
    for (const printed of ["1.6 2.8 4.8 7.5", "1.8 3.0 5.0 8.0", "1.9 3.4 5.8 9.0", "2.2 3.8 6.0 9.6"]) {
      const holding = read.filter((r) => r.content.includes(printed));
      expect(holding.length, printed).toBeGreaterThan(0);
      expect(holding.every((r) => !affirmsModel(r)), printed).toBe(true);
    }
  });
});

describe("the gate is unchanged: these lines answer only from a reviewed page", () => {
  const line = "GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A";
  it("with the shipped pins (page 26 not reviewed) the 5.1 A line is stored, but withheld", async () => {
    const { read, stored } = await ingest(P26);
    expect(modelLines(read)).toContain(line); // the reader states it, so withholding is not vacuous
    expect(stored.some((r) => r.content.includes(line))).toBe(true);
    expect(stored.filter((r) => r.content.includes(line)).every((r) => r.meta.table_unqualified === true)).toBe(true);
  });
  it("a review recorded for the page as it was read before this change does not carry over", async () => {
    const { stored } = await ingest(P26, candidateP26.digest);
    expect(stored.filter((r) => r.content.includes(line)).every((r) => r.meta.table_unqualified === true)).toBe(true);
  });
  it("reviewed for exactly these rows: 5.1 A answers GS11N-20P2 only, from page 26, under Input Rating / CT", async () => {
    const digest = scopeDigest((await ingest(P26)).read);
    const { stored } = await ingest(P26, digest);
    const own = stored.filter((r) => r.content.includes(line));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ page: 26 });
    expect(own[0].meta.table_models).toEqual(["GS11N20P2"]);
    expect(own[0].meta.table_unqualified).toBeUndefined();
    expect(own[0].content).not.toMatch(/: Input Rating \/ CT \/ Rated Input Current (?!5\.1 A)/);
    expect(own[0].content).toContain("GS11N-20P2: Input Rating / VT / Rated Input Current 5.8 A");
    expect(stored.filter((r) => r.content.includes("5.1 A") && r.meta.table_unqualified !== true)
      .every((r) => (r.meta.table_models as string[]).join() === "GS11N20P2")).toBe(true);
  });
});
