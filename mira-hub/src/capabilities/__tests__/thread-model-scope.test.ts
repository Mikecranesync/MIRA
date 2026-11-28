// A project's manual status names the project's machine. A thread inside that
// project that asked about a DIFFERENT exact model must not show it (staging
// tablet walk 2026-11-21: "Find me the manual for AutomationDirect GS11N-20P25"
// in a GS11N-20P2 project showed "…coverage for GS11N-20P2" plus the manual
// link under an answer that said GS11N-20P25 is not listed). #5750.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/thread-model-scope
import { describe, it, expect } from "vitest";
import { threadStatusScope } from "@/capabilities/notebook-manual-acquisition";
import { oemMakerTable } from "@/lib/manual-discovery";

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

// #6085 (staging tablet walk 2026-11-27): the technician ticked the order number on the
// identity card. The number is theirs, so the question that names it is the machine's own.
describe("threadStatusScope: a number the technician confirmed (#6085)", () => {
  const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
  const TP700 = { manufacturer: "Siemens", model: "TP700", catalogNumber: "", recordCatalog: null };
  const ticked = { ...TP700, confirmedNumbers: ["6AV2124-0GC01-0AX0"] };

  it("is own for the walk question once its order number is confirmed", () => {
    expect(threadStatusScope([J2], ticked)).toBe("own");
  });

  it("control: with no confirmed number the walk question is other", () => {
    expect(threadStatusScope([J2], TP700)).toBe("other");
    expect(threadStatusScope([J2], { ...TP700, confirmedNumbers: [] })).toBe("other");
  });

  it("control: a TP900 or another order number later in the thread is other", () => {
    expect(threadStatusScope([J2, "Find the manual for Siemens TP900 Comfort 6AV2124-0JC01-0AX0"], ticked)).toBe("other");
    expect(threadStatusScope([J2, "What about the 6AV2124-0JC01-0AX0?"], ticked)).toBe("other");
  });

  it("control: another maker named with the confirmed number is other", () => {
    expect(threadStatusScope(["Find the manual for Schneider Electric 6AV2124-0GC01-0AX0"], ticked)).toBe("other");
  });

  // #6127: two makers named make a confirmed number count for nothing; this machine's own model
  // keeps counting, as before, when another maker is mentioned beside it.
  it("two makers named with the confirmed number is other", () => {
    expect(threadStatusScope(["How do I wire the ABB 6AV2124-0GC01-0AX0 in our Siemens cabinet?"], ticked)).toBe("other");
  });

  it("control: the card's own model is own with another maker mentioned beside it", () => {
    const q = "Our Siemens TP700 is wired to an ABB drive. Why is the TP700 screen blank?";
    expect(threadStatusScope([q], TP700)).toBe("own");
    expect(threadStatusScope([q], ticked)).toBe("own");
  });

  // Accepted cost: the ticked number still counts for nothing when a second maker is named, even
  // beside the card's own model. That matches the scope before #6104.
  it("cost: the walk question with a second maker named stays other, ticked or not", () => {
    const q = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 is wired to an ABB drive and will not power up.";
    expect(threadStatusScope([q], TP700)).toBe("other");
    expect(threadStatusScope([q], ticked)).toBe("other");
  });

  // #6131 r1 F1: the saved-number rule reads makers from the folded question, as the model is
  // read, so another maker written with a nonbreaking hyphen beside a ticked number reads as it
  // does with the ASCII hyphen.
  it("another maker written with a nonbreaking hyphen beside a ticked number reads as the ASCII spelling does", () => {
    const ascii = "How do I wire the Allen-Bradley 6AV2124-0GC01-0AX0?";
    const nb = "How do I wire the Allen‑Bradley 6AV2124-0GC01-0AX0?";
    expect(threadStatusScope([ascii], ticked)).toBe("other"); // precondition: the ASCII reading
    expect(threadStatusScope([nb], TP700)).toBe("other"); // precondition: withheld without the tick
    expect(threadStatusScope([nb], ticked)).toBe("other");
  });

  // #6131 r2: without a ticked number, main's first maker check is unchanged. It reads the
  // question as typed, so a nonbreaking hyphen hides a maker from it, and two other makers read
  // as none. Folding it in round 1 admitted the second question below, which main withholds.
  it("known limit, as on main: with no ticked number the first maker check reads the question as typed", () => {
    expect(threadStatusScope(["Is the TP700 on the Allen‑Bradley network?"], TP700)).toBe("own");
    expect(threadStatusScope(["How do I wire the EATON TP700 on the Allen‑Bradley network?"], TP700)).toBe("other");
  });

  it("control: this machine's maker written with a nonbreaking hyphen is own", () => {
    const MICRO850 = { manufacturer: "Allen-Bradley", model: "Micro850", catalogNumber: "", recordCatalog: null };
    expect(threadStatusScope(["Find the manual for the Allen‑Bradley Micro850"], MICRO850)).toBe("own");
    expect(threadStatusScope(["Is the Micro850 on the Allen‑Bradley network?"], MICRO850)).toBe("own");
  });

  // #6131 r1 F2, r6: with only a ticked number making it own, this machine's maker counts however
  // it is written on record, a dictionary-word maker before its own number never counts against
  // it, and a machine with no maker on record counts no named maker as its own (fail closed).
  it("control: this machine's maker written in capitals on record is its own maker", () => {
    expect(threadStatusScope(["How do I wire the Siemens 6AV2124-0GC01-0AX0?"], { ...ticked, manufacturer: "SIEMENS" })).toBe("own");
  });

  it("control: a dictionary-word maker typed before this machine's own number is own", () => {
    const EATON = { manufacturer: "Eaton", model: "DG1", catalogNumber: "", recordCatalog: null, confirmedNumbers: ["DG1-344D1FN-C21C"] };
    expect(threadStatusScope(["How do I wire the Eaton DG1-344D1FN-C21C?"], EATON)).toBe("own");
    expect(threadStatusScope(["How do I wire the Eaton DG1-344D1FN-C21C?"], { ...EATON, confirmedNumbers: [] })).toBe("other"); // precondition
  });

  it("control: a dictionary-word maker typed before this machine's own quoted number is own", () => {
    const EATON = { manufacturer: "Eaton", model: "DG1", catalogNumber: "", recordCatalog: null, confirmedNumbers: ["DG1-344D1FN-C21C"] };
    expect(threadStatusScope(['How do I wire the Eaton "DG1-344D1FN-C21C"?'], EATON)).toBe("own");
    expect(threadStatusScope(["How do I wire the Eaton P/N:DG1-344D1FN-C21C?"], EATON)).toBe("own");
  });

  // #6131: each dictionary-word maker on record keeps its own number written after a label, and a
  // question that also names Siemens is still withheld.
  it.each(["Sick", "Banner", "Parker", "Eaton", "Emerson", "Phoenix"])("control: %s on record keeps its own labelled number", (maker) => {
    const own = { manufacturer: maker, model: "QX700", catalogNumber: "", recordCatalog: null, confirmedNumbers: ["QX700-12A-34B"] };
    for (const q of [`How do I wire the ${maker} order no. QX700-12A-34B?`, `How do I wire the ${maker} part number QX700-12A-34B?`]) {
      expect(threadStatusScope([q], { ...own, confirmedNumbers: [] })).toBe("other"); // precondition: withheld without the tick
      expect(threadStatusScope([q], own)).toBe("own");
    }
    expect(threadStatusScope([`Is this a ${maker} or a Siemens QX700-12A-34B?`], own)).toBe("other");
  });

  // #6131 r2 F5: a maker on record under a spelling the alias table knows (the OCR "Alien-Bradley")
  // is still this machine's maker when the question spells it properly.
  it("a maker on record under a known alias keeps its ticked number", () => {
    const AL = { manufacturer: "Alien-Bradley", model: "Micro850", catalogNumber: "", recordCatalog: null, confirmedNumbers: ["Micro850-12A"] };
    expect(threadStatusScope(["How do I wire the Allen-Bradley Micro850-12A?"], AL)).toBe("own");
    expect(threadStatusScope(["How do I wire the Allen-Bradley Micro850-12A?"], { ...AL, confirmedNumbers: [] })).toBe("other"); // precondition
    expect(threadStatusScope(["How do I wire the Siemens Micro850-12A?"], AL)).toBe("other"); // control: a conflicting maker
  });

  // #6131 r2 F5, over the whole maker table: with a maker on record, its ticked number named after
  // that same maker is own, however either side spells it (as listed, capitals, title case, U+2011).
  it("every maker on the table keeps its own ticked number in every spelling", () => {
    const NUMBER = "QX700-12A-34B";
    const spellings = (s: string) => [...new Set([s, s.toUpperCase(), s.replace(/\b[a-z]/g, (c) => c.toUpperCase()), s.replace(/-/g, "‑")])];
    const misses: string[] = [];
    let rows = 0;
    for (const { name } of oemMakerTable()) {
      for (const stored of spellings(name)) {
        for (const asked of spellings(name)) {
          const machine = { manufacturer: stored, model: "QX700", catalogNumber: "", recordCatalog: null };
          const q = `How do I wire the ${asked} ${NUMBER}?`;
          rows++;
          if (threadStatusScope([q], { ...machine, confirmedNumbers: [] }) !== "other") misses.push(`precondition ${stored} / ${asked}`);
          if (threadStatusScope([q], { ...machine, confirmedNumbers: [NUMBER] }) !== "own") misses.push(`${stored} / ${asked}`);
        }
      }
    }
    expect(rows).toBeGreaterThan(100);
    expect(misses).toEqual([]);
  });

  it("with no maker on record, a named maker makes the confirmed number count for nothing", () => {
    const NO_MAKER = { ...ticked, manufacturer: "" };
    expect(threadStatusScope(["How do I wire the 6AV2124-0GC01-0AX0?"], NO_MAKER)).toBe("own"); // control
    expect(threadStatusScope(["How do I wire the Siemens 6AV2124-0GC01-0AX0?"], NO_MAKER)).toBe("other");
  });

  // Known limit (#6146, #6131 r6): a maker that is also an ordinary word never counts in this rule,
  // in any case; written after the number it reads as an ordinary word too.
  it("known limit: title-case Eaton written after the confirmed number is not read as a maker", () => {
    expect(threadStatusScope(["How do I wire the 6AV2124-0GC01-0AX0 from Eaton in our Siemens cabinet?"], ticked)).toBe("own");
  });
});
