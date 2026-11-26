/**
 * #5955 — citation integrity, DB-free layer: the page-trust rules, the one passage identity every
 * consumer of `[n]` must share, and the render/href consequences. The SQL fact read and the real
 * route are exercised against PostgreSQL in the two `citation-integrity*.integration.test.ts` files.
 *
 * Run: npx vitest run src/capabilities/__tests__/citation-integrity.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  annotatePageTrust,
  citationIndex,
  displayPage,
  documentPagesTrusted,
  groupPassages,
  passageKey,
  type PageFactApproval,
} from "@/capabilities/citation-passages";
import { buildGroundedContext, chunksToSources, type ManualChunk } from "@/lib/manual-rag";
import { withSupportingQuotes } from "@/capabilities/supporting-quote";
import { citedPagesFor, manualSafetyStatementForCitations } from "@/capabilities/manual-safety-statement";
import { lockoutPageOf } from "@/capabilities/energized-work-stop";
import { pageFromRetrievedChunks } from "@/lib/citation-page";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import { citationHref, sourceFor, turnsFromPersisted } from "@/factorylm-ui/to-interaction";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import type { HubNotebookMeta } from "@/factorylm-ui/to-interaction";

const chunk = (o: Partial<ManualChunk> & { content: string }): ManualChunk => ({
  manufacturer: "Allen-Bradley", modelNumber: "PowerFlex 525", sourceUrl: "gdrive://a.pdf", sourcePage: null, title: "PF525", rank: 1, ...o,
});
const unknown = (o: Partial<ManualChunk> & { content: string }) => chunk({ sourcePage: 1, chunkIndex: 5, pageTrust: "unknown", ...o });

describe("displayPage — what a chip may show", () => {
  it.each([
    ["unproven stamp (document verdict unknown)", { sourcePage: 1, pageTrust: "unknown" as const }, null],
    ["chunk ordinal stamp (#2910)", { sourcePage: 715, chunkIndex: 715, pageTrust: "trusted" as const }, null],
    ["trusted document, real page", { sourcePage: 161, chunkIndex: 3, pageTrust: "trusted" as const }, 161],
    ["never assessed keeps the older chunk-level rule (real page shows)", { sourcePage: 12, chunkIndex: 2 }, 12],
    ["never assessed, ordinal still withheld", { sourcePage: 12, chunkIndex: 12 }, null],
    ["anchored (page_start) beats an unknown document verdict", { sourcePage: 1, pageAnchored: true, pageTrust: "unknown" as const }, 1],
    ["no page", { sourcePage: null, pageTrust: "trusted" as const }, null],
  ])("%s", (_n, c, want) => expect(displayPage(c)).toBe(want));
});

describe("documentPagesTrusted — counts may only demote; only anchors protect a one-page document", () => {
  const f = (rows: number, anchored: number, pages: number, ordinal: number) => ({ rows, anchored, pages, ordinal });
  it.each([
    ["989 rows all one page (the PowerFlex 525 legacy copy)", f(989, 0, 1, 0), false],
    ["989 rows, page == ordinal on every row", f(989, 0, 800, 989), false],
    ["a one-row document with no anchor", f(1, 0, 1, 0), false],
    ["a one-page document with NO anchor cannot be told from an all-page-1 stamp", f(12, 0, 1, 0), false],
    ["a TRUE one-page document where every row is anchored by page_start", f(12, 12, 1, 0), true],
    ["real crawler copy: 1069 rows, 2 coincidental ordinals", f(1069, 0, 270, 2), true],
    ["ordinal share just under half still trusted", f(100, 0, 40, 49), true],
    ["ordinal share exactly half is not", f(100, 0, 40, 50), false],
    ["mixed: anchored rows do not vouch for the unanchored ones", f(10, 5, 1, 0), false],
    ["no rows visible (private/unapproved/other tenant)", f(0, 0, 0, 0), false],
  ])("%s", (_n, fact, want) => expect(documentPagesTrusted(fact)).toBe(want));
  it("a document the facts did not return is unknown", () => expect(documentPagesTrusted(undefined)).toBe(false));
});

describe("passage identity — one key for context blocks, chips, route citations and re-derivations", () => {
  it("several distinct passages of one document with unknown pages ALL survive, numbered 1..n", () => {
    const cs = [unknown({ content: "alpha passage" }), unknown({ content: "beta passage" }), unknown({ content: "gamma passage" })];
    expect(groupPassages(cs)).toHaveLength(3);
    expect(chunksToSources(cs).map((s) => s.index)).toEqual([1, 2, 3]);
    expect(buildGroundedContext(cs)).toMatch(/\[1\][^]*\[2\][^]*\[3\]/);
  });
  it("the same actual passage twice (same document, same text) collapses to one citation", () => {
    const cs = [unknown({ content: "same   text" }), unknown({ content: "same text", chunkIndex: 9 })];
    expect(groupPassages(cs)).toHaveLength(1);
  });
  it("two chunks of the same KNOWN page share one citation (the #1912 behaviour is kept)", () => {
    const cs = [chunk({ content: "a", sourcePage: 7, chunkIndex: 1, pageTrust: "trusted" }), chunk({ content: "b", sourcePage: 7, chunkIndex: 2, pageTrust: "trusted" })];
    expect(groupPassages(cs)).toHaveLength(1);
  });
  it("same title / same chunk index / blank doc id in DIFFERENT documents never collide", () => {
    const a = unknown({ content: "x", sourceUrl: "https://a/same.pdf", title: "Same", chunkIndex: 0, docId: null });
    const b = unknown({ content: "x", sourceUrl: "https://b/same.pdf", title: "Same", chunkIndex: 0, docId: null });
    const c = unknown({ content: "x", sourceUrl: "https://a/same.pdf", title: "Same", chunkIndex: 0, docId: "d-1" });
    expect(new Set([passageKey(a), passageKey(b), passageKey(c)]).size).toBe(3);
  });
  it("a known page and an unknown page of one document are different passages", () => {
    const a = chunk({ content: "x", sourcePage: 4, chunkIndex: 1, pageTrust: "trusted" });
    const b = unknown({ content: "x" });
    expect(passageKey(a)).not.toBe(passageKey(b));
  });
  it("citationIndex numbers in first-appearance order", () => {
    const cs = [unknown({ content: "p" }), unknown({ content: "q" }), unknown({ content: "p" })];
    expect([...citationIndex(cs).values()]).toEqual([1, 2]);
  });
});

describe("every re-derivation of [n] groups exactly like the context blocks", () => {
  // Three distinct unknown-page passages of ONE document + a known page of another.
  const cs: ManualChunk[] = [
    unknown({ content: "WARNING: hazardous voltage. Wait 3 minutes.", docId: "d-1", sourceUrl: "hub://d-1/m.pdf" }),
    unknown({ content: "Fault F004 UnderVoltage: the DC bus is below 400 V. Check the line.", docId: "d-1", sourceUrl: "hub://d-1/m.pdf" }),
    unknown({ content: "Parameter A001 sets the start source.", docId: "d-1", sourceUrl: "hub://d-1/m.pdf" }),
    chunk({ content: "Real page text about torque.", docId: "d-2", sourceUrl: "hub://d-2/n.pdf", sourcePage: 9, pageAnchored: true, pageTrust: "trusted" }),
  ];
  it("the model's blocks, the chips and withSupportingQuotes agree on which text is [n]", () => {
    const sources = chunksToSources(cs);
    expect(sources.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    const cites = sources.map((s) => ({ citationId: String(s.index), quote: null as string | null }));
    const out = withSupportingQuotes(cites, cs, "F004 trips when the DC bus is below 400 V [2].", "what does F004 mean");
    // [2] is the F004 passage in the context block AND in the quote re-derivation.
    expect(buildGroundedContext(cs)).toMatch(/\[2\] [^\n]*\nFault F004/);
    expect(out.citations[1].quote ?? "").toMatch(/400 V/);
    expect(out.citations[0].quote).toBeNull();
  });
  it("manualSafetyStatementForCitations finds the warning under citation [1], not a shifted number", () => {
    const cites = [{ citationId: "1", docId: "d-1", sourceTitle: "m.pdf", page: null }];
    const n = manualSafetyStatementForCitations(cites, cs);
    expect(n?.sourceCitationId).toBe("1");
    expect(n?.page).toBeNull();
    // citation [2] is the F004 passage: it carries no warning.
    expect(manualSafetyStatementForCitations([{ citationId: "2", docId: "d-1", sourceTitle: "m.pdf", page: null }], cs)).toBeNull();
  });
  it("an unknown page is never re-read as 'page N'; a proven page still is", () => {
    const pages = citedPagesFor(
      [1, 2, 3, 4].map((n) => ({ citationId: String(n), docId: "x", sourceTitle: "t", page: null })),
      cs,
    );
    expect(pages).toEqual([{ docId: "d-2", sourceUrl: "hub://d-2/n.pdf", page: 9 }]);
  });
});

describe("other places that print a page for a chunk", () => {
  it("the safety-stop page (lockoutPageOf) and the hazard banner page withhold an unproven stamp", () => {
    const legacy = unknown({ content: "WARNING: lockout" });
    expect(lockoutPageOf(legacy)).toBeNull();
    expect(pageFromRetrievedChunks([legacy])).toBeNull();
  });
  it("control: a proven page is still printed by both", () => {
    const real = chunk({ content: "WARNING: lockout", sourcePage: 17, chunkIndex: 2, pageTrust: "trusted" });
    expect(lockoutPageOf(real)).toBe("17");
    expect(pageFromRetrievedChunks([real])).toBe("17");
  });
});

describe("annotatePageTrust — failure direction and query budget", () => {
  const approval: PageFactApproval = { forDocs: () => "", docParams: [], forUrls: "" };
  it("anchored chunks need no read at all", async () => {
    const q = vi.fn();
    const out = await annotatePageTrust({ query: q }, "t", [chunk({ content: "x", sourcePage: 1, pageAnchored: true, docId: "d" })], approval);
    expect(q).not.toHaveBeenCalled();
    expect(out[0].pageTrust).toBe("trusted");
  });
  it("an unreadable fact query withholds pages and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await annotatePageTrust({ query: async () => { throw new Error("boom"); } }, "t", [chunk({ content: "x", sourcePage: 3, chunkIndex: 1 })], approval);
    expect(out[0].pageTrust).toBe("unknown");
    expect(displayPage(out[0])).toBeNull();
    warn.mockRestore();
  });
  it("many chunks of many documents cost one query per key kind, not one per chunk", async () => {
    const q = vi.fn(async () => ({ rows: [] }));
    const cs = [
      ...Array.from({ length: 20 }, (_, i) => chunk({ content: `u${i}`, sourceUrl: `gdrive://${i % 4}.pdf`, sourcePage: 2, chunkIndex: i })),
      ...Array.from({ length: 20 }, (_, i) => chunk({ content: `d${i}`, sourceUrl: `hub://${i % 3}`, docId: `00000000-0000-4000-8000-00000000000${i % 3}`, sourcePage: 2, chunkIndex: i })),
    ];
    await annotatePageTrust({ query: q }, "t", cs, approval);
    expect(q).toHaveBeenCalledTimes(2);
  });
});

describe("render, link and click consequences of an unknown page", () => {
  const cite = (id: string, page: number | null, quote: string): EvidenceCitation => ({
    citationId: id, docId: "", sourceTitle: "PowerFlex 525 manual", page, fileId: null, sourceUrl: "https://oem.invalid/pf525.pdf", quote,
  });
  const cites = [cite("1", null, "first"), cite("2", null, "second"), cite("3", 161, "third")];

  it("inline [1] [2] [3] each render their own chip; the label says no page unless proven", () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content="Under-voltage [1] see also [2] and [3]." citations={cites} />);
    expect(html).toContain("Open citation 1: PowerFlex 525 manual\"");
    expect(html).toContain("Open citation 2: PowerFlex 525 manual\"");
    expect(html).toContain("Open citation 3: PowerFlex 525 manual, page 161");
    expect(html).not.toContain("page 1\"");
  });
  it("the canonical shell source keeps every citation id, with no page label and no #page deep link when unknown", () => {
    const sources = cites.map((c) => sourceFor(c, "turn-9"));
    expect(sources.map((s) => s.id)).toEqual(["turn-9:1", "turn-9:2", "turn-9:3"]);
    expect(sources[0].locator).toBe("first");
    expect(sources[2].locator).toBe("p. 161");
    expect(citationHref(cites[0])).toBe("https://oem.invalid/pf525.pdf");
    expect(citationHref(cites[2])).toBe("https://oem.invalid/pf525.pdf#page=161");
  });

  it("an OLD persisted row reloads with the same ids and locators; a null page stays null (no re-invented page)", () => {
    const meta: HubNotebookMeta = { notebookId: "nb-1", threadId: "notebook-nb-1:thread-t-1", title: "PF525", tenantId: "t", asset: null, identityConfirmed: true, capturedAt: "2026-11-26T00:00:00.000Z" };
    const row = { id: "row-1", question: "q", answerStatus: "answered", answerText: "A [1] B [2] C [3]", basis: null, evidence: cites } as unknown as PersistedTurn;
    const [, answer] = turnsFromPersisted(row, meta);
    const sources = answer.parts.filter((p) => p.type === "source").map((p) => (p as unknown as { source: { id: string; locator?: string } }).source);
    expect(sources.map((x) => x.id)).toEqual(["row-1-a:1", "row-1-a:2", "row-1-a:3"].map((id) => id));
    expect(sources.map((x) => x.locator)).toEqual(["first", "second", "p. 161"]);
  });
});
