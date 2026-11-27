// A project's manual status names the project's machine. A thread inside that
// project that asked about a DIFFERENT exact model must not show it (staging
// tablet walk 2026-11-21: "Find me the manual for AutomationDirect GS11N-20P25"
// in a GS11N-20P2 project showed "…coverage for GS11N-20P2" plus the manual
// link under an answer that said GS11N-20P25 is not listed). #5750.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/thread-model-scope
import { describe, it, expect } from "vitest";
import { threadStatusScope } from "@/capabilities/notebook-manual-acquisition";

const GS10 = { manufacturer: "AutomationDirect", model: "GS11N-20P2", catalogNumber: "", recordCatalog: null };
const CONFIRMED = { manufacturer: "AutomationDirect", model: "DURApulse GS10", catalogNumber: "GS11N-20P2", recordCatalog: "GS11N-20P2" };

describe("threadStatusScope", () => {
  it("is other for a look-alike model named with its maker", () => {
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P25"], GS10)).toBe("other");
  });

  it("is own for the project's own model", () => {
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P2"], GS10)).toBe("own");
  });

  it("settles nothing for the photo turn, a follow-up, or an empty thread", () => {
    expect(threadStatusScope(["Find me the manual"], GS10)).toBe("undecided");
    expect(threadStatusScope(["What does the keypad show?"], GS10)).toBe("undecided");
    expect(threadStatusScope([], GS10)).toBe("undecided");
  });

  // #5750 r2: the family whose manual covers the project's drive is the
  // project's own manual, with or without its maker (was a known limit).
  it("is own for the family whose manual covers the project's drive", () => {
    expect(threadStatusScope(["Find me the GS10 manual"], GS10)).toBe("own");
    expect(threadStatusScope(["Find me the AutomationDirect GS10 manual"], GS10)).toBe("own");
    expect(threadStatusScope(["Find me the AutomationDirect GS10 manual"], CONFIRMED)).toBe("own");
  });

  it("control: another drive family of the same maker is other", () => {
    expect(threadStatusScope(["Find me the manual for the GS1 drive"], GS10)).toBe("other");
    expect(threadStatusScope(["Find me the AutomationDirect GS20 manual"], GS10)).toBe("other");
  });

  it("control: fault codes, ratings and wiring words name no model", () => {
    expect(threadStatusScope(["what does oC mean, it is 3-phase 230V on RS-485"], GS10)).toBe("undecided");
    expect(threadStatusScope(["I set P09-03 to 5, the input is 0-10V, installed 2026-11-21"], GS10)).toBe("undecided");
  });

  it("matches the catalog number as the project's identifier", () => {
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P2"], CONFIRMED)).toBe("own");
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P25"], CONFIRMED)).toBe("other");
  });

  it("decides on the newest question that settles it", () => {
    const questions = [
      "Find me the manual for AutomationDirect GS11N-20P25",
      "What does the keypad show?",
      "Find me the manual for AutomationDirect GS11N-20P2",
    ];
    expect(threadStatusScope(questions, GS10)).toBe("own");
    expect(threadStatusScope([...questions].reverse(), GS10)).toBe("other");
  });

  // #5750 Codex F2: a model-only request and a conflicting maker.
  it("is other for a look-alike named without a maker", () => {
    expect(threadStatusScope(["Find me the manual for GS11N-20P25"], GS10)).toBe("other");
    expect(threadStatusScope(["what does oC mean on a GS11N-20P25"], GS10)).toBe("other");
  });

  it("is other for the same model code under another maker", () => {
    expect(threadStatusScope(["Find me the manual for Siemens GS11N-20P2"], GS10)).toBe("other");
  });

  it("is own for the project's model under an alias of its maker, or with no maker", () => {
    expect(threadStatusScope(["Find me the manual for Automation Direct GS11N-20P2"], GS10)).toBe("own");
    expect(threadStatusScope(["what does oC mean on the GS11N-20P2"], GS10)).toBe("own");
  });

  // #5750 r2 F2: model-only requests the catalog regex did not read.
  it("is other for a model-only sibling outside the GS catalog pattern", () => {
    const acs = { manufacturer: "ABB", model: "ACS355", catalogNumber: "", recordCatalog: null };
    expect(threadStatusScope(["Find the manual for ACS580"], acs)).toBe("other");
    expect(threadStatusScope(["Find the manual for ACS355"], acs)).toBe("own");
    const pf = { manufacturer: "Allen-Bradley", model: "PowerFlex 525", catalogNumber: "25B-D017N104", recordCatalog: null };
    expect(threadStatusScope(["Find me the manual for 25B-D024N104"], pf)).toBe("other");
    expect(threadStatusScope(["Find me the manual for 25B-D017N104"], pf)).toBe("own");
    expect(threadStatusScope(["Find me the manual for the PowerFlex 525"], pf)).toBe("own");
  });

  // #5750 r3 F2: Unicode hyphens and compact codes.
  it("reads a nonbreaking-hyphen catalog number as the ASCII one", () => {
    const pf = { manufacturer: "Allen-Bradley", model: "PowerFlex 525", catalogNumber: "25B-D017N104", recordCatalog: null };
    expect(threadStatusScope(["Find me the manual for 25B\u2011D024N104"], pf)).toBe("other");
    expect(threadStatusScope(["Find me the manual for 25B\u2011D017N104"], pf)).toBe("own");
  });

  it("is other for a compact sibling code, by shared leading characters or in a document request", () => {
    const ca = { manufacturer: "Schneider Electric", model: "CA3KN22BD", catalogNumber: "", recordCatalog: null };
    expect(threadStatusScope(["Find the manual for CA3KN31BD"], ca)).toBe("other");
    expect(threadStatusScope(["does the CA3KN31BD have a 24V coil"], ca)).toBe("other");
    expect(threadStatusScope(["Find the datasheet for LC1D09BD"], ca)).toBe("other");
    expect(threadStatusScope(["Find the manual for CA3KN22BD"], ca)).toBe("own");
  });

  it("is other for a hyphenated catalog code outside a request and without a shared prefix", () => {
    expect(threadStatusScope(["does the 1756-L71 need a battery"], GS10)).toBe("other");
  });

  // #5746 r9 F18: a range of ratings ("208-230VAC") is hyphenated and carries a digit on both
  // sides, but it is not a catalog number.
  it("a range of ratings names no model", () => {
    expect(threadStatusScope(["What does the manual say about the 208-230VAC input range?"], GS10)).toBe("undecided");
    expect(threadStatusScope(["is 380-480VAC at 50-60HZ ok, and the 4-20MA signal"], GS10)).toBe("undecided");
    expect(threadStatusScope(["does the GS11N-20P2 take 208-230VAC"], GS10)).toBe("own");
  });

  it("control: a sibling catalog code beside a range is still other", () => {
    expect(threadStatusScope(["does the 1756-L71 take 18-32VDC"], GS10)).toBe("other");
  });

  it("is other for a one-letter model family the document is asked for", () => {
    expect(threadStatusScope(["Find me the G120 manual"], GS10)).toBe("other");
    expect(threadStatusScope(["Find the manual for E300"], GS10)).toBe("other");
    expect(threadStatusScope(["Find the manual for the I550"], GS10)).toBe("other");
  });

  it("control: fault codes and parameters never name a model, even in a document request", () => {
    const ca = { manufacturer: "Schneider Electric", model: "CA3KN22BD", catalogNumber: "", recordCatalog: null };
    expect(threadStatusScope(["what does the manual say about F0004"], GS10)).toBe("undecided");
    expect(threadStatusScope(["what does the manual say about parameter P09-03"], GS10)).toBe("undecided");
    expect(threadStatusScope(["the coil hums, error E001 on the panel"], ca)).toBe("undecided");
    expect(threadStatusScope(["Find the manual for parameter P09-03"], GS10)).toBe("undecided");
    expect(threadStatusScope(["what does E001 mean in the manual"], GS10)).toBe("undecided");
    expect(threadStatusScope(["Find the manual for fault F0004"], GS10)).toBe("undecided");
    expect(threadStatusScope(["Check the manual for error E001"], GS10)).toBe("undecided");
  });

  // #5750 r2 F3: a model named in the same question beats the return phrase.
  it("is other when the return phrase names a sibling in the same question", () => {
    expect(threadStatusScope(["OK, back to my drive. Does the GS11N-20P25 need a brake resistor?"], CONFIRMED)).toBe("other");
    expect(threadStatusScope(["OK, back to my drive, the GS11N-20P2. Does it need a brake resistor?"], CONFIRMED)).toBe("own");
  });

  // #5750 Codex F3: an explicit return to the confirmed unit is a boundary.
  it("is own after a return to the confirmed unit, and on the follow-up after it", () => {
    const sibling = "Find me the manual for AutomationDirect GS11N-20P25";
    const back = "OK, back to my drive. Find me the manual.";
    expect(threadStatusScope([sibling, back], CONFIRMED)).toBe("own");
    expect(threadStatusScope([sibling, back, "What is the rated current?"], CONFIRMED)).toBe("own");
  });

  it("control: without a confirmed catalog number, 'my drive' refers to nothing on record", () => {
    const back = "OK, back to my drive. Find me the manual.";
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P25", back], GS10)).toBe("other");
  });
});

