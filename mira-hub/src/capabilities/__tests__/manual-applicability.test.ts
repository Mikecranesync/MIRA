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
  coverDeclaredNumbers,
  manualCoversNumber,
  otherProductRefusalText,
} from "../manual-applicability";
import { NAMEPLATE_BODY_MARK, NAMEPLATE_OPENER, PHOTO_OCR_OPENER_START, PHOTO_READING_BODY_MARK, PHOTO_READING_OPENER, buildPhotoSourceText, photoDocumentShape, productWrittenBody } from "../photo-document-text";
import { ocrSourceText } from "@/lib/photo-ocr";

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

  // Review round 2 on #5389: the detector's positions count UTF-16 units, and an
  // emoji is two of them. Typed before a model on a phone keyboard, each one
  // shifted the masking by a character and left the model's head behind as a
  // "number" the detector does not read (GS11N out of GS11N-20P2).
  it.each([
    "😀 Which parameter sets acceleration time on the GS11N-20P2?",
    "😀😀😀😀😀 GS11N-20P2 will not start",
    "⚠️🔧🔧🔧🔧🔧🔧 Wiring for the Micro820-20QBB",
    "👍🏽👍🏽👍🏽 Micro850-48QWB supply",
    "GS11N-20P2 😀😀😀😀😀😀 Micro820-20QBB",
  ])("an emoji before a detector-read number does not shift the masking: %s", (text) => {
    expect(asked(text).map((n) => n.key)).toEqual([]);
  });

  it("an emoji before an unread number leaves it whole, and the rest of the text as typed", () => {
    expect(asked("😀😀😀 Wire the Micro820 to the RX420 😀").map((n) => n.label)).toEqual(["RX420"]);
    expect(asked("😀😀😀 coil voltage of the CA3KN22BD").map((n) => n.label)).toEqual(["CA3KN22BD"]);
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
  it("says the number came from an earlier question, and gives the way out", () => {
    const r = summarizeUnlistedRefusals([refusal(manualAnswersFor(asked("CA3KN22BD"), "standard coil\nCA3KN31BD", "DS1.pdf"))], "conversation");
    const text = unlistedModelRefusalText(r);
    expect(text).toContain("not the CA3KN22BD you asked about earlier in this conversation");
    expect(text).toMatch(/name its model in the question or start a new chat/);
    expect(text).toMatch(/won't answer/);
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

// "NO" and "DO" are sentence words and also cover nouns: normally-open contacts
// and digital outputs. "IS" and "IT" are always read as sentence words (see the
// stated limits below).
describe("contact and I/O notation is not a negation", () => {
  it.each([
    ["Coil voltage of the CA3KN22BD?", "CA3KN22BD - TeSys K control relay - 2 NO + 2 NC - 24 V DC coil"],
    ["Coil voltage of the CA3KN22BD?", "TeSys K control relay, 2 NO + 2 NC, 24 V DC coil\nCA3KN22BD"],
    ["Coil voltage of the CA3KN22BD?", "CONTROL RELAY 2 NO + 2 NC\nCA3KN22BD"],
    ["RX420 supply voltage?", "RX420 Relay Output Module NO/NC"],
    ["RX420 supply voltage?", "RX420 Relay Output Module NO + NC"],
    ["RX420 supply voltage?", "RX420 Logic Controller 8 DI / 4 DO"],
    ["RX420 supply voltage?", "RX420 Logic Controller DI/DO"],
    ["RX420 supply voltage?", "RX420 Logic Controller\nNO/NC Relay Outputs"],
  ])("%s on %j answers", (question, heading) => expect(kindOf(verdict(question, heading, "DS1.pdf"))).toBe("answers"));

  it.each([
    ["a bare NO", "RX420 NO SUPPORT\nHardware User Guide"],
    ["NO after a model's own digits, not a contact count", "RX420 Drive Series 525 NO SUPPORT\nUser Manual"],
    ["NO opening a mixed-case remark", "NO RX420 support in this Guide"],
    ["a shouted IS in a shouted line", "RX420 IS SOLD ELSEWHERE\nHardware User Guide"],
    ["a shouted IS on the line below", "RX420 Logic Controller\nIS SOLD ELSEWHERE"],
    ["an ordinary is", "RX420 is sold elsewhere\nHardware User Guide"],
    // Review round 3 on #5389: a shouted IS or IT in a line that carries
    // lower case used to be read as a noun, and these were admitted.
    ["a shouted IS in a mixed-case remark", "RX420 IS sold elsewhere Logic Controller"],
    ["a shouted IS in a title-cased remark", "RX420 IS Sold Elsewhere Logic Controller"],
    ["a shouted IT in a mixed-case remark", "RX420 IT ships separately Logic Controller"],
    ["a shouted IS opening a lower-case line below", "RX420 Logic Controller\nIS sold elsewhere"],
    ["a shouted IS at the end of the line", "RX420 Logic Controller sold where the RX410 IS"],
    ["a remark built from a word IS can qualify", "RX420 IS power hungry Controller"],
    ["the same with IT", "RX420 IT system incompatible Controller"],
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

// Codex round 2 on #5389 (F4): a negation the lists already know got past them
// by being joined to another word. "RX420 (not-covered)" read as a title because
// "not-covered" is one word and no list holds it; the same for "NOT-SUPPORTED"
// on the line below and "Non-supported models:" on the line above.
//
// The rule now: a word joined by a hyphen (of any kind), an underscore, a dot,
// a plus or an apostrophe is read by its parts, and one known negation or
// exclusion part makes it a sentence word UNLESS the pair is a product word the
// allowlist names ("Non-Isolated", "Do-more"). An unknown joined negation
// refuses. And three places a remark is written (brackets, the text after a
// dash or colon that follows the number, a label before a colon) must be made
// of title vocabulary, or show nothing.
describe("an exclusion joined to another word shows no coverage, wherever it sits", () => {
  const ASK = "RX420 supply voltage?";
  const JOINED = [
    "not-covered", "NOT-COVERED", "Not-Covered", "not-supported", "NOT-SUPPORTED", "non-supported", "Non-Supported",
    "un-supported", "not_covered", "not–covered", "not‑covered", "not‐covered", "not.covered",
    "non-applicable", "not-included", "not-listed", "never-supported", "no-support", "nicht-enthalten", "kein-Inhalt",
    "ohne-RX420", "not-for-this-model", "non-RX420",
  ];
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

  it.each(JOINED)("on the model's line, after the title: %s", (w) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\nRX420 Logic Controller ${w}`))).toBe("coverage-not-shown");
  });
  it.each(JOINED)("on the model's line, in brackets: (%s)", (w) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\nRX420 (${w})`))).toBe("coverage-not-shown");
    expect(kindOf(verdict(ASK, `Hardware User Guide\nRX420 Logic Controller [${w}]`))).toBe("coverage-not-shown");
  });
  it.each(JOINED)("on the model's line, before the model: %s", (w) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${cap(w)} RX420 Logic Controller`))).toBe("coverage-not-shown");
  });
  it.each(JOINED)("opening the line below: %s", (w) => {
    expect(kindOf(verdict(ASK, `RX420 Logic Controller\n${w.toUpperCase()} by this manual`))).toBe("coverage-not-shown");
    expect(kindOf(verdict(ASK, `RX420 Logic Controller\n${cap(w)} by this manual\nHardware User Guide`))).toBe("coverage-not-shown");
    expect(kindOf(verdict(ASK, `RX420 Logic Controller\n(${w})\nHardware User Guide`))).toBe("coverage-not-shown");
  });
  it.each(JOINED)("in a heading on the line above: %s", (w) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${cap(w)} models:\nRX420 Logic Controller`))).toBe("coverage-not-shown");
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${cap(w)} models\nRX420 Logic Controller`))).toBe("coverage-not-shown");
  });
  it.each(JOINED)("and it declares no product either: %s", (w) => {
    for (const heading of [
      `Hardware User Guide\nRX420 (${w})`,
      `RX420 Logic Controller\n${w.toUpperCase()} by this manual`,
      `Hardware User Guide\n${cap(w)} models:\nRX420 Logic Controller`,
    ]) expect(coverDeclaredNumbers(heading), heading).toEqual([]);
  });

  // The three covers in the finding, word for word.
  it.each([
    "Hardware User Guide\nRX420 (not-covered)",
    "RX420 Logic Controller\nNOT-SUPPORTED by this manual",
    "Hardware User Guide\nNon-supported models:\nRX420 Logic Controller",
  ])("the reviewer's cover: %j", (heading) => {
    expect(verdict(ASK, heading)).toEqual({ admit: false, kind: "coverage-not-shown", asked: ["RX420"], declared: [] });
    expect(manualCoversNumber(asked(ASK)[0], heading, OPAQUE)).toBe(false);
    expect(coverDeclaredNumbers(heading)).toEqual([]);
  });

  it.each([
    ["isn't", "RX420 Logic Controller isn't here"],
    ["doesn't, opening the line below", "RX420 Logic Controller\nDoesn't ship with a guide"],
    ["won't, with a curly apostrophe", "RX420 Logic Controller won’t ship"],
    ["can't, in a heading above", "Models Northfield can't supply\nRX420 Logic Controller"],
    ["typed with no apostrophe", "RX420 Logic Controller isnt here"],
  ])("a contraction is a negation: %s", (_w, heading) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${heading}`))).toBe("coverage-not-shown");
  });

  it.each([
    ["a soft hyphen", "RX420 Logic Controller n­ot"],
    ["a zero-width space", "RX420 Logic Controller n​ot"],
    ["full-width letters", "RX420 Logic Controller ｎｏｔ"],
    ["a no-break hyphen and a no-break space", "RX420 Logic Controller not‑supported"],
  ])("a negation is read as it prints: %s", (_why, line) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${line}`))).toBe("coverage-not-shown");
  });

  // The line BELOW the model is read whole for a negation, not only its first word.
  it.each([
    ["a sentence about the model above", "RX420 Logic Controller\nThis controller is not covered by this manual"],
    ["a sentence that names the same model again", "RX420 Logic Controller\nThis guide does not cover the RX420"],
    ["a joined negation mid-line", "RX420 Logic Controller\nModels NOT-SUPPORTED by this manual"],
    ["an abbreviation on its own line", "RX420 Logic Controller\n(N/A)"],
    ["a phrase", "RX420 Logic Controller\nNow out of scope"],
    ["an exclusion word mid-line", "RX420 Logic Controller\nNow discontinued"],
  ])("a negation anywhere on the line below: %s", (_why, heading) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${heading}`))).toBe("coverage-not-shown");
  });
  it("but a remark below that names a different model is about that one, not the title above", () => {
    const heading = "RX410 Drive User Manual\nThe RX420 Drive is not covered here";
    expect(kindOf(verdict("RX410 supply voltage?", heading))).toBe("answers");
    expect(verdict(ASK, heading)).toMatchObject({ admit: false, kind: "other-model", declared: ["RX410"] });
  });
});

