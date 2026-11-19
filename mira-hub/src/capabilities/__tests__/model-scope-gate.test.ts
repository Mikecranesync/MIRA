/**
 * Model scope fails closed (#5503). The real gate, through the real writer.
 *
 * Only the PDF and SQL boundaries are simulated. Page text and positions are captured from the
 * real files; the gate, the pins and the page reader are production code. Every "withheld" case
 * first asserts that the reader DID affirm something on that page, so a reader that stops
 * affirming cannot make a withholding test pass by itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import micro820 from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import { contactTableBeforeInventory, RELAY_CAPTION_BODY, RELAY_CAPTION_PRINTED, relayOnlyInventory } from "../__fixtures__/micro820-relay-subset";
import gs10p26 from "../__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import reviewedP26 from "../__fixtures__/reviewed-pages/gs10-rev-b-p26.reviewed.json";
import pins from "../table-rule-pins.json";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { affirmsModel, gatePageRows, scopeDigest, withheld, type ScopedRow } from "../model-scope-gate";

vi.hoisted(() => { process.env.NODE_EMBED_ON_WRITE = "0"; });

type Page = { page: number; text: string; items: Array<{ str: string; x: number; y: number; w: number; size: number }> };
/** `pinnedFrom`: the pages the pin was captured from, when they differ from what the PDF now reads. */
const pdf = vi.hoisted(() => ({ pages: [] as Page[], pinnedFrom: null as Page[] | null, sha: null as string | null, reviewed: undefined as string | undefined }));
/** Every page's rows as the writer handed them to the gate, and as the gate returned them. */
const gated = vi.hoisted(() => [] as Array<{ input: ScopedRow[]; output: ScopedRow[] }>);

vi.mock("../model-scope-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model-scope-gate")>();
  return { ...actual, gatePageRows: <Row extends ScopedRow>(rows: readonly Row[], reviewed: string | null | undefined) => {
    const output = actual.gatePageRows(rows, reviewed);
    gated.push({ input: [...rows], output });
    return output;
  } };
});
// "These bytes are that manual": the stub bytes stand for the file whose SHA-256 a test names.
// The page then gets that file's REAL pin, found by the real fingerprint of its text positions.
vi.mock("../table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../table-rule-pins")>();
  const { pinsDouble } = await import("../__fixtures__/pinned-rules-double");
  return { ...actual, rulePinsForSha: () => {
    if (!pdf.sha) return null;
    const pins = pinsDouble(actual, pdf.pinnedFrom ?? pdf.pages, [pdf.sha]);
    if (pdf.reviewed === undefined) return pins;
    return Object.fromEntries(Object.entries(pins).map(([k, pin]) => [k, { ...pin, reviewed: pdf.reviewed }]));
  } };
});
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
const asScoped = (r: Stored): ScopedRow => ({ content: r.content, tableModels: r.meta.table_models as string[] | undefined,
  tableUnqualified: r.meta.table_unqualified as boolean | undefined, tableScope: r.meta.table_scope as ScopedRow["tableScope"], tableHeader: r.meta.table_header as string | undefined });

async function ingest(pages: Page[], sha: string | null, reviewed?: string, pinnedFrom: Page[] | null = null) {
  captured.length = 0; gated.length = 0;
  pdf.pages = pages; pdf.sha = sha; pdf.reviewed = reviewed; pdf.pinnedFrom = pinnedFrom;
  vi.resetModules();
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", nodeId: "node-1", unsPath: null,
    filename: "manual.pdf", buffer: Buffer.from("%PDF stub standing for the named file") });
  return stored();
}
const affirmedIn = (rows: ScopedRow[]) => rows.filter(affirmsModel).length;
const contents = (rows: ScopedRow[]) => rows.map((r) => r.content);
const P26 = [{ page: 26, text: gs10p26.text, items: gs10p26.items }] as Page[];

beforeEach(() => { captured.length = 0; gated.length = 0; });

