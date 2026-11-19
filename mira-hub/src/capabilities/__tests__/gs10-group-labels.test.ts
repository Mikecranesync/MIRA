/**
 * GS10 Rev B pages 26 and 27: every value keeps the group and duty labels the page prints for it
 * (#5503 follow-up, decision record .planning/2026-11-17-pdf-reader-decision).
 *
 * On these pages "Output Rating" and "Input Rating" are rotated cells, and "CT" / "VT" are cells
 * centred on the rows they cover. A value line stored without them cannot be told apart from its
 * sibling (page 26: CT and VT Rated Output Capacity; page 27: the CT values read as VT). Page and
 * gold are the captured real ones; the reader, the pins and the gate are production code, through
 * the real writer. Page 26 of the two approved GS10 files is the one reviewed page (owner review,
 * #5232, 2026-11-18); page 27 is not reviewed and stays withheld.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import gs10p26 from "../__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p27 from "../__fixtures__/table-rows/gs10-p27-230v-3ph.json";
import reviewedP26 from "../__fixtures__/reviewed-pages/gs10-rev-b-p26.reviewed.json";
import goldP27 from "../__fixtures__/reviewed-pages/gs10-rev-b-p27.gold.json";
import { affirmsModel, scopeDigest, type ScopedRow } from "../model-scope-gate";
import { layoutItemsFromTextContent } from "../pdf-layout-items";
import pins from "../table-rule-pins.json";
import { layoutFingerprint } from "../table-rule-pins";

vi.hoisted(() => { process.env.NODE_EMBED_ON_WRITE = "0"; });

type Item = { str: string; x: number; y: number; w: number; size: number; vertical?: boolean };
type Page = { page: number; text: string; items: Item[] };
type Gold = { model: string; property: string; condition: string | null; unit: string | null; value: string };
/** `real`: the stub bytes stand for file `sha` and get that file's REAL page-keyed pin map, as
 *  shipped (no re-keying by fingerprint), so page binding is exercised exactly as in production. */
const pdf = vi.hoisted(() => ({ pages: [] as Page[], sha: null as string | null, reviewed: undefined as string | undefined, real: false }));
const gated = vi.hoisted(() => [] as Array<{ input: ScopedRow[]; output: ScopedRow[]; reviewed: string | null | undefined }>);

vi.mock("../model-scope-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model-scope-gate")>();
  return { ...actual, gatePageRows: <Row extends ScopedRow>(rows: readonly Row[], reviewed: string | null | undefined) => {
    const output = actual.gatePageRows(rows, reviewed);
    gated.push({ input: [...rows], output, reviewed });
    return output;
  } };
});
vi.mock("../table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../table-rule-pins")>();
  const { pinsDouble } = await import("../__fixtures__/pinned-rules-double");
  return { ...actual, rulePinsForSha: () => {
    if (!pdf.sha) return null;
    if (pdf.real) return actual.rulePinsForSha(pdf.sha);
    const pins = pinsDouble(actual, pdf.pages, [pdf.sha]);
    if (pdf.reviewed === undefined) return pins;
    return Object.fromEntries(Object.entries(pins).map(([k, pin]) => [k, { ...pin, reviewed: pdf.reviewed }]));
  } };
});
// The PDF boundary: a captured item becomes the pdf.js text item it was read from, rotation included.
vi.mock("unpdf", async () => {
  const { textContentItem } = await import("../__fixtures__/text-content-item");
  return {
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (n: number) => ({
      getTextContent: async () => ({ items: (pdf.pages.find((p) => p.page === n)?.items ?? []).map((i) => textContentItem(i)) }),
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: Math.max(...pdf.pages.map((p) => p.page)) }, (_, i) => pdf.pages.find((p) => p.page === i + 1)?.text ?? "") })),
  };
});
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
const STUB = "%PDF stub standing for the pinned GS10 file";
async function ingest(page: Page, reviewed?: string, sha: string = reviewedP26.sha256, real = false) {
  captured.length = 0; gated.length = 0;
  pdf.pages = [page]; pdf.sha = sha; pdf.reviewed = reviewed; pdf.real = real;
  vi.resetModules();
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", nodeId: "node-1", unsPath: null,
    filename: "gs10usermanual.pdf", buffer: Buffer.from(STUB) });
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
  const gold = reviewedP26.gold as Gold[];
  it("the captured page has the rotated items the real PDF has, not only the two labels (precondition)", () => {
    // As read from the real file by layoutItemsFromTextContent: besides the two group cells, the
    // PDF also rotates empty and space items and the footnote mark "2". A capture that keeps only
    // the labels tests a cleaner page than any upload produces.
    expect(P26.items.filter((i) => i.vertical).map((i) => i.str)).toEqual(["", "Output Rating", " ", "", "Input Rating", "2", " "]);
    expect(P27.items.filter((i) => i.vertical).map((i) => i.str)).toEqual(["", "Output Rating", "", "Input Rating", "2", " "]);
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
          // The page prints the unit cell on the label line for some rows ("Rated Output Current
          // A 1.6"): skip a unit word, then the first token is the value.
          const value = l.slice(l.indexOf(` ${p} `) + p.length + 2).split(" ").find((t) => !/^(A|kVA|kW|hp|kHz)$/.test(t));
          expect(value, l).toBe(first(duty!));
          expect(value, l).not.toBe(first(duty === "CT" ? "VT" : "CT"));
        }
      }
    });
  }
});

