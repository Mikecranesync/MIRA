import { describe, expect, it } from "vitest";
import {
  citationPageLabel,
  isChapterSectionLabel,
  pageFromRetrievedChunks,
  withPageCitation,
} from "./citation-page";

describe("isChapterSectionLabel (cite_integrity.py parity)", () => {
  it("accepts GS-style chapter-section labels", () => {
    expect(isChapterSectionLabel("2-15")).toBe(true);
    expect(isChapterSectionLabel("4-188")).toBe(true);
    expect(isChapterSectionLabel("3-6")).toBe(true);
    expect(isChapterSectionLabel("A-12")).toBe(true);
    expect(isChapterSectionLabel("2–15")).toBe(true); // en-dash
  });

  it("rejects integers, int-strings, fault codes, and empties", () => {
    expect(isChapterSectionLabel(162)).toBe(false);
    expect(isChapterSectionLabel("162")).toBe(false);
    expect(isChapterSectionLabel("2")).toBe(false);
    expect(isChapterSectionLabel("F004")).toBe(false);
    expect(isChapterSectionLabel("")).toBe(false);
    expect(isChapterSectionLabel(null)).toBe(false);
  });
});

describe("citationPageLabel — never Number()/parseInt a section label", () => {
  it("preserves 2-15 instead of Number('2-15')=NaN or parseInt('2-15')=2", () => {
    expect(Number("2-15")).toBeNaN();
    expect(parseInt("2-15", 10)).toBe(2);
    expect(citationPageLabel("2-15")).toBe("2-15");
    expect(citationPageLabel("2–15")).toBe("2-15");
  });

  it("keeps a real integer page as digits", () => {
    expect(citationPageLabel(42)).toBe("42");
    expect(citationPageLabel("42")).toBe("42");
  });

  it("drops NaN, non-positive, and junk", () => {
    expect(citationPageLabel(Number("2-15"))).toBeNull();
    expect(citationPageLabel(0)).toBeNull();
    expect(citationPageLabel(-3)).toBeNull();
    expect(citationPageLabel("F004")).toBeNull();
    expect(citationPageLabel("")).toBeNull();
    expect(citationPageLabel(null)).toBeNull();
  });
});

describe("pageFromRetrievedChunks (TQ-29 warning page)", () => {
  it("cites p.2-15 from the WARNING chunk's page metadata, not an earlier PDF page", () => {
    const page = pageFromRetrievedChunks([
      { content: "Rated input 200–240 V.", pageLabel: null, sourcePage: 47 },
      {
        content: "WARNING: Disconnect power before servicing the drive.",
        pageLabel: "2-15",
        sourcePage: 2, // parseInt trap — INTEGER column cannot hold "2-15"
      },
    ]);
    expect(page).toBe("2-15");
  });

  it("falls back to the first labeled page when no hazard chunk is present", () => {
    expect(
      pageFromRetrievedChunks([
        { content: "Installation overview.", pageLabel: "2-15", sourcePage: 21 },
      ]),
    ).toBe("2-15");
  });

  it("falls back to sourcePage when metadata has no printed label", () => {
    expect(
      pageFromRetrievedChunks([{ content: "WARNING: lock out.", sourcePage: 14 }]),
    ).toBe("14");
  });

  it("returns null when nothing is citable", () => {
    expect(pageFromRetrievedChunks([])).toBeNull();
    expect(pageFromRetrievedChunks([{ content: "no page" }])).toBeNull();
  });
});

describe("withPageCitation", () => {
  const banner =
    "⚠️ **Safety flag.** This task involves a hazard. Isolate and verify zero energy before hands-on work.";

  it("appends (p.2-15) for the TQ-29 warning banner", () => {
    expect(withPageCitation(banner, "2-15")).toBe(`${banner} (p.2-15)`);
    expect(withPageCitation(banner, "2-15")).toContain("p.2-15");
  });

  it("is a no-op without a page and is idempotent", () => {
    expect(withPageCitation(banner, null)).toBe(banner);
    const once = withPageCitation(banner, "2-15");
    expect(withPageCitation(once, "2-15")).toBe(once);
  });
});
