// #5369 — is a manual shown to be for the asked model number?
//
// Pure-function tests for manual-applicability.ts. The end-to-end rows (the
// real admission path, with citations) are the synthetic-technician bench.
// Every model and part number here is invented ("Northfield RX4xx") unless the
// row says it is typed from a public cover.
import { describe, expect, it } from "vitest";
import {
  isTitleLine,
  manualAnswersFor,
  modelNumbersIn,
  summarizeUnlistedRefusals,
  unlistedModelNumbers,
  unlistedModelRefusalText,
  type ManualVerdict,
} from "../manual-applicability";
import { NAMEPLATE_BODY_MARK, NAMEPLATE_OPENER, PHOTO_READING_BODY_MARK, PHOTO_READING_OPENER, buildPhotoSourceText, photoDocumentBody } from "../photo-document-text";

const keys = (text: string) => modelNumbersIn(text).map((n) => n.key);
const asked = (text: string) => unlistedModelNumbers(text);
const OPAQUE = "NF0000021.pdf";
const verdict = (question: string, heading: string, filename = OPAQUE): ManualVerdict =>
  manualAnswersFor(asked(question), heading, filename);
const kindOf = (v: ManualVerdict) => (v.admit ? "answers" : v.kind);
const refusal = (v: ManualVerdict) => {
  if (v.admit) throw new Error("expected a refusal");
  return v;
};

describe("what reads as a model number", () => {
  it.each([
    ["RX420 supply voltage?", ["RX420"]],
    ["the RX-420 controller", ["RX420"]],
    ["Supply voltage for 2080-LC99-99ZZZ?", ["2080LC9999ZZZ"]],
    ["coil voltage of the CA3KN22BD", ["CA3KN22BD"]],
    ["rx410-hardware-guide", ["RX410"]],
    ["2080-in009 -en-p", ["2080IN009"]],
  ])("%s", (text, want) => expect(keys(text)).toEqual(want));

  it.each([
    "Is the coil 24VDC or 48VDC?",
    "690V contact limit, 4-20mA loop, 100-240VAC supply",
    "2 NO + 2 NC, 3-Phase, 20-Point",
    "IP20 enclosure, RS485 port, NEMA4X, CAT5E cable, IEC61131",
    "parameter P09.03 and the 1st step",
    "What supply voltage does it need?",
  ])("a rating, a standard or a count is not one: %s", (text) => expect(keys(text)).toEqual([]));

  it("keeps the shown spelling and compares without hyphens", () => {
    expect(modelNumbersIn("2080-LC20-20QBB")).toEqual([{ key: "2080LC2020QBB", label: "2080-LC20-20QBB" }]);
  });
});

describe("numbers the existing detector already reads are left to it, whole", () => {
  it.each([
    "Which parameter sets acceleration time on the GS11N-20P2?",
    "Which parameter on the GS11N - 20P2?",
    "What supply voltage does the Micro820 need?",
    "PowerFlex 525 fault F0004",
    "SMC-50 or SMC Flex?",
    "Wiring for the Micro820-20QBB",
    "Micro850-48QWB supply",
  ])("%s", (text) => {
    expect(asked(text).map((n) => n.key).filter((k) => k !== "F0004")).toEqual([]);
  });

  it("a number beside a detector-read one is still returned", () => {
    expect(asked("Wire the Micro820 to the RX420").map((n) => n.key)).toEqual(["RX420"]);
  });
});

describe("a title line, and what is not one", () => {
  // Typed from public covers, or the same shape with an invented number.
  it.each([
    "Northfield RX410 Logic Controller",
    "Northfield RX410 and RX420 Logic Controllers",
    "ACS355 User's manual",
    "TP1200 Comfort Operating Instructions",
    "SINAMICS G120C converter Operating Instructions",
    "PowerFlex 520-Series Adjustable Frequency AC Drive",
    "User Manual for the RX410",
    "Catalog Numbers: 2080-LC20-20QWB, 2080-LC20-20QBB",
    "CA3KN22BD",
    "RX410 - Hardware User Guide",
    "RX410 \u2014 Logic Controller",
    "RX410: Hardware User Guide",
  ])("title: %s", (line) => expect(isTitleLine(line)).toBe(true));

  it.each([
    "RX420 is not covered by this manual.",
    "For RX420 see the separate manual.",
    "RX420 NOT COVERED BY THIS MANUAL",
    "RX420 Excluded",
    "Excluding RX420 Logic Controller",
    "Omitting RX420 Controller",
    "Not for RX420",
    "RX420 sold separately",
    "Replaces RX420 Logic Controller",
    "Unlike the RX420",
    "RX410 (not RX420) Logic Controller",
    "RX410 User Manual — for RX420 consult the separate manual",
    "RX420: NF0000022",
    "RX420 manual: NF0000022",
    "RX410 User Manual. RX420 is covered elsewhere",
    "Also applies to RX420 Controller",
    "RX420 Controller Unavailable",
    "RX420 Controller differs",
    // No sentence word at all: only the punctuation or the mark gives these away.
    "RX420 Controller. Sold elsewhere",
    "RX420 Logic Controller ordered elsewhere.",
    "RX420 - NF0000022",
    "RX420 \u2014 order code NF0000022",
    "RX420; RX410 Logic Controller",
    // A mark after the number, then words that are no product or document noun.
    "RX420: sold elsewhere",
  ])("not a title: %s", (line) => expect(isTitleLine(line)).toBe(false));
});