describe("GS10 page 27: a rated value is never stated without its duty", () => {
  const rated = ["Rated Output Capacity", "Rated Output Current", "Rated Input Current"];
  it("no affirmed line states a rated value without a CT or VT label", async () => {
    const lines = modelLines((await ingest(P27)).read);
    expect(lines.length).toBeGreaterThan(0); // the page is read
    const unlabelled = lines.filter((l) => rated.some((p) => l.includes(` ${p} `)) && !/ \/ (CT|VT) \/ /.test(l));
    expect(unlabelled).toEqual([]);
  });
  it("the duty-labelled lines are stored, and withheld while page 27 is not reviewed", async () => {
    const { read, stored } = await ingest(P27);
    const line = "GS13N-20P2: Input Rating / CT / Rated Input Current 1.9 A";
    expect(modelLines(read)).toContain(line); // read, so withholding is not vacuous
    const holding = stored.filter((r) => r.content.includes(line));
    expect(holding.length).toBeGreaterThan(0);
    expect(holding.every((r) => r.meta.table_unqualified === true)).toBe(true);
  });
});

describe("GS10 page 26: the rotated footnote mark is read by its size, not its exact string (#5615 Codex F3)", () => {
  it("a space-padded rotated \"2\" reads the page exactly as the captured \"2\" does", async () => {
    const at = P26.items.findIndex((i) => i.vertical && i.str === "2");
    expect(at, "precondition: the capture has the rotated mark").toBeGreaterThan(-1);
    // The padded string changes the layout fingerprint, so give the page the real page 26 rules
    // explicitly (as a matching pin would): only the mark's string differs from the control.
    const rules = (pins as unknown as { documents: Record<string, { pages: Record<string, { rules: unknown }> }> })
      .documents[reviewedP26.sha256].pages["26"].rules;
    const padded = { ...P26, items: P26.items.map((i, k) => (k === at ? { ...i, str: " 2 " } : i)), rules } as Page;
    const control = (await ingest(P26)).read;
    const read = (await ingest(padded)).read;
    expect(modelLines(control)).toContain("GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A");
    expect(scopeDigest(read)).toBe(scopeDigest(control));
  });
});

