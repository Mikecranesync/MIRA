/**
 * The confirmation card's look-alikes (Mike 2026-11-14 rule 3): the exact
 * difference is shown, a meaningful suffix and the O/0 distinction are never
 * folded away, and similarity only proposes.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/lookalike.test.ts
 */
import { describe, expect, it } from "vitest";
import { exactMatches, lookAlikes } from "../lookalike";

const KNOWN = [
  { label: "GS11N-20P2", from: "gs10usermanual.pdf" },
  { label: "GS13N-20P2", from: "gs10usermanual.pdf" },
  { label: "CA3KN22BD", from: "CA3KN22BD.pdf" },
  { label: "CA3KN22BD3", from: "CA3KN22BD.pdf" },
  { label: "2080-LC20-20QWB", from: "2080-in009.pdf" },
  { label: "LC1D09BD", from: "schedule" },
];

describe("look-alikes", () => {
  it("a letter O typed for a zero proposes the zero, and says which character differs", () => {
    const [first] = lookAlikes("GS11N-2OP2", KNOWN);
    expect(first.label).toBe("GS11N-20P2");
    expect(first.diff).toEqual([
      { kind: "same", text: "GS11N-2" },
      { kind: "changed", text: "0", typed: "O" },
      { kind: "same", text: "P2" },
    ]);
    expect(first.summary).toBe('"0" (zero) where you typed "O" (letter O)');
  });

  it("a sibling one digit away is offered as a different number, never as the same one", () => {
    const labels = lookAlikes("GS11N-20P2", KNOWN).map((c) => c.label);
    expect(labels).toEqual(["GS13N-20P2"]);
    expect(exactMatches("GS11N-20P2", KNOWN)).toEqual(["gs10usermanual.pdf"]);
  });

  it("a dropped suffix is shown as the extra character, both ways", () => {
    const fromShort = lookAlikes("CA3KN22BD", KNOWN);
    expect(fromShort.map((c) => c.label)).toEqual(["CA3KN22BD3"]);
    expect(fromShort[0].diff).toEqual([{ kind: "same", text: "CA3KN22BD" }, { kind: "added", text: "3" }]);
    const fromLong = lookAlikes("CA3KN22BD3", KNOWN);
    expect(fromLong[0].diff).toEqual([{ kind: "same", text: "CA3KN22BD" }, { kind: "missing", typed: "3" }]);
    expect(fromLong[0].summary).toBe('no "3"');
  });

  it("a two-letter coil suffix dropped from the label is still proposed, with both letters marked", () => {
    const [c] = lookAlikes("LC1D09", KNOWN);
    expect(c.label).toBe("LC1D09BD");
    expect(c.diff).toEqual([{ kind: "same", text: "LC1D09" }, { kind: "added", text: "BD" }]);
  });

  it("spacing and dashes are spelling, not a difference", () => {
    expect(exactMatches("2080 LC20 20QWB", KNOWN)).toEqual(["2080-in009.pdf"]);
    expect(lookAlikes("2080 LC20 20QWB", KNOWN).map((c) => c.label)).not.toContain("2080-LC20-20QWB");
  });

  it("control: an unrelated number proposes nothing", () => {
    expect(lookAlikes("6ES7212-1BE40-0XB0", KNOWN)).toEqual([]);
    expect(lookAlikes("PS1", KNOWN)).toEqual([]);
    // Two digits off a sibling is a different number, not a misread one.
    expect(lookAlikes("GS23N-40P2", KNOWN)).toEqual([]);
  });
});
