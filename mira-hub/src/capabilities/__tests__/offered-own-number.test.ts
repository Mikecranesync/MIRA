// #6085: the identity card offers the one number the technician typed that would make the
// card's question this machine's own. The scope itself decides, so the card and the scope
// cannot disagree. Every expectation below was checked against main's scope at plan stage.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/offered-own-number
import { describe, it, expect } from "vitest";
import { offeredOwnNumber, threadStatusScope } from "@/capabilities/notebook-manual-acquisition";

const TP700 = { manufacturer: "Siemens", model: "TP700" };
const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";

describe("offeredOwnNumber", () => {
  it("offers the walk question's order number", () => {
    expect(offeredOwnNumber(J2, TP700)).toBe("6AV2124-0GC01-0AX0");
  });

  it("the offered number is the one that makes the question own", () => {
    const n = offeredOwnNumber(J2, TP700)!;
    expect(threadStatusScope([J2], { ...TP700, catalogNumber: "", recordCatalog: null, confirmedNumbers: [n] })).toBe("own");
  });

  // #6094 r2 F7: a neighbour's number is still offered. The box starts unticked, so a
  // careless tap never saves it; ticking it is the technician's own statement.
  it("offers a neighbour's number when it is the only one typed (the unticked box protects)", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort sits next to a 6AV2124-0JC01-0AX0 that will not power up.", TP700))
      .toBe("6AV2124-0JC01-0AX0");
  });

  it("offers nothing when two numbers are typed", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort 6AV2124-0GC01-0AX0 sits next to a 6AV2124-0JC01-0AX0 that will not power up.", TP700)).toBeNull();
  });

  it("offers nothing when another maker is named", () => {
    expect(offeredOwnNumber("Our Schneider Electric TP700 6AV2124-0GC01-0AX0 will not power up.", TP700)).toBeNull();
  });

  it("offers nothing when the question is already own or names no number", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort will not power up.", TP700)).toBeNull();
    expect(offeredOwnNumber("Find me the AutomationDirect GS10 manual", { manufacturer: "AutomationDirect", model: "GS11N-20P2" })).toBeNull();
  });

  it("offers nothing without a model", () => {
    expect(offeredOwnNumber(J2, { manufacturer: "Siemens", model: "" })).toBeNull();
    expect(offeredOwnNumber(J2, { manufacturer: "Siemens", model: null })).toBeNull();
  });

  // Only an order number written with hyphens counts as one, so the compact spelling of the same
  // number is not a second candidate: the hyphenated one is offered, and settles both.
  it("offers the hyphenated spelling when the same number is typed two ways", () => {
    expect(offeredOwnNumber("Siemens TP700 6AV2124-0GC01-0AX0 also written 6AV21240GC010AX0 will not power up", TP700)).toBe("6AV2124-0GC01-0AX0");
  });

  // Two hyphenated spellings of one number both settle the question, so neither is offered:
  // "exactly one" is the rule, and the card never picks a spelling for the technician.
  it("offers nothing when the same order number is typed in two hyphenated spellings", () => {
    const q = "Siemens TP700 6AV2124-0GC01-0AX0 also written 6av2124-0gc01-0ax0 will not power up";
    expect(threadStatusScope([q], { ...TP700, catalogNumber: "", recordCatalog: null, confirmedNumbers: ["6av2124-0gc01-0ax0"] })).toBe("own"); // precondition: either spelling settles it
    expect(offeredOwnNumber(q, TP700)).toBeNull();
  });

  // Review Focus 1: the technician's own spelling, without surrounding punctuation.
  it("keeps the typed spelling, without brackets or trailing punctuation", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort (order no. 6AV2124-0GC01-0AX0) will not power up.", TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber("Our Siemens TP700 Comfort 6AV2124‑0GC01‑0AX0 will not power up.", TP700)).toBe("6AV2124‑0GC01‑0AX0");
    expect(offeredOwnNumber("The label reads SIEMENS TP700 Comfort 1P 6AV2124-0GC01-0AX0 and it will not power up", TP700)).toBe("6AV2124-0GC01-0AX0");
  });

  it("offers a drive's type code", () => {
    expect(offeredOwnNumber("Our ABB ACS355 ACS355-03E-07A3-4 shows fault 0001. What does it mean?", { manufacturer: "ABB", model: "ACS355" }))
      .toBe("ACS355-03E-07A3-4");
  });

  // Review: the scope's cost grows faster than the text (a 4,000-character paste took over a
  // second for 20 scope calls), so a long question gets no offer, and stays withheld as today.
  it("offers nothing for a question over 500 characters, and still offers at 500", () => {
    const pad = (q: string, len: number) => q + " " + "x".repeat(len - q.length - 1);
    expect(offeredOwnNumber(pad(J2, 500), TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber(pad(J2, 501), TP700)).toBeNull();
  });

  // Review Focus 2: bounded work on a pasted wall of text.
  it("offers nothing past 20 digit-bearing tokens, and still offers at 20", () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `x${i + 1}`).join(" ");
    // "TP700" and the number are two of the digit-bearing tokens.
    expect(offeredOwnNumber(`Siemens TP700 6AV2124-0GC01-0AX0 ${filler(18)}`, TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber(`Siemens TP700 6AV2124-0GC01-0AX0 ${filler(19)}`, TP700)).toBeNull();
  });
});

