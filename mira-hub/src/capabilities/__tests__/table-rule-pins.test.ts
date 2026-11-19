import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import gs10p26 from "../__fixtures__/table-rows/gs10-p26-230v-1ph.json";
import gs10p27 from "../__fixtures__/table-rows/gs10-p27-230v-3ph.json";
import micro820 from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import ml1100 from "../__fixtures__/table-rows/ml1100-p114-p120-ratings-scope.json";
import pinFile from "../table-rule-pins.json";
import { activeReleaseSql, allRulePins, isReleaseActive, pinnedRules, reviewedRowsDigest, rulePinsForSha, rulesCrossing } from "../table-rule-pins";
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
      // The approval is released or not by the pin's own switch; CI holds either configured state.
      const enabled = pins!["26"].release === "enabled";
      expect(reviewedRowsDigest(pins, 26, gs10p26.items)).toBe(enabled ? approved : null);
      for (const page of [2, 25, 27, 28, 30]) expect(reviewedRowsDigest(pins, page, gs10p26.items)).toBeNull();
      expect(reviewedRowsDigest(pins, 26, gs10p26.items.slice(1))).toBeNull(); // the layout must match
      expect(reviewedRowsDigest(pins, 27, gs10p27.items)).toBeNull(); // page 27's own layout, not reviewed
    }
    // Another pinned GS10 file (same table at its own page numbers) carries no review.
    const other = Object.keys(pinFile.documents).find((k) => k.startsWith("eca93c34"))!;
    for (const page of [11, 12, 26]) expect(reviewedRowsDigest(rulePinsForSha(other), page, gs10p26.items)).toBeNull();
    expect(reviewedRowsDigest(null, 26, gs10p26.items)).toBeNull();
  });

  it("a stored release is honoured only while the pin of ITS file and page still carries its digest (#5646 r3 F1)", () => {
    const approved = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5";
    const second = "90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab";
    for (const sha of [GS10, second]) {
      const enabled = rulePinsForSha(sha)!["26"].release === "enabled";
      expect(isReleaseActive(sha, 26, approved)).toBe(enabled);
      expect(isReleaseActive(sha, "26", approved)).toBe(enabled); // a page read back from SQL as text
      for (const page of [25, 27, 0, -26, 26.5, Number.NaN, null, undefined]) expect(isReleaseActive(sha, page as never, approved)).toBe(false);
      for (const digest of [approved.replace(/^d/, "e"), approved.slice(1), "", null, undefined, 42]) {
        expect(isReleaseActive(sha, 26, digest as never)).toBe(false);
      }
    }
    // The same digest is not honoured for another file, or for a release with no file.
    const other = Object.keys(pinFile.documents).find((k) => k.startsWith("eca93c34"))!;
    for (const sha of [other, "0".repeat(64), "", null, undefined]) expect(isReleaseActive(sha as never, 26, approved)).toBe(false);
    // A layout fingerprint is not a reviewed digest.
    const fingerprint = (pinFile.documents as Record<string, { pages: Record<string, { fingerprint: string }> }>)[GS10].pages["26"].fingerprint;
    expect(isReleaseActive(GS10, 26, fingerprint)).toBe(false);
  });

  it("the approval switch: one pin record, released while enabled, withdrawn while disabled, no deletion (#5646 r4 F2)", () => {
    const approved = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5";
    const shipped = rulePinsForSha(GS10)!;
    expect(shipped["26"].reviewed).toBe(approved); // the approved digest stays recorded in both states
    const withState = (release: unknown) => ({ ...shipped, "26": { ...shipped["26"], release } }) as never;
    const active = (release: unknown) => isReleaseActive(GS10, 26, approved, () => withState(release));
    const digest = (release: unknown) => reviewedRowsDigest(withState(release), 26, gs10p26.items);
    // enabled -> disabled -> enabled -> disabled, on the same record: the switch alone decides.
    for (const [release, on] of [["enabled", true], ["disabled", false], ["enabled", true], ["disabled", false]] as const) {
      expect(active(release)).toBe(on);
      expect(digest(release)).toBe(on ? approved : null);
    }
    // Fail closed: a record with no switch, or anything but the exact word "enabled", releases nothing.
    for (const release of [undefined, null, true, "Enabled", "enabled ", "on", 1]) {
      expect(active(release)).toBe(false);
      expect(digest(release)).toBeNull();
    }
  });

  it("the SQL release guard admits exactly the enabled file, page and digest triples (#5646 r4 F1)", () => {
    const approved = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5";
    const second = "90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab";
    const all = allRulePins();
    type Docs = Record<string, Record<string, object>>;
    const set = (base: Docs, sha: string, release: string): Docs => ({ ...base, [sha]: { ...base[sha], "26": { ...base[sha]["26"], release } } });
    const states = (a: string, b: string) => set(set(all as Docs, GS10, a), second, b) as never;
    const both = activeReleaseSql("", states("enabled", "enabled"));
    const enabled = (sql: string) => [GS10, second].filter((sha) => sql.includes(`('${sha}', '26', '${approved}')`));
    expect(enabled(both).sort()).toEqual([GS10, second].sort());
    expect(enabled(activeReleaseSql("", states("disabled", "enabled")))).toEqual([second]);
    expect(enabled(activeReleaseSql("", states("enabled", "disabled")))).toEqual([GS10]);
    const none = activeReleaseSql("", states("disabled", "disabled"));
    expect(none).toBe("(metadata->>'table_reviewed' IS NULL)"); // no enabled approval: no stamped row qualifies
    expect(both.startsWith("(metadata->>'table_reviewed' IS NULL OR (metadata->>'table_reviewed_sha', COALESCE(page_start, source_page)::text, metadata->>'table_reviewed') IN (")).toBe(true);
    expect(activeReleaseSql("k", states("enabled", "enabled"))).toContain("k.metadata->>'table_reviewed' IS NULL OR (k.metadata->>'table_reviewed_sha', COALESCE(k.page_start, k.source_page)::text");
    for (const alias of ["k;", "K", "1k", "k.x", "k k"]) expect(() => activeReleaseSql(alias)).toThrow();
    // Nothing but validated hex and digits reaches the SQL.
    const hostile = { ["x'); DROP TABLE t; --"]: { "26": { fingerprint: approved, rules: [], reviewed: approved, release: "enabled" } },
      [GS10]: { "26'--": { fingerprint: approved, rules: [], reviewed: approved, release: "enabled" }, "27": { fingerprint: approved, rules: [], reviewed: "zz'", release: "enabled" } } };
    expect(activeReleaseSql("", hostile as never)).toBe("(metadata->>'table_reviewed' IS NULL)");
  });

  it("every reviewed record carries the switch, and only reviewed records do", () => {
    const states: string[] = [];
    for (const document of Object.values(pinFile.documents)) {
      for (const pin of Object.values(document.pages) as Array<{ reviewed?: string; release?: string }>) {
        if (pin.reviewed === undefined) expect(pin.release).toBeUndefined();
        else { expect(["enabled", "disabled"]).toContain(pin.release); states.push(pin.release!); }
      }
    }
    expect(states).toHaveLength(2); // the two approved GS10 files, page 26
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