// The owner's review of page 26 (#5232, 2026-11-18): the approved identity, written out here and
// not read from the pin file or the fixture, so neither can be changed to make this pass.
const APPROVED = {
  digest: "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5",
  fingerprint: "b0a1fef1bf04c8b095735fd2edc9db31933b1bd083756735a0f71498351c4c9d",
  files: ["090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4", "90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab"],
};
const LINE_5_1 = "GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A";
type PinPage = { fingerprint: string; reviewed?: string };
const pinDocs = (pins as unknown as { documents: Record<string, { pages: Record<string, PinPage> }> }).documents;
const reviewedRecords = Object.entries(pinDocs).flatMap(([sha, doc]) =>
  Object.entries(doc.pages).filter(([, pin]) => pin.reviewed !== undefined).map(([page, pin]) => ({ sha, page, ...pin })));

describe("drift guard: page 26 answers only while it is exactly the page the owner reviewed", () => {
  it("on the two approved files only page 26 is reviewed, with the approved layout and digest", () => {
    for (const sha of APPROVED.files) {
      expect(reviewedRecords.filter((r) => r.sha === sha).map(({ page, fingerprint, reviewed }) => ({ page, fingerprint, reviewed })))
        .toEqual([{ page: "26", fingerprint: APPROVED.fingerprint, reviewed: APPROVED.digest }]);
    }
  });
  it("the approved digest is recorded for no other file or page", () => {
    expect(reviewedRecords.filter((r) => r.reviewed === APPROVED.digest).map((r) => `${r.sha}:${r.page}`).sort())
      .toEqual(APPROVED.files.map((sha) => `${sha}:26`).sort());
  });
  it("the captured page 26 still has the approved layout", () => {
    expect(layoutFingerprint(P26.items)).toBe(APPROVED.fingerprint);
  });
  it("the reader still produces exactly the approved rows (a failure here means page 26 must be reviewed again)", async () => {
    const { read } = await ingest(P26);
    expect(read.filter(affirmsModel).map((r) => r.content)).toEqual(reviewedP26.rows.map((r) => r.content));
    expect(scopeDigest(read)).toBe(APPROVED.digest);
    expect(reviewedP26.digest).toBe(APPROVED.digest);
  });
  it.each(APPROVED.files)("shipped pins, file %s: 5.1 A answers GS11N-20P2 only, from page 26, under Input Rating / CT", async (sha) => {
    const { read, stored } = await ingest(P26, undefined, sha, true);
    expect(gated.filter((g) => g.input.length > 0).map((g) => g.reviewed)).toEqual([APPROVED.digest]); // the gate was handed the approved record
    // Nothing withheld on the reviewed page: every row as read, the released ones stamped with the digest.
    expect(gated.flatMap((g) => g.output).map((row) => ({ ...row, tableReviewed: undefined }))).toEqual(gated.flatMap((g) => g.input));
    const released = stored.filter((r) => r.meta.table_unqualified !== true && (r.meta.table_models as string[] | undefined)?.length === 1);
    expect(released).toHaveLength(10);
    expect(released.map((r) => r.meta.table_reviewed)).toEqual(Array(10).fill(APPROVED.digest));
    // Bound to the file it was read from: the SHA-256 of the bytes the writer was handed.
    expect(released.map((r) => r.meta.table_reviewed_sha)).toEqual(Array(10).fill(createHash("sha256").update(STUB).digest("hex")));
    expect(stored.filter((r) => r.meta.table_reviewed !== undefined)).toHaveLength(10);
    const own = stored.filter((r) => r.content.includes(LINE_5_1));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ page: 26 });
    expect(own[0].meta.table_models).toEqual(["GS11N20P2"]);
    expect(own[0].meta.table_unqualified).toBeUndefined();
    expect(own[0].content).toContain("GS11N-20P2: Input Rating / VT / Rated Input Current 5.8 A");
    // No other model is stated at 5.1 A for CT rated input current.
    expect(modelLines(read).filter((l) => / Input Rating \/ CT \/ Rated Input Current 5\.1 A$/.test(l))).toEqual([LINE_5_1]);
    expect(stored.filter((r) => r.content.includes("5.1 A") && r.meta.table_unqualified !== true)
      .every((r) => (r.meta.table_models as string[]).join() === "GS11N20P2")).toBe(true);
  });
});