// #6085 (staging tablet walk 2026-11-27): "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 …"
// offered "Is this a Siemens TP700?"; after "Use its manuals" the order number in that same
// question made the thread "about another model", so the lookup outcome never showed there.
// The question MIRA saved that identity card on is about the machine the technician confirmed.
describe("threadStatusScope: the question an identity card was saved on (#6085)", () => {
  const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
  const TP700 = { manufacturer: "Siemens", model: "TP700", catalogNumber: "", recordCatalog: null };
  const card = (question: string, manufacturer: string, model: string) => ({ question, manufacturer, model });
  const withCard = { ...TP700, cards: [card(J2, "Siemens", "TP700")] };

  it("is own for the question the confirmed machine's card was saved on", () => {
    expect(threadStatusScope([J2], withCard)).toBe("own");
  });

  it("control: the same question with no saved card is still other", () => {
    expect(threadStatusScope([J2], TP700)).toBe("other");
  });

  it("is own when a later question names the same order number again", () => {
    expect(threadStatusScope([J2, "Does the 6AV2124-0GC01-0AX0 need a fuse?"], withCard)).toBe("own");
  });

  it("control: another order number, another panel or another maker is still other", () => {
    expect(threadStatusScope([J2, "What about the 6AV2124-0JC01-0AX0?"], withCard)).toBe("other");
    expect(threadStatusScope([J2, "Find the manual for Siemens TP900 Comfort 6AV2124-0JC01-0AX0"], withCard)).toBe("other");
    expect(threadStatusScope([J2, "Find the manual for Schneider Electric CA3KN22BD"], withCard)).toBe("other");
  });

  it("control: a card for another model does not make its question own", () => {
    const tp900 = "Our Siemens TP900 Comfort panel 6AV2124-0JC01-0AX0 will not power up.";
    expect(threadStatusScope([tp900], { ...TP700, cards: [card(tp900, "Siemens", "TP900")] })).toBe("other");
  });

  it("control: a card under another maker does not make its question own", () => {
    expect(threadStatusScope([J2], { ...TP700, cards: [card(J2, "ABB", "TP700")] })).toBe("other");
  });

  it("control: a card with an empty maker or model never matches", () => {
    // One identifier the record does not hold, so only the guard keeps it out.
    const tp900 = "Does the TP900 need a fuse?";
    const noMaker = { manufacturer: null, model: "TP700", catalogNumber: "", recordCatalog: null };
    expect(threadStatusScope([tp900], noMaker)).toBe("other");
    expect(threadStatusScope([tp900], { ...noMaker, cards: [card(tp900, "", "TP700")] })).toBe("other");
    const noModel = { manufacturer: "Siemens", model: null, catalogNumber: "6AV2124-0GC01-0AX0", recordCatalog: null };
    expect(threadStatusScope([tp900], noModel)).toBe("other");
    expect(threadStatusScope([tp900], { ...noModel, cards: [card(tp900, "Siemens", "")] })).toBe("other");
  });

  it("matches the card's maker through its vendor group and the model in any spacing", () => {
    expect(threadStatusScope([J2], { ...TP700, cards: [card(J2, "SIEMENS", "tp 700")] })).toBe("own");
  });

  it("control: a card's question naming two identifiers is not read as one machine's markings", () => {
    const q = "Our ABB ACS355 ACS355-03E-07A3-4 sits next to an ACS355-03E-09A8-4. Which fuse?";
    const acs = { manufacturer: "ABB", model: "ACS355", catalogNumber: "", recordCatalog: null };
    const carded = { ...acs, cards: [card(q, "ABB", "ACS355")] };
    expect(threadStatusScope([q], carded)).toBe("other");
    expect(threadStatusScope([q, "Does the ACS355-03E-07A3-4 need a fuse?"], carded)).toBe("other");
    expect(threadStatusScope([q, "Does the ACS355-03E-09A8-4 need a fuse?"], carded)).toBe("other");
  });

  it("is own for an ABB ACS355 typed with its type code", () => {
    const q = "Our ABB ACS355 ACS355-03E-07A3-4 shows fault 0001. What does it mean?";
    const acs = { manufacturer: "ABB", model: "ACS355", catalogNumber: "", recordCatalog: null };
    expect(threadStatusScope([q], acs)).toBe("other");
    const carded = { ...acs, cards: [card(q, "ABB", "ACS355")] };
    expect(threadStatusScope([q], carded)).toBe("own");
    expect(threadStatusScope([q, "and the ACS355-03E-09A8-4 beside it?"], carded)).toBe("other");
  });

  // Codex #6094 r1 F1/F2: a number read off a card's question is the machine's only when nothing
  // on record says otherwise and every matching card agrees. Disagreement adds nothing.
  const Q07 = "Our ABB ACS355 ACS355-03E-07A3-4 shows fault 0001. What does it mean?";
  const Q09 = "Our ABB ACS355 ACS355-03E-09A8-4 shows fault 0002. What does it mean?";
  const PAIR = "Our ABB ACS355 ACS355-03E-07A3-4 sits next to an ACS355-03E-09A8-4. Which fuse?";
  const F07 = "Does the ACS355-03E-07A3-4 need a fuse?";
  const F09 = "Does the ACS355-03E-09A8-4 need a fuse?";
  const ACS = { manufacturer: "ABB", model: "ACS355", catalogNumber: "", recordCatalog: null as string | null };
  const acsCard = (q: string) => card(q, "ABB", "ACS355");

  it("a confirmed catalog number wins over an older card's number", () => {
    const record = { ...ACS, catalogNumber: "ACS355-03E-09A8-4", recordCatalog: "ACS355-03E-09A8-4", cards: [acsCard(Q07)] };
    expect(threadStatusScope([Q07], record)).toBe("other");
    expect(threadStatusScope([Q07, F07], record)).toBe("other");
    expect(threadStatusScope([Q07, F09], record)).toBe("own");
  });

  it("either confirmed catalog field alone keeps a card's number out", () => {
    expect(threadStatusScope([Q07, F07], { ...ACS, catalogNumber: "ACS355-03E-09A8-4", cards: [acsCard(Q07)] })).toBe("other");
    expect(threadStatusScope([Q07, F07], { ...ACS, recordCatalog: "ACS355-03E-09A8-4", cards: [acsCard(Q07)] })).toBe("other");
  });

  it("cards that name different numbers add none, in either order", () => {
    for (const cards of [[acsCard(Q07), acsCard(PAIR)], [acsCard(PAIR), acsCard(Q07)], [acsCard(Q07), acsCard(Q09)]]) {
      expect(threadStatusScope([Q07, F07], { ...ACS, cards })).toBe("other");
      expect(threadStatusScope([Q07, F09], { ...ACS, cards })).toBe("other");
    }
  });

  it("control: cards that name the same number, or no number, still agree", () => {
    const again = "Our ABB ACS355 ACS355-03E-07A3-4 trips on start. Why?";
    const plain = "Our ABB ACS355 will not start. Why?";
    expect(threadStatusScope([Q07, F07], { ...ACS, cards: [acsCard(Q07), acsCard(again)] })).toBe("own");
    expect(threadStatusScope([Q07, F07], { ...ACS, cards: [acsCard(plain), acsCard(Q07)] })).toBe("own");
    expect(threadStatusScope([Q07, F09], { ...ACS, cards: [acsCard(plain), acsCard(Q07)] })).toBe("other");
  });

  it("control: a card for another machine does not count as disagreeing", () => {
    const other = "Our ABB ACS580 ACS580-01-12A7-4 shows fault 2310. What does it mean?";
    expect(threadStatusScope([Q07, F07], { ...ACS, cards: [card(other, "ABB", "ACS580"), acsCard(Q07)] })).toBe("own");
  });
});
