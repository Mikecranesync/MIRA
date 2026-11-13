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
  excludedTablesRefusalText,
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

// #5465 — a Rockwell manual downloaded under its publication number. With the
// revision letter ("2080-IN009B") the number has the same letters/digits layout
// as the catalog numbers on the cover ("2080-LC20-20QWB"), so it read as a
// look-alike model the cover does not list.
describe("a file saved under its publication number (#5465)", () => {
  const SHEET = "Installation Instructions\nMicro820 20-Point Programmable Controllers\n"
    + "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n2080-LC20-20QBBR, 2080-LC20-20AWBR";
  // The first stored block of the real PDF (the hub's extractor, 2026-11-13).
  const AS_STORED = SHEET
    + "\nhttp://rockwellautomation.com/literature\nFR\nCette publication est disponible en français\n"
    + "sous forme électronique (fichier PDF). Pour la\ntélécharger, rendez-vous sur la page Internet\nindiquée ci-dessus.\nPT";
  const GENERIC = "Hardware User Guide\nOriginal instructions";
  const FILE = "2080-IN009B-EN-P.pdf";
  const RX420 = "Northfield RX420 Logic Controller\nHardware User Guide";

  it("precondition: the publication number still reads as a number, and is a look-alike of the catalog numbers", () => {
    expect(keys("2080-IN009B-EN-P")).toEqual(["2080IN009B"]);
    // A neutral file name answers: the cover is right, only the file name differs.
    expect(kindOf(verdict("Relay contact ratings on the 2080-LC20-20QWB?", SHEET, "micro820-install.pdf"))).toBe("answers");
  });
  it.each(["2080-LC20-20QWB", "2080-LC20-20QBB", "2080-LC20-20AWBR"])("the cover lists %s: the manual answers under its real file name", (n) => {
    expect(kindOf(verdict(`Relay contact ratings on the ${n}?`, SHEET, FILE))).toBe("answers");
    expect(kindOf(verdict(`Relay contact ratings on the ${n}?`, AS_STORED, FILE))).toBe("answers");
  });
  it.each(["2080-in009b-en-p.pdf", "2080-IN009B-EN-P (1).pdf", "1766-UM001O-EN-P.pdf"])("in any spelling a download gives it: %s", (filename) => {
    const cover = filename.startsWith("1766") ? "MicroLogix 1400 Programmable Controllers\nCatalog Numbers 1766-L32BWA, 1766-L32AWA" : SHEET;
    const n = filename.startsWith("1766") ? "1766-L32BWA" : "2080-LC20-20QWB";
    expect(kindOf(verdict(`Supply voltage for the ${n}?`, cover, filename))).toBe("answers");
  });
  it("a cover with no number of the family: the publication file name does not refuse the manual", () => {
    expect(kindOf(verdict("Relay contact ratings on the 2080-LC20-20QWB?", GENERIC, FILE))).toBe("answers");
  });
  it("control: the publication file name is never evidence that the manual covers a number", () => {
    expect(manualCoversNumber(asked("2080-LC20-20QWB")[0], GENERIC, FILE)).toBe(false);
  });
  it("control: a catalog number the cover does not list still refuses, and names what it lists", () => {
    const v = verdict("Supply voltage for 2080-LC99-99ZZZ?", SHEET, FILE);
    expect(v).toMatchObject({ admit: false, kind: "other-model", declared: expect.arrayContaining(["2080-LC20-20QWB"]) });
    expect(kindOf(verdict("Supply voltage for 2080-LC99-99ZZZ?", AS_STORED, FILE))).toBe("other-model");
  });
  it("control: a sibling model glued to a publication number in the file name still disagrees with the cover", () => {
    expect(kindOf(verdict("RX420 supply voltage?", RX420, "RX410-UM001A-EN-P.pdf"))).toBe("cover-and-file-disagree");
    expect(kindOf(verdict("RX410 supply voltage?", RX420, "RX410-UM001A-EN-P.pdf"))).toBe("cover-and-file-disagree");
    expect(verdict("RX420 supply voltage?", GENERIC, "RX410-UM001A-EN-P.pdf")).toEqual({ admit: false, kind: "coverage-not-shown", asked: ["RX420"], declared: [] });
    expect(kindOf(verdict("RX410 supply voltage?", GENERIC, "RX410-UM001A-EN-P.pdf"))).toBe("answers");
  });
  it.each(["2080-UM005E-EN-E.pdf", "2080-QS001A-EN-P.pdf", "2080-in009b-de-p.pdf", "2080-IN009B-ZH-P.pdf", "2080-IN009B-EN-P_v2.pdf", "2080-IN009B-EN-P copy.pdf"])(
    "any listed publication type, language and download suffix: %s", (filename) => {
      expect(kindOf(verdict("Relay contact ratings on the 2080-LC20-20QWB?", SHEET, filename))).toBe("answers");
    });
  it.each(["2080-DS001B-EN-P.pdf", "2080-IN009B_EN_P.pdf", "2080-IN009B-ENG-P.pdf", "2080-IN009B.pdf"])(
    "short of the whole signature the number is read as a model (stated limit: the right manual still refuses): %s", (filename) => {
      // A type code off the list, underscores, a three-letter language, or no
      // suffix at all. Tracked in #5469.
      expect(kindOf(verdict("Relay contact ratings on the 2080-LC20-20QWB?", SHEET, filename))).toBe("cover-and-file-disagree");
    });
  it.each(["1234-AB123-US-A.pdf", "1234-AB123-EN-P.pdf", "Z1234-BR100-EN-P_1234-BR100.pdf"])(
    "control: a sibling product that only resembles the signature still disagrees with the cover: %s", (filename) => {
      const asked = filename.includes("AB123") ? "1234-AB124" : "1234-BR200";
      const cover = `Northfield ${asked} Drive\nHardware User Guide`;
      expect(kindOf(verdict(`Supply voltage for ${asked}?`, cover, filename))).toBe("cover-and-file-disagree");
    });
  it("control: the same number written again without the suffix is still a model (Codex round 1, F1)", () => {
    const BR200 = "Northfield 1234-BR200 Drive\nHardware User Guide";
    for (const filename of ["1234-BR100-EN-P_1234-BR100.pdf", "1234-BR100_1234-BR100-EN-P.pdf"]) {
      expect(kindOf(verdict("Supply voltage for 1234-BR200?", BR200, filename))).toBe("cover-and-file-disagree");
      expect(verdict("Supply voltage for 1234-BR200?", GENERIC, filename)).toEqual({ admit: false, kind: "coverage-not-shown", asked: ["1234-BR200"], declared: [] });
    }
    // Twice WITH the suffix it is the document's number twice, and the cover decides.
    expect(kindOf(verdict("Relay contact ratings on the 2080-LC20-20QWB?", SHEET, "2080-IN009B-EN-P_2080-IN009B-EN-P.pdf"))).toBe("answers");
  });
  it("control: a sibling PRODUCT whose second group looks like a publication group still disagrees with the cover", () => {
    // "1234-BR100.pdf" has no language-and-format suffix: it is a product's name, not a document's.
    const BR200 = "Northfield 1234-BR200 Drive\nHardware User Guide";
    expect(kindOf(verdict("Supply voltage for 1234-BR200?", BR200, "1234-BR100.pdf"))).toBe("cover-and-file-disagree");
    expect(kindOf(verdict("Supply voltage for 1234-BR200?", BR200, "1234-BR100-manual.pdf"))).toBe("cover-and-file-disagree");
    expect(verdict("Supply voltage for 1234-BR200?", GENERIC, "1234-BR100.pdf")).toEqual({ admit: false, kind: "coverage-not-shown", asked: ["1234-BR200"], declared: [] });
  });
  it("a publication file name tells nothing about the model, exactly like a neutral one (stated limit: a silent cover answers)", () => {
    // The cover is silent about the family, so the manual answers for any number
    // of it, as it always has under a neutral file name. The publication number
    // used to refuse here only by being misread as a model.
    for (const filename of ["micro820-install.pdf", FILE]) {
      expect(kindOf(verdict("Supply voltage for 2080-LC50-24QWB?", GENERIC, filename))).toBe("answers");
    }
  });
  it("a product whose name has a document's whole shape is taken for a document (stated limit)", () => {
    const SR745 = "Northfield 1234-SR745 Relay\nHardware User Guide";
    expect(kindOf(verdict("Supply voltage for 1234-SR745?", SR745, "1234-SR750-EN-P.pdf"))).toBe("answers");
    // The cover still decides: it lists the sibling, so the asked model is refused.
    expect(kindOf(verdict("Supply voltage for 1234-SR750?", SR745, "1234-SR750-EN-P.pdf"))).toBe("other-model");
  });
  it("control: a model that only looks like a publication group on its own is still a model on the file name", () => {
    // "PM800", "SR750" and "AT500" are products. Only a group AFTER a family
    // prefix ("2080-IN009B") numbers the document.
    const PM820 = "Northfield PM820 Power Meter\nInstallation Guide";
    expect(kindOf(verdict("PM820 supply voltage?", PM820, "PM800.pdf"))).toBe("cover-and-file-disagree");
    // Even with a document's suffix: there is no group in front of it.
    expect(kindOf(verdict("PM820 supply voltage?", PM820, "PM800-EN-P.pdf"))).toBe("cover-and-file-disagree");
    expect(kindOf(verdict("PM800 supply voltage?", GENERIC, "PM800.pdf"))).toBe("answers");
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
  it("another model's table was all that was found: names the record's number, the table's models and the page, and nothing from the passage", () => {
    expect(excludedTablesRefusalText("GS11N-20P2", [{ page: 27, models: ["GS13N20P2"] }])).toBe(
      "This manual's table for the GS11N-20P2 was not found. What I found is the GS13N20P2 table (page 27), and I won't answer the GS11N-20P2 from another model's column — its values may not apply. Open page 27 and read the GS11N-20P2 column there, or add the page that lists the GS11N-20P2 to this notebook and ask again.",
    );
    const two = excludedTablesRefusalText("GS11N-20P2", [
      { page: 27, models: ["GS13N20P2"] },
      { page: 26, models: ["GS13N20P2", "GS13N20P5"] },
      { page: null, models: [] },
    ]);
    expect(two).toContain("the GS13N20P2 / GS13N20P5 table (pages 26, 27)");
    expect(two).toContain("Open pages 26, 27 and read the GS11N-20P2 column there");
    expect(two).not.toMatch(/1\.9|5\.1/);
    expect(excludedTablesRefusalText("GS11N-20P2", [{ page: null, models: ["GS13N20P2"] }])).toBe(
      "This manual's table for the GS11N-20P2 was not found. What I found is the GS13N20P2 table, and I won't answer the GS11N-20P2 from another model's column — its values may not apply. Add the page that lists the GS11N-20P2 to this notebook and ask again.",
    );
  });
  it("the record's own table was found but its lines could not be tied to a column: says so by page, never calls the record's own table another model's", () => {
    const own = ["GS11N20P2", "GS11N20P5", "GS11N21P0"];
    const only = excludedTablesRefusalText("GS11N-20P2", [{ page: 26, models: own, unqualified: true }]);
    expect(only).toBe(
      "This manual's table for the GS11N-20P2 is on page 26, but I could not read its lines as values for one model, and I won't answer the GS11N-20P2 from a line I can't tie to its column. Open page 26 and read the GS11N-20P2 column there, or add a clearer copy of that page to this notebook and ask again.",
    );
    expect(only).not.toMatch(/another model's column|GS11N20P2/);
    const mixed = excludedTablesRefusalText("GS11N-20P2", [
      { page: 27, models: ["GS13N20P2"] },
      { page: 26, models: own, unqualified: true },
    ]);
    expect(mixed).toContain("What I found is the GS13N20P2 table (page 27), and I won't answer the GS11N-20P2 from another model's column");
    expect(mixed).toContain("The GS11N-20P2 table itself is on page 26, but I could not read its lines as values for one model.");
    expect(mixed).toContain("Open pages 26, 27 and read the GS11N-20P2 column there");
    expect(mixed).not.toContain("GS11N20P2");
    expect(excludedTablesRefusalText("GS11N-20P2", [{ page: null, models: own, unqualified: true }])).toBe(
      "This manual's table for the GS11N-20P2 was found, but I could not read its lines as values for one model, and I won't answer the GS11N-20P2 from a line I can't tie to its column. Add a clearer copy of the page that lists the GS11N-20P2 to this notebook and ask again.",
    );
  });
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
// a plus or an apostrophe is read by its parts. A known negation or exclusion
// part makes it a sentence word when another part says what is negated: a word
// about coverage, a sentence word or a model number ("not-covered",
// "not-for-this-model", "ohne-RX420"). A product word ("Non-Isolated",
// "Do-more") stays a title word: nothing in it says what is negated.
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
  // What the cover DECLARES (read when the question names no number) is left
  // as it was: there a product the cover no longer declares lets another
  // machine's notebook be answered from this manual.
  it.each(JOINED.filter((w) => !w.includes("RX420")))("and the cover declares what it did before: %s", (w) => {
    for (const heading of [
      `Hardware User Guide\nRX420 (${w})`,
      `RX420 Logic Controller\n${w.toUpperCase()} by this manual`,
      `Hardware User Guide\n${cap(w)} models:\nRX420 Logic Controller`,
    ]) expect(coverDeclaredNumbers(heading).map((n) => n.label), heading).toEqual(["RX420"]);
  });

  // The three covers in the finding, word for word.
  it.each([
    "Hardware User Guide\nRX420 (not-covered)",
    "RX420 Logic Controller\nNOT-SUPPORTED by this manual",
    "Hardware User Guide\nNon-supported models:\nRX420 Logic Controller",
  ])("the reviewer's cover: %j", (heading) => {
    expect(verdict(ASK, heading)).toEqual({ admit: false, kind: "coverage-not-shown", asked: ["RX420"], declared: [] });
    expect(manualCoversNumber(asked(ASK)[0], heading, OPAQUE)).toBe(false);
  });

  it.each([
    ["isn't", "RX420 Logic Controller isn't here"],
    ["doesn't, opening the line below", "RX420 Logic Controller\nDoesn't ship with a guide"],
    ["won't, with a curly apostrophe", "RX420 Logic Controller won’t ship"],
    ["can't, in a heading above", "Models Northfield can't supply\nRX420 Logic Controller"],
  ])("a contraction is a negation: %s", (_w, heading) => {
    expect(kindOf(verdict(ASK, `Hardware User Guide\n${heading}`))).toBe("coverage-not-shown");
  });

  it.each([
    ["a soft hyphen", "RX420 Logic Controller n­ot"],
    ["a zero-width space", "RX420 Logic Controller n​ot"],
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

describe("a remark beside the model written with a listed word, phrase or mark shows nothing", () => {
  const ASK = "RX420 supply voltage?";
  it.each([
    ["not applicable, abbreviated", "Hardware User Guide\nRX420 Logic Controller (N/A)"],
    ["the same, with dots", "Hardware User Guide\nRX420 Logic Controller (n.a.)"],
    ["the same, with no brackets", "Hardware User Guide\nRX420 Logic Controller N/A"],
    ["end of life after a dash", "Hardware User Guide\nRX420 Logic Controller - end of life"],
    ["out of scope, in brackets", "Hardware User Guide\nRX420 Logic Controller (out of scope)"],
    ["out of scope, as a label before the model", "Hardware User Guide\nOut-of-scope: RX420 Logic Controller"],
    ["out of scope, as a heading above", "Hardware User Guide\nOut-of-scope models:\nRX420 Logic Controller"],
    ["German, joined, after a dash", "Hardware User Guide\nRX420 Logic Controller – nicht-enthalten"],
    ["German, joined, in brackets", "Hardware User Guide\nRX420 Logic Controller (kein-Inhalt)"],
    ["a bracket that is never closed", "Hardware User Guide\nRX420 Logic Controller (ask your dealer"],
    ["square brackets", "Hardware User Guide\nRX420 Logic Controller [dealer only]"],
    ["curly brackets", "Hardware User Guide\nRX420 Logic Controller {not covered}"],
    ["angle brackets", "Hardware User Guide\nRX420 Logic Controller <not covered>"],
    ["abbreviated exclusion", "Hardware User Guide\nExcl. RX420 Logic Controller"],
    ["not equal", "Hardware User Guide\nRX420 Logic Controller ≠ this manual"],
  ])("refuses, coverage not shown: %s", (_why, heading) => {
    expect(kindOf(verdict(ASK, heading))).toBe("coverage-not-shown");
  });
});

// More ways the same exclusion is written with no listed word standing alone.
describe("an exclusion written as a mark, run together or broken across lines", () => {
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
    // Read on the line below too. Until 2026-11-10 it was read only on the
    // model's own line and the line above ("NOT-SUPPORTED by ..." refused,
    // "NotSupported by ..." answered).
    ["run together, alone on the line below", "RX420 Logic Controller\nNotSupported"],
    ["run together, opening the line below", "RX420 Logic Controller\nNotSupported by this manual"],
    ["run together, lower case, on the line below", "RX420 Logic Controller\nnotcovered in this guide"],
    ["run together, inside the line below", "RX420 Logic Controller\nThis model: NotIncluded"],
    ["an exclusion broken across lines, above", "Hardware User Guide ex-\ncluding RX420 Logic Controller"],
    ["a heading two lines up that ends in a colon", "Not covered in this guide:\nHardware\nRX420 Logic Controller"],
    ["the same heading five lines up", "Not covered in this guide:\nA\nB\nC\nD\nRX420 Logic Controller"],
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
// answer. So this change leaves it alone, but for one thing pinned at the end
// of this block. An earlier draft made it read these negations too, and an
// independent pass showed covers that stopped declaring their own product.
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
    "Hardware User Guide\nRX420 Logic Controller isn't here",
    // Each of these is told from a title by one rule only (the tamper checks
    // found the rows above were also caught by another).
    "Hardware User Guide\nRX420 Logic Controller hasn't shipped",
    "Hardware User Guide\nRX420 Logic Controller couldn’t ship",
    "Hardware User Guide\nRX420 Logic Controller n­ot",
    "Hardware User Guide\nRX420 Logic Controller n​ot",
    "Hardware User Guide\nRX420 Logic Controller ｎｏｔ",
  ])("a negation the asked-number check refuses is still declared: %j", (heading) => {
    expect(kindOf(verdict("RX420 supply voltage?", heading))).toBe(heading.includes("ｎｏｔ") ? "answers" : "coverage-not-shown");
    expect(labels(heading)).toEqual(["RX420"]);
  });
  // Red on the unpushed second rework (970d26cbe), which declared nothing here.
  it.each([
    ["a label line ending in No.", "Catalog No.\n25B-D010N104\nPowerFlex 525 Adjustable Frequency AC Drive\nUser Manual", ["25B-D010N104"]],
    ["the Spanish number sign", "PowerFlex 525 Drive Nº 25B-D010N104\nManual do usuário", ["25B-D010N104"]],
    ["a range typed with a minus sign", "RX410 \u2212 RX430 Logic Controllers\nUser Manual", ["RX410", "RX430"]],
    ["a range typed with a no-break hyphen", "RX410 \u2011 RX430 Logic Controllers\nUser Manual", ["RX410", "RX430"]],
    ["N/A as a field value above the title", "Version N/A\n\nRX420 Drive User Manual\nUser Manual", ["RX420"]],
    ["a joined remark below the title", "RX420 Drive User Manual\nDo-It-Yourself", ["RX420"]],
    ["an end-of-service notice above the title", "End-of-Service Notice\nRX420 Drive User Manual", ["RX420"]],
    ["an exclusion-zone sensor", "Banner ZSX100 Exclusion Zone Radar Sensor\nInstruction Manual", ["ZSX100"]],
  ])("the cover declares what it did before this change: %s", (_why, heading, declared) => {
    expect(labels(heading)).toEqual(declared);
  });
  // The one difference from the commit before, measured on 52,089 covers from
  // the independent pass and 6,933 of this change's own: curly and angle
  // brackets are stripped in both readings, so a listed negation inside them
  // is read here too.
  it.each(["RX420 Logic Controller {not covered}", "Hardware User Guide\nRX420 Logic Controller <not covered>"])(
    "a listed negation in curly or angle brackets declares nothing: %j",
    (heading) => {
      expect(labels(heading)).toEqual([]);
    },
  );
  it.each([
    ["a remark on coverage under the title", "RX420 Drive User Manual\nThis drive is not covered here"],
    ["not applicable, alone under the title", "RX420 Drive User Manual\nN/A"],
  ])("a cover the asked-number check refuses for the line below still declares its product: %s", (_why, heading) => {
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
    ["a three-part product word", "RX420 Non-Isolated-Input Module User Manual"],
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
    ["a product word joined to a rating", "RX420 30A-Non-Fused Disconnect Switch Manual"],
    ["a product word joined to a wire count", "RX420 2-Wire-Non-Isolated Transmitter Manual"],
    ["a no-load test joined to a voltage", "RX420 Drive 24V-No-Load Test Guide"],
    ["a contact count, joined", "RX420 Relay Output Module 2-NO"],
    ["contact counts joined with a plus", "RX420 Logic Controller 1-NO+1-NC Module"],
    ["channel counts, joined", "RX420 Logic Controller 8-DI/8-DO Module"],
    // Each row below isolates one exemption: with it taken out, the row refuses.
    ["a web address under the title that reads like an exclusion", "RX420 Logic Controller\nwww.northfield.example/not-supported"],
    ["a mail address under the title that reads like an exclusion", "RX420 Logic Controller\nsupport@not-covered.example"],
    ["digital outputs, normally open, joined", "RX420 Relay Output Module 4-DO-NO"],
    ["a typed file that opens like a photo's text, the photo's file name holding a negation", `${PHOTO_OCR_OPENER_START}no label.jpg":\nNorthfield\nRX420 Logic Controller`],
    ["a joined phrase on the line beside a model line with no noun of its own", "RX420 Compact\nThe Do-It-Yourself Logic Controller"],
    ["a typed file that opens with the product's photo heading, two lines above the title", `${PHOTO_READING_BODY_MARK}\nNorthfield\nRX420 Logic Controller`],
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
    ["North America written N/A", "RX420 Drive N/A Version User Manual"],
    ["'Model No.:' with the colon tight against it (it refused before this change too)", "Model No.: RX420\nUser Manual"],
    ["North America written N/A, after the noun", "RX420 Logic Controller N/A Version"],
    ["a part number field left as N/A under the title", "RX420 Logic Controller\nPart Number: N/A"],
    ["a revision field left as n/a under the title", "RX420 Logic Controller\nRevision: n/a"],
    ["a feature line under the title that says no and supports", "RX420 Logic Controller\nSupports Modbus, no extra license"],
    ["a slogan under the title that opens with a contraction", "RX420 Logic Controller\nIsn't it time to upgrade"],
    ["'alternative' beside a coverage word under the title", "RX420 Logic Controller\nIncludes Alternative Wiring Diagrams"],
    ["a joined warning", "RX420 Logic Controller\nDo-Not-Open"],
    ["a joined approval remark", "RX420 Logic Controller Non-UL-Listed"],
    ["a joined accessories remark", "RX420 Logic Controller Not-Included-Accessories User Manual"],
    // New on 2026-11-10 with the line-below reading of run-together negations
    // (found by the independent pass): an ordinary word that IS a negation
    // prefix plus a coverage word, under the title. It already refused on the
    // model's own line.
    ["'Uncovered' under the title", "RX420 Logic Controller\nUncovered Terminals"],
    ["'Unlisted' under the title", "RX420 Logic Controller\nUnlisted accessories"],
  ])("%s", (_why, heading) => {
    expect(kindOf(verdict("RX420 fault F004?", heading, "NF0000021.pdf"))).toBe("coverage-not-shown");
  });
});

// A rule that asked every word beside the model to be a known title word was
// built for this change and withdrawn before it shipped: an independent pass
// found it refused ordinary covers. Every row here failed with that rule in
// place (commit 5cc481470, never pushed) and answers on the commit before this
// change.
describe("ordinary covers the withdrawn every-word-known rule refused still answer", () => {
  it.each([
    ["a language code in brackets", "RX420", "RX420 Drive Manual (EN)"],
    ["the same in lower case", "RX420", "RX420 Drive Manual (en)"],
    ["a language code with no brackets", "RX420", "RX420 Drive Manual EN"],
    ["a file type in brackets", "RX420", "RX420 Drive Manual (PDF)"],
    ["a market in brackets", "RX420", "RX420 Drive Manual (US)"],
    ["a UL mark", "RX420", "RX420 Drive Manual (UL)"],
    ["a CE mark", "RX420", "RX420 Drive Manual (CE)"],
    ["hardware, abbreviated", "RX420", "RX420 Drive Manual (HW)"],
    ["software, abbreviated", "RX420", "RX420 Drive Manual (SW)"],
    ["a page number", "RX420", "RX420 Drive Manual (Page 1)"],
    ["a revision and date", "RX420", "RX420 Drive Manual (Rev 2, Dec 2020)"],
    ["a maker in brackets", "RX420", "RX420 Drive Manual (Siemens)"],
    ["a bracketed maker or range name", "RX420", "RX420 Logic Controller (Northfield)\nUser Manual"],
    ["a manual kind in brackets", "RX420", "RX420 Drive Manual (Detailed)"],
    ["another", "RX420", "RX420 Drive Manual (Short)"],
    ["another", "RX420", "RX420 Drive Manual (Full)"],
    ["'translation' in French", "RX420", "RX420 Drive Manual (Traduction)"],
    ["'translation' in German", "RX420", "RX420 Servoantrieb Betriebsanleitung (Übersetzung)"],
    ["a Spanish user manual", "RX420", "RX420 Manual del usuario"],
    ["a French user manual", "RX420", "RX420 Variateur de fréquence Manuel de l'utilisateur"],
    ["a Mitsubishi part number with its suffix", "FX5U-32MR", "MELSEC iQ-F FX5U-32MR/ES\nUser's Manual (Hardware)"],
    ["a Mitsubishi drive manual with its range letters", "FR-D700", "FR-D700 SC Instruction Manual (Applied)\nFR-D720S-025"],
    ["a catalog number before the product name", "22B-D4P0N104", "Rockwell 22B-D4P0N104 PowerFlex 40\nUser Manual\nPublication 22B-UM001"],
    ["a joined product word no list names", "RX420", "RX420 Non-Sparking Drive Manual"],
    ["the same on a tool kit", "RX420", "RX420 Non-Sparking Tool Kit Manual"],
    ["the same on the line below", "RX420", "RX420 Drive Manual\nNon-Sparking"],
    ["a label the lists do not know", "RX420", "Bestellbezeichnung: RX420 Logic Controller"],
    ["the same, with the title below", "RX420", "Bestellbezeichnung: RX420\nBetriebsanleitung"],
    ["a title that ends in a product word the lists do not know", "RX420", "RX420 Drive with Brake Chopper\nUser Manual"],
    ["a heading the lists do not know, directly above", "RX420", "Hauptkatalog:\nRX420 Logic Controller"],
  ])("%s", (_why, number, heading) => {
    expect(kindOf(verdict(`What does the fault mean on the ${number}?`, heading, "x.pdf"))).toBe("answers");
  });

  // Controls: these answered with the withdrawn rule too.
  it.each([
    ["PowerFlex 525, by catalog number", "25B-D1P4N104", "PowerFlex 525 Adjustable Frequency AC Drive\nUser Manual\nCatalog Numbers 25B-D1P4N104, 25B-D2P3N104"],
    ["SINAMICS V20, by order number", "6SL3210-5BB11-2UV1", "SINAMICS V20 Inverter\nOperating Instructions\n6SL3210-5BB11-2UV1"],
    ["SIMATIC S7-1200", "S7-1200", "SIMATIC S7-1200 Controller\nSystem Manual\n6ES7214-1AG40-0XB0"],
    ["SINAMICS G120C, German", "G120C", "Betriebsanleitung\nSINAMICS G120C 6SL3210-1KE12-3UB2\nFrequenzumrichter"],
    ["Altivar 320", "ATV320U06N4B", "Altivar 320 Variable speed drives ATV320U06N4B\nInstallation manual"],
    ["Altivar 320, French", "ATV320U06N4B", "Variateur de vitesse ATV320U06N4B\nManuel d'installation"],
    ["TeSys D", "LC1D09BD", "TeSys D contactors LC1D09BD\nInstructions for use"],
    ["Omron CP1E", "CP1E-N40DR", "Omron CP1E-N40DR-A\nCP1E CPU Unit Software User's Manual"],
    ["Mitsubishi FR-D700, basic manual", "FR-D700", "FR-D700 Inverter\nInstruction Manual (Basic)\nFR-D720S-025"],
    ["a publication number under the title", "RX420", "RX420 Logic Controller\nInstallation Instructions\nPublication 2080-IN009C-EN-P"],
    ["a model label", "RX420", "Model: RX420\nDrive Manual"],
    ["a maker with a trade mark sign", "RX420", "Northfield® RX420 Logic Controller"],
    ["a guide and revision after a dash", "RX420", "RX420 Logic Controller - Installation Guide, Rev 3"],
    ["a rating after commas", "RX420", "RX420 Logic Controller, 24 VDC, Ethernet"],
    ["one word per line", "RX420", "Northfield\nRX420\nLogic Controller\nUser Manual"],
    ["a non-isolated version on the line below", "RX420", "RX420 Drive Manual\nNon-isolated version"],
    ["an Italian manual", "RX420", "RX420 Manuale di installazione e uso"],
    ["a Spanish manual", "RX420", "RX420 Convertidor de frecuencia Manual de instrucciones"],
    ["a safety line below", "RX420", "RX420 Drive Manual\nFor use in non-hazardous locations"],
    ["a firmware version in brackets", "RX420", "RX420 Drive Manual (Firmware V3.1)"],
    ["an edition in brackets", "RX420", "RX420 Drive Manual (Edition 2021-05)"],
    ["a part count in brackets", "RX420", "RX420 Drive Manual (Part 1 of 3)"],
  ])("control: %s", (_why, number, heading) => {
    expect(kindOf(verdict(`What does the fault mean on the ${number}?`, heading, "x.pdf"))).toBe("answers");
  });
});

// The first rework of this change (commit 166d795b3, never pushed) still read
// too much as an exclusion: forty-one added words (false, invalid, skipped,
// TBD ...), any joined word with a digit in it, any heading ending in a colon
// and any negation on the line below. An independent pass found the ordinary
// covers it refused. Every row here failed on that commit and answers on the
// commit before this change.
describe("ordinary covers the unpushed first rework refused still answer", () => {
  it.each([
    "RX420 Relay Module\nNO-24VDC, 5 A",
    "RX420 Logic Controller\nDO-16TP",
    "RX420 Safety Relay IS-Barrier-24V",
    "Scan this QR code for the latest manual:\nwww.maker.com/doc\nRX420 Logic Controller\nUser Manual",
    "Applies to:\nNorthfield\nRX420 Logic Controller\nUser Manual",
    "This document applies to:\nwww.maker.com/doc\nRX420 Logic Controller",
    "Contents of this package:\nQR\nRX420 Logic Controller\nUser Manual",
    "Applicable products:\nNorthfield\nRX420 Logic Controller",
    "RX420 Logic Controller\nRev. TBD",
    "RX420 Logic Controller\nRelease date: TBA",
    "RX420 Drive False Alarm Troubleshooting Guide",
    "RX420 Invalid Parameter Handling Guide",
    "RX420 Absent Phase Detection Relay Manual",
    "RX420 Drive Wrong Wiring Protection Module Manual",
    "RX420 Logic Controller\nFalse alarm handling",
    "RX420 Dropped Frame Diagnostics Guide",
    "RX420 Logic Controller\nHors tension",
    "RX420 Drive Skipped Frequency Setup Guide",
    "RX420 Void Detection Sensor Manual",
    "RX420 Retired Products Catalog",
    "RX420 Drive Upcoming Firmware Guide",
    "RX420 Logic Controller\nInstallation and Replacement Parts Manual",
    "RX420 Logic Controller\nUser Manual - Separate Mounting Kit",
    "RX420 Drive\nUser Manual, Different Frame Sizes",
    "RX420 Logic Controller\nHardware and Coverage Options",
    "RX420 Logic Controller\nSpare and Replacement Parts",
    "RX420 Logic Controller\nOriginal Instructions, Applicable Standards EN 61131",
    "RX420 Logic Controller\nNO-24VDC",
    "RX420 Logic Controller\nRelay-NO-24V",
    "RX420 Logic Controller\nType-NO-8A",
    "RX420 NO-contact-4A Logic Controller User Manual",
    "NO-contact-4A Series\nRX420 Logic Controller",
    "RX420 IS-Barrier-24V Logic Controller User Manual",
    "IS-Barrier-24V Series\nRX420 Logic Controller",
    "RX420 Logic Controller\nSin/Cos-Encoder",
    "RX420 Logic Controller TBD-2024",
    "RX420 Logic Controller\nKeiner-Ausser-Dir",
    "RX420 Logic Controller\n\nRev. TBD\nUser Manual",
    "Manufacturer\nRX420 Logic Controller\nRev. TBD\nOriginal Instructions",
    "RX420 Logic Controller\nNext revision upcoming",
    "RX420 Logic Controller\nDraft - not for distribution",
    "RX420 Logic Controller\nCONFIDENTIAL - NOT FOR DISTRIBUTION",
    "RX420 Logic Controller\nWarning: do not operate without guard",
    "RX420 Logic Controller\nFor use without display",
    "RX420 Logic Controller\nNon-3-phase version",
    "RX420 Logic Controller\nNon-60Hz",
    "RX420 Logic Controller\nPrevious revision: none",
    "RX420 Logic Controller\nRevision history: none",
    "RX420 Logic Controller\nPrinted in USA - no recycled content",
    "RX420 Logic Controller\nLanguage: English (no translation)",
    "RX420 Logic Controller\nTranslation: none",
    "RX420 Logic Controller\nHazardous location: not required",
    "RX420 Logic Controller\nSans fil",
    "RX420 Logic Controller\nOhne Zubehör",
    "RX420 Logic Controller\nSin accesorios",
    "RX420 Logic Controller\nSenza fili",
    "RX420 Logic Controller\nWireless (no cables)",
    "RX420 Logic Controller\nVoid where prohibited",
    "RX420 Logic Controller\nRetired parts list",
    "RX420 Logic Controller\nIgnored faults",
    "RX420 Logic Controller\nSkipped steps",
    "RX420 Logic Controller\nExcl. VAT",
    "RX420 Drive User Manual\nThis manual covers installation and wiring",
    "RX420 Drive User Manual\nWarning: not for use in hazardous locations",
  ])("%j", (heading) => {
    expect(kindOf(verdict("RX420 fault F004?", heading, "NF0000021.pdf"))).toBe("answers");
  });
});

// An independent pass on the unpushed second rework (970d26cbe) found cover
// shapes seen on real manuals that it refused and the commit before answered.
// Each row is red on 970d26cbe.
describe("real cover shapes the second rework refused still answer", () => {
  it.each([
    ["a label line ending in No., the number below", "25B-D010N104", "Catalog No.\n25B-D010N104\nPowerFlex 525 Adjustable Frequency AC Drive\nUser Manual"],
    ["the same, Model No.", "25B-D010N104", "Model No.\n25B-D010N104\nUser Manual"],
    ["the Spanish number sign before the number", "6SL3210-1KE12-3UB2", "SINAMICS G120C\nNº de pedido 6SL3210-1KE12-3UB2\nInstrucciones de servicio"],
    ["the same on the title line", "25B-D010N104", "PowerFlex 525 Drive Nº 25B-D010N104\nManual do usuário"],
    ["a title that trails off in an ellipsis", "ACS580-01-12A6-4", "ACS580-01-12A6-4 Drive Manual …"],
    ["a range typed with a minus sign", "RX410", "RX410 \u2212 RX430 Logic Controllers\nUser Manual"],
    ["a range typed with a no-break hyphen", "RX410", "RX410 \u2011 RX430 Logic Controllers\nUser Manual"],
    ["an exclusion-zone sensor", "ZSX100", "Banner ZSX100 Exclusion Zone Radar Sensor\nInstruction Manual"],
    ["a joined product phrase opening the line below", "RX420", "RX420 Logic Controller\nDo-It-Yourself Installation Guide"],
    // An ordinary word that only starts like a negation is not one, below the title either.
    ["'Notebook' on the line below", "RX420", "RX420 Logic Controller\nNotebook Edition User Guide"],
    ["'Universal' on the line below", "RX420", "RX420 Logic Controller\nUniversal Input Module Guide"],
    ["'Noncontact' on the line below", "RX420", "RX420 Logic Controller\nNoncontact Sensor Kit Manual"],
    ["a run-together negation below that names another model", "RX410", "RX410 Drive User Manual\nRX420 Drive NotSupported"],
  ])("%s", (_why, number, heading) => {
    expect(kindOf(verdict(`${number} supply voltage?`, heading))).toBe("answers");
  });

  // One pattern backtracked on a long run of letters: 0.9 s at 40,000 letters.
  it("a title line that ends in one very long run of letters is read at once", () => {
    const heading = `RX420 Logic Controller ${"a".repeat(40000)}`;
    const started = performance.now();
    verdict("RX420 supply voltage?", heading);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

// KNOWN WRONG-ADMIT, open: a LISTED word the rules do not read where or how it
// is written. Each row answered on the commit before this change too.
describe("known limit: a listed word written or placed where it is not read", () => {
  it.each([
    ["full-width letters", "Hardware User Guide\nRX420 Logic Controller ｎｏｔ"],
    ["full-width, on the line below", "RX420 Logic Controller\nｎｏｔ covered"],
    ["a full-width slash in N/A", "Hardware User Guide\nRX420 Logic Controller N／A"],
    ["an answer after a colon", "Hardware User Guide\nRX420 Logic Controller: no."],
    ["run together with a word between the negation and the coverage word", "RX420 Logic Controller\nNoLongerSupported"],
    ["run together, two lines below", "RX420 Logic Controller\nUser Guide\nNotSupported"],
    ["emphasis marks around it", "Hardware User Guide\nRX420 Logic Controller **not covered**"],
    ["curly quotes around it", "Hardware User Guide\nRX420 Logic Controller “not covered”"],
    ["letters spaced out", "RX420 Logic Controller\nN O T  C O V E R E D"],
    ["N/A typed with spaces", "Hardware User Guide\nRX420 Logic Controller N / A"],
    ["a phrase wrapped over two lines", "RX420 Logic Controller\nEnd of\nlife"],
    ["a heading seven lines up", "Not covered:\nA\nB\nC\nD\nE\nF\nG\nRX420 Logic Controller"],
    ["a heading that ends in a dash, not a colon", "Not covered in this guide -\nHardware\nRX420 Logic Controller"],
    ["under the last of three stacked models", "RX410 Logic Controller\nRX420 Logic Controller\nRX430 Logic Controller\nnot covered"],
  ])("%s", (_why, heading) => {
    expect(kindOf(verdict("RX420 supply voltage?", heading))).toBe("answers");
  });
});

// KNOWN WRONG-ADMIT, open: an exclusion written with no listed word, phrase or
// mark reads as a title. The rule that closed it is the withdrawn one above.
// Each row answered on the commit before this change too. Pinned so a change
// here is seen, and so nobody reads the rows above as "every exclusion refuses".
describe("known limit: an exclusion written with no listed word still answers", () => {
  it.each([
    ["a remark that trails the product noun", "Hardware User Guide\nRX420 Logic Controller sold by distributors"],
    ["'left out'", "Hardware User Guide\nRX420 Logic Controller left out"],
    ["a bracketed remark between the model and its noun", "Hardware User Guide\nRX420 (dealer stock) Logic Controller"],
    ["a remark after a dash", "Hardware User Guide\nRX420 Logic Controller — dealer stock"],
    ["a remark before the model", "Dealer stock RX420 Logic Controller"],
    ["a status word on the line below", "RX420 Logic Controller\nCancelled"],
    ["another", "RX420 Logic Controller\nArchived"],
    ["a status word on the line above", "Cancelled\nRX420 Logic Controller"],
    ["a heading of ordinary words above", "Hardware User Guide\nSold through distributors:\nRX420 Logic Controller"],
    ["a single letter after a colon", "RX420 Logic Controller: N"],
    ["a bracketed letter", "RX420 Logic Controller (X)"],
    ["a contraction typed with no apostrophe", "Hardware User Guide\nRX420 Logic Controller isnt here"],
    ["end of life, abbreviated", "Hardware User Guide\nRX420 Logic Controller (EOL)"],
    ["a bracketed remark of ordinary words", "Hardware User Guide\nRX420 Logic Controller (wrong manual)"],
    ["sold elsewhere, after the product noun", "Hardware User Guide\nRX420 Logic Controller sold elsewhere"],
    ["a German no", "Hardware User Guide\nRX420 Logic Controller nein"],
    ["to be decided", "Hardware User Guide\nRX420 Logic Controller TBD"],
    ["a heading above that carries no negation", "Models this guide leaves to others:\nA\nB\nC\nD\nRX420 Logic Controller"],
    ["an answer on the line below", "RX420 Logic Controller\nController: no."],
    ["a field on the line below", "RX420 Logic Controller\nVersion: false"],
    ["a line below that excludes it and names another model", "RX420 Logic Controller\nUse the RX430 manual instead - not covered here"],
    ["an exclusion two lines below the title", "RX410 Logic Controller User Manual\nRX420 Logic Controller\nHardware\nnot covered"],
  ])("%s", (_why, heading) => {
    expect(kindOf(verdict("RX420 supply voltage?", heading))).toBe("answers");
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
