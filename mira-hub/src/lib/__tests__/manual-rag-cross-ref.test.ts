/**
 * Page-reference parsing and target binding for the one-hop expansion (#6030 F2/F3).
 *
 * The formatter (buildGroundedContext) no longer follows references itself: a page found only
 * there would have no source chip. The production reader is capabilities/referenced-pages.ts and
 * these tests exercise its real parser, target binder and read helper. Synthetic text only.
 */
import { describe, expect, it, vi } from "vitest";
import { buildGroundedContext, chunksToSources } from "../manual-rag";
import {
  REFERENCE_MAX_TARGETS,
  extractPageReferences,
  referenceTargets,
  retrieveReferencedPageChunks,
} from "@/capabilities/referenced-pages";
import { makeChunk } from "./test-fixtures";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T = "11111111-1111-4111-8111-111111111111";
const doc = (content: string, page: number, docId = A, url = "a.pdf", label: string | null = String(page)) =>
  makeChunk(content, page, url, { docId, pageLabel: label });

describe("extractPageReferences — what a passage points to", () => {
  it("single references: see / refer to / consult / check page N, with or without a sentence period", () => {
    expect(extractPageReferences("For wiring details, see page 40.").labels).toEqual(["40"]);
    expect(extractPageReferences("Parameter details: refer to page 223").labels).toEqual(["223"]);
    expect(extractPageReferences("consult p. 12 and Check page 9").labels).toEqual(["12", "9"]);
  });

  it("coordinated and plural lists", () => {
    expect(extractPageReferences("See page 15 for specs and page 20 for wiring.").labels).toEqual(["15", "20"]);
    expect(extractPageReferences("See pages 10, 15 and 20 for details.").labels).toEqual(["10", "15", "20"]);
    expect(extractPageReferences("refer to pp. 7 & 9").labels).toEqual(["7", "9"]);
  });

  it("a section number is NOT a page; its independent consult-page control still works", () => {
    const r = extractPageReferences("For calibration, check section 7 and consult page 100.");
    expect(r.labels).toEqual(["100"]);
    expect(r.sectionRefs).toBe(1);
    expect(extractPageReferences("check section 7").labels).toEqual([]);
  });

  it("hyphenated labels are exact labels, never numeric ranges; malformed tokens and the Safety-chapter form do not match", () => {
    expect(extractPageReferences("see page 2-15").labels).toEqual(["2-15"]);
    expect(extractPageReferences("see page 17A").labels).toEqual([]);
    expect(extractPageReferences("see page 17.5 for more").labels).toEqual([]);
    expect(extractPageReferences("WARNING! Read the instructions in chapter Safety on page 17.").labels).toEqual([]);
    expect(extractPageReferences("The drive operates at 480V. Page 40 is blank.").labels).toEqual([]);
  });
});

describe("referenceTargets — bound to the originating document AND file", () => {
  it("manual A -> p20 and manual B -> p40 never become A p40 / B p20", () => {
    const a = doc("see page 20.", 5, A, "a.pdf");
    const b = doc("see page 40.", 5, B, "b.pdf");
    expect(referenceTargets([a, b])).toEqual([
      { docId: A, sourceUrl: "a.pdf", label: "20" },
      { docId: B, sourceUrl: "b.pdf", label: "40" },
    ]);
  });

  it("same URL, different document ids stay separate", () => {
    const x = doc("see page 3.", 1, A, "shared.pdf");
    const y = doc("see page 3.", 1, B, "shared.pdf");
    expect(referenceTargets([x, y]).map((t) => t.docId)).toEqual([A, B]);
  });

  it("a chunk without a document id (shared OEM lane) is not expanded; a self-reference is skipped", () => {
    expect(referenceTargets([makeChunk("see page 8.", 2)])).toEqual([]);
    expect(referenceTargets([doc("see page 5.", 5)])).toEqual([]);
  });

  it("is bounded", () => {
    const many = doc("See pages 1, 2, 3, 4, 5, 6, 7, 8.", 99);
    expect(referenceTargets([many])).toHaveLength(REFERENCE_MAX_TARGETS);
  });
});