describe("a remark beside the model must be title vocabulary, or it shows nothing", () => {
  const ASK = "RX420 supply voltage?";
  it.each([
    ["not applicable, abbreviated", "Hardware User Guide\nRX420 Logic Controller (N/A)"],
    ["the same, with dots", "Hardware User Guide\nRX420 Logic Controller (n.a.)"],
    ["the same, with no brackets", "Hardware User Guide\nRX420 Logic Controller N/A"],
    ["end of life, abbreviated", "Hardware User Guide\nRX420 Logic Controller (EOL)"],
    ["end of life after a dash", "Hardware User Guide\nRX420 Logic Controller - end of life"],
    ["a bracketed remark of ordinary words", "Hardware User Guide\nRX420 Logic Controller (wrong manual)"],
    ["a bracketed remark between the model and its noun", "Hardware User Guide\nRX420 (dealer stock) Logic Controller"],
    ["out of scope, in brackets", "Hardware User Guide\nRX420 Logic Controller (out of scope)"],
    ["out of scope, as a label before the model", "Hardware User Guide\nOut-of-scope: RX420 Logic Controller"],
    ["out of scope, as a heading above", "Hardware User Guide\nOut-of-scope models:\nRX420 Logic Controller"],
    ["a label of ordinary words above", "Hardware User Guide\nSold through distributors:\nRX420 Logic Controller"],
    ["a note label before the model", "Hardware User Guide\nNote: RX420 Logic Controller"],
    ["German, joined, after a dash", "Hardware User Guide\nRX420 Logic Controller – nicht-enthalten"],
    ["German, joined, in brackets", "Hardware User Guide\nRX420 Logic Controller (kein-Inhalt)"],
    ["a bracket that is never closed", "Hardware User Guide\nRX420 Logic Controller (ask your dealer"],
    ["square brackets", "Hardware User Guide\nRX420 Logic Controller [dealer only]"],
    ["a remark after a dash with no product or document word", "Hardware User Guide\nRX420 Logic Controller — dealer stock"],
    ["a pointer after a colon", "Hardware User Guide\nRX420 Logic Controller manual: publication 1234"],
    ["an answer after a colon", "Hardware User Guide\nRX420 Logic Controller: no."],
    ["a label that is not one, with 'No.' after it", "Hardware User Guide\nIncluded: No. RX420 Logic Controller"],
    ["sold elsewhere, no punctuation", "Hardware User Guide\nRX420 Logic Controller sold elsewhere"],
    ["abbreviated exclusion", "Hardware User Guide\nExcl. RX420 Logic Controller"],
    ["not equal", "Hardware User Guide\nRX420 Logic Controller ≠ this manual"],
  ])("refuses, coverage not shown: %s", (_why, heading) => {
    expect(kindOf(verdict(ASK, heading))).toBe("coverage-not-shown");
  });

  it("a second title stacked under the first does not count when it ends in a pointer", () => {
    const heading = "RX410 Hardware User Guide\nRX420 Logic Controller manual: publication 1234";
    expect(verdict(ASK, heading)).toMatchObject({ admit: false, kind: "other-model", declared: ["RX410"] });
  });
});