describe("the gate on its own", () => {
  const rows: ScopedRow[] = [
    { content: "intro" },
    { content: "A: 1 V", tableModels: ["A"] },
    { content: "caption text", tableModels: ["A", "B"], tableScope: "section" },
    { content: "shared text", tableScope: "shared", tableHeader: "A B" },
    { content: "line", tableModels: ["A", "B"], tableUnqualified: true },
  ];
  it("keeps a page's rows only when the reviewed digest is the digest of what they affirm", () => {
    const digest = scopeDigest(rows);
    const out = gatePageRows(rows, digest);
    expect(out.map((row) => ({ ...row, tableReviewed: undefined }))).toEqual(rows);
    expect(affirmedIn(out)).toBe(3);
    expect(scopeDigest(out)).toBe(digest);
  });
  it("stamps every released row with the digest it was released under, and only those rows (#5646 r3 F1)", () => {
    const digest = scopeDigest(rows);
    const out = gatePageRows(rows, digest);
    expect(out.map((r) => r.tableReviewed ?? null)).toEqual([null, digest, digest, digest, null]);
    // A withheld page carries no release stamp at all.
    expect(gatePageRows(rows, null).some((r) => r.tableReviewed !== undefined)).toBe(false);
    expect(gatePageRows(rows, scopeDigest(rows.slice(0, 2))).some((r) => r.tableReviewed !== undefined)).toBe(false);
  });
  it.each([["not a reviewed page", null], ["no record", undefined], ["another page's digest", scopeDigest(rows.slice(0, 2))], ["a short string", "abc"]])(
    "withholds every affirming row and keeps all text: %s", (_why, reviewed) => {
      const out = gatePageRows(rows, reviewed as string | null | undefined);
      expect(affirmedIn(rows)).toBe(3);
      expect(affirmedIn(out)).toBe(0);
      expect(contents(out)).toEqual(contents(rows));
    });
  it("withholds by the rule retrieval reads: models kept, unqualified or unresolved, shared passage unresolved", () => {
    expect(withheld(rows[1])).toEqual({ content: "A: 1 V", tableModels: ["A"], tableUnqualified: true });
    expect(withheld(rows[2])).toEqual({ content: "caption text", tableModels: ["A", "B"], tableScope: "unresolved", tableUnqualified: true, tableHeader: undefined });
    expect(withheld(rows[3])).toEqual({ content: "shared text", tableScope: "unresolved", tableUnqualified: true, tableHeader: undefined });
    expect(withheld(rows[4])).toBe(rows[4]);
  });
  it("one changed value in an affirming row changes the digest; a change outside affirming rows does not", () => {
    const changed = rows.map((r, i) => (i === 1 ? { ...r, content: "A: 2 V" } : r));
    expect(scopeDigest(changed)).not.toBe(scopeDigest(rows));
    const prose = rows.map((r, i) => (i === 0 ? { ...r, content: "other intro" } : r));
    expect(scopeDigest(prose)).toBe(scopeDigest(rows));
  });
});

describe("through the writer: a page nobody reviewed affirms no model", () => {
  it("the captured Micro820 pages (pinned file, not reviewed) store their text with no model affirmed", async () => {
    const rows = await ingest(micro820.pages as Page[], micro820.sha256);
    const input = gated.flatMap((g) => g.input);
    expect(affirmedIn(input)).toBeGreaterThan(0); // precondition: the reader DID affirm on these pages
    expect(rows.length).toBeGreaterThan(0);
    expect(affirmedIn(rows.map(asScoped))).toBe(0);
    expect(contents(gated.flatMap((g) => g.output))).toEqual(contents(input));
  });
  it("GS10 page 26 in a file that is not pinned affirms nothing", async () => {
    const rows = await ingest(P26, null);
    expect(affirmedIn(gated.flatMap((g) => g.input))).toBe(5);
    expect(affirmedIn(rows.map(asScoped))).toBe(0);
  });
  it("GS10 page 26 whose text positions moved by one item affirms nothing", async () => {
    // The pin (and its reviewed digest) is the one captured from the original page; only the text
    // positions the PDF now yields differ, by one item.
    const moved = [{ ...P26[0], items: P26[0].items.map((i, n) => (n === 0 ? { ...i, x: i.x + 0.5 } : i)) }];
    const rows = await ingest(moved, reviewedP26.sha256, reviewedP26.digest, P26);
    expect(affirmedIn(gated.flatMap((g) => g.input))).toBe(5);
    expect(affirmedIn(rows.map(asScoped))).toBe(0);
  });
  it("GS10 page 26 whose reviewed record is for other rows affirms nothing", async () => {
    const rows = await ingest(P26, reviewedP26.sha256, scopeDigest([{ content: "x", tableModels: ["A"] }]));
    expect(affirmedIn(gated.flatMap((g) => g.input))).toBe(10); // five models, two chunks each
    expect(affirmedIn(rows.map(asScoped))).toBe(0);
  });
});