describe("retrieveReferencedPageChunks — the read", () => {
  const referrer = doc("Details: see page 45.", 44, A, "a.pdf", "44");
  const resolveRow = (printed: string, lo: number, hi = lo) => ({ doc_id: A, source_url: "a.pdf", printed, first_pg: lo, last_pg: hi });
  const clientFor = (resolved: unknown[], rows: unknown[]) => {
    const q = vi.fn(async (sql: string) => {
      if (sql.includes("SET LOCAL")) return { rows: [] };
      return { rows: sql.includes("first_pg") ? resolved : rows };
    });
    return { client: { query: q } as never, q };
  };
  const row = (content: string, extra: Record<string, unknown> = {}) => ({
    id: "i", content, doc_id: A, source_url: "a.pdf", pg: 47, page_label: "45", verified: false, ...extra,
  });

  it("returns the physical page, keeps the document's title/maker, rank 0 and the row's own verified flag", async () => {
    const { client } = clientFor([resolveRow("45", 47)], [row("Steps one two three.", { verified: true })]);
    const out = await retrieveReferencedPageChunks(client, T, [referrer], { docIds: [A] });
    expect(out).toEqual([
      expect.objectContaining({ docId: A, sourceUrl: "a.pdf", sourcePage: 47, pageLabel: "45", rank: 0, verified: true, title: referrer.title, manufacturer: referrer.manufacturer }),
    ]);
  });

  it("binds aligned (doc, file, label) arrays, tenant and scope — never a cross product", async () => {
    const x = doc("see page 20.", 5, A, "a.pdf");
    const y = doc("see page 40.", 5, B, "b.pdf");
    const { client, q } = clientFor([], []);
    await retrieveReferencedPageChunks(client, T, [x, y], { docIds: [A, B] });
    const call = q.mock.calls.find((c) => String(c[0]).includes("first_pg")) as unknown as [string, unknown[]];
    expect(call[1]).toEqual([T, [A, B], [A, B], ["a.pdf", "b.pdf"], ["20", "40"]]);
  });

  it("an ambiguous label (two physical pages) or an unnumbered one adds nothing and skips the page read", async () => {
    for (const resolved of [[resolveRow("45", 46, 47)], [resolveRow("45", 0)], []]) {
      const { client, q } = clientFor(resolved, [row("must not appear")]);
      expect(await retrieveReferencedPageChunks(client, T, [referrer], { docIds: [A] })).toEqual([]);
      expect(q.mock.calls.some((c) => String(c[0]).includes("rank() OVER"))).toBe(false);
    }
  });

  it("a document outside the validated scope is never read", async () => {
    const { client, q } = clientFor([resolveRow("45", 47)], [row("x")]);
    expect(await retrieveReferencedPageChunks(client, T, [referrer], { docIds: [B] })).toEqual([]);
    expect(q).not.toHaveBeenCalled();
  });

  it("drops unqualified table lines and exact duplicates, keeps distinct passages of the page and meaningful case", async () => {
    const { client } = clientFor([resolveRow("45", 47)], [
      row("Output range: 4 mV."),
      row("Output range: 4 MV."),
      row("Output   range: 4 mV."), // whitespace-only duplicate
      row("flat table text", { table_unqualified: true }),
      row("already retrieved"),
    ]);
    const existing = [referrer, doc("already retrieved", 47, A, "a.pdf", "45")];
    const out = await retrieveReferencedPageChunks(client, T, [referrer], { docIds: [A], existing });
    expect(out.map((c) => c.content)).toEqual(["Output range: 4 mV.", "Output range: 4 MV."]);
  });

  it("added pages share ONE citation chip with their page and the formatter adds nothing of its own", async () => {
    const { client } = clientFor([resolveRow("45", 47)], [row("Step A."), row("Step B.")]);
    const added = await retrieveReferencedPageChunks(client, T, [referrer], { docIds: [A] });
    const evidence = [referrer, ...added];
    expect(chunksToSources(evidence)).toHaveLength(2);
    const ctx = buildGroundedContext(evidence, "how?");
    expect(ctx).toContain("Step A.");
    expect(ctx).toContain("Step B.");
    expect(ctx.match(/^\[2\] /gm)).toHaveLength(2);
    // the formatter alone never reaches for a page it was not handed
    expect(buildGroundedContext([referrer], "how?")).not.toContain("Step A.");
  });
});

