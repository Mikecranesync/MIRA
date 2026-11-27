// #6085: the identity card offers the one number the technician typed that would make the
// card's question this machine's own. The scope itself decides, so the card and the scope
// cannot disagree. Every expectation below was checked against main's scope at plan stage.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/offered-own-number
import { describe, it, expect } from "vitest";
import { machineOrderNumber, offeredOwnNumber, singleOrderNumber, threadStatusScope } from "@/capabilities/notebook-manual-acquisition";
import { canonicalModelKey } from "@/capabilities/model-token";

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

  // GS11N is in the GS10 family, but the scope reads a GS11N order number as naming the GS11N
  // model, so a GS10 card never offers it (fail closed). In the route, a question naming both
  // models gets no card at all; a question naming only GS11N-20P2 gets a GS11N card (below).
  it("offers no order number whose first group names a different model from the card's", () => {
    expect(offeredOwnNumber("Our AutomationDirect GS10 sits next to a GS11N-20P2 that trips.", GS10)).toBeNull();
  });

  it("control: a GS11N card offers its own GS11N order number", () => {
    expect(offeredOwnNumber("Our AutomationDirect GS11N-20P2 trips on oc at start", { manufacturer: "AutomationDirect", model: "GS11N" })).toBe("GS11N-20P2");
  });

  it("a saved model name counts for nothing", () => {
    expect(scopeWith("Find the manual for Siemens TP900 Comfort", TP700, ["TP900"])).toBe("other");
  });

  // #6104 r1 F1: a saved value counts only when it is exactly one order number, so a value
  // joining the number to anything else counts for nothing (it can no longer be offered or saved).
  it("a saved number joined to another model counts for nothing", () => {
    expect(scopeWith("Siemens TP900 Comfort will not boot", TP700, ["6AV2124-0GC01-0AX0/TP900"])).toBe("other");
    expect(scopeWith(J2, TP700, ["6AV2124-0GC01-0AX0/TP900"])).toBe("other");
  });

  it("a saved number naming a different model does not make that model own", () => {
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

// Pre-Codex check: a notebook can gain a confirmed catalog number after a number was ticked
// (PATCH catalogNumber keeps the identity confirmed). The catalog is then the machine's number,
// so a ticked number stops counting: the same fail-closed rule Mike set for #6094 (r1 F1).
describe("a confirmed catalog number outranks a ticked number", () => {
  const ONLY_NUMBER = "Siemens panel 6AV2124-0GC01-0AX0 will not power up";
  const machine = (catalog: string | null) => ({ ...TP700, catalogNumber: catalog ?? "", recordCatalog: catalog, confirmedNumbers: ["6AV2124-0GC01-0AX0"] });

  it("a ticked number does not count once a different catalog is confirmed", () => {
    expect(threadStatusScope([ONLY_NUMBER], machine("6AV2124-0JC01-0AX0"))).toBe("other");
  });

  it("nor when only the record carries the catalog", () => {
    expect(threadStatusScope([ONLY_NUMBER], { ...machine(null), recordCatalog: "6AV2124-0JC01-0AX0" })).toBe("other");
  });

  it("control: with no catalog the ticked number counts", () => {
    expect(threadStatusScope([ONLY_NUMBER], machine(null))).toBe("own");
  });

  it("control: a catalog equal to the ticked number still settles it", () => {
    expect(threadStatusScope([ONLY_NUMBER], machine("6AV2124-0GC01-0AX0"))).toBe("own");
  });
});

// #6104 r1 F1: one token joining two order numbers ("…-0AX0|S7-1200") was offered as one number,
// and one tick would have made the other machine's threads this notebook's own.
describe("exactly one order number is offered, saved or read (#6104 r1 F1)", () => {
  const JOINED = "Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0|S7-1200 will not power up.";
  const S7 = "Siemens S7-1200 trips on startup";

  it("singleOrderNumber reads one whole order number, whatever its hyphens or wrapping", () => {
    expect(singleOrderNumber("6AV2124-0GC01-0AX0")).toBe("6AV21240GC010AX0");
    expect(singleOrderNumber("(6AV2124-0GC01-0AX0).")).toBe("6AV21240GC010AX0");
    expect(singleOrderNumber("6AV2124\u20110GC01\u20110AX0")).toBe("6AV21240GC010AX0");
    expect(singleOrderNumber("6av2124-0gc01-0ax0")).toBe("6AV21240GC010AX0");
  });

  it("singleOrderNumber reads nothing from two numbers, a number joined to a model, or a non-number", () => {
    for (const value of ["6AV2124-0GC01-0AX0|S7-1200", "6AV2124-0GC01-0AX0/TP900", "6AV21240GC010AX0", "TP900", "DH-485", "208-230VAC", ""]) {
      expect(singleOrderNumber(value), value).toBeNull();
    }
  });

  it("offers nothing for a token joining two order numbers", () => {
    expect(offeredOwnNumber(JOINED, TP700)).toBeNull();
  });

  it("a saved value joining two order numbers makes neither machine's thread own", () => {
    expect(scopeWith(S7, TP700, [])).toBe("other"); // precondition
    expect(scopeWith(S7, TP700, ["6AV2124-0GC01-0AX0|S7-1200"])).toBe("other");
    expect(scopeWith(J2, TP700, ["6AV2124-0GC01-0AX0|S7-1200"])).toBe("other");
  });

  it("control: a saved single order number settles its thread and not the S7-1200 one", () => {
    expect(scopeWith(J2, TP700, ["6AV2124-0GC01-0AX0"])).toBe("own");
    expect(scopeWith(S7, TP700, ["6AV2124-0GC01-0AX0"])).toBe("other");
  });
});

// #6104 r3 F6: a ticked value counts only when the existing readers tie it to the card's machine:
// its first group is the card's model, or it is a panel order number the proposer's own pairing
// ties to the card's panel. Another machine's model or order number is never offered or counted.
describe("a number tied to another machine is never offered or counted (#6104 r3 F6)", () => {
  const S7_QUESTION = "Our Siemens TP700 Comfort panel fails when connected to the S7-1200 PLC.";

  it("precondition: S7-1200 is read as exactly one order number", () => {
    expect(singleOrderNumber("S7-1200")).toBe("S71200");
  });

  it("offers no PLC model typed beside the panel", () => {
    expect(offeredOwnNumber(S7_QUESTION, TP700)).toBeNull();
  });

  it("offers no CPU order number typed beside the panel", () => {
    expect(offeredOwnNumber("Our Siemens TP700 Comfort panel next to a 6ES7214-1AG40-0XB0 will not power up.", TP700)).toBeNull();
  });

  it("a saved PLC model counts for nothing: a later S7-1200 question stays another machine's", () => {
    expect(scopeWith("Find the manual for Siemens S7-1200", TP700, ["S7-1200"])).toBe("other");
  });

  it("a saved CPU order number counts for nothing", () => {
    expect(scopeWith("Find the manual for Siemens 6ES7214-1AG40-0XB0", TP700, ["6ES7214-1AG40-0XB0"])).toBe("other");
  });

  it("control: the panel's own saved number still makes the walk thread its own", () => {
    expect(scopeWith(J2, TP700, ["6AV2124-0GC01-0AX0"])).toBe("own");
  });

  it("control: the walk question still offers the panel's number, whatever form the card's model takes", () => {
    expect(offeredOwnNumber(J2, TP700)).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber(J2, { manufacturer: "Siemens", model: "TP700 Comfort" })).toBe("6AV2124-0GC01-0AX0");
    expect(offeredOwnNumber("Our Siemens KTP700 Basic 6AV2123-2GB03-0AX0 will not power up.", { manufacturer: "Siemens", model: "KTP700" })).toBe("6AV2123-2GB03-0AX0");
  });

  it("control: a number that starts with the card's model is still offered and counted", () => {
    expect(offeredOwnNumber("Our Mitsubishi FX3U FX3U-32M shows an error. What does it mean?", { manufacturer: "Mitsubishi", model: "FX3U" })).toBe("FX3U-32M");
    expect(scopeWith("Find the manual for ABB ACS355-03E-07A3-4", { manufacturer: "ABB", model: "ACS355" }, ["ACS355-03E-07A3-4"])).toBe("own");
  });

  it("a panel's order number counts for nothing on a drive card", () => {
    expect(scopeWith("Find the manual for 6AV2124-0GC01-0AX0", { manufacturer: "AutomationDirect", model: "GS10" }, ["6AV2124-0GC01-0AX0"])).toBe("other");
  });

  // The shared model key reads both "Micro850" and "ACS850-04-03A0-5" as 850, so the rule compares
  // the number's own first group, and the panel pairing is limited to 6AV numbers.
  it("precondition: the shared model key reads the Micro850 and an ACS850 number alike", () => {
    expect(canonicalModelKey("ACS850-04-03A0-5")).toBe(canonicalModelKey("Micro850"));
  });

  it("a number whose model only shares the card's digits is not the card's (Micro850 card, ACS850 number)", () => {
    expect(machineOrderNumber("ACS850-04-03A0-5", "Micro850")).toBeNull();
  });

  it("control: the same number is the ACS850 card's own", () => {
    expect(machineOrderNumber("ACS850-04-03A0-5", "ACS850")).toBe("ACS8500403A05");
  });

  // The cost, pinned: a machine's own order number that neither starts with its model nor is a
  // paired panel number is no longer offered. The thread stays withheld, as on main.
  it("cost: a PowerFlex 525 catalog number is not offered", () => {
    expect(offeredOwnNumber("Our Allen-Bradley PowerFlex 525 25B-D024N104 trips on F004 at start.", { manufacturer: "Allen-Bradley", model: "PowerFlex 525" })).toBeNull();
  });

  it("cost: an S7-1200 CPU's own order number is not offered on an S7-1200 card", () => {
    expect(offeredOwnNumber("Our Siemens S7-1200 6ES7214-1AG40-0XB0 shows a red error light.", { manufacturer: "Siemens", model: "S7-1200" })).toBeNull();
  });
});