const relayRatings = (r: { content: string }) => /\b15 A\b/.test(r.content) && /\b1\.5 A\b/.test(r.content);
describe("through the writer: a relay inventory that lists only some variants (#5510 F16)", () => {
  it("the modified page lists AWB and QWB as relay and no QBB column (precondition)", () => {
    const p16 = relayOnlyInventory(micro820.pages as Page[]).find((p) => p.page === 16)!;
    const strs = p16.items.map((i) => i.str);
    expect(strs).toEqual(expect.arrayContaining(["2080-LC20-20AWB(R)", "2080-LC20-20QWB(R)"]));
    expect(strs.some((s) => s.includes("QBB"))).toBe(false);
    expect(strs.filter((s) => s === "Relay")).toHaveLength(2);
    expect(strs).not.toContain("24V DC source");
  });
  it("the reader builds the all-relay AWB/QWB inventory from it (precondition)", async () => {
    await ingest(relayOnlyInventory(micro820.pages as Page[]), micro820.sha256);
    const inventory = gated.flatMap((g) => g.input).filter((r) => affirmsModel(r) && /: Output circuit type Relay$/m.test(r.content));
    expect(inventory.map((r) => r.tableModels).sort()).toEqual([["2080LC2020AWB"], ["2080LC2020QWB"]]);
  });
  for (const [why, pages] of [["subset inventory", relayOnlyInventory(micro820.pages as Page[])], ["complete inventory (control)", micro820.pages as Page[]]] as const) {
    it(`${why}: the relay ratings are stored, never as plain text any model may read`, async () => {
      const rows = await ingest(pages, micro820.sha256);
      const relay = rows.filter((r) => r.page === 19 && relayRatings(r));
      expect(relay.length).toBeGreaterThan(0); // the text is preserved
      for (const r of relay) {
        const scoped = asScoped(r);
        expect(scoped.tableModels?.length || scoped.tableScope, r.content.slice(0, 80)).toBeTruthy();
        expect(affirmsModel(scoped)).toBe(false);
        // Only an unresolved, withheld row may name QBB; a scoped row never applies to it.
        if (scoped.tableScope !== "unresolved") expect(scoped.tableModels ?? []).not.toContain("2080LC2020QBB");
        else expect(scoped.tableUnqualified).toBe(true);
      }
    });
  }
});

describe("through the writer: a contact table whose caption typography fails (#5510 F17)", () => {
  for (const inventory of ["complete", "subset", "absent"] as const) {
    for (const size of [RELAY_CAPTION_BODY, RELAY_CAPTION_PRINTED]) {
      it(`${inventory} inventory, caption ${size} pt: the contact values are stored withheld, never as plain text`, async () => {
        const rows = await ingest(contactTableBeforeInventory(micro820.pages as Page[], inventory, size), micro820.sha256);
        const contact = rows.filter((r) => r.page === 2 && /\b15 A\b|\b1\.5 A\b|columns read from the page layout/.test(r.content));
        expect(contact.length).toBeGreaterThan(0); // the text is preserved
        for (const r of contact) {
          const scoped = asScoped(r);
          expect(affirmsModel(scoped)).toBe(false);
          expect(scoped.tableScope === "unresolved" || (scoped.tableModels?.length ?? 0) > 0, r.content.slice(0, 80)).toBe(true);
        }
      });
    }
  }
});

type Gold = { model: string; property: string; condition: string | null; unit: string | null; value: string };
const norm = (t: string) => t.replace(/[\s\u2013\u2014-]+/g, "").toLowerCase();
/** A stored model line is backed when gold for THAT model gives this property, under this
 *  condition, exactly this value and unit: the line's value is a whole token, not a substring.
 *  Same rule as the frozen benchmark's scorer (.planning/2026-11-16-model-assisted-tables). */