describe("retrieveReferencedPageChunks — model admission and the deadline", () => {
  const referrer = doc("Specifications: see page 45.", 44, A, "a.pdf", "44");
  const resolved = [{ doc_id: A, source_url: "a.pdf", printed: "45", first_pg: 47, last_pg: 47 }];
  const mk = (content: string, extra: Record<string, unknown> = {}) => ({
    id: "i", content, doc_id: A, source_url: "a.pdf", pg: 47, page_label: "45", verified: false, ...extra,
  });
  const fake = (rows: unknown[], onSet?: (sql: string) => void) => ({
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SET LOCAL")) {
        onSet?.(sql);
        return { rows: [] };
      }
      return { rows: sql.includes("first_pg") ? resolved : rows };
    }),
  }) as never;

  const P5 = mk("Model GS11N-20P5 only: 460 V synthetic", { table_models: ["GS11N20P5"], table_scope: "section" });
  const P2 = mk("Model GS11N-20P2 only: 230 V synthetic", { table_models: ["GS11N-20P2"], table_scope: "section" });
  const SIB = mk("GS11N-20P5 input 380-480 V synthetic");
  const NOTE = mk("General synthetic note.");
  const ACC = mk("Accessory PN-1234 synthetic", { table_models: ["PN-1234"], table_scope: "shared" });

  it("with the confirmed record the retrieval used, another model's section and untagged sibling text stay out; own/general/accessory come in", async () => {
    const out = await retrieveReferencedPageChunks(fake([P5, P2, SIB, NOTE, ACC]), T, [referrer], { docIds: [A], recordNumber: "GS11N-20P2" });
    expect(out.map((c) => c.content)).toEqual(["Model GS11N-20P2 only: 230 V synthetic", "General synthetic note.", "Accessory PN-1234 synthetic"]);
  });

  it("control: no confirmed record (null) admits as retrieval does; the referring chunk's own model name is not an authority", async () => {
    const withName = { ...referrer, modelNumber: "GS11N-20P2" };
    const out = await retrieveReferencedPageChunks(fake([P5, NOTE]), T, [withName], { docIds: [A], recordNumber: null });
    expect(out).toHaveLength(2);
  });

  it("a caller that says nothing about the record (undefined) gets no model-tagged table at all", async () => {
    const out = await retrieveReferencedPageChunks(fake([P5, P2, ACC, NOTE]), T, [referrer], { docIds: [A] });
    expect(out.map((c) => c.content)).toEqual(["General synthetic note."]);
  });

  /** A client whose queries advance a fake clock by the given amounts, in order. */
  const clocked = (rows: unknown[], costs: number[]) => {
    let clock = 0;
    const issued: string[] = [];
    let n = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SET LOCAL")) {
          issued.push(sql);
          return { rows: [] };
        }
        clock += costs[n++] ?? 0;
        return { rows: sql.includes("first_pg") ? resolved : rows };
      }),
    } as never;
    return { client, issued, now: () => clock };
  };

  it("each statement timeout is capped by what is left of the 4 s deadline", async () => {
    const c = clocked([NOTE], [1_500, 100]);
    const out = await retrieveReferencedPageChunks(c.client, T, [referrer], { docIds: [A], recordNumber: null, now: c.now });
    expect(c.issued).toEqual(["SET LOCAL statement_timeout = '2000ms'", "SET LOCAL statement_timeout = '2500ms'"]);
    expect(out).toHaveLength(1);
  });

  it("a slow label lookup leaves the page read only the remainder", async () => {
    const c = clocked([NOTE], [3_900, 10]);
    await retrieveReferencedPageChunks(c.client, T, [referrer], { docIds: [A], recordNumber: null, now: c.now });
    expect(c.issued[1]).toBe("SET LOCAL statement_timeout = '100ms'");
  });

  it("no page read at all once the lookup has used the deadline", async () => {
    const c = clocked([NOTE], [4_000]);
    expect(await retrieveReferencedPageChunks(c.client, T, [referrer], { docIds: [A], recordNumber: null, now: c.now })).toEqual([]);
    expect(c.issued).toHaveLength(1);
  });

  it("rows that arrive after the deadline are not added (fail open)", async () => {
    const c = clocked([NOTE], [500, 3_600]);
    expect(await retrieveReferencedPageChunks(c.client, T, [referrer], { docIds: [A], recordNumber: null, now: c.now })).toEqual([]);
  });

  it("uses SET LOCAL only (transaction-scoped), never a session-level SET or RESET", async () => {
    const c = clocked([NOTE], [1, 1]);
    await retrieveReferencedPageChunks(c.client, T, [referrer], { docIds: [A], recordNumber: null, now: c.now });
    const all = (c.client as unknown as { query: { mock: { calls: unknown[][] } } }).query.mock.calls.map((x) => String(x[0]));
    expect(all.filter((q) => /^(SET|RESET)\b/i.test(q) && !q.startsWith("SET LOCAL"))).toEqual([]);
  });
});

