/**
 * #5955 independent-review findings C1/C2/C3 — permanent regressions + controls.
 *
 * C1  a bare-integer metadata locator (staging: metadata.page_num = "1" on EVERY row of the three
 *     ordinal-stamped PowerFlex copies) must not republish the page the stamp guard withheld.
 * C2  a citation SAVED before #5955 (docId "", no file, no browser address — the shape the old
 *     builder kept for every bare/gdrive legacy address) has no way to prove its page: it is not
 *     displayed as "p. 1" in the canonical source, its link, the inline chip, the legacy pill or
 *     the click-through; identified sources keep their pages; the saved row itself is untouched.
 * C3  an unknown page must not leave a numeric page fragment (#page=715 / #p715) on an openable URL.
 *
 * Run: npx vitest run src/capabilities/__tests__/citation-integrity-review.test.tsx
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Static rendering cannot press the "supporting passages" toggle; open it for the pill assertions only.
const open = vi.hoisted(() => ({ on: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: ((init: unknown) => (open.on && init === false ? [true, () => undefined] : actual.useState(init as never))) as unknown as typeof actual.useState };
});
import { renderToStaticMarkup } from "react-dom/server";
import { lockoutPageOf } from "@/capabilities/energized-work-stop";
import { pageFromRetrievedChunks } from "@/lib/citation-page";
import { chunksToSources, type ManualChunk } from "@/lib/manual-rag";
import { citationHref, sourceFor, turnsFromPersisted, type HubNotebookMeta } from "@/factorylm-ui/to-interaction";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import { Bubble, type ChatTurn } from "@/components/equipment/NotebookChat";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import {
  citationPageQuery,
  effectiveCitationPage,
  numericLocatorUnproven,
  pageSelector,
  withoutUnverifiedPage,
} from "@/capabilities/citation-page-display";

const ordinal: ManualChunk = {
  content: "WARNING: lockout", sourceUrl: "gdrive://520-um001_-en-e.pdf", sourcePage: 715, chunkIndex: 715,
  pageLabel: "1", pageTrust: "unknown", manufacturer: "Allen-Bradley", modelNumber: "PowerFlex 525", title: "PF525", rank: 1,
};

describe("C1 — numeric metadata locators obey page trust", () => {
  it("banner and stop withhold a bare \"1\" beside an unproven stamp", () => {
    expect(pageFromRetrievedChunks([ordinal])).toBeNull();
    expect(lockoutPageOf(ordinal)).toBeNull();
  });
  it("the same holds when the stamp is only the chunk ordinal (no document verdict yet)", () => {
    const c = { ...ordinal, pageTrust: undefined };
    expect(pageFromRetrievedChunks([c])).toBeNull();
    expect(lockoutPageOf(c)).toBeNull();
  });
  it("control: an independently printed chapter-section label survives even beside an unproven stamp", () => {
    const c = { ...ordinal, pageLabel: "2-15" };
    expect(pageFromRetrievedChunks([c])).toBe("2-15");
    expect(lockoutPageOf(c)).toBe("2-15");
  });
  it("control: an anchored one-page document keeps its page and its numeric label", () => {
    const c = { ...ordinal, sourcePage: 1, chunkIndex: 1, pageAnchored: true };
    expect(pageFromRetrievedChunks([c])).toBe("1");
    expect(lockoutPageOf(c)).toBe("1");
  });
  it("control: a trusted document's numeric printed page is kept; so is a label on a chunk with no stamp at all", () => {
    const trusted = { ...ordinal, sourcePage: 161, chunkIndex: 3, pageLabel: "17", pageTrust: "trusted" as const };
    expect(lockoutPageOf(trusted)).toBe("17");
    const unstamped = { ...ordinal, sourcePage: null, chunkIndex: null, pageLabel: "5" };
    expect(lockoutPageOf(unstamped)).toBe("5");
  });
  it("numericLocatorUnproven: only a bare integer on a withheld stamp", () => {
    expect(numericLocatorUnproven(ordinal, "1")).toBe(true);
    expect(numericLocatorUnproven(ordinal, " 1 ")).toBe(true);
    expect(numericLocatorUnproven(ordinal, "2-15")).toBe(false);
    expect(numericLocatorUnproven(ordinal, null)).toBe(false);
    expect(numericLocatorUnproven({ ...ordinal, pageTrust: "trusted", sourcePage: 9, chunkIndex: 2 }, "9")).toBe(false);
  });
});

// The shape every pre-#5955 bare/gdrive citation was saved with: no docId, no file, no address.
const historic: EvidenceCitation = { citationId: "1", docId: "", sourceTitle: "PowerFlex 525 manual", page: 1, fileId: null, quote: "F004 UnderVoltage" };
const meta: HubNotebookMeta = { notebookId: "nb-1", threadId: "notebook-nb-1:thread-t-1", title: "PF525", tenantId: "t", asset: null, identityConfirmed: true, capturedAt: "2026-11-26T00:00:00.000Z" };

describe("C2 — a saved legacy citation with no stable source identity does not claim its historical page", () => {
  it("canonical source: locator falls back to the quote, no link", () => {
    const s = sourceFor(historic, "old-turn");
    expect(s.locator).toBe("F004 UnderVoltage");
    expect(s.href).toBeUndefined();
    expect(citationHref(historic)).toBeUndefined();
  });
  it("inline chip: no page in the accessible name", () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content="UnderVoltage [1]" citations={[historic]} />);
    expect(html).toContain("Open citation 1: PowerFlex 525 manual\"");
    expect(html).not.toContain("page 1");
  });
  it("legacy pill caption: no p.1", () => {
    open.on = true;
    try {
      const turn: ChatTurn = { id: "a", role: "assistant", content: "UnderVoltage [1]", citations: [historic], status: "answered" };
      const html = renderToStaticMarkup(<Bubble turn={turn} />).replace(/<!-- -->/g, "");
      expect(html).toContain("[1] PowerFlex 525 manual");
      expect(html).not.toMatch(/p\.1\b/);
      // control (same render path): an identified source's page IS in the pill
      const withDoc = renderToStaticMarkup(<Bubble turn={{ ...turn, citations: [{ ...historic, docId: "d-1" }] }} />).replace(/<!-- -->/g, "");
      expect(withDoc).toContain("p.1");
    } finally {
      open.on = false;
    }
  });
  it("reload: the saved row keeps its page and ids; only the displayed locator changes", () => {
    const evidence = [{ ...historic }, { ...historic, citationId: "2", quote: "second" }];
    const before = JSON.stringify(evidence);
    const row = { id: "row-1", question: "q", answerStatus: "answered", answerText: "A [1] B [2]", basis: null, evidence } as unknown as PersistedTurn;
    const [, answer] = turnsFromPersisted(row, meta);
    const sources = answer.parts.filter((p) => p.type === "source").map((p) => (p as unknown as { source: { id: string; locator?: string; href?: string } }).source);
    expect(sources.map((s) => s.id)).toEqual(["row-1-a:1", "row-1-a:2"]);
    expect(sources.map((s) => s.locator)).toEqual(["F004 UnderVoltage", "second"]);
    expect(sources.every((s) => s.href === undefined)).toBe(true);
    expect(JSON.stringify(evidence)).toBe(before);
    expect(evidence[0].page).toBe(1);
  });
  it("control: an identified document keeps its page (docId), as does a parked file and a browser address", () => {
    expect(sourceFor({ ...historic, docId: "d-1" }, "t").locator).toBe("p. 1");
    const file = sourceFor({ ...historic, fileId: "f-1" }, "t");
    expect(file.locator).toBe("p. 1");
    expect(file.href).toContain("f-1");
    const web = { ...historic, page: 161, sourceUrl: "https://oem.invalid/pf525.pdf" };
    expect(sourceFor(web, "t").locator).toBe("p. 161");
    expect(citationHref(web)).toBe("https://oem.invalid/pf525.pdf#page=161");
    expect(renderToStaticMarkup(<AnswerMarkdown content="[1]" citations={[web]} />)).toContain("page 161");
  });
  it("control: a page the server attested (selector) is shown even for a bare legacy address", () => {
    const attested = { ...historic, page: 161, selector: pageSelector(161) };
    expect(sourceFor(attested, "t").locator).toBe("p. 161");
    expect(effectiveCitationPage(attested)).toBe(161);
    // an attestation for a different page proves nothing about this one
    expect(effectiveCitationPage({ ...historic, page: 1, selector: pageSelector(161) })).toBeNull();
  });
  it("click-through: the source page opens at a page only for a displayable citation", () => {
    expect(citationPageQuery(historic)).toBe("");
    expect(citationPageQuery({ ...historic, docId: "d-1" })).toBe("?page=1");
    expect(citationPageQuery({ ...historic, page: 161, selector: pageSelector(161) })).toBe("?page=161");
  });
  it("control: distinct unknown citations keep their own ids and clicks", () => {
    const cs = [{ ...historic, page: null }, { ...historic, page: null, citationId: "2" }];
    expect(cs.map((c) => sourceFor(c, "t").id)).toEqual(["t:1", "t:2"]);
  });
});

describe("C3 — an unknown page leaves no numeric fragment on an openable address", () => {
  const web = (url: string, page: number | null): EvidenceCitation => ({ ...historic, page, sourceUrl: url });
  it.each(["#page=715", "#p715"])("%s is removed when the page is unknown", (frag) => {
    expect(citationHref(web(`https://oem.invalid/manual.pdf${frag}`, null))).toBe("https://oem.invalid/manual.pdf");
  });
  it("only the numeric page locator goes: other anchors stay", () => {
    expect(withoutUnverifiedPage("https://x/y.pdf#view=Fit&page=3")).toBe("https://x/y.pdf#view=Fit");
    expect(withoutUnverifiedPage("https://x/y.pdf#section-3")).toBe("https://x/y.pdf#section-3");
    expect(withoutUnverifiedPage("https://x/y.pdf#nameddest=pg7")).toBe("https://x/y.pdf#nameddest=pg7");
    expect(withoutUnverifiedPage("https://x/y.pdf")).toBe("https://x/y.pdf");
  });
  it("control: a known real page keeps its link", () => {
    expect(citationHref(web("https://oem.invalid/manual.pdf", 161))).toBe("https://oem.invalid/manual.pdf#page=161");
  });
  it("a legacy citation with a browser address but a withheld stamp: no page, no fragment, link kept", () => {
    expect(citationHref(web("https://oem.invalid/manual.pdf#p715", null))).toBe("https://oem.invalid/manual.pdf");
    expect(sourceFor(web("https://oem.invalid/manual.pdf#p715", null), "t").locator).toBe("F004 UnderVoltage");
  });
  it("shared builder (chunksToSources): an unknown page ships the address without the fragment; a known page ships it unchanged", () => {
    const base: ManualChunk = { content: "a", manufacturer: "A", modelNumber: "B", sourceUrl: "https://oem.invalid/m.pdf#page=715", sourcePage: 715, chunkIndex: 715, title: "t", rank: 1 };
    expect(chunksToSources([base])[0]).toMatchObject({ url: "https://oem.invalid/m.pdf", page: null });
    const real = { ...base, sourcePage: 161, chunkIndex: 3, pageTrust: "trusted" as const, sourceUrl: "https://oem.invalid/m.pdf" };
    expect(chunksToSources([real])[0]).toMatchObject({ url: "https://oem.invalid/m.pdf", page: 161 });
  });
});

afterEach(() => vi.restoreAllMocks());