describe("one manual, one asked number", () => {
  const TITLED = "Northfield RX410 Logic Controller\nHardware User Guide";

  it("answers when the title names it", () => expect(kindOf(verdict("RX410 supply voltage?", TITLED))).toBe("answers"));
  it("refuses a look-alike the title does not name, and says what the cover declares", () => {
    expect(verdict("RX420 supply voltage?", TITLED)).toEqual({ admit: false, kind: "other-model", asked: ["RX420"], declared: ["RX410"] });
  });
  it("has no opinion when nothing on the cover or file resembles the number", () => {
    expect(kindOf(verdict("What does fault F0004 mean?", TITLED))).toBe("answers");
    expect(kindOf(verdict("RX420 supply voltage?", "Hardware User Guide\nOriginal instructions"))).toBe("answers");
  });
  it("a fault code that shares the letters but not the digit layout is not a look-alike", () => {
    expect(kindOf(verdict("What does RX0093 mean?", TITLED))).toBe("answers");
    expect(kindOf(verdict("What does RX93 mean?", TITLED))).toBe("answers");
  });
  // The relation #5371's reviews settled, one boundary per test so each half is pinned.
  it("same letters and first digit but another digit count is not a look-alike", () => {
    expect(kindOf(verdict("What does RX4093 mean?", TITLED))).toBe("answers");
  });
  it("same letters and digit count but another first digit is not a look-alike (stated limit)", () => {
    expect(kindOf(verdict("RX910 supply voltage?", TITLED))).toBe("answers");
  });
  it("other letters in front are another family", () => {
    expect(kindOf(verdict("TX420 supply voltage?", TITLED))).toBe("answers");
    expect(kindOf(verdict("Coil voltage of the LP3KN99ZZ?", "standard coil\nCA3KN22BD"))).toBe("answers");
  });

  // Each of these was a way to get a sibling's manual admitted.
  it.each([
    ["exclusion sentence", "RX420 is not covered by this manual.\nHardware User Guide"],
    ["pointer sentence", "For RX420 see the separate manual.\nHardware User Guide"],
    ["exclusion in capitals", "RX420 NOT COVERED BY THIS MANUAL\nHARDWARE USER GUIDE"],
    ["exclusion with no small word", "RX420 Excluded\nHardware User Guide"],
    ["exclusion wrapped onto the next line", "RX420 Logic Controller\nis not covered by this manual.\nHardware User Guide"],
    ["the same, next line capitalised", "RX420 Logic Controller\nIs not covered by this manual.\nHardware User Guide"],
    ["the same, with a blank line between", "RX420 Logic Controller\n\nIs not covered by this manual.\nHardware User Guide"],
    ["exclusion wrapped from the line above", "Hardware User Guide\nThis manual does not cover the\nRX420 Logic Controller"],
    ["a label above", "Hardware User Guide\nNot covered:\nRX420 Logic Controller"],
    ["a related-documents label above", "Hardware User Guide\nRelated documents:\nRX420 Logic Controller Hardware User Guide"],
    ["pointer on the next line", "RX420 Logic Controller\nSee the separate manual\nHardware User Guide"],
    ["a bare note with no title noun beside it", "RX420 pending"],
    ["a wrapped remark that starts in lower case, with no verb first", "RX420 Logic Controller\nand accessories ship in another box\nHardware User Guide"],
    ["a wrapped remark that starts with an exclusion word", "RX420 Logic Controller\nExcluded from this manual\nHardware User Guide"],
    ["a row of a cross-reference table", "Hardware User Guide\nOriginal instructions\nRevision C\nRX420 NF0000022"],
    ["a model with no product or document word on or beside its line (stated limit)", "Hardware User Guide\nOriginal instructions\nRevision C 2019\nNorthfield RX420 2019"],
    ["a pointer line does not lend its noun", "Northfield RX420\nSee the RX430 guide"],
  ])("refuses, coverage not shown: %s", (_why, heading) => {
    expect(kindOf(verdict("What supply voltage does the RX420 accept?", heading))).toBe("coverage-not-shown");
  });

  it("reads only the first cover line that carries the family", () => {
    const heading = "Northfield RX410 Logic Controller Hardware User Guide\nRelated Publications\nRX420 Logic Controller Hardware User Guide";
    expect(kindOf(verdict("RX410 supply voltage?", heading))).toBe("answers");
    expect(kindOf(verdict("RX420 supply voltage?", heading))).toBe("other-model");
  });

  it("a model on its own line takes its title noun from the line beside it", () => {
    expect(kindOf(verdict("G120C fault?", "SINAMICS G120C\nOperating Instructions"))).toBe("answers");
    expect(kindOf(verdict("RX410 supply voltage?", "Hardware User Guide\nNorthfield RX410"))).toBe("answers");
  });

  it("a pointer below that names its own number is a new line, not the end of the title's sentence", () => {
    const heading = "Northfield RX410 Logic Controller\nSee publication NF0000022 for the RX420";
    expect(kindOf(verdict("RX410 supply voltage?", heading))).toBe("answers");
    expect(kindOf(verdict("RX420 supply voltage?", heading))).toBe("other-model");
  });

  it("a real title beside a sentence refuses (stated limit)", () => {
    expect(kindOf(verdict("RX410 supply voltage?", "Read this manual before use\nNorthfield RX410 Logic Controller"))).toBe("coverage-not-shown");
  });
});

