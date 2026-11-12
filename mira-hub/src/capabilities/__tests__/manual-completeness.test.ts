/**
 * Garage pilot L2 (plan row 5-A/C, M5) — is the document a WHOLE manual?
 *
 * The auto-acquired GS10 "manual" was one chapter file (ch1.pdf): its page 1
 * is the chapter's own heading + table of contents, and its tables carry a
 * replacement character where every decimal point should be ("5�1" for
 * 5.1 A — ToUnicode code 0011 maps to nothing). A candidate like that must
 * never be promoted as "ready": it is marked partial and the technician is
 * told to add the full manual.
 *
 * Fixtures are typed from the extracted page text of the real documents
 * (.planning/2026-11-10-garage-pilot/bench-walk/manuals/text/<doc>/page-001.txt,
 * ch1.pdf page 1 and page 12 through unpdf). Never derived from the code under test.
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-completeness.test.ts
 */
import { describe, expect, it } from "vitest";
import { assessCompleteness, hasUnmappedGlyphBetweenDigits } from "../manual-completeness";

// ch1.pdf (cdn.automationdirect.com/static/manuals/gs10m/ch1.pdf), page 1 — the
// chapter's heading, then ITS OWN table of contents (one chapter, many sections).
const CH1_PAGE1 =
  "Getting Started\n111\nChapterChapterChapterPage 1–1DURApulse GS10 Drive User Manual – 1st Ed., Rev C\n" +
  "Table of Contents\nChapter 1: Getting Started\n" +
  "User Manual Overview � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � �1–2\n" +
  "Overview of this Publication � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � � 1–2\n" +
  "Who Should Read This Manual � � � � � � � � � � � � � � � � 1–2\n" +
  "Technical Support � � � � � � � � � � � � � � � � � � � � � � 1–3\n" +
  "Chapter 1: Getting Started\nPage 1–2 DURApulse GS10 Drive User Manual – 1st Ed., Rev C\n";

// ch1.pdf page 12 (printed 1–12): the specifications table as stored, decimal points unmapped.
const CH1_PAGE12 =
  "Chapter 1: Getting Started\nPage 1–12 DURApulse GS10 Drive User Manual – 1st Ed., Rev C\n" +
  "230V Class – 1-Phase Model-Specific Specifications\n" +
  "Model Name: GS11N-2xPx GS11N-20P2 GS11N-20P5 GS11N-21P0 GS11N-22P0 GS11N-23P0\n" +
  "kW 0�2 0�4 0�75 1�5 2�2\n" +
  "Input Rating2 CT Rated Input Current A 5�1 7�3 10�8 16�5 24�2\n";

// The full GS10 manual (gs10usermanual.pdf, 454 pages): cover, blank, warnings.
const GS10_COVER = "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions";
const GS10_BLANK = "BLANK PAGE";
const GS10_WARNINGS =
  "Page W–1DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nWarnings and Trademarks\n~ WARNING ~\n" +
  "Thank you for purchasing automation equipment from Automationdirect.com®, doing business as\nAutomationDirect.";
// The full manual's table of contents (page 10): MANY chapters on one page.
const GS10_TOC =
  "Table of Contents\nChapter 1: Getting Started\nChapter 2: Installation and Wiring\nChapter 3: Keypad Operation and Quick Start\nChapter 4: AC Drive Parameters\n";

// Micro820 user manual (2080-um005) page 1 and install sheet (2080-in009) page 1.
const M820_UM_P1 =
  "User Manual Original Instructions\nMicro820 Programmable\nControllers\nCatalog Numbers 2080-LC20-20QWB, 2080-L20E-20QWB,\n2080-LC20-20QBB, 2080-L20E-20QBB, 2080-LC20-20AWB,";
const M820_INSTALL_P1 =
  "Installation Instructions\nMicro820 20-Point Programmable Controllers\nCatalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n2080-LC20-20QBBR, 2080-LC20-20AWBR\nhttp://rockwellautomation.com/literature";
// Schneider relay data sheet (CA3KN22BD) page 1.
const RELAY_P1 =
  "Control relay, TeSys K, 2 NO + 2\nNC, lt or eq to 690V, 24VDC\nstandard coil\nCA3KN22BD\nProduct availability: Stock - Normally stocked in distribution\nfacility\nMain\nRange TeSys";

const chunks = (...pages: Array<[number, string]>) => pages.map(([page, content]) => ({ page, content }));