// More ways the same exclusion is written with no listed word standing alone.
describe("an exclusion written as a mark, run together, broken across lines, or trailing the title", () => {
  const ASK = "RX420 supply voltage?";
  it.each([
    ["a cross", "Hardware User Guide\nRX420 Logic Controller ✗"],
    ["a cross mark", "Hardware User Guide\nRX420 ❌"],
    ["a no-entry sign", "Hardware User Guide\n\u{1f6ab} RX420 Logic Controller"],
    ["run together, capitals inside", "Hardware User Guide\nRX420 Logic Controller NotSupported"],
    ["run together, lower case", "Hardware User Guide\nRX420 Logic Controller notcovered"],
    ["run together, before the model", "Hardware User Guide\nNonSupported RX420 Logic Controller"],
    ["unlisted", "Hardware User Guide\nUNLISTED RX420 Logic Controller"],
    ["run together, German", "Hardware User Guide\nNichtenthalten RX420 Steuerung"],
    ["a negation broken across lines, below", "Hardware User Guide\nRX420 Logic Controller unsup-\nported"],
    ["an exclusion broken across lines, above", "Hardware User Guide ex-\ncluding RX420 Logic Controller"],
    ["a remark that trails the product noun", "Hardware User Guide\nRX420 Logic Controller sold by distributors"],
    ["another", "Hardware User Guide\nRX420 Logic Controller left out"],
    ["a remark that trails a bare model", "RX420 left out\nHardware User Guide"],
    ["a German no", "Hardware User Guide\nRX420 Logic Controller nein"],
    ["to be decided", "Hardware User Guide\nRX420 Logic Controller TBD"],
    ["a heading two lines up that ends in a colon", "Not covered in this guide:\nHardware\nRX420 Logic Controller"],
    ["the same heading five lines up", "Models this guide leaves to others:\nA\nB\nC\nD\nRX420 Logic Controller"],
  ])("refuses, coverage not shown: %s", (_why, heading) => {
    expect(kindOf(verdict(ASK, heading))).toBe("coverage-not-shown");
  });

  it.each([
    ["Notebook", "RX420 Notebook Interface Module Manual"],
    ["Universal", "RX420 Universal Drive Controller Manual"],
    ["Unit", "RX420 Unit Controller Manual"],
    ["Noncontact", "RX420 Noncontact Sensor Manual"],
    ["Uncoated", "RX420 Uncoated Terminal Module Manual"],
    ["a maker before the model", "Northfield RX420 Logic Controller"],
    ["adjectives before the noun", "RX420 Adjustable Frequency AC Drive\nUser Manual"],
    ["a title that ends after its noun", "RX420 Drive with Removable Terminal Block\nUser Manual"],
    ["a label heading further up", "Catalog Numbers:\nRX410\nRX420"],
  ])("an ordinary word that only starts like a negation, or a real title, still answers: %s", (_why, heading) => {
    expect(kindOf(verdict("RX420 fault F004?", heading, "rx420.pdf"))).toBe("answers");
  });
});