describe("the filename", () => {
  const GENERIC = "Hardware User Guide\nOriginal instructions";
  it("counts when the cover carries no number of the family", () => {
    expect(kindOf(verdict("RX410 supply voltage?", GENERIC, "rx410-hardware-guide.pdf"))).toBe("answers");
  });
  it("naming a look-alike refuses, and is never published as what the manual declares", () => {
    expect(verdict("RX420 supply voltage?", GENERIC, "rx410-hardware-guide.pdf")).toEqual({ admit: false, kind: "coverage-not-shown", asked: ["RX420"], declared: [] });
  });
  it("cannot rescue a cover whose only mention is prose", () => {
    expect(kindOf(verdict("RX420 supply voltage?", "RX420 is not covered by this manual.\nHardware User Guide", "rx420-notes.pdf"))).toBe("coverage-not-shown");
  });
  it("disagreeing with the cover refuses for either model", () => {
    const heading = "Northfield RX420 Logic Controller\nHardware User Guide";
    expect(kindOf(verdict("RX420 supply voltage?", heading, "rx410-hardware-guide.pdf"))).toBe("cover-and-file-disagree");
    expect(kindOf(verdict("RX410 supply voltage?", heading, "rx410-hardware-guide.pdf"))).toBe("cover-and-file-disagree");
  });
  it.each(["scan_2019_final-rev2.pdf", "manual (1).pdf", "NF0000021.pdf", "2080-in009_-en-p.pdf"])(
    "a stale or opaque name that names no look-alike changes nothing: %s", (filename) => {
      expect(kindOf(verdict("RX410 supply voltage?", "Northfield RX410 Logic Controller\nHardware User Guide", filename))).toBe("answers");
    });
});

describe("catalog numbers", () => {
  // Typed from the public Micro820 installation sheet's cover.
  const SHEET = "Installation Instructions\nMicro820 20-Point Programmable Controllers\n"
    + "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n2080-LC20-20QBBR, 2080-LC20-20AWBR";
  const FILE = "2080-in009_-en-p.pdf";

  it.each(["2080-LC20-20QWB", "2080-LC20-20QBB", "2080-LC20-20AWBR"])("a listed number answers, across the wrapped list: %s", (n) => {
    expect(kindOf(verdict(`Supply voltage for the ${n}?`, SHEET, FILE))).toBe("answers");
  });
  it("an unlisted number of the same layout refuses and names what the sheet lists", () => {
    const v = verdict("Supply voltage for 2080-LC99-99ZZZ?", SHEET, FILE);
    expect(v.admit).toBe(false);
    if (!v.admit) expect(v).toMatchObject({ kind: "other-model", declared: expect.arrayContaining(["2080-LC20-20QBB"]) });
  });
  it("the sheet's own publication-number filename is not a conflicting look-alike", () => {
    expect(keys(FILE)).toEqual(["2080IN009"]);
    expect(kindOf(verdict("Supply voltage for the 2080-LC20-20QBB?", SHEET, FILE))).toBe("answers");
  });
  it("a relay part number alone on its line, under lines with ratings, is its title", () => {
    const relay = "Control relay, TeSys K, 2 NO + 2\nNC, lt or eq to 690V, 24VDC\nstandard coil\nCA3KN22BD";
    expect(kindOf(verdict("Coil voltage of the CA3KN22BD?", relay, "DS0004417.pdf"))).toBe("answers");
    expect(kindOf(verdict("Coil voltage of the CA3KN99ZZ?", relay, "DS0004417.pdf"))).toBe("other-model");
  });
});

describe("a question that names more than one number", () => {
  const RX410 = "Northfield RX410 Logic Controller\nHardware User Guide";
  const BOTH = "Northfield RX410 and RX420 Logic Controllers\nHardware User Guide";

  it("naming the manual's own model elsewhere in the question does not switch the check off", () => {
    const v = verdict("The RX420 replaced an RX410, what supply voltage does the RX420 accept?", RX410);
    expect(v).toMatchObject({ admit: false, kind: "several-look-alikes", asked: ["RX420", "RX410"] });
  });
  it("a manual shown to cover both answers", () => {
    expect(kindOf(verdict("Compare the RX410 and RX420 supply voltages.", BOTH))).toBe("answers");
  });
  it("a fault code beside the model changes nothing", () => {
    expect(kindOf(verdict("What does fault F0004 mean on the RX410?", RX410))).toBe("answers");
  });
});