describe("controls: everything the owner did not review stays withheld", () => {
  const affirmsStored = (r: Stored) => affirmsModel({ content: r.content, tableModels: r.meta.table_models as string[] | undefined,
    tableUnqualified: r.meta.table_unqualified as boolean | undefined, tableScope: r.meta.table_scope as ScopedRow["tableScope"] });
  const withheldOnly = (rows: Stored[]) => rows.filter((r) => r.content.includes(LINE_5_1)).every((r) => r.meta.table_unqualified === true);
  it("a review recorded for the page as it was read before #5615 does not carry over", async () => {
    // The digest of page 26 as the 117860bce reader read it (the candidate record before #5615).
    const before = "5a68f20d187c128b083ef8a1c663b6b30a8e8317efecc244dc9f94dcc3bb2b87";
    expect(APPROVED.digest).not.toBe(before);
    const { stored } = await ingest(P26, before);
    expect(stored.some((r) => r.content.includes(LINE_5_1))).toBe(true); // stored, so withholding is not vacuous
    expect(withheldOnly(stored)).toBe(true);
  });
  it("the same page under another pinned GS10 file that was not approved affirms nothing", async () => {
    const other = "eca93c34";
    const sha = Object.keys(pinDocs).find((k) => k.startsWith(other))!;
    expect(sha, "precondition: another pinned GS10 file").toBeDefined();
    expect(APPROVED.files).not.toContain(sha);
    const { read, stored } = await ingest(P26, undefined, sha, true);
    // Without this file's own pin the table ends at the first group cell; the reader still affirms
    // the model columns above it, so the gate has something to withhold.
    expect(read.filter(affirmsModel).length).toBeGreaterThan(0);
    expect(stored.some((r) => r.content.includes("Rated Input Current"))).toBe(true); // the text is kept
    expect(stored.filter(affirmsStored)).toEqual([]);
  });
  it("a file that is not pinned at all affirms nothing", async () => {
    const { read, stored } = await ingest(P26, undefined, "1".repeat(64), true);
    expect(read.filter(affirmsModel).length).toBeGreaterThan(0);
    expect(stored.some((r) => r.content.includes("Rated Input Current"))).toBe(true);
    expect(stored.filter(affirmsStored)).toEqual([]);
  });
  it("page 26 with one value changed is not the reviewed page and affirms nothing", async () => {
    const at = P26.items.findIndex((i) => i.str.trim() === "5.1");
    expect(at, "precondition: the capture prints 5.1").toBeGreaterThan(-1);
    const changed = { ...P26, items: P26.items.map((i, k) => (k === at ? { ...i, str: i.str.replace("5.1", "5.7") } : i)) } as Page;
    const { read, stored } = await ingest(changed, undefined, APPROVED.files[0], true);
    expect(read.filter(affirmsModel).length).toBeGreaterThan(0); // the reader affirms, so withholding is not vacuous
    expect(stored.filter(affirmsStored)).toEqual([]);
  });
  it.each(APPROVED.files.flatMap((sha) => [25, 27, 30].map((page) => [sha, page] as const)))(
    "the approved page 26 content presented as page %s:%i affirms nothing (a pin binds its own page number)", async (sha, page) => {
      const { read, stored } = await ingest({ ...P26, page }, undefined, sha, true);
      expect(gated.filter((g) => g.input.length > 0).map((g) => g.reviewed)).toEqual([null]);
      expect(read.filter(affirmsModel).length).toBeGreaterThan(0); // the reader affirms, so withholding is not vacuous
      expect(stored.filter(affirmsStored)).toEqual([]);
    });
  it("reviewed for exactly these rows by a test-supplied record: the gate's own affirm path", async () => {
    const digest = scopeDigest((await ingest(P26)).read);
    const { stored } = await ingest(P26, digest);
    expect(stored.filter((r) => r.content.includes(LINE_5_1)).map((r) => r.meta.table_models)).toEqual([["GS11N20P2"]]);
  });
});
