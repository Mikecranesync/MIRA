import { describe, expect, it } from "vitest";
import { classify, hitRank, norm, summarize, type ReplayRow } from "./lib";

describe("hitRank", () => {
  it("finds the first page within tolerance, 1-based", () => {
    expect(hitRank([40, 11, 9], 10, 1)).toBe(2);
    expect(hitRank([40, null, 10], 10, 0)).toBe(3);
  });
  it("is null when no page is within tolerance (control: tolerance is honoured, not ignored)", () => {
    expect(hitRank([12, 8], 10, 1)).toBeNull();
    expect(hitRank([12, 8], 10, 2)).toBe(1);
    expect(hitRank([], 10, 1)).toBeNull();
  });
  it("accepts any of several answer pages (control: a page outside all of them is still a miss)", () => {
    expect(hitRank([30, 17, 9], [16, 17], 0)).toBe(2);
    expect(hitRank([30, 18], [16, 17], 0)).toBeNull();
  });
});

describe("classify", () => {
  it("A when the anchor is not on the expected page, whatever the ranks", () => {
    expect(classify(false, 1, 1)).toBe("A");
    expect(classify(false, null, null)).toBe("A");
  });
  it("D in the top six, C within 100 only, B nowhere", () => {
    expect(classify(true, 3, 3)).toBe("D");
    expect(classify(true, null, 40)).toBe("C");
    expect(classify(true, null, null)).toBe("B");
  });
});

describe("norm", () => {
  it("matches an anchor across soft hyphens, unicode dashes, quotes and line breaks", () => {
    expect(norm("Over­current  during\nacceleration (ocA)")).toBe("overcurrent during acceleration (oca)");
    expect(norm("Wait 3 – 5 min ’ok’")).toBe("wait 3 - 5 min 'ok'");
  });
});

describe("summarize", () => {
  const row = (id: string, cls: ReplayRow["missClass"], at: Record<string, boolean>, err?: string): ReplayRow => ({
    id, manual: "m", family: "vfd", expectedPage: 1, top6Pages: [], rankTop6: null, recallAt: at,
    firstRankWithin100: null, missClass: cls, dup: false, anchorPages: [], error: err,
  });
  it("counts recall@K and classes over measured rows only — an errored row is not a miss or a hit", () => {
    const s = summarize(
      [row("a", "D", { "6": true, "100": true }), row("b", "C", { "6": false, "100": true }), row("c", "B", { "6": true }, "boom")],
      "lexical",
      "abcdef0123",
    );
    expect(s.recall["6"]).toBe(1);
    expect(s.recall["100"]).toBe(2);
    expect(s.classes).toMatchObject({ D: 1, C: 1, B: 0 });
    expect(s.markdown).toContain("1 errored");
  });
  it("a not-in-manual question is reported, never counted as a hit or a miss", () => {
    const s = summarize([row("a", "D", { "6": true }), row("n", "N", {})], "lexical", null);
    expect(s.recall["6"]).toBe(1);
    expect(s.markdown).toContain("1 measured, 1 not in the manual");
  });
});
