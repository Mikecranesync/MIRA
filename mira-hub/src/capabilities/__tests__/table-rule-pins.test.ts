import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import gs10p26 from "../__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p27 from "../__fixtures__/table-rows/gs10-p27-230v-3ph.json";
import micro820 from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import ml1100 from "../__fixtures__/table-rows/ml1100-p114-p120-ratings-scope.json";
import pinFile from "../table-rule-pins.json";
import { isReviewedDigestActive, pinnedRules, reviewedRowsDigest, rulePinsForSha, rulesCrossing } from "../table-rule-pins";
import { pageLayoutItems } from "../pdf-layout-items";

// #5503 F14/F15: table rules are pinned data, never read from a page's drawing. Nothing here is
// mocked except the PDF and SQL boundaries of the writer test at the end.
const GS10 = "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4";
const CAPTURED = [
  ["GS10 rev B page 26", GS10, 26, gs10p26.items],
  ["GS10 rev B page 27", GS10, 27, gs10p27.items],
  ["Micro820 page 16", micro820.sha256, 16, micro820.pages.find((p) => p.page === 16)!.items],
  ["MicroLogix 1100 page 111", ml1100.sha256, 111, ml1100.pages.find((p) => p.page === 111)!.items],
] as const;

describe("pinned table rules: the real pin file", () => {
  it.each(CAPTURED)("%s: the captured page still matches its pin", (_name, sha, page, items) => {
    const rules = pinnedRules(rulePinsForSha(sha), page, items);
    expect(rules).not.toBeNull();
    expect(rules!.length).toBeGreaterThan(0);
  });

  it("a file that is not pinned has no pins, whatever its pages hold", () => {
    expect(rulePinsForSha("0".repeat(64))).toBeNull();
    expect(rulePinsForSha(GS10.toUpperCase())).toBeNull();
    for (const key of ["__proto__", "constructor", "toString", "documents", ""]) expect(rulePinsForSha(key)).toBeNull();
    expect(pinnedRules(null, 26, gs10p26.items)).toBeNull();
  });

  it("a pin applies to its own page number only", () => {
    const pins = rulePinsForSha(GS10);
    expect(pinnedRules(pins, 27, gs10p26.items)).toBeNull();
    expect(pinnedRules(pins, 2, gs10p26.items)).toBeNull();
    for (const key of [Number.NaN, -1, 0]) expect(pinnedRules(pins, key, gs10p26.items)).toBeNull();
    expect(pinnedRules({ ...pins } as never, "__proto__" as never, gs10p26.items)).toBeNull();
  });

  it.each([
    ["one item moved by 0.02 pt across", (items: typeof gs10p26.items) => items.map((item, i) => i === 40 ? { ...item, x: item.x + 0.02 } : item)],
    ["one item moved by 0.02 pt down", (items: typeof gs10p26.items) => items.map((item, i) => i === 40 ? { ...item, y: item.y - 0.02 } : item)],
    ["one character changed", (items: typeof gs10p26.items) => items.map((item, i) => i === 40 ? { ...item, str: item.str + "x" } : item)],
    ["one item removed", (items: typeof gs10p26.items) => items.filter((_, i) => i !== 40)],
    ["one item added (a new title line)", (items: typeof gs10p26.items) => [...items, { str: "24 V DC Outputs", x: 280, y: 300, w: 60, size: 8 }]],
    ["two items swapped in order", (items: typeof gs10p26.items) => items.map((item, i) => i === 40 ? items[41] : i === 41 ? items[40] : item)],
    ["text moved between two items", (items: typeof gs10p26.items) => items.map((item, i) => i === 40 ? { ...item, str: item.str + items[41].str } : i === 41 ? { ...item, str: "" } : item)],
    ["no items", () => []],
  ] as const)("a pinned page whose text geometry differs gets no rules: %s", (_name, change) => {
    expect(pinnedRules(rulePinsForSha(GS10), 26, change(gs10p26.items))).toBeNull();
  });

  it("the reviewed record of GS10 page 26 binds both approved files, page 26 and the captured layout only (#5232)", () => {
    const approved = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5";
    for (const sha of [GS10, "90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab"]) {
      const pins = rulePinsForSha(sha);
      expect(reviewedRowsDigest(pins, 26, gs10p26.items)).toBe(approved);
      for (const page of [2, 25, 27, 28, 30]) expect(reviewedRowsDigest(pins, page, gs10p26.items)).toBeNull();
      expect(reviewedRowsDigest(pins, 26, gs10p26.items.slice(1))).toBeNull(); // the layout must match
      expect(reviewedRowsDigest(pins, 27, gs10p27.items)).toBeNull(); // page 27's own layout, not reviewed
    }
    // Another pinned GS10 file (same table at its own page numbers) carries no review.
    const other = Object.keys(pinFile.documents).find((k) => k.startsWith("eca93c34"))!;
    for (const page of [11, 12, 26]) expect(reviewedRowsDigest(rulePinsForSha(other), page, gs10p26.items)).toBeNull();
    expect(reviewedRowsDigest(null, 26, gs10p26.items)).toBeNull();
  });

  it("a stored release stamp is honoured only while the shipped pins still carry its digest (#5646 r3 F1)", () => {
    const approved = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5";
    expect(isReviewedDigestActive(approved)).toBe(true);
    // Exactly the digests the pin file records as reviewed, nothing else.
    const recorded = Object.values(pinFile.documents).flatMap((d) =>
      Object.values(d.pages as Record<string, { reviewed?: string }>).map((p) => p.reviewed).filter(Boolean));
    expect([...new Set(recorded)]).toEqual([approved]);
    for (const other of [approved.replace(/^d/, "e"), approved.slice(1), "", null, undefined, 42, { approved }]) {
      expect(isReviewedDigestActive(other as unknown)).toBe(false);
    }
    // A layout fingerprint is not a reviewed digest.
    const fingerprint = (pinFile.documents as Record<string, { pages: Record<string, { fingerprint: string }> }>)[GS10].pages["26"].fingerprint;
    expect(isReviewedDigestActive(fingerprint)).toBe(false);
  });

  it("every pinned page is well formed", () => {
    const documents = Object.entries(pinFile.documents);
    expect(documents.length).toBeGreaterThan(0);
    for (const [sha, document] of documents) {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
      for (const [page, pin] of Object.entries(document.pages)) {
        expect(page).toMatch(/^[1-9]\d*$/);
        expect(pin.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(pin.rules.length).toBeGreaterThan(0);
        for (const rule of pin.rules) {
          expect([rule.x, rule.y0, rule.y1].every(Number.isFinite)).toBe(true);
          expect(rule.y1 - rule.y0).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  it("a rule runs through a text line only from below its baseline up through its letters", () => {
    const rules = [{ x: 270, y0: 600, y1: 700 }];
    expect(rulesCrossing(rules, 650)).toEqual([0]);
    expect(rulesCrossing(rules, 601)).toEqual([0]);
    expect(rulesCrossing(rules, 600.5)).toEqual([]); // stops at the baseline
    expect(rulesCrossing(rules, 696)).toEqual([0]);
    expect(rulesCrossing(rules, 696.5)).toEqual([]); // only reaches the foot of the letters
  });
});

describe("pinned table rules: reading a page", () => {
  const operatorList = vi.fn(async () => ({ fnArray: [91], argsArray: [[20, [new Float32Array([0, 264.3, 300, 1, 264.3, 720])], new Float32Array([264.3, 300, 264.3, 720])]] }));
  /** A page proxy that offers a real drawn separator; production code must never ask for it. */
  const proxy = (items: ReadonlyArray<{ str: string; x: number; y: number; w: number; size: number }>) => ({
    getPage: async () => ({
      getTextContent: async () => ({ items: items.map((i) => ({ str: i.str, width: i.w, transform: [i.size, 0, 0, i.size, i.x, i.y] })) }),
      getOperatorList: operatorList,
      cleanup: () => true,
    }),
  });
  beforeEach(() => operatorList.mockClear());
  const ruled = (items: Awaited<ReturnType<typeof pageLayoutItems>>) => items.filter((item) => item.vr !== undefined).length;

  it("the pinned file's pinned page carries rules", async () => {
    expect(ruled(await pageLayoutItems(proxy(gs10p26.items), 26, GS10))).toBeGreaterThan(100);
  });

  it.each([
    ["another file's hash", "1".repeat(64), 26],
    ["no hash", undefined, 26],
    ["the pinned file at another page number", GS10, 2],
  ] as const)("the same page content carries no rules under %s", async (_name, sha, page) => {
    expect(ruled(await pageLayoutItems(proxy(gs10p26.items), page, sha))).toBe(0);
  });

  it("a page's drawing is never read", async () => {
    await pageLayoutItems(proxy(gs10p26.items), 26, GS10);
    await pageLayoutItems(proxy(gs10p26.items), 26, "1".repeat(64));
    expect(operatorList).not.toHaveBeenCalled();
  });
});

// The writer: a document is identified by the SHA-256 of exactly the bytes it parses.
const upload = vi.hoisted(() => ({ rows: [] as Array<{ content: string; page: number; metadata: Record<string, unknown> }>, shas: [] as string[],
  items: [] as Array<{ str: string; x: number; y: number; w: number; size: number }>, text: "", operatorListCalls: 0 }));
vi.hoisted(() => { process.env.NODE_EMBED_ON_WRITE = "0"; });
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (page: number) => ({
      getTextContent: async () => ({ items: (page === 26 ? upload.items : []).map((i) => ({ str: i.str, width: i.w, transform: [i.size, 0, 0, i.size, i.x, i.y] })) }),
      getOperatorList: async () => { upload.operatorListCalls++; return { fnArray: [], argsArray: [] }; },
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: 26 }, (_, i) => (i === 25 ? upload.text : "")) })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }> }) => Promise<unknown>) =>
    fn({ query: async (sql: string, params: unknown[]) => {
      if (/INSERT\s+INTO\s+knowledge_entries/.test(sql)) for (let i = 3; i + 3 < params.length; i += 4) {
        upload.rows.push({ content: params[i + 1] as string, page: params[i + 2] as number, metadata: JSON.parse(params[i + 3] as string) });
      }
      return { rows: [] as never[] };
    } })),
}));
vi.mock("../table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../table-rule-pins")>();
  // Records the hash the writer asks about; the answer is the real one.
  return { ...actual, rulePinsForSha: (sha: string) => { upload.shas.push(sha); return actual.rulePinsForSha(sha); } };
});

describe("pinned table rules: the upload writer", () => {
  it("a copy of a pinned page inside a file that is not pinned gets no model scope past a group heading", async () => {
    upload.rows = []; upload.shas = []; upload.operatorListCalls = 0;
    upload.items = gs10p26.items; upload.text = gs10p26.text;
    const bytes = Buffer.from("%PDF-1.4 the real page 26, inside some other file");
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    await writePdfChunksForNode({ tenantId: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", nodeId: "node-1", unsPath: null, filename: "gs10usermanual.pdf", buffer: bytes });
    expect(new Set(upload.shas)).toEqual(new Set([createHash("sha256").update(bytes).digest("hex")]));
    const own = upload.rows.filter((row) => (row.metadata.table_models as string[] | undefined)?.join() === "GS11N20P2" && !row.metadata.table_unqualified);
    expect(own.map((row) => row.content).join("\n")).not.toContain("Rated Input Current");
    expect(upload.rows.map((row) => row.content).join("\n")).toContain("Rated Input Current"); // kept, without a model
    expect(upload.operatorListCalls).toBe(0);
  });
});