describe("a document whose first page is a chapter heading is one chapter, not a manual", () => {
  it("ch1.pdf: page 1 names exactly one chapter → partial, reason chapter_start", () => {
    const c = assessCompleteness(chunks([1, CH1_PAGE1], [2, "Chapter 1: Getting Started\nUser Manual Overview"]));
    expect(c.complete).toBe(false);
    expect(c.reasons).toContain("chapter_start");
  });

  it("an appendix file is partial the same way", () => {
    const c = assessCompleteness(chunks([1, "Appendix A: Accessories\nPage A–1 DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nAccessories for the GS10"]));
    expect(c.complete).toBe(false);
    expect(c.reasons).toEqual(["chapter_start"]);
  });

  // #5434 (cheap review of #5425, rounds 2 and 3): the heading's CASE is the manual's typography, not
  // evidence of completeness — an OEM file whose page 1 prints "CHAPTER 1" or "chapter 1" is still one chapter.
  it.each([
    ["uppercase", "CHAPTER 1: GETTING STARTED\nPage 1–1 DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nTable of Contents\nCHAPTER 1: GETTING STARTED"],
    ["lowercase", "chapter 1: getting started\nPage 1–1 DURApulse GS10 Drive User Manual – 1st Ed., Rev C"],
    ["uppercase appendix", "APPENDIX A: ACCESSORIES\nPage A–1 DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nAccessories for the GS10"],
  ])("a %s heading on page 1 is one chapter too → partial, reason chapter_start", (_case, page1) => {
    const c = assessCompleteness(chunks([1, page1], [2, "User Manual Overview"]));
    expect(c.complete).toBe(false);
    expect(c.reasons).toEqual(["chapter_start"]);
  });

  it("a table of contents in uppercase still lists MANY chapters → not partial", () => {
    const c = assessCompleteness(chunks([1, "TABLE OF CONTENTS\nCHAPTER 1: GETTING STARTED\nCHAPTER 2: INSTALLATION AND WIRING\nCHAPTER 3: KEYPAD OPERATION"], [2, GS10_WARNINGS]));
    expect(c.complete).toBe(true);
    expect(c.reasons).toEqual([]);
  });

  it("judges the document's FIRST page even when its chunks arrive out of order", () => {
    const c = assessCompleteness(chunks([3, GS10_WARNINGS], [1, CH1_PAGE1], [2, "Chapter 1: Getting Started"]));
    expect(c.complete).toBe(false);
    expect(c.firstPage).toBe(1);
  });

  it.each([
    ["the full GS10 manual (cover, blank, warnings)", chunks([1, GS10_COVER], [2, GS10_BLANK], [3, GS10_WARNINGS])],
    ["a manual whose page 1 is a table of contents listing many chapters", chunks([1, GS10_TOC], [2, GS10_WARNINGS])],
    ["the Micro820 user manual", chunks([1, M820_UM_P1])],
    ["the Micro820 install sheet", chunks([1, M820_INSTALL_P1])],
    ["the relay data sheet", chunks([1, RELAY_P1])],
    ["a chapter heading on a LATER page only (every full manual has those)", chunks([1, GS10_COVER], [15, "Chapter 2: Installation and Wiring\nPage 2–1"])],
    ["no chunks at all (nothing to judge)", []],
  ])("control — %s is not partial", (_what, rows) => {
    const c = assessCompleteness(rows);
    expect(c.complete).toBe(true);
    expect(c.reasons).toEqual([]);
  });
});

describe("a replacement character between two digits is a number that cannot be read", () => {
  it("ch1.pdf page 12 ('5�1' for 5.1) → partial, reason unmapped_glyphs, with the page count", () => {
    const c = assessCompleteness(chunks([1, GS10_COVER], [12, CH1_PAGE12], [13, "kVA 0�6 1�1"]));
    expect(c.complete).toBe(false);
    expect(c.reasons).toEqual(["unmapped_glyphs"]);
    expect(c.unreadablePages).toBe(2);
  });

  it("both reasons are reported when both hold (the real ch1.pdf)", () => {
    const c = assessCompleteness(chunks([1, CH1_PAGE1], [12, CH1_PAGE12]));
    expect(c.reasons).toEqual(["chapter_start", "unmapped_glyphs"]);
  });

  it.each([
    ["a leader dot in a table of contents ('Overview � � � 1–2')", "User Manual Overview � � � � 1–2"],
    ["a glyph beside a letter, not a digit", "Rated Input Current A�5.1 7.3"],
    ["a glyph at the end of a number", "5.1� A"],
    ["a clean decimal", "CT Rated Input Current A 5.1 7.3 10.8"],
    ["an empty page", ""],
  ])("control — %s is not flagged", (_what, text) => {
    expect(hasUnmappedGlyphBetweenDigits(text)).toBe(false);
    expect(assessCompleteness(chunks([1, GS10_COVER], [12, text])).complete).toBe(true);
  });

  it.each(["5�1", "kW 0�75 1�5", "10�8 A"])("'%s' is flagged", (text) => {
    expect(hasUnmappedGlyphBetweenDigits(text)).toBe(true);
  });
});