describe("the reply text", () => {
  it("names the asked number and what the cover declares, and nothing from the manual's body", () => {
    const r = summarizeUnlistedRefusals([refusal(verdict("RX420 supply voltage?", "Northfield RX410 Logic Controller\nHardware User Guide"))], "question");
    expect(unlistedModelRefusalText(r)).toBe(
      "The manual in this notebook is for the RX410, not the RX420 you asked about, so I won't answer from it — its values may not apply to the RX420. Add the RX420 manual (or the page that covers it) to this notebook and ask again.",
    );
  });
  it("says the notebook's machine, not 'you asked about', when the number came from the notebook", () => {
    const r = summarizeUnlistedRefusals([refusal(manualAnswersFor(asked("CA3KN22BD"), "standard coil\nCA3KN31BD", "DS1.pdf"))], "notebook");
    expect(unlistedModelRefusalText(r)).toContain("not the CA3KN22BD this notebook is set up for");
  });
  it("manuals refused for different reasons share only the weakest claim, and no cover number", () => {
    const r = summarizeUnlistedRefusals([
      refusal(verdict("RX420 supply voltage?", "Northfield RX410 Logic Controller\nHardware User Guide")),
      refusal(verdict("RX420 supply voltage?", "RX420 is not covered by this manual.\nHardware User Guide")),
    ], "question");
    expect(r).toEqual({ kind: "coverage-not-shown", asked: ["RX420"], declared: [], source: "question" });
    expect(unlistedModelRefusalText(r)).not.toContain("RX410");
  });
  it.each(["other-model", "coverage-not-shown", "cover-and-file-disagree", "several-look-alikes"] as const)(
    "%s never tells the technician to drop the model number to get an answer", (kind) => {
      const text = unlistedModelRefusalText({ kind, asked: ["RX420", "RX410"], declared: ["RX410"], source: "question" });
      expect(text).not.toMatch(/without the model|leave out|drop the/i);
      expect(text).toMatch(/won't answer/);
    });
});

// Cases from an independent adversarial read of the rule (2026-11-10). Each was
// run red against the first version before anything was changed.
describe("variants of one part number", () => {
  it.each([
    ["a coil-voltage code", "What is the coil inrush for the LC1D09BD?", "LC1D09B7 Contactor\nInstruction Sheet", "LC1D09B7_sheet.pdf", "LC1D09B7"],
    ["one more character on the end", "Coil voltage of the CA3KN22BD?", "Control relay\nCA3KN22BD3", "DS1.pdf", "CA3KN22BD3"],
    ["a letter on the end", "RX420 supply voltage?", "Northfield RX420S Logic Controller\nHardware User Guide", OPAQUE, "RX420S"],
    ["the shorter base number", "RX420S supply voltage?", "Northfield RX420 Logic Controller\nHardware User Guide", OPAQUE, "RX420"],
  ])("refuses %s, naming what the cover declares", (_why, question, heading, filename, declared) => {
    expect(verdict(question, heading, filename)).toMatchObject({ admit: false, kind: "other-model", declared: [declared] });
  });

  it("a longer order code is not a variant: more than two characters are added", () => {
    expect(kindOf(verdict("ACS355 fault 2?", "ACS355-03E-05A6-4 Drives\nUser's manual"))).toBe("answers");
  });
  it("three characters added is not a variant (stated limit)", () => {
    expect(kindOf(verdict("CA3KN22 coil voltage?", "Control relay\nCA3KN22BD3", "DS1.pdf"))).toBe("answers");
  });
  it("nor is three characters fewer: the limit holds whichever side is longer", () => {
    expect(kindOf(verdict("CA3KN22BD3 coil voltage?", "Control relay\nCA3KN22", "DS1.pdf"))).toBe("answers");
  });
  it("sharing only three leading characters is not a variant", () => {
    expect(kindOf(verdict("ABC34 supply voltage?", "Northfield ABC12 Drive\nUser Manual"))).toBe("answers");
  });
  it("a fault code is not a variant of a model that shares fewer than four leading characters", () => {
    expect(kindOf(verdict("What does RX4093 mean?", "Northfield RX410 Logic Controller\nHardware User Guide"))).toBe("answers");
  });
});

describe("a model number hyphenated to something else", () => {
  it.each([
    ["a range", "Fault F004 on the RX420, what do I check?", "RX410-RX415 Drive\nUser Manual"],
    ["a publication number", "RX420 supply voltage?", "Publication RX410-UM001A-EN-P\nUser Manual"],
  ])("is still read: %s", (_why, question, heading) => {
    expect(kindOf(verdict(question, heading, "manual.pdf"))).toBe("other-model");
  });
  it("a range's own members answer", () => {
    expect(kindOf(verdict("RX415 supply voltage?", "RX410-RX415 Drive\nUser Manual", "manual.pdf"))).toBe("answers");
  });
  it("a catalog number's groups are still one number", () => {
    expect(keys("2080-LC20-20QBB")).toEqual(["2080LC2020QBB"]);
    expect(keys("GS11N-20P2")).toEqual(["GS11N20P2"]);
  });
});

describe("exclusions the first word lists missed", () => {
  it.each([
    ["German", "RX410 Drive Manual (nicht für RX420)"],
    ["French", "RX410 Drive Manual (sauf RX420)"],
    ["Spanish", "RX410 Drive Manual (excepto RX420)"],
    ["w/o", "RX410 Drive Manual (w/o RX420)"],
    ["a negation hyphenated to the number", "RX410 Drive Manual non-RX420"],
  ])("%s", (_lang, heading) => {
    expect(kindOf(verdict("RX420 parameter list?", heading, "x.pdf"))).toBe("coverage-not-shown");
  });
  it.each([
    ["an associated-publications list", "Quick Start Guide\nAssociated Publications\nRX420 Drive User Manual\nRX410 Drive User Manual"],
    ["a compatibility list", "Mounting Bracket Kit\nCompatible with:\nRX420"],
    ["an additional-resources list", "Quick Start Guide\nAdditional Resources\nRX420 Drive User Manual"],
  ])("a number under %s is not the manual's title", (_why, heading) => {
    expect(kindOf(verdict("RX420 wiring?", heading, "quickstart.pdf"))).toBe("coverage-not-shown");
  });
});

describe("real cover shapes that must still answer", () => {
  it.each([
    ["a month below the title", "RX420 Drive User Manual\nMay 2021"],
    ["a month above the title", "May 2021\nRX420 Drive User Manual"],
    ["a month on the title line", "RX420 Drive User Manual May 2021"],
    ["a full date below the title", "RX420 Drive User Manual\nMay 12, 2021"],
    ["a CAN part on the line below", "RX420 Drive\nCAN Interface Module"],
    ["a variant suffix alone on its line", "Hardware Manual\nOriginal instructions\nRevision C\nRX420-U"],
    ["a revision abbreviation", "RX420 Drive User Manual, Rev. 3"],
    ["a 'Model No.' label", "Model No. RX420 Drive\nUser Manual"],
    ["a 'Cat. No.' label", "Cat. No. RX420\nUser Manual"],
    ["a company abbreviation", "Northfield Corp. RX420 Drive Manual"],
    ["a language after a dash", "RX420 Drive User Manual – English"],
    ["a date after a dash", "RX420 Drive – April 2021"],
    ["a subtitle after a colon", "RX420 Drive Manual: Setup and Operation"],
    ["one model per line", "Hardware Manual\nRX410 Drive\nRX420 Drive\nRX430 Drive"],
    ["one bare model per line", "Hardware Manual\nRX410\nRX420\nRX430"],
    ["a German cover", "Frequenzumrichter RX420 Betriebsanleitung"],
    ["a French cover", "Variateur de vitesse RX420 Manuel d'utilisation"],
    ["a maker whose name starts like an exclusion word", "Applied Motion Products\nRX420 Servo Drive Hardware Manual"],
    ["a CAN interface", "RX420 Drive with CAN Interface\nUser Manual"],
    ["instructions for use", "RX420 Drive\nInstructions for Use"],
    ["a removable part named on the cover", "RX420 Drive with Removable Terminal Block\nUser Manual"],
    ["an application note", "RX420 Drive Application Note"],
    ["a differential product", "RX420 Differential Pressure Transmitter\nUser Manual"],
    ["a brand that starts in lower case below", "RX420 AC Drive\niC7 Series"],
  ])("%s", (_why, heading) => {
    expect(kindOf(verdict("RX420 fault F004?", heading, "rx420.pdf"))).toBe("answers");
  });

  it("a stacked list still refuses a model it does not list, and names the ones it does", () => {
    expect(verdict("RX440 wiring?", "Hardware Manual\nRX410 Drive\nRX420 Drive\nRX430 Drive", "hw.pdf"))
      .toMatchObject({ admit: false, kind: "other-model", declared: ["RX410", "RX420", "RX430"] });
  });
  it("an exclusion that wraps onto an all-capitals line starting with CAN still refuses", () => {
    expect(kindOf(verdict("RX420 fault F004?", "RX420 DRIVE\nCAN BE FOUND IN NF0000022", "x.pdf"))).toBe("coverage-not-shown");
  });
  it("a stack stops at the first line that is not a title", () => {
    const heading = "RX410 Drive User Manual\nRelated Publications\nRX420 Drive User Manual";
    expect(kindOf(verdict("RX420 wiring?", heading, "hw.pdf"))).toBe("other-model");
    expect(kindOf(verdict("RX420 wiring?", "RX410 Drive User Manual\nRX420 Drive is sold separately", "hw.pdf"))).toBe("other-model");
  });
});

// "NO", "DO", "IS" and "IT" are sentence words and also cover nouns: normally-open
// contacts, digital outputs, intrinsic safety, IT power systems.
describe("contact and I/O notation is not a negation", () => {
  it.each([
    ["Coil voltage of the CA3KN22BD?", "CA3KN22BD - TeSys K control relay - 2 NO + 2 NC - 24 V DC coil"],
    ["Coil voltage of the CA3KN22BD?", "TeSys K control relay, 2 NO + 2 NC, 24 V DC coil\nCA3KN22BD"],
    ["Coil voltage of the CA3KN22BD?", "CONTROL RELAY 2 NO + 2 NC\nCA3KN22BD"],
    ["RX420 supply voltage?", "RX420 Relay Output Module NO/NC"],
    ["RX420 supply voltage?", "RX420 Relay Output Module NO + NC"],
    ["RX420 supply voltage?", "RX420 Logic Controller 8 DI / 4 DO"],
    ["RX420 supply voltage?", "RX420 Logic Controller DI/DO"],
    ["RX420 supply voltage?", "RX420 IT Power Systems Guide"],
    ["RX420 supply voltage?", "RX420 IS Barrier Installation Guide"],
    ["RX420 supply voltage?", "RX420 Logic Controller\nIS Barrier Module"],
    ["RX420 supply voltage?", "RX420 Logic Controller\nNO/NC Relay Outputs"],
  ])("%s on %j answers", (question, heading) => expect(kindOf(verdict(question, heading, "DS1.pdf"))).toBe("answers"));

  it.each([
    ["a bare NO", "RX420 NO SUPPORT\nHardware User Guide"],
    ["NO after a model's own digits, not a contact count", "RX420 Drive Series 525 NO SUPPORT\nUser Manual"],
    ["NO opening a mixed-case remark", "NO RX420 support in this Guide"],
    ["a shouted IS in a shouted line", "RX420 IS SOLD ELSEWHERE\nHardware User Guide"],
    ["a shouted IS on the line below", "RX420 Logic Controller\nIS SOLD ELSEWHERE"],
    ["an ordinary is", "RX420 is sold elsewhere\nHardware User Guide"],
    ["DO as a verb", "RX420 DO NOT INSTALL\nHardware User Guide"],
    ["do not, in a count's shadow", "RX420 Controller 2 do not fit"],
  ])("control, still refused: %s", (_why, heading) =>
    expect(kindOf(verdict("RX420 supply voltage?", heading, "DS1.pdf"))).toBe("coverage-not-shown"));
});

// The first block of each pilot manual as the hub stores it: its own extractor and
// chunker run over the public PDF (2026-11-10). Earlier fixtures stopped at the
// catalog list; the stored text carries on, and the next line is a web address.
describe("pilot covers as stored, not as typed", () => {
  const IN009_AS_STORED =
    "Installation Instructions\nMicro820 20-Point Programmable Controllers\n"
    + "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n"
    + "2080-LC20-20QBBR, 2080-LC20-20AWBR\nhttp://rockwellautomation.com/literature\nFR\n"
    + "Cette publication est disponible en fran\u00e7ais\nsous forme \u00e9lectronique (fichier PDF). Pour la";
  const RELAY_AS_STORED =
    "Control relay, TeSys K, 2 NO + 2\nNC, lt or eq to 690V, 24VDC\nstandard coil\nCA3KN22BD\n"
    + "Product availability: Stock - Normally stocked in distribution\nfacility\nMain\nRange TeSys\n"
    + "Product name TeSys CAK\nProduct or Component Type Control relay\nDevice short name CA3K\n"
    + "Pole contact composition 2 NO + 2 NC";

  it("the Micro820 installation sheet answers for a catalog number it lists, with a web address on the next line", () => {
    expect(kindOf(verdict("Supply voltage for 2080-LC20-20QBB?", IN009_AS_STORED, "2080-in009_-en-p.pdf"))).toBe("answers");
  });
  it("and still refuses a catalog number it does not list", () => {
    expect(verdict("Supply voltage for 2080-LC50-24QWB?", IN009_AS_STORED, "2080-in009_-en-p.pdf")).toMatchObject({ admit: false, kind: "other-model" });
  });
  it("the relay data sheet answers for its own part number and refuses its sibling's", () => {
    expect(kindOf(verdict("Coil voltage of the CA3KN22BD?", RELAY_AS_STORED, "DS0004417.pdf"))).toBe("answers");
    expect(verdict("Coil voltage of the CA3KN31BD?", RELAY_AS_STORED, "DS0004417.pdf")).toMatchObject({ admit: false, kind: "other-model", declared: ["CA3KN22BD"] });
  });
  it.each(["www.northfield.example/rx", "https://northfield.example/literature", "support@northfield.example"])(
    "an address below a title is not the rest of a sentence: %s",
    (address) => expect(kindOf(verdict("RX420 supply voltage?", `Northfield RX420 Logic Controller\n${address}`))).toBe("answers"),
  );
  it("control: an ordinary lower-case line below still is", () => {
    expect(kindOf(verdict("RX420 supply voltage?", "Northfield RX420 Logic Controller\nis described in a separate guide"))).toBe("coverage-not-shown");
  });
});

describe("a remark that a clean title beside it must not carry", () => {
  it("a sibling's line with a mark and no noun does not join the title above it", () => {
    expect(verdict("RX420 supply voltage?", "Northfield RX410 Logic Controller\nRX420: sold elsewhere\nHardware User Guide")).toMatchObject({
      admit: false,
      kind: "other-model",
      declared: ["RX410"],
    });
  });
  it("a list that wraps onto the line where it is excluded is read as one sentence", () => {
    expect(kindOf(verdict("RX410 supply voltage?", "RX410,\nRX420 are not covered here.\nHardware User Guide"))).toBe("coverage-not-shown");
  });
});

// The product writes two documents itself from a technician's photo: a kept
// photo reading and a confirmed nameplate. Neither has a cover, and both carry
// the machine's NAME in a header line the product writes. The CI suite
// cv101-photo-recall caught the first version of this rule refusing every saved
// reading as soon as the question named the machine ("CV-101").
const FILE_ID = "0b6f4c1e-7a2d-4e59-9c3a-5d1f8e2b7a40";
const SHA = "9f2c41d07be35a68c1d2e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5e6f7";
/** The first stored block: the chunker returns a short text whole, trimmed. */
const stored = (text: string) => {
  const clean = text.replace(/[ \t]+\n/g, "\n").trim();
  expect(clean.length, "fits one stored block").toBeLessThanOrEqual(1000);
  return clean;
};
const reading = (machine: string, observation: string, reviewed = true) =>
  stored(buildPhotoSourceText({ machineName: machine, fileId: FILE_ID, photoSha256: SHA, capturedAt: "2026-11-09T14:32:08.000Z", observation, reviewed }));
/** The confirmed-nameplate text, in the layout the confirm route writes. */
const plate = (notebook: string, identity: string[], raw: string[]) =>
  stored([
    NAMEPLATE_OPENER, "", `Machine notebook: ${notebook}`, `Canonical nameplate photo (file id): ${FILE_ID}`, "Recognition confidence: 0.91", "",
    NAMEPLATE_BODY_MARK, ...identity.map((l) => `- ${l}`), "",
    "RAW NAMEPLATE OBSERVATION (unedited vision extraction)", "- reader: stub", ...raw.map((l) => `- ${l}`), "",
  ].join("\n"));
const CONTROLLER_READING = reading("CV-101", "Controller Micro820, catalog 2080-LC20-20QBB. Reviewed against the photo only; physical condition and operating state unknown. No completed work or live measurements.");
const RELAY_PLATE = plate("K1 control relay", ["Manufacturer: Schneider Electric", "Model: CA3KN22BD", "Voltage: 24 V DC"], ["Schneider Electric", "TeSys CA3KN22BD", "Ui 690V", "24V DC"]);
const READING_FILE = "Technician-reviewed photo reading 2026-11-09.txt";
const PLATE_FILE = `nameplate-${FILE_ID}.txt`;

describe("a photo reading or a confirmed nameplate is read by what it carries, not as a cover", () => {
  it("is told from an uploaded manual by its opening line", () => {
    expect(photoDocumentBody(CONTROLLER_READING)).toContain("Controller Micro820");
    expect(photoDocumentBody(CONTROLLER_READING)).not.toContain("CV-101");
    expect(photoDocumentBody(RELAY_PLATE)).toContain("- Model: CA3KN22BD");
    expect(photoDocumentBody(RELAY_PLATE)).not.toContain("K1 control relay");
    expect(photoDocumentBody("Northfield RX410 Logic Controller\nHardware User Guide")).toBeNull();
    expect(photoDocumentBody(`Hardware User Guide\n${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420`)).toBeNull();
    expect(photoDocumentBody(`${PHOTO_READING_OPENER}. Unconfirmed transcription of motor nameplate ratings.`)).toBeNull();
    expect(photoDocumentBody(`${PHOTO_READING_OPENER}\nMachine: CV-101`)).toBe("");
  });

  it.each([
    ["the question names the machine, and the product wrote that name into the reading",
      "Which components of CV-101 have reviewed photo readings saved in this project? Summarize them with their source evidence.", CONTROLLER_READING, READING_FILE],
    ["the question names two machines", "CV-101 stops when CV-102 is full, what should I check?", CONTROLLER_READING, READING_FILE],
    ["the catalog number the reading carries", "Supply voltage for 2080-LC20-20QBB?", CONTROLLER_READING, READING_FILE],
    ["the plate's own part number", "What is the coil voltage of the CA3KN22BD?", RELAY_PLATE, PLATE_FILE],
    ["a look-alike in the machine's name only", "RX420 supply voltage?", reading("RX410 press, line 2", "Label reads 24 V DC supply. No model is legible."), READING_FILE],
    ["a look-alike in the notebook's name only", "RX420 supply voltage?", plate("RX410 press", ["Manufacturer: Northfield"], ["Northfield", "24 V DC"]), PLATE_FILE],
    ["the reading itself is outside the stored block", "RX420 supply voltage?", `${PHOTO_READING_OPENER}\nMachine: RX410 press`, READING_FILE],
    ["an unreviewed reading that carries the asked number", "RX420 supply voltage?", reading("Press 2", "Drive model RX420, 24 V DC.", false), "Unconfirmed photo reading 2026-11-09.txt"],
  ])("answers: %s", (_name, question, heading, filename) => {
    expect(kindOf(verdict(question, heading, filename))).toBe("answers");
  });

  it.each([
    ["a sibling part number against the relay's plate", "What is the coil voltage of the CA3KN31BD?", RELAY_PLATE, PLATE_FILE, ["CA3KN22BD"]],
    ["a sibling catalog number against the controller's reading", "Supply voltage for 2080-LC50-24QWB?", CONTROLLER_READING, READING_FILE, ["2080-LC20-20QBB"]],
    ["a sibling model against a reading that says, in a sentence, what the drive is", "RX420 supply voltage?", reading("Press 2", "The drive on this press is an RX410."), READING_FILE, ["RX410"]],
  ])("refuses, and names what the reading shows: %s", (_name, question, heading, filename, declared) => {
    expect(verdict(question, heading, filename)).toMatchObject({ admit: false, kind: "other-model", declared, reading: true });
  });

  it("an uploaded manual is still read as a cover, whatever it quotes lower down", () => {
    const upload = `Hardware User Guide\n${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420 is not covered by this manual.`;
    const v = verdict("RX420 supply voltage?", upload);
    expect(v).toMatchObject({ admit: false, kind: "coverage-not-shown" });
    expect(v).not.toHaveProperty("reading");
  });

  it("the reply says it is a photo reading, not a manual, when only readings were refused", () => {
    const refused = verdict("What is the coil voltage of the CA3KN31BD?", RELAY_PLATE, PLATE_FILE);
    const text = unlistedModelRefusalText(summarizeUnlistedRefusals([refusal(refused)], "question"));
    expect(text).toBe(
      "The photo reading saved in this notebook shows the CA3KN22BD, not the CA3KN31BD you asked about, so I won't answer from it — its values may not apply to the CA3KN31BD. Add the CA3KN31BD manual (or the page that covers it) to this notebook and ask again.",
    );
  });

  it("a refused manual beside a refused reading keeps the manual's sentence", () => {
    const manual = verdict("What is the coil voltage of the CA3KN31BD?", "Control relay, TeSys K\nstandard coil\nCA3KN22BD", "DS0004417.pdf");
    const refused = verdict("What is the coil voltage of the CA3KN31BD?", RELAY_PLATE, PLATE_FILE);
    const text = unlistedModelRefusalText(summarizeUnlistedRefusals([refusal(manual), refusal(refused)], "question"));
    expect(text).toContain("The manual in this notebook is for the CA3KN22BD, not the CA3KN31BD you asked about");
  });
});

describe("stated limits, pinned so a change to them is seen", () => {
  it("an accessory's manual that names the model it is for is not told apart from the model's own manual", () => {
    expect(kindOf(verdict("How do I clear fault F004 on the RX420?", "EtherNet/IP Adapter for RX420 Drives\nUser Manual", "UM_ENET.pdf"))).toBe("answers");
  });
  it("a variant written as a hyphen and letters only is not told apart (RX420-E / RX420-U)", () => {
    expect(kindOf(verdict("Max output frequency of the RX420-E?", "RX420-U Drive User Manual", "um.pdf"))).toBe("answers");
  });
  it("a filename that names the asked model counts when the cover names none, whatever else the name carries", () => {
    expect(kindOf(verdict("Torque limit on the RX420?", "Migration Guide\nSetup Notes", "RX410_to_RX420_Migration.pdf"))).toBe("answers");
  });
  it("an uploaded file that opens with the product's own photo-reading line is read as a reading", () => {
    const upload = `${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420 is not covered by this manual.`;
    expect(kindOf(verdict("RX420 supply voltage?", upload))).toBe("answers");
  });
  it("a reading that carries one machine's tag is refused for a question that names that tag and a look-alike tag", () => {
    const tagPlate = reading("CV-101", "Asset tag plate reads CV-101.");
    expect(kindOf(verdict("CV-101 stops when CV-102 is full, what should I check?", tagPlate, READING_FILE))).toBe("several-look-alikes");
    expect(kindOf(verdict("What is the belt speed on CV-101?", tagPlate, READING_FILE))).toBe("answers");
  });
});