// coverDeclaredNumbers answers a different question ("is this manual for some
// OTHER product than the notebook's machine?"), and a miss there lets the manual
// answer. So it reads a negation as the asked-number check does, and nothing
// stricter: a cover with a word the title lists do not know still declares.
describe("what a cover declares when no number was asked", () => {
  const labels = (heading: string) => coverDeclaredNumbers(heading).map((n) => n.label);
  it.each([
    "Hardware User Guide\nRX420 (not-covered)",
    "RX420 Logic Controller\nNOT-SUPPORTED by this manual",
    "Hardware User Guide\nNon-supported models:\nRX420 Logic Controller",
    "Hardware User Guide\nRX420 Logic Controller (N/A)",
    "Hardware User Guide\nRX420 Logic Controller ✗",
    "Hardware User Guide\nRX420 Logic Controller NotSupported",
    "Hardware User Guide\nOut-of-scope: RX420 Logic Controller",
    "Hardware User Guide\nRX420 Logic Controller sold elsewhere",
    "Hardware User Guide\nRX420 Logic Controller isn't here",
    // Each of these is told from a title by one rule only (the tamper checks
    // found the rows above were also caught by another).
    "Hardware User Guide\nRX420 Logic Controller hasn't shipped",
    "Hardware User Guide\nRX420 Logic Controller couldn’t ship",
    "Hardware User Guide\nRX420 Logic Controller n­ot",
    "Hardware User Guide\nRX420 Logic Controller n​ot",
    "Hardware User Guide\nRX420 Logic Controller ｎｏｔ",
  ])("a negation declares nothing: %j", (heading) => {
    expect(labels(heading)).toEqual([]);
  });
  it.each([
    ["a bracketed maker", "RX420 Logic Controller (Northfield)\nUser Manual"],
    ["a title ending in an unknown product word", "RX420 Drive with Brake Chopper\nUser Manual"],
    ["an unknown label", "Bestellbezeichnung: RX420\nBetriebsanleitung"],
    ["an unknown joined product word", "RX420 Non-Sparking Tool Kit Manual"],
    ["an unknown joined product word on the line below", "RX420 Logic Controller\nNon-Sparking Tool Kit"],
    ["a sentence under the title that uses an exclusion word in passing", "RX420 Drive User Manual\nThis manual covers installation and wiring"],
    ["a remark with no negation after a dash", "Hardware User Guide\nRX420 Logic Controller — dealer stock"],
  ])("a cover the asked-number check refuses for an unknown word still declares its product: %s", (_why, heading) => {
    expect(kindOf(verdict("RX420 supply voltage?", heading))).toBe("coverage-not-shown");
    expect(labels(heading)).toEqual(["RX420"]);
  });
});