// Review (whole-branch, 2026-11-27): a confirmed value counts only as the order numbers in it.
// A model name ticked as "this machine's number" (a sibling TP900 typed beside the TP700) would
// otherwise make every thread about that model this notebook's own, with no way back.
const GS10 = { manufacturer: "AutomationDirect", model: "GS10" };
const scopeWith = (q: string, machine: { manufacturer: string; model: string }, confirmedNumbers: string[]) =>
  threadStatusScope([q], { ...machine, catalogNumber: "", recordCatalog: null, confirmedNumbers });

describe("a model name is never offered or counted as a number", () => {
  it("offers no sibling model typed beside the machine", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort next to a TP900 will not power up.", TP700)).toBeNull();
    expect(offeredOwnNumber("Our Siemens TP700 Comfort next to a TP1200 Comfort will not power up.", TP700)).toBeNull();
  });

  it("offers no token that joins the number to another model", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort 6AV2124-0GC01-0AX0/TP900 will not power up.", TP700)).toBeNull();
  });

  it("offers no network name", () => {
    expect(offeredOwnNumber("Find the manual for this Allen-Bradley SLC 5/03 on DH-485", { manufacturer: "Allen-Bradley", model: "SLC 5/03" })).toBeNull();
  });

  it("offers no sibling order number that names its own series", () => {
    expect(offeredOwnNumber("Our AutomationDirect GS10 sits next to a GS11N-20P2 that trips.", GS10)).toBeNull();
  });

  it("a saved model name counts for nothing", () => {
    expect(scopeWith("Find the manual for Siemens TP900 Comfort", TP700, ["TP900"])).toBe("other");
  });

  it("a saved number joined to another model counts only as its order number", () => {
    expect(scopeWith("Siemens TP900 Comfort will not boot", TP700, ["6AV2124-0GC01-0AX0/TP900"])).toBe("other");
    expect(scopeWith(J2, TP700, ["6AV2124-0GC01-0AX0/TP900"])).toBe("own"); // control: the order number still counts
  });

  it("a saved sibling order number does not make its series own", () => {
    expect(scopeWith("Find the GS11N manual", GS10, ["GS11N-20P2"])).toBe("other");
  });

  // The cost, disclosed in the PR: a number typed with no hyphens is not read as an order
  // number, so it is never offered and the thread stays withheld as today.
  it("offers nothing for an order number typed with no hyphens", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort 6AV21240GC010AX0 will not power up.", TP700)).toBeNull();
    expect(scopeWith("Our Siemens TP700 Comfort 6AV21240GC010AX0 will not power up.", TP700, ["6AV21240GC010AX0"])).toBe("other");
  });

  it("control: a saved order number in any hyphen spelling still settles the walk question", () => {
    expect(scopeWith(J2, TP700, ["6AV2124-0GC01-0AX0"])).toBe("own");
    expect(scopeWith(J2, TP700, ["6AV2124‑0GC01‑0AX0"])).toBe("own");
  });
});