function backed(gold: readonly Gold[], line: string): boolean {
  const at = line.indexOf(": ");
  if (at < 0) return false;
  const model = line.slice(0, at), rest = norm(line.slice(at + 2));
  return gold.some((g) => {
    if (g.model !== model || !rest.includes(norm(g.property))) return false;
    // As the frozen benchmark scorer judges it: the condition's last segment ("Input Rating / CT" -> "CT").
    const condition = g.condition?.split("/").pop()?.trim();
    if (condition && !rest.includes(norm(condition))) return false;
    const tail = norm(g.value) + norm(g.unit ?? "");
    if (!rest.endsWith(tail)) return false;
    const before = rest.slice(0, rest.length - tail.length);
    return !/[0-9.\/]$/.test(before);
  });
}
const affirmedLines = (rows: ScopedRow[]) => rows.filter(affirmsModel).flatMap((r) => r.content.split("\n").slice(1).filter((l) => l.trim().length > 0));

describe("the exact gold check a page must pass before it is recorded as reviewed", () => {
  const gold = reviewedP26.gold as Gold[];
  it("backs a line only for its own model, condition, value and unit", () => {
    expect(backed(gold, "GS11N-20P2: CT Rated Input Current 5.1 A")).toBe(true);
    expect(backed(gold, "GS11N-20P2: CT Rated Input Current 7.3 A")).toBe(false);   // the sibling's value
    expect(backed(gold, "GS11N-20P5: CT Rated Input Current 5.1 A")).toBe(false);   // another model
    expect(backed(gold, "GS11N-20P2: VT Rated Input Current 5.1 A")).toBe(false);   // another condition
    expect(backed(gold, "GS11N-20P2: CT Rated Input Current 15.1 A")).toBe(false);  // value inside a longer one
    expect(backed(gold, "GS11N-20P2: Max Motor Output 1/4 hp")).toBe(false);        // its group label is missing
  });
  it("backs a line only with the group and duty labels the page prints", () => {
    expect(backed(gold, "GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A")).toBe(true);
    expect(backed(gold, "GS11N-20P2: Input Rating / VT / Rated Input Current 5.1 A")).toBe(false); // the other duty
    expect(backed(gold, "GS11N-20P2: Output Rating / Max Motor Output 1/4 hp")).toBe(true);
  });
  it("GS10 page 26 as read now: all 90 lines pass the exact gold check, and the page is the owner-reviewed one", async () => {
    // The check is the frozen benchmark scorer's, unchanged. The fixture's gold was corrected to the
    // printed page (25 entries: a unit the page prints once is no longer recorded twice, nor in the
    // label); every entry is verified against the source PDF's word positions. Passing the check
    // did not record the page as reviewed: the owner's source review did (#5232, 2026-11-18).
    const rows = await ingest(P26, reviewedP26.sha256, reviewedP26.digest);
    const lines = affirmedLines(rows.map(asScoped)).filter((l) => !/\(cont\.\)$/.test(l));
    expect(lines).toHaveLength(90);
    expect(lines.filter((l) => !backed(gold, l))).toEqual([]);
    expect(new Set(lines).size).toBe(90);
    expect(lines).toContain("GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A");
    expect(reviewedP26.status).toBe("reviewed");
  });
  it("the corrected gold still rejects a line that misstates the printed unit", () => {
    expect(backed(gold, "GS11N-20P2: IE2 Efficiency - Relative Power Loss 4.7")).toBe(false);
    expect(backed(gold, "GS11N-20P2: Weight 0.4 lb")).toBe(false);
    expect(backed(gold, "GS11N-20P2: Input Rating / Operating Voltage Range 170–265 Hz")).toBe(false);
    expect(backed(gold, "GS11N-20P2: Weight 0.4 kg")).toBe(true);
  });
});