// The other half: what the new rules must NOT refuse. Each row answers on the
// commit before this change too, unless it is marked as a behaviour change.
describe("joined words and bracketed notes on real cover shapes still answer", () => {
  it.each([
    ["a non-isolated module", "RX420 Non-Isolated Analog Module User Manual"],
    ["the same in capitals", "RX420 NON-ISOLATED ANALOG MODULE USER MANUAL"],
    ["a non-reversing starter", "RX420 Non-Reversing Starter\nUser Manual"],
    ["a non-fused disconnect", "RX420 Non-Fused Disconnect Switch Manual"],
    ["a three-part compound that holds an allowed pair", "RX420 Non-Isolated-Input Module User Manual"],
    ["the Do-more family name", "Do-more RX420 Logic Controller User Manual"],
    ["a how-to guide", "RX420 Drive How-To Guide"],
    ["a read-only part", "RX420 Read-Only Memory Module Manual"],
    ["a no-load test", "RX420 Drive No-Load Test Instructions"],
    ["a safety-related part", "RX420 Safety-Related Controller Manual"],
    ["a German emergency-stop relay", "RX420 Not-Aus-Schaltgerät Betriebsanleitung"],
    ["stand-alone", "RX420 Stand-Alone Drive User Manual"],
    ["three-phase", "RX420 Three-Phase AC Drive User Manual"],
    ["contact notation, joined", "RX420 Relay Output Module NO-NC"],
    ["contact counts written tight", "CA3KN22BD Control Relay 2NO+2NC"],
    ["I/O notation, joined", "RX420 Logic Controller DI-DO Module"],
    ["a possessive", "RX420 Drive User's Manual"],
    ["a French elision", "Variateur RX420 Manuel d'utilisation"],
    ["a series in brackets", "RX420 Logic Controller (Series B)\nUser Manual"],
    ["a rating in brackets", "RX420 Drive (24 V DC) User Manual"],
    ["a frame size in brackets", "RX420 Drive (Frame A) User Manual"],
    ["a document kind in brackets", "RX420 Drive User Manual (Original Instructions)"],
    ["a language in brackets", "RX420 Drive User Manual (English)"],
    ["contacts in brackets", "RX420 Control Relay (2 NO + 2 NC)"],
    ["a catalog number in brackets", "RX420 Logic Controller (2080-LC20-20QBB)\nUser Manual"],
    ["a 'Catalog Numbers:' label", "Catalog Numbers: RX410, RX420\nUser Manual"],
    ["a 'Type:' label", "Type: RX420 Drive\nOperating Instructions"],
    ["a catalog label on the line above", "User Manual\nCatalog Numbers:\nRX420"],
    ["a specifications label on the line above", "Technical Specifications:\nRX420 Logic Controller"],
    ["a product name after a dash, with a maker's range in it", "RX420 - TeSys K control relay - 2 NO + 2 NC - 24 V DC coil"],
    ["a web address under the title that holds a sentence word", "RX420 Logic Controller\nwww.northfield.example/how-to/not-found"],
  ])("%s", (_why, heading) => {
    expect(kindOf(verdict("RX420 fault F004?", heading, "rx420.pdf"))).toBe("answers");
  });

  // The first block of every pilot manual as the hub stores it (2026-11-10).
  const UM005_AS_STORED =
    "User Manual Original Instructions\nMicro820 Programmable\nControllers\n"
    + "Catalog Numbers 2080-LC20-20QWB, 2080-L20E-20QWB,\n2080-LC20-20QBB, 2080-L20E-20QBB, 2080-LC20-20AWB,\n"
    + "2080-L20E-20AWB, 2080-LC20-20QWBR, 2080-L20E-20QWBR,\n2080-LC20-20QBBK, 2080-L20E-20QBBK, 2080-LC20-20QBBR,\n"
    + "2080-L20E-20QBBR, 2080-LC20-20AWBR, 2080-L20E-20AWBR";
  const RELAY_DISTRIBUTOR_AS_STORED =
    "Disclaimer: This documentation is not intended as a substitute for and is not to be used for determining suitability or reliability of these products for specific user applications\n"
    + "Jul 31, 2017\n1\nProduct data sheet\nCharacteristics\nCA3KN22BD\nTeSys K control relay - 2 NO + 2 NC - <= 690 V -\n"
    + "24 V DC standard coil\nProduct availability : Stock - Normally stocked in distribution facility\nPrice* : 49.20 USD\nMain\nRange TeSys";
  const PLC_DISTRIBUTOR_AS_STORED =
    "2080-LC20-20QBB\nAllen Bradley PLC – Micro 820\nTechnical Specifications:\nManufacturer\nBrand\nPart Number/Catalog No.\n"
    + "Product Type\nInputs\nOutputs\nDimensions HxWxD\nPower Input\nPower Dissipation\nPower Supply Voltage Range\nEnclosure\n"
    + "Non-Isolated DC Input On-state Voltage\nRange\nDC Output User Supply Voltage\nPilot Duty Rating\nTerminal Block\n"
    + "Rockwell Automation\nAllen-Bradley\n2080-LC20-20QBB\nProgrammable Controller\n12(24V DC)";
  it.each([
    ["the Micro820 user manual", "Supply voltage for 2080-LC20-20QBB?", UM005_AS_STORED, "2080-um005_-en-e.pdf"],
    ["the same, by a number on its last wrapped line", "Supply voltage for 2080-L20E-20AWBR?", UM005_AS_STORED, "2080-um005_-en-e.pdf"],
    ["the relay sheet from a distributor", "Coil voltage of the CA3KN22BD?", RELAY_DISTRIBUTOR_AS_STORED, "CA3KN22BD.pdf"],
    ["the same, saved under a document number", "Coil voltage of the CA3KN22BD?", RELAY_DISTRIBUTOR_AS_STORED, "DS0004417.pdf"],
    ["the controller sheet from a distributor", "Supply voltage for 2080-LC20-20QBB?", PLC_DISTRIBUTOR_AS_STORED, "2080-LC20-20QBB.pdf"],
    ["the same, saved under a plain name", "Supply voltage for 2080-LC20-20QBB?", PLC_DISTRIBUTOR_AS_STORED, "sheet.pdf"],
  ])("pilot cover as stored still answers: %s", (_why, question, heading, filename) => {
    expect(kindOf(verdict(question, heading, filename))).toBe("answers");
  });
  it.each([
    ["the Micro820 user manual", "Supply voltage for 2080-LC50-24QWB?", UM005_AS_STORED, "2080-um005_-en-e.pdf"],
    ["the relay sheet from a distributor", "Coil voltage of the CA3KN31BD?", RELAY_DISTRIBUTOR_AS_STORED, "DS0004417.pdf"],
    ["the controller sheet from a distributor", "Supply voltage for 2080-LC50-24QWB?", PLC_DISTRIBUTOR_AS_STORED, "sheet.pdf"],
  ])("and still refuses a sibling's number: %s", (_why, question, heading, filename) => {
    expect(verdict(question, heading, filename)).toMatchObject({ admit: false, kind: "other-model" });
  });
});

