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

  it("offers nothing when the same number is typed two ways", () => {
    expect(offeredOwnNumber("Siemens TP700 6AV2124-0GC01-0AX0 also written 6AV21240GC010AX0 will not power up", TP700)).toBeNull();
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

  // Review Focus 2: bounded work on a pasted wall of text.
  it("offers nothing past 20 digit-bearing tokens, and still offers at 20", () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `x${i + 1}`).join(" ");
    // "TP700" and the number are two of the digit-bearing tokens.
    expect(offeredOwnNumber(`Siemens TP700 6AV2124-0GC01-0AX0 ${filler(18)}`, TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber(`Siemens TP700 6AV2124-0GC01-0AX0 ${filler(19)}`, TP700)).toBeNull();
  });
});