describe("a reviewed record exists only for a page that passes the exact gold check", () => {
  const dir = join(__dirname, "../__fixtures__/reviewed-pages");
  const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as
    { sha256: string; alsoSha256?: string[]; page: number; status: string; digest: string; rows: ScopedRow[]; gold: Gold[] });
  /** Every file a fixture stands for: its own hash and the files that render the page identically. */
  const shasOf = (f: (typeof fixtures)[number]) => [f.sha256, ...(f.alsoSha256 ?? [])];
  const recorded = Object.entries((pins as unknown as { documents: Record<string, { pages: Record<string, { reviewed?: string }> }> }).documents)
    .flatMap(([sha, doc]) => Object.entries(doc.pages).filter(([, pin]) => pin.reviewed !== undefined).map(([page, pin]) => ({ sha, page: Number(page), reviewed: pin.reviewed! })));
  it("every reviewed record has a reviewed fixture with the same digest", () => {
    for (const r of recorded) {
      const f = fixtures.find((x) => shasOf(x).includes(r.sha) && x.page === r.page && x.status === "reviewed");
      expect(f, `${r.sha.slice(0, 12)} p${r.page}`).toBeDefined();
      expect(scopeDigest(f!.rows)).toBe(r.reviewed);
      expect(f!.digest).toBe(r.reviewed);
    }
  });
  it("every reviewed fixture affirms only lines that pass the exact gold check", () => {
    for (const f of fixtures.filter((x) => x.status === "reviewed")) {
      expect(affirmedLines(f.rows).filter((l) => !backed(f.gold, l))).toEqual([]);
      for (const sha of shasOf(f)) expect(recorded.filter((r) => r.sha === sha && r.page === f.page).map((r) => r.reviewed)).toEqual([f.digest]);
    }
  });
  it("a fixture that is not reviewed has no reviewed record", () => {
    for (const f of fixtures.filter((x) => x.status !== "reviewed")) for (const sha of shasOf(f)) expect(recorded.some((r) => r.sha === sha && r.page === f.page)).toBe(false);
    expect(fixtures.length).toBeGreaterThan(0);
  });
});

describe("through the writer: a page with a matching reviewed record stores its rows as read", () => {
  // The gate's affirm path with a reviewed record a test supplies: the digest of exactly the rows
  // the reader produces. The real recorded pin is exercised in gs10-group-labels.test.ts.
  it("GS10 page 26 with a matching record stores its five model columns unchanged", async () => {
    const rows = await ingest(P26, reviewedP26.sha256, reviewedP26.digest);
    expect(rows.map(asScoped).filter(affirmsModel).map((r) => r.tableModels)).toEqual(
      ["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"].flatMap((m) => [[m], [m]])); // two chunks per model
    const output = gated.flatMap((g) => g.output);
    expect(output.map((row) => ({ ...row, tableReviewed: undefined }))).toEqual(gated.flatMap((g) => g.input));
    expect(output.filter(affirmsModel).every((r) => r.tableReviewed === reviewedP26.digest)).toBe(true);
    expect(output.filter((r) => !affirmsModel(r)).some((r) => r.tableReviewed !== undefined)).toBe(false);
  });
});

describe("retrieval reads the release stamp wherever it reads a row's model scope (#5646 r3 F1)", () => {
  it("every SELECT in manual-rag.ts that reads table_models also reads table_reviewed and table_reviewed_sha", () => {
    const source = readFileSync(join(__dirname, "..", "..", "lib", "manual-rag.ts"), "utf8");
    const lines = source.split("\n").filter((l) => l.includes("AS table_models"));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) expect(line).toContain("metadata->>'table_reviewed' AS table_reviewed, metadata->>'table_reviewed_sha' AS table_reviewed_sha");
  });
  it("every passage query in manual-rag.ts carries the release guard, so a disabled approval reaches no answer (#5646 r4 F1)", () => {
    const lines = readFileSync(join(__dirname, "..", "..", "lib", "manual-rag.ts"), "utf8").split("\n");
    // Each retrieval SELECT (the lines reading table_models), up to its LIMIT, must add the guard.
    const starts = lines.flatMap((l, i) => (l.includes("AS table_models") ? [i] : []));
    expect(starts.length).toBeGreaterThanOrEqual(5);
    for (const start of starts) {
      const end = lines.findIndex((l, i) => i > start && /\bLIMIT\b/.test(l));
      expect(end, `LIMIT after line ${start + 1}`).toBeGreaterThan(start);
      expect(lines.slice(start, end).some((l) => /AND \$\{releaseGuard(On)?\}/.test(l)), `guard in the query at line ${start + 1}`).toBe(true);
    }
    // The cited-page read (safety statements) returns passages too.
    const cited = lines.findIndex((l) => l.startsWith("export async function retrieveCitedPageChunks("));
    const next = lines.findIndex((l, i) => i > cited && l.startsWith("}"));
    expect(cited).toBeGreaterThan(-1);
    expect(lines.slice(cited, next).some((l) => l.includes("AND ${activeReleaseSql()}"))).toBe(true);
  });
});