// The line BESIDE the number is read for its noun only, never strictly: on the
// stored relay sheet "Utilisation category AC-15" sits under "Contactor
// application Control circuit", whose last word no title list holds.
describe("a rating named in the question is not refused on the part's own sheet", () => {
  const SHEET = "CA3KN22BD\nControl relay, TeSys K\nContactor application Control circuit\nUtilisation category AC-15\nDC-13\nPole contact composition 2 NO + 2 NC";
  it("answers a question that names the utilisation category and the part", () => {
    expect(kindOf(verdict("What is the AC-15 rating of the CA3KN22BD?", SHEET, "DS0004417.pdf"))).toBe("answers");
  });
});

// Wrong refusals the new rules accept, pinned so a change to them is seen.
describe("stated limits of the joined-word and remark rules (wrong refusals)", () => {
  it.each([
    ["a joined product word the allowlist does not name", "RX420 Non-Sparking Tool Kit Manual"],
    ["a bracketed maker or range name", "RX420 Logic Controller (Northfield)\nUser Manual"],
    ["North America written N/A", "RX420 Drive N/A Version User Manual"],
    ["a label the list does not know", "Bestellbezeichnung: RX420\nBetriebsanleitung"],
    ["'Model No.:' with the colon tight against it (it refused before this change too)", "Model No.: RX420\nUser Manual"],
    ["a sentence under the title that uses an exclusion word in passing", "RX420 Drive User Manual\nThis manual covers installation and wiring"],
    ["a warning under the title", "RX420 Drive User Manual\nWarning: not for use in hazardous locations"],
    ["a title that ends in a product word the list does not know", "RX420 Drive with Brake Chopper\nUser Manual"],
    ["an unknown heading that ends in a colon, directly above", "Hauptkatalog:\nRX420 Logic Controller"],
  ])("%s", (_why, heading) => {
    expect(kindOf(verdict("RX420 fault F004?", heading, "NF0000021.pdf"))).toBe("coverage-not-shown");
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

// Every text built by `reading`, `plate` and `ocr` below comes from the
// product's own writers, so the upload records name it. `written` judges it
// with that record: the kind its writer produces. `verdict`, with no record,
// is how the same words are judged when they arrive as an uploaded file.
const recordOf = (heading: string) => photoDocumentShape(heading);
const written = (question: string, heading: string, filename = OPAQUE): ManualVerdict =>
  manualAnswersFor(asked(question), heading, filename, recordOf(heading));
const readOff = (heading: string) => productWrittenBody(heading, recordOf(heading));

describe("a photo reading or a confirmed nameplate is read by what it carries, not as a cover", () => {
  it("is told from an uploaded manual by its opening line", () => {
    expect(readOff(CONTROLLER_READING)).toContain("Controller Micro820");
    expect(readOff(CONTROLLER_READING)).not.toContain("CV-101");
    expect(readOff(RELAY_PLATE)).toContain("- Model: CA3KN22BD");
    expect(readOff(RELAY_PLATE)).not.toContain("K1 control relay");
    expect(readOff("Northfield RX410 Logic Controller\nHardware User Guide")).toBeNull();
    expect(readOff(`Hardware User Guide\n${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420`)).toBeNull();
    expect(readOff(`${PHOTO_READING_OPENER}. Unconfirmed transcription of motor nameplate ratings.`)).toBeNull();
    expect(readOff(`${PHOTO_READING_OPENER}\nMachine: CV-101`)).toBe("");
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
    expect(kindOf(written(question, heading, filename))).toBe("answers");
  });

  it.each([
    ["a sibling part number against the relay's plate", "What is the coil voltage of the CA3KN31BD?", RELAY_PLATE, PLATE_FILE, ["CA3KN22BD"]],
    ["a sibling catalog number against the controller's reading", "Supply voltage for 2080-LC50-24QWB?", CONTROLLER_READING, READING_FILE, ["2080-LC20-20QBB"]],
    ["a sibling model against a reading that says, in a sentence, what the drive is", "RX420 supply voltage?", reading("Press 2", "The drive on this press is an RX410."), READING_FILE, ["RX410"]],
  ])("refuses, and names what the reading shows: %s", (_name, question, heading, filename, declared) => {
    expect(written(question, heading, filename)).toMatchObject({ admit: false, kind: "other-model", declared, reading: true });
  });

  it("an uploaded manual is still read as a cover, whatever it quotes lower down", () => {
    const upload = `Hardware User Guide\n${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420 is not covered by this manual.`;
    const v = verdict("RX420 supply voltage?", upload);
    expect(v).toMatchObject({ admit: false, kind: "coverage-not-shown" });
    expect(v).not.toHaveProperty("reading");
  });

  // Until review round 1 on #5389 this was a pinned limit ("…is read as a
  // reading"). It let a typed file choose the lenient rule for itself.
  it("an uploaded file that opens with the product's own photo-reading line is NOT read as a reading", () => {
    const upload = `${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420 is not covered by this manual.`;
    const v = verdict("RX420 supply voltage?", upload);
    expect(v).toMatchObject({ admit: false, kind: "coverage-not-shown" });
    expect(v).not.toHaveProperty("reading");
    // The same words in a document the records say the product wrote are a reading.
    expect(kindOf(written("RX420 supply voltage?", upload))).toBe("answers");
  });

  it("the reply says it is a photo reading, not a manual, when only readings were refused", () => {
    const refused = written("What is the coil voltage of the CA3KN31BD?", RELAY_PLATE, PLATE_FILE);
    const text = unlistedModelRefusalText(summarizeUnlistedRefusals([refusal(refused)], "question"));
    expect(text).toBe(
      "The photo reading saved in this notebook shows the CA3KN22BD, not the CA3KN31BD you asked about, so I won't answer from it — its values may not apply to the CA3KN31BD. Add the CA3KN31BD manual (or the page that covers it) to this notebook and ask again.",
    );
  });

  // A third text the product writes: what OCR read off an uploaded photo. Its
  // first line is the product's and quotes the photo's file name; the same
  // name is the stored filename.
  const ocr = (photoName: string, text: string) =>
    ocrSourceText(photoName, { text, meanConfidence: 87.4, wordCount: 12, engine: "tesseract", ms: 40 }).replace(/[ \t]+\n/g, "\n").trim();

  it("OCR text of a photo is told by how its first line starts, and read from the next line on", () => {
    const stored = ocr("CV-101 relay.jpg", "Schneider Electric\nCA3KN22BD\n24 V DC");
    expect(stored.startsWith(PHOTO_OCR_OPENER_START)).toBe(true);
    expect(readOff(stored)).toContain("CA3KN22BD");
    expect(readOff(stored)).not.toContain("CV-101");
    expect(readOff(`Hardware User Guide\n${PHOTO_OCR_OPENER_START}x.jpg" (OCR, 90% confidence):\nRX420`)).toBeNull();
  });

  it.each([
    ["the photo is named for the machine, and the question names the machine", "What is the coil voltage of the relay on CV-101?", "CV-101 relay.jpg", "Schneider Electric\nCA3KN22BD\n24 V DC"],
    ["the photo is named for a look-alike, the text carries the asked number", "What is the coil voltage of the CA3KN22BD?", "CA3KN31BD.jpg", "Schneider Electric\nCA3KN22BD\n24 V DC"],
    ["the asked number is read inside a sentence", "What is the coil voltage of the CA3KN22BD?", "IMG_0042.jpg", "Do not exceed 24 V DC on the CA3KN22BD coil."],
    ["a look-alike in the photo's name only", "RX420 supply voltage?", "RX410 press.jpg", "Label reads 24 V DC supply"],
  ])("OCR text answers: %s", (_name, question, photoName, text) => {
    expect(kindOf(written(question, ocr(photoName, text), photoName))).toBe("answers");
  });

  it("OCR text that carries only a look-alike is refused as a reading, whatever the photo is named", () => {
    const v = written("What is the coil voltage of the CA3KN22BD?", ocr("CA3KN22BD.jpg", "Schneider Electric\nCA3KN31BD\n24 V DC"), "CA3KN22BD.jpg");
    expect(v).toMatchObject({ admit: false, kind: "other-model", declared: ["CA3KN31BD"], reading: true });
  });

  it("a refused manual beside a refused reading keeps the manual's sentence", () => {
    const manual = verdict("What is the coil voltage of the CA3KN31BD?", "Control relay, TeSys K\nstandard coil\nCA3KN22BD", "DS0004417.pdf");
    const refused = written("What is the coil voltage of the CA3KN31BD?", RELAY_PLATE, PLATE_FILE);
    const text = unlistedModelRefusalText(summarizeUnlistedRefusals([refusal(manual), refusal(refused)], "question"));
    expect(text).toContain("The manual in this notebook is for the CA3KN22BD, not the CA3KN31BD you asked about");
  });
});

describe("stated limits, pinned so a change to them is seen", () => {
  it("a photo reading that mentions the asked number only in passing answers for it", () => {
    const stored = buildPhotoSourceText({ machineName: "Press 2", fileId: "0b6f4c1e-7a2d-4e59-9c3a-5d1f8e2b7a40", photoSha256: null, capturedAt: null, reviewed: true, observation: "Page reads: for the RX420 see publication NF-UM002." }).trim();
    expect(kindOf(written("RX420 supply voltage?", stored, "Technician-reviewed photo reading.txt"))).toBe("answers");
  });
  it("an accessory's manual that names the model it is for is not told apart from the model's own manual", () => {
    expect(kindOf(verdict("How do I clear fault F004 on the RX420?", "EtherNet/IP Adapter for RX420 Drives\nUser Manual", "UM_ENET.pdf"))).toBe("answers");
  });
  it("a variant written as a hyphen and letters only is not told apart (RX420-E / RX420-U)", () => {
    expect(kindOf(verdict("Max output frequency of the RX420-E?", "RX420-U Drive User Manual", "um.pdf"))).toBe("answers");
  });
  it("a filename that names the asked model counts when the cover names none, whatever else the name carries", () => {
    expect(kindOf(verdict("Torque limit on the RX420?", "Migration Guide\nSetup Notes", "RX410_to_RX420_Migration.pdf"))).toBe("answers");
  });
  it("a reading that carries one machine's tag is refused for a question that names that tag and a look-alike tag", () => {
    const tagPlate = reading("CV-101", "Asset tag plate reads CV-101.");
    expect(kindOf(written("CV-101 stops when CV-102 is full, what should I check?", tagPlate, READING_FILE))).toBe("several-look-alikes");
    expect(kindOf(written("What is the belt speed on CV-101?", tagPlate, READING_FILE))).toBe("answers");
  });
  // IS and IT are always sentence words (review round 3 on #5389): nothing on
  // the page tells the noun from the verb for certain, so these real-looking
  // covers are refused. A wrong refusal, on the safe side, and seen here if it changes.
  it.each([
    "RX420 IS Barrier Installation Guide",
    "RX420 IT Power Systems Guide",
    "RX420 Logic Controller\nIS Barrier Module",
    "RX420 IS barrier - installation guide",
    "RX420 IT Network Supply Module",
  ])("a cover that uses IS or IT as a noun is refused: %j", (heading) => {
    expect(kindOf(verdict("RX420 supply voltage?", heading, "DS1.pdf"))).toBe("coverage-not-shown");
  });
});

describe("what a cover declares it is for (numbers the detector does not read)", () => {
  const labels = (heading: string) => coverDeclaredNumbers(heading).map((n) => n.label);

  it("reads the pilot's real covers as stored", () => {
    // Relay data sheet, maker's copy: the part number is its own title line.
    expect(labels("Control relay, TeSys K, 2 NO + 2\nNC, lt or eq to 690V, 24VDC\nstandard coil\nCA3KN22BD\nProduct availability: Stock")).toEqual(["CA3KN22BD"]);
    // Distributor's copy: a disclaimer, a date and a page number come first.
    expect(labels("Disclaimer: This documentation is not intended as a substitute for determining suitability\nJul 31, 2017\n1\nProduct data sheet\nCharacteristics\nCA3KN22BD\nTeSys K control relay - 2 NO + 2 NC - <= 690 V -\n24 V DC standard coil")).toEqual(["CA3KN22BD"]);
    // Controller sheet: the catalog-number list runs over stacked lines.
    expect(labels("Installation Instructions\nMicro820 20-Point Programmable Controllers\nCatalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB")).toEqual(["2080-LC20-20QWB", "2080-LC20-20QBB", "2080-LC20-20AWB"]);
  });

  it("a guide that names no product declares nothing, publication and document numbers included", () => {
    expect(labels("Wiring and Grounding Guidelines\nPublication NF-IN041B-EN-P\nOriginal Instructions")).toEqual([]);
    expect(labels("Conveyor Safety Guide\nDocument No. NF0000077 Rev. C")).toEqual([]);
  });

  it("a cover whose model the detector reads may repeat it here; it never adds another product", () => {
    // The drive manual's second line is its document code, "GS10_UMW".
    expect(labels("DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions")).toEqual(["GS10"]);
  });

  it("a number in running text further down is not a declaration", () => {
    expect(labels("Wiring Guide\nGeneral practice\nThis guide also applies when a CA3KN22BD relay is fitted in the panel.")).toEqual([]);
  });

  it("a photo reading has no cover", () => {
    expect(labels(reading("CV-101", "Relay plate reads CA3KN22BD."))).toEqual([]);
  });

  it("a manual covers a number its cover or filename carries, and only then", () => {
    const [relay] = unlistedModelNumbers("coil voltage of the CA3KN22BD");
    expect(manualCoversNumber(relay, "Product data sheet\nCA3KN22BD\nTeSys K control relay", "sheet.pdf")).toBe(true);
    expect(manualCoversNumber(relay, "Wiring Guide\nGeneral practice", "guide.pdf")).toBe(false);
  });

  it("the refusal says which product the manual is for, which the notebook is for, and both ways out", () => {
    const text = otherProductRefusalText({ declared: ["CA3KN22BD"], project: "Allen-Bradley Micro820" });
    expect(text).toContain("for the CA3KN22BD");
    expect(text).toContain("set up for the Allen-Bradley Micro820");
    expect(text).toMatch(/name it in the question/);
    expect(text).toMatch(/add the Allen-Bradley Micro820 manual/);
  });
});
