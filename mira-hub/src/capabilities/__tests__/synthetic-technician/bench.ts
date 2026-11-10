// Synthetic-technician bench: the manuals and jobs the $0 regression matrix runs.
//
// What is real and what is not:
//  - REAL covers are the first lines of the maker's own public PDF, typed from
//    the file. They carry no serial number, network address, lot or date code.
//  - SYNTHETIC rows use an invented maker ("Northfield") and invented model
//    numbers. They exist to exercise sibling model numbers the detector has no
//    pattern for. They are not, and must never be reported as, a real device.
//  - Every passage body is a stand-in sentence, not a quotation. This suite
//    judges which manual is admitted and what the citation points at. It does
//    not judge the wording of an answer.
//
// Nothing here calls a model, a network or a database.
import { ocrSourceText } from "@/lib/photo-ocr";
import { NAMEPLATE_BODY_MARK, NAMEPLATE_OPENER, PHOTO_OCR_OPENER_START, PHOTO_READING_BODY_MARK, PHOTO_READING_OPENER, type PhotoDocumentKind, buildPhotoSourceText } from "../../photo-document-text";

export type Manual = {
  key: string;
  /** What the product stores as `document_heading`: the first text block. */
  heading: string;
  filename: string;
  page: number;
  pageLabel: string;
  /** `product-written`: the product's own text around a synthetic reading. */
  origin: "public-cover" | "synthetic" | "product-written";
  /** What the upload records say the product wrote this document as. Absent for
   *  every uploaded file, including one that only OPENS like a photo document. */
  writtenAs?: PhotoDocumentKind;
};

const standIn = (key: string) => `Stand-in passage for ${key}. Admission fixture only, not a quotation.`;
export const passageOf = (m: Manual) => standIn(m.key);

// ── Real, public covers ────────────────────────────────────────────────────────

export const GS10: Manual = {
  key: "gs10-user-manual",
  heading: "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions",
  filename: "gs10usermanual.pdf",
  page: 139,
  pageLabel: "4-69",
  origin: "public-cover",
};

export const MICRO820_SHEET: Manual = {
  key: "micro820-installation-instructions",
  heading:
    "Installation Instructions\nMicro820 20-Point Programmable Controllers\n"
    + "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n"
    + "2080-LC20-20QBBR, 2080-LC20-20AWBR",
  filename: "2080-in009_-en-p.pdf",
  page: 12,
  pageLabel: "12",
  origin: "public-cover",
};

export const RELAY_SHEET: Manual = {
  key: "ca3kn22bd-data-sheet",
  heading: "Control relay, TeSys K, 2 NO + 2\nNC, lt or eq to 690V, 24VDC\nstandard coil\nCA3KN22BD",
  filename: "CA3KN22BD.pdf",
  page: 1,
  pageLabel: "1",
  origin: "public-cover",
};

// ── Synthetic sibling pair outside the detector's pattern list ─────────────────
// RX410 and RX420 are invented. Same letters, same digit count, same first digit.

const synthetic = (key: string, heading: string, filename: string): Manual => ({
  key, heading, filename, page: 27, pageLabel: "27", origin: "synthetic",
});

/** Title names the model; the filename agrees. */
export const RX410_TITLED = synthetic(
  "rx410-titled", "Northfield RX410 Logic Controller\nHardware User Guide", "rx410-hardware-guide.pdf");
export const RX420_TITLED = synthetic(
  "rx420-titled", "Northfield RX420 Logic Controller\nHardware User Guide", "rx420-hardware-guide.pdf");
/** Title names the model; the filename is a document number. */
export const RX410_OPAQUE_FILE = synthetic(
  "rx410-opaque-file", "Northfield RX410 Logic Controller\nHardware User Guide", "NF0000021.pdf");
/** Generic title; only the filename names the model. */
export const RX410_GENERIC_TITLE = synthetic(
  "rx410-generic-title", "Hardware User Guide\nOriginal instructions", "rx410-hardware-guide.pdf");
/** Nothing names a model anywhere. */
export const NO_MODEL_ANYWHERE = synthetic(
  "no-model-anywhere", "Hardware User Guide\nOriginal instructions", "NF0000021.pdf");
/** The RX410 guide, whose cover also points the reader to the sibling's own guide. */
export const RX410_WITH_SEE_ALSO = synthetic(
  "rx410-see-also",
  "Northfield RX410 Logic Controller Hardware User Guide\nFor the RX420 see publication NF0000022.",
  "NF0000021.pdf");
/** One guide that really covers both. */
export const RX410_RX420_COMBINED = synthetic(
  "rx410-rx420-combined", "Northfield RX410 and RX420 Logic Controllers\nHardware User Guide", "NF0000030.pdf");
/** The RX410 guide whose first stored block is only a sentence excluding the sibling. */
export const RX410_EXCLUSION_ONLY = synthetic(
  "rx410-exclusion-only", "RX420 is not covered by this manual.\nHardware User Guide", "NF0000021.pdf");
/** Same, worded as a pointer to the sibling's own manual. */
export const RX410_SEPARATE_MANUAL = synthetic(
  "rx410-separate-manual", "For RX420 see the separate manual.\nHardware User Guide", "NF0000021.pdf");
/** Cover and filename name different siblings. */
export const RX420_COVER_RX410_FILE = synthetic(
  "rx420-cover-rx410-file", "Northfield RX420 Logic Controller\nHardware User Guide", "rx410-hardware-guide.pdf");

// ── Jobs ───────────────────────────────────────────────────────────────────────

/** `catalogNumber` is the notebook's own catalog-number field, recorded beside the model. */
export type Identity = { manufacturer: string; model: string; catalogNumber?: string };

/** What the product says when it refuses, as the suite reads it off the retrieval diagnostics. */
export type Reason =
  | "mismatch-named"          // a model the detector reads; the manual declares another
  | "asks-which-model"        // two models the detector reads, named as one machine
  | "other-model"             // a number the detector cannot read; the cover declares a look-alike
  | "coverage-not-shown"      // the number is on the cover or file, but not as what the manual is for
  | "cover-and-file-disagree" // cover and filename name different look-alikes
  | "several-look-alikes"     // the question names two look-alike numbers; no one manual is shown to cover both
  | "another-product";        // the cover declares a product that is not the project's confirmed machine

export type Job = {
  id: string;
  /** Who is asking. Changes the phrasing only. */
  who: "apprentice" | "journeyman" | "senior";
  doing: string;
  attached: Manual[];
  /** The project's confirmed equipment, when it has one. */
  identity?: Identity;
  ask: string;
  /** `answerFrom`: only these manuals may be cited. `refuse`: nothing may be cited. */
  want: { answerFrom: string[] } | { refuse: true };
  /** The reason the product must state when it refuses. Checked only where set. */
  says?: Reason;
  /** Whose model number the refusal is about. Checked only where set. */
  about?: "question" | "notebook" | "conversation";
  /** Earlier questions of this conversation that were refused, newest first.
   *  A model named in them is still the subject of a question that names none. */
  earlier?: string[];
  /** The search finds no passage for this question. The manual is still attached. */
  noPassages?: true;
  /** The project's equipment was typed in but never confirmed. */
  unconfirmed?: true;
  /** Set when main is known to get this row wrong. The row then counts as FAIL. */
  knownFail?: { tracked: string; why: string };
};

export const DRIVE: Identity = { manufacturer: "AutomationDirect", model: "GS11N-20P2" };
export const PLC: Identity = { manufacturer: "Allen-Bradley", model: "Micro820" };
export const RELAY: Identity = { manufacturer: "Schneider Electric", model: "CA3KN22BD" };

const answer = (...m: Manual[]) => ({ answerFrom: m.map((x) => x.key) });
const REFUSE = { refuse: true } as const;

export const JOBS: Job[] = [
  // Garage conveyor: the drive.
  { id: "G-01", who: "apprentice", doing: "setting up the drive", attached: [GS10], identity: DRIVE,
    ask: "How do I change how fast it ramps up?", want: answer(GS10) },
  { id: "G-02", who: "journeyman", doing: "setting up the drive", attached: [GS10], identity: DRIVE,
    ask: "Which parameter sets acceleration time on the GS11N-20P2?", want: answer(GS10) },
  { id: "G-03", who: "journeyman", doing: "asking about a different drive family", attached: [GS10], identity: DRIVE,
    ask: "Which parameter sets acceleration time on the GS20?", want: REFUSE },
  { id: "G-04", who: "senior", doing: "asking with two families in one question", attached: [GS10], identity: DRIVE,
    ask: "Acceleration time parameter, GS10 or GS20?", want: REFUSE },
  { id: "G-05", who: "apprentice", doing: "working from a manual left attached from another drive",
    attached: [{ ...GS10, key: "gs20-cover-left-attached", heading: "DURApulse GS20 Drive User Manual" }], identity: DRIVE,
    ask: "How do I change how fast it ramps up?", want: REFUSE },

  // Garage conveyor: the controller.
  { id: "G-06", who: "apprentice", doing: "wiring the controller supply", attached: [MICRO820_SHEET], identity: PLC,
    ask: "What supply voltage does it need?", want: answer(MICRO820_SHEET) },
  { id: "G-07", who: "journeyman", doing: "wiring the controller supply", attached: [MICRO820_SHEET], identity: PLC,
    ask: "What supply voltage does the Micro820 need?", want: answer(MICRO820_SHEET) },
  { id: "G-08", who: "journeyman", doing: "asking about the next model up", attached: [MICRO820_SHEET], identity: PLC,
    ask: "What supply voltage does the Micro850 need?", want: REFUSE },
  { id: "G-09", who: "senior", doing: "asking by a catalog number this sheet does not list",
    attached: [MICRO820_SHEET], identity: PLC,
    ask: "Supply voltage for 2080-LC99-99ZZZ?", want: REFUSE, says: "other-model" },

  // Garage conveyor: the relay, known only by its part number.
  { id: "G-10", who: "journeyman", doing: "checking the relay coil", attached: [RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN22BD?", want: answer(RELAY_SHEET) },
  { id: "G-11", who: "senior", doing: "asking about a different relay part number", attached: [RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN99ZZ?", want: REFUSE, says: "other-model" },

  // One project, two parts.
  { id: "G-12", who: "journeyman", doing: "asking about the controller with both manuals attached",
    attached: [GS10, MICRO820_SHEET],
    ask: "What supply voltage does the Micro820 need?", want: answer(MICRO820_SHEET) },
  { id: "G-13", who: "journeyman", doing: "asking about the drive with both manuals attached",
    attached: [GS10, MICRO820_SHEET],
    ask: "Which parameter sets acceleration time on the GS11N-20P2?", want: answer(GS10) },
  { id: "G-14", who: "apprentice", doing: "asking about the controller inside the drive's project",
    attached: [MICRO820_SHEET], identity: DRIVE,
    ask: "What supply voltage does it need?", want: REFUSE },

  // A sibling pair the detector has no pattern for (synthetic RX410 / RX420).
  { id: "S-01", who: "journeyman", doing: "asking about the manual's own model", attached: [RX410_TITLED],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_TITLED) },
  { id: "S-02", who: "journeyman", doing: "asking about the sibling", attached: [RX410_TITLED],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "other-model" },
  { id: "S-03", who: "journeyman", doing: "asking about the sibling, the other way round", attached: [RX420_TITLED],
    ask: "What supply voltage does the RX410 controller accept?", want: REFUSE, says: "other-model" },
  { id: "S-04", who: "apprentice", doing: "asking with no model named", attached: [RX410_TITLED],
    ask: "What supply voltage does it accept?", want: answer(RX410_TITLED) },
  { id: "S-05", who: "senior", doing: "asking about the sibling; the file is named by document number",
    attached: [RX410_OPAQUE_FILE],
    ask: "RX420 supply voltage?", want: REFUSE, says: "other-model" },
  { id: "S-06", who: "journeyman", doing: "asking about the manual's own model; only the filename names it",
    attached: [RX410_GENERIC_TITLE],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_GENERIC_TITLE) },
  { id: "S-07", who: "journeyman", doing: "asking about the sibling; only the filename names the manual's model",
    attached: [RX410_GENERIC_TITLE],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "coverage-not-shown" },
  { id: "S-08", who: "apprentice", doing: "asking with no model named; nothing names a model anywhere",
    attached: [NO_MODEL_ANYWHERE],
    ask: "What supply voltage does it accept?", want: answer(NO_MODEL_ANYWHERE) },
  { id: "S-09", who: "journeyman", doing: "asking about the manual's own model; the cover also points to the sibling's guide",
    attached: [RX410_WITH_SEE_ALSO],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_WITH_SEE_ALSO) },
  { id: "S-10", who: "journeyman", doing: "asking about the sibling the cover points away to",
    attached: [RX410_WITH_SEE_ALSO],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "other-model" },
  { id: "S-11", who: "journeyman", doing: "asking about one model of a combined guide", attached: [RX410_RX420_COMBINED],
    ask: "What supply voltage does the RX420 controller accept?", want: answer(RX410_RX420_COMBINED) },
  { id: "S-12", who: "journeyman", doing: "asking about the sibling; the first block only excludes it",
    attached: [RX410_EXCLUSION_ONLY],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "coverage-not-shown" },
  { id: "S-13", who: "journeyman", doing: "asking about the sibling; the first block only points to its own manual",
    attached: [RX410_SEPARATE_MANUAL],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "coverage-not-shown" },
  { id: "S-14", who: "apprentice", doing: "asking with no model named; the first block only excludes a sibling",
    attached: [RX410_EXCLUSION_ONLY],
    ask: "What supply voltage does it accept?", want: answer(RX410_EXCLUSION_ONLY) },
  { id: "S-15", who: "senior", doing: "asking when the cover and the filename name different siblings",
    attached: [RX420_COVER_RX410_FILE],
    ask: "RX420 supply voltage?", want: REFUSE, says: "cover-and-file-disagree" },
  { id: "S-16", who: "journeyman", doing: "asking about one model with both siblings' guides attached",
    attached: [RX410_TITLED, RX420_TITLED],
    ask: "What supply voltage does the RX420 controller accept?", want: answer(RX420_TITLED) },
];

// ── Rows added with the #5369 fix ──────────────────────────────────────────────
// The 30 jobs above are the contract and are counted on their own. These rows
// were written RED before the fix: wordings a reviewer broke the shelved attempt
// with, and controls that a rule which simply refuses more would fail.

/** An exclusion written in capitals: no lower-case word gives it away. */
export const RX420_CAPS_EXCLUSION = synthetic(
  "rx420-caps-exclusion", "RX420 NOT COVERED BY THIS MANUAL\nHARDWARE USER GUIDE", "NF0000021.pdf");
/** An exclusion with no function word at all. */
export const RX420_EXCLUDED = synthetic(
  "rx420-excluded", "RX420 Excluded\nHardware User Guide", "NF0000021.pdf");
/** The RX410 guide; lower down the cover lists the sibling's guide by its own title. */
export const RX410_RELATED_PUBLICATIONS = synthetic(
  "rx410-related-publications",
  "Northfield RX410 Logic Controller Hardware User Guide\nRelated Publications\nRX420 Logic Controller Hardware User Guide",
  "NF0000021.pdf");
/** A correct title; the filename is stale but names no look-alike. */
export const RX410_STALE_FILE = synthetic(
  "rx410-stale-file", "Northfield RX410 Logic Controller\nHardware User Guide", "scan_2019_final-rev2.pdf");
/** The relay data sheet saved under a document number. */
export const RELAY_SHEET_OPAQUE_FILE: Manual = { ...RELAY_SHEET, key: "ca3kn22bd-data-sheet-opaque-file", filename: "DS0004417.pdf" };
/** A sibling relay's sheet. Synthetic part number, shape only. */
export const SIBLING_RELAY_SHEET: Manual = {
  key: "sibling-relay-data-sheet",
  heading: "Control relay, TeSys K, 3 NO + 1\nNC, lt or eq to 690V, 24VDC\nstandard coil\nCA3KN31BD",
  filename: "DS0004418.pdf", page: 1, pageLabel: "1", origin: "synthetic",
};
/** A sibling controller's sheet. Synthetic heading in the real sheet's layout, not a quotation. */
export const SIBLING_PLC_SHEET: Manual = {
  key: "sibling-controller-installation-instructions",
  heading: "Installation Instructions\nMicro850 24-Point Programmable Controllers\nCatalog Numbers 2080-LC50-24QWB, 2080-LC50-24QBB",
  filename: "2080-in999_-en-p.pdf", page: 12, pageLabel: "12", origin: "synthetic",
};

/** The controller recorded by the catalog number on its plate, not by its family. */
export const PLC_BY_CATALOG: Identity = { manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" };
/** The same controller recorded by family name and catalog number together. */
export const PLC_BY_NAME_AND_CATALOG: Identity = { manufacturer: "Allen-Bradley", model: "Micro820 2080-LC20-20QBB" };
/** A sheet of the same family for one other catalog number. Synthetic heading in the real sheet's layout, not a quotation. */
export const MICRO820_OTHER_CATALOG_SHEET: Manual = {
  key: "micro820-other-catalog-sheet",
  heading: "Installation Instructions\nMicro820 20-Point Programmable Controllers\nCatalog Number 2080-LC20-20AWB",
  filename: "2080-in998_-en-p.pdf", page: 12, pageLabel: "12", origin: "synthetic",
};

export const MICRO820_SHEET_AS_STORED: Manual = {
  ...MICRO820_SHEET,
  key: "micro820-installation-instructions-as-stored",
  heading:
    MICRO820_SHEET.heading
    + "\nhttp://rockwellautomation.com/literature\nFR\nCette publication est disponible en fran\u00e7ais\n"
    + "sous forme \u00e9lectronique (fichier PDF). Pour la\nt\u00e9l\u00e9charger, rendez-vous sur la page Internet\nindiqu\u00e9e ci-dessus.",
};
export const RELAY_SHEET_AS_STORED: Manual = {
  ...RELAY_SHEET,
  key: "ca3kn22bd-data-sheet-as-stored",
  filename: "DS0004417.pdf",
  heading:
    RELAY_SHEET.heading
    + "\nProduct availability: Stock - Normally stocked in distribution\nfacility\nMain\nRange TeSys\n"
    + "Product name TeSys CAK\nProduct or Component Type Control relay\nDevice short name CA3K\n"
    + "Contactor application Control circuit\nUtilisation category AC-15\nDC-13\nPole contact composition 2 NO + 2 NC",
};

// ── Documents the product writes itself from a technician's photo ─────────────
// A kept photo reading and a confirmed nameplate. The header lines are the
// product's own (built by its own function, or in the confirm route's layout
// with its own marker lines); what was "read off the photo" is synthetic. The
// file id and hash are invented. No serial number, no lot or date code.
const PHOTO_FILE_ID = "0b6f4c1e-7a2d-4e59-9c3a-5d1f8e2b7a40";
const PHOTO_SHA = "9f2c41d07be35a68c1d2e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5e6f7";
/** What the hub stores as the first block of a text this short: the whole text, trimmed. */
const storedBlock = (text: string) => {
  const clean = text.replace(/[ \t]+\n/g, "\n").trim();
  if (clean.length > 1000) throw new Error("fixture is longer than one stored block");
  return clean;
};
const photoDocument = (key: string, filename: string, text: string, writtenAs: PhotoDocumentKind): Manual => ({
  key, filename, heading: storedBlock(text), page: 1, pageLabel: "1", origin: "product-written", writtenAs,
});
const CONTROLLER_PHOTO_TEXT = buildPhotoSourceText({
  machineName: "CV-101", fileId: PHOTO_FILE_ID, photoSha256: PHOTO_SHA, capturedAt: "2026-11-09T14:32:08.000Z", reviewed: true,
  observation: "Controller Micro820, catalog 2080-LC20-20QBB. Reviewed against the photo only; physical condition and operating state unknown. No completed work or live measurements.",
});
const RELAY_PLATE_TEXT = [
  NAMEPLATE_OPENER, "", "Machine notebook: K1 control relay", `Canonical nameplate photo (file id): ${PHOTO_FILE_ID}`, "Recognition confidence: 0.91", "",
  NAMEPLATE_BODY_MARK, "- Manufacturer: Schneider Electric", "- Model: CA3KN22BD", "- Voltage: 24 V DC", "",
  "RAW NAMEPLATE OBSERVATION (unedited vision extraction)", "- reader: stub", "- Schneider Electric", "- TeSys CA3KN22BD", "- Ui 690V", "- 24V DC", "",
].join("\n");
/** A sheet titled for another machine's tag AND a sibling relay: refused on both counts. Synthetic. */
export const OTHER_MACHINE_RELAY_SHEET: Manual = {
  key: "other-machine-sibling-relay-sheet",
  heading: "CV-102 Conveyor Control Relay CA3KN31BD\nData Sheet",
  filename: "DS0004419.pdf", page: 1, pageLabel: "1", origin: "synthetic",
};
/** A technician-reviewed photo reading of the controller, kept as a source of the CV-101 project. */
export const CONTROLLER_PHOTO_READING = photoDocument(
  "controller-photo-reading", "Technician-reviewed photo reading 2026-11-09.txt", CONTROLLER_PHOTO_TEXT, "photo_text");
/** The relay's confirmed nameplate, as the confirm route writes it. */
export const RELAY_PLATE = photoDocument("relay-confirmed-nameplate", `nameplate-${PHOTO_FILE_ID}.txt`, RELAY_PLATE_TEXT, "nameplate_text");
/** Each product-written fixture beside the full text it was cut from, for the as-stored check. */
const ocrOf = (text: string) => ({ text, meanConfidence: 87.4, wordCount: 12, engine: "tesseract", ms: 40 });
const RELAY_PLATE_OCR_TEXT = ocrSourceText("CV-101 K1 relay.jpg", ocrOf("Schneider Electric\nTeSys\nCA3KN22BD\nUi 690V\n24V DC"));
const SIBLING_PLATE_OCR_TEXT = ocrSourceText("IMG_20261109_143208.jpg", ocrOf("Schneider Electric\nTeSys\nCA3KN31BD\nUi 690V\n24V DC"));
/** What OCR read off an uploaded photo of the relay's plate; the photo is named for the machine. */
export const RELAY_PLATE_OCR = photoDocument("relay-plate-photo-ocr", "CV-101 K1 relay.jpg", RELAY_PLATE_OCR_TEXT, "photo_ocr");
/** The same for a photo of a sibling relay's plate. */
export const SIBLING_PLATE_OCR = photoDocument("sibling-relay-plate-photo-ocr", "IMG_20261109_143208.jpg", SIBLING_PLATE_OCR_TEXT, "photo_ocr");
export const PHOTO_DOCUMENT_TEXTS: Array<[Manual, string]> = [
  [CONTROLLER_PHOTO_READING, CONTROLLER_PHOTO_TEXT],
  [RELAY_PLATE, RELAY_PLATE_TEXT],
  [RELAY_PLATE_OCR, RELAY_PLATE_OCR_TEXT],
  [SIBLING_PLATE_OCR, SIBLING_PLATE_OCR_TEXT],
];

// ── Uploaded files that only OPEN like the product's photo documents ──────────
// Anyone can type the product's opening line at the top of a file. Each of
// these is a sibling's cover with such a line pasted above it and a passing
// mention of the other model below. They are uploads: no upload record names
// them, so `writtenAs` is absent and their cover decides.
const SIBLING_COVER_LINES = "Northfield RX410 Logic Controller\nHardware User Guide";
const PASSING_MENTION = "This guide is sometimes kept beside the RX420 on the same line.";
const posing = (key: string, filename: string, heading: string): Manual => ({ key, heading, filename, page: 1, pageLabel: "1", origin: "synthetic" });
export const POSING_AS_READING = posing("upload-posing-as-photo-reading", "line-2-notes.txt",
  `${PHOTO_READING_OPENER}\n${SIBLING_COVER_LINES}\n${PHOTO_READING_BODY_MARK}\n${PASSING_MENTION}`);
export const POSING_AS_NAMEPLATE = posing("upload-posing-as-nameplate", "line-2-plate.txt",
  `${NAMEPLATE_OPENER}\n${SIBLING_COVER_LINES}\n${NAMEPLATE_BODY_MARK}\n${PASSING_MENTION}`);
export const POSING_AS_OCR = posing("upload-posing-as-photo-ocr", "line-2-scan.txt",
  `${PHOTO_OCR_OPENER_START}line-2.jpg" (OCR, 90% confidence):\n${SIBLING_COVER_LINES}\n${PASSING_MENTION}`);
/** A sibling relay's sheet with the photo-reading opener pasted above its cover. */
export const SIBLING_SHEET_POSING_AS_READING = posing("sibling-relay-sheet-posing-as-photo-reading", "relay-notes.txt",
  `${PHOTO_READING_OPENER}\nControl relay, TeSys K\nstandard coil\nCA3KN31BD\n${PHOTO_READING_BODY_MARK}\nCoil 24 V DC.`);
/** The record says "nameplate", the text is shaped as a photo reading: the record does not vouch for it. */
export const READING_SHAPE_NAMEPLATE_RECORD: Manual = { ...POSING_AS_READING, key: "reading-shape-with-a-nameplate-record", writtenAs: "nameplate_text" };
/** The controller as the confirm screens record it: family name as the model, catalog number in its own field. */
export const PLC_WITH_CATALOG_FIELD: Identity = { manufacturer: "Allen-Bradley", model: "Micro820", catalogNumber: "2080-LC20-20QBB" };
/** The relay with its part number in both fields. */
export const RELAY_BOTH_FIELDS: Identity = { manufacturer: "Schneider Electric", model: "CA3KN22BD", catalogNumber: "CA3KN22BD" };

export const EXTRA_JOBS: Job[] = [
  // Wordings that must still refuse.
  { id: "X-01", who: "journeyman", doing: "asking about the sibling; the exclusion is in capitals",
    attached: [RX420_CAPS_EXCLUSION],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "coverage-not-shown" },
  { id: "X-02", who: "journeyman", doing: "asking about the sibling; the exclusion has no small word in it",
    attached: [RX420_EXCLUDED],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "coverage-not-shown" },
  { id: "X-03", who: "journeyman", doing: "asking about the sibling listed under related publications",
    attached: [RX410_RELATED_PUBLICATIONS],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE, says: "other-model" },
  { id: "X-04", who: "senior", doing: "naming the old controller too; only the old one's guide is attached",
    attached: [RX410_TITLED],
    ask: "The RX420 replaced an RX410, what supply voltage does the RX420 accept?", want: REFUSE, says: "several-look-alikes" },
  { id: "X-05", who: "senior", doing: "asking by a part number the relay sheet does not carry; the file is a document number",
    attached: [RELAY_SHEET_OPAQUE_FILE], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN99ZZ?", want: REFUSE, says: "other-model" },
  { id: "X-06", who: "journeyman", doing: "asking with the model written with a hyphen", attached: [RX410_TITLED],
    ask: "What supply voltage does the RX-420 accept?", want: REFUSE, says: "other-model", about: "question" },

  // Controls: these must still answer.
  { id: "X-07", who: "journeyman", doing: "asking about the manual's own model; a related-publications list is on the cover",
    attached: [RX410_RELATED_PUBLICATIONS],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_RELATED_PUBLICATIONS) },
  { id: "X-08", who: "senior", doing: "asking by a catalog number the sheet lists", attached: [MICRO820_SHEET], identity: PLC,
    ask: "Supply voltage for the 2080-LC20-20QBB?", want: answer(MICRO820_SHEET) },
  { id: "X-09", who: "journeyman", doing: "checking the relay coil; the sheet is saved under a document number",
    attached: [RELAY_SHEET_OPAQUE_FILE], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN22BD?", want: answer(RELAY_SHEET_OPAQUE_FILE) },
  { id: "X-10", who: "apprentice", doing: "asking about ratings printed on the relay sheet",
    attached: [RELAY_SHEET_OPAQUE_FILE], identity: RELAY,
    ask: "Is the coil 24VDC or 48VDC, and is 690V the contact limit?", want: answer(RELAY_SHEET_OPAQUE_FILE) },
  { id: "X-11", who: "journeyman", doing: "asking about the manual's own model; the filename is stale",
    attached: [RX410_STALE_FILE],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_STALE_FILE) },
  { id: "X-12", who: "journeyman", doing: "asking about a fault code on the manual's own model", attached: [RX410_TITLED],
    ask: "What does fault F0004 mean on the RX410?", want: answer(RX410_TITLED) },
  { id: "X-13", who: "senior", doing: "comparing the two models of a combined guide", attached: [RX410_RX420_COMBINED],
    ask: "Compare the RX410 and RX420 supply voltages.", want: answer(RX410_RX420_COMBINED) },

  // A project confirmed by a number the detector cannot read, question names no model.
  { id: "X-14", who: "apprentice", doing: "asking in a project confirmed by the controller's catalog number; a sibling's sheet is attached too",
    attached: [MICRO820_SHEET, SIBLING_PLC_SHEET], identity: PLC_BY_CATALOG,
    ask: "What supply voltage does it need?", want: answer(MICRO820_SHEET) },
  { id: "X-15", who: "apprentice", doing: "asking in the relay's project; a sibling relay's sheet is attached too",
    attached: [RELAY_SHEET_OPAQUE_FILE, SIBLING_RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage?", want: answer(RELAY_SHEET_OPAQUE_FILE) },
  { id: "X-16", who: "apprentice", doing: "asking in the relay's project; only a sibling relay's sheet is attached",
    attached: [SIBLING_RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage?", want: REFUSE, says: "other-model", about: "notebook" },
  // The question's own model wins over the notebook's number, as it does today for known families.
  { id: "X-17", who: "senior", doing: "asking about the next model up, by name, in a project confirmed by catalog number; its sheet is attached",
    attached: [SIBLING_PLC_SHEET], identity: PLC_BY_CATALOG,
    ask: "What supply voltage does the Micro850 need?", want: answer(SIBLING_PLC_SHEET) },
  // An identity nobody confirmed scopes nothing, as today.
  { id: "X-18", who: "apprentice", doing: "asking in a project whose relay part number was typed but never confirmed",
    attached: [SIBLING_RELAY_SHEET], identity: RELAY, unconfirmed: true,
    ask: "What is the coil voltage?", want: answer(SIBLING_RELAY_SHEET) },
  // The same two public covers, as the hub's own extractor and chunker store them
  // (run over the PDFs 2026-11-10). The typed covers above stop at the model
  // line; the stored text carries on, and on the PLC sheet the next line is a
  // web address.
  { id: "X-19", who: "journeyman", doing: "asking by a listed catalog number, against the sheet's cover as stored",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_BY_CATALOG,
    ask: "Supply voltage for 2080-LC20-20QBB?", want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "X-20", who: "apprentice", doing: "asking with no model named, in a project confirmed by catalog number, cover as stored",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_BY_CATALOG,
    ask: "What is the supply voltage?", want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "X-21", who: "senior", doing: "asking by an unlisted catalog number, cover as stored",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_BY_CATALOG,
    ask: "Supply voltage for 2080-LC50-24QWB?", want: REFUSE, says: "other-model", about: "question" },
  { id: "X-22", who: "apprentice", doing: "asking with no model named, relay sheet as stored",
    attached: [RELAY_SHEET_AS_STORED], identity: RELAY,
    ask: "What is the coil voltage?", want: answer(RELAY_SHEET_AS_STORED) },
  // The product's own photo documents. CI's cv101-photo-recall suite caught the
  // first version of the rule refusing every saved reading once the question
  // named the machine: the product writes that name into each reading's header.
  { id: "X-23", who: "journeyman", doing: "asking what is saved for the machine, by its tag; one reviewed photo reading is attached",
    attached: [CONTROLLER_PHOTO_READING],
    ask: "Which components of CV-101 have reviewed photo readings saved in this project? Summarize them with their source evidence.",
    want: answer(CONTROLLER_PHOTO_READING) },
  { id: "X-24", who: "journeyman", doing: "naming two machines by tag; one reviewed photo reading is attached",
    attached: [CONTROLLER_PHOTO_READING],
    ask: "CV-101 stops when CV-102 is full, what should I check?", want: answer(CONTROLLER_PHOTO_READING) },
  { id: "X-25", who: "journeyman", doing: "asking by the relay's own part number; only its confirmed nameplate is attached",
    attached: [RELAY_PLATE], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN22BD?", want: answer(RELAY_PLATE) },
  { id: "X-26", who: "apprentice", doing: "asking with no model named; only the relay's confirmed nameplate is attached",
    attached: [RELAY_PLATE], identity: RELAY,
    ask: "What is the coil voltage?", want: answer(RELAY_PLATE) },
  { id: "X-27", who: "senior", doing: "asking by another relay part number; only this relay's confirmed nameplate is attached",
    attached: [RELAY_PLATE], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN31BD?", want: REFUSE, says: "other-model", about: "question" },
  { id: "X-28", who: "apprentice", doing: "asking in the relay's project; its nameplate and a sibling relay's sheet are attached",
    attached: [RELAY_PLATE, SIBLING_RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage?", want: answer(RELAY_PLATE) },
  { id: "X-29", who: "senior", doing: "asking by another relay part number; this relay's nameplate and its own sheet are attached",
    attached: [RELAY_PLATE, RELAY_SHEET_AS_STORED], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN31BD?", want: REFUSE, says: "other-model", about: "question" },
  { id: "X-30", who: "journeyman", doing: "naming the machine by tag in a project confirmed by catalog number; the sheet and a photo reading are attached",
    attached: [MICRO820_SHEET_AS_STORED, CONTROLLER_PHOTO_READING], identity: PLC_BY_CATALOG,
    ask: "What supply voltage does the controller on CV-101 need?", want: answer(MICRO820_SHEET_AS_STORED, CONTROLLER_PHOTO_READING) },
  // A tag or a fault code in the question is not a model: it must not switch
  // off the check on the project's own confirmed part number.
  { id: "X-31", who: "apprentice", doing: "naming the machine by tag in the relay's project; only a sibling relay's sheet is attached",
    attached: [SIBLING_RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the relay on CV-101?", want: REFUSE, says: "other-model", about: "notebook" },
  { id: "X-32", who: "journeyman", doing: "asking about a fault code in a project confirmed by catalog number; only a sibling's sheet is attached",
    attached: [SIBLING_PLC_SHEET], identity: PLC_BY_CATALOG,
    ask: "What does fault F0004 mean?", want: REFUSE, says: "other-model", about: "notebook" },
  { id: "X-35", who: "senior", doing: "naming the machine by tag in the relay's project; the only sheet is for another machine's sibling relay",
    attached: [OTHER_MACHINE_RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the relay on CV-101?", want: REFUSE, says: "other-model", about: "question" },
  // Controls: the question's own part number still wins over the project's, and a fault code changes nothing for the right sheet.
  { id: "X-33", who: "senior", doing: "asking by the sibling relay's part number in the relay's project; the sibling's sheet is attached",
    attached: [SIBLING_RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN31BD?", want: answer(SIBLING_RELAY_SHEET) },
  { id: "X-34", who: "journeyman", doing: "asking about a fault code in a project confirmed by catalog number; its own sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_BY_CATALOG,
    ask: "What does fault F0004 mean?", want: answer(MICRO820_SHEET_AS_STORED) },
  // Two manuals refused for different reasons: one against the project's part, one against a number in the question.
  { id: "X-36", who: "senior", doing: "naming another controller in the relay's project; a sibling relay's sheet and that controller's sibling guide are attached",
    attached: [SIBLING_RELAY_SHEET, RX410_TITLED], identity: RELAY,
    ask: "Can an RX420 output switch this coil?", want: REFUSE, says: "other-model", about: "question" },
  // A project recorded by family name AND catalog number: the catalog number is still checked.
  { id: "X-37", who: "apprentice", doing: "asking in a project confirmed by family name and catalog number; the only sheet is the family's, for another catalog number",
    attached: [MICRO820_OTHER_CATALOG_SHEET], identity: PLC_BY_NAME_AND_CATALOG,
    ask: "What supply voltage does it need?", want: REFUSE, says: "other-model", about: "notebook" },
  { id: "X-38", who: "apprentice", doing: "asking in a project confirmed by family name and catalog number; its own sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_BY_NAME_AND_CATALOG,
    ask: "What supply voltage does it need?", want: answer(MICRO820_SHEET_AS_STORED) },
  // Photo OCR text: the product's first line quotes the photo's file name.
  { id: "X-39", who: "apprentice", doing: "naming the machine by tag; the only source is OCR text of the relay's plate, from a photo named for the machine",
    attached: [RELAY_PLATE_OCR], identity: RELAY,
    ask: "What is the coil voltage of the relay on CV-101?", want: answer(RELAY_PLATE_OCR) },
  { id: "X-40", who: "apprentice", doing: "asking in the relay's project; the only source is OCR text of a sibling relay's plate",
    attached: [SIBLING_PLATE_OCR], identity: RELAY,
    ask: "What is the coil voltage?", want: REFUSE, says: "other-model", about: "notebook" },
  // The catalog number in the notebook's own field, as the confirm screens record it.
  { id: "X-41", who: "apprentice", doing: "asking in a project confirmed as a Micro820 with its catalog number in the catalog field; the only sheet is the family's, for another catalog number",
    attached: [MICRO820_OTHER_CATALOG_SHEET], identity: PLC_WITH_CATALOG_FIELD,
    ask: "What supply voltage does it need?", want: REFUSE, says: "other-model", about: "notebook" },
  { id: "X-42", who: "apprentice", doing: "asking in the same project; its own sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_WITH_CATALOG_FIELD,
    ask: "What supply voltage does it need?", want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "X-43", who: "apprentice", doing: "asking in a relay project with the part number in both fields; only a sibling relay's sheet is attached",
    attached: [SIBLING_RELAY_SHEET], identity: RELAY_BOTH_FIELDS,
    ask: "What is the coil voltage?", want: REFUSE, says: "other-model", about: "notebook" },
  { id: "X-44", who: "apprentice", doing: "asking in the same relay project; its own sheet is attached",
    attached: [RELAY_SHEET_OPAQUE_FILE], identity: RELAY_BOTH_FIELDS,
    ask: "What is the coil voltage?", want: answer(RELAY_SHEET_OPAQUE_FILE) },
  { id: "X-45", who: "apprentice", doing: "asking in a project whose catalog number was read off a plate but never confirmed",
    attached: [MICRO820_OTHER_CATALOG_SHEET], identity: PLC_WITH_CATALOG_FIELD, unconfirmed: true,
    ask: "What supply voltage does it need?", want: answer(MICRO820_OTHER_CATALOG_SHEET) },
  { id: "X-46", who: "senior", doing: "asking about the next model up, by name, in a project with a catalog number in the catalog field; its sheet is attached",
    attached: [SIBLING_PLC_SHEET], identity: PLC_WITH_CATALOG_FIELD,
    ask: "What supply voltage does the Micro850 need?", want: answer(SIBLING_PLC_SHEET) },
  // Review round 1 on #5389: the lenient photo-document rule was chosen by a
  // file's own first line. A typed file could paste that line above a sibling's
  // cover and be read as a reading. Who wrote a document now comes from the
  // upload records; these files have none, so their cover decides.
  { id: "X-47", who: "senior", doing: "asking about the sibling; the only source is a typed file that opens like a kept photo reading, above the other model's cover",
    attached: [POSING_AS_READING], ask: "RX420 supply voltage?", want: REFUSE, says: "other-model", about: "question" },
  { id: "X-48", who: "senior", doing: "asking about the sibling; the only source is a typed file that opens like a confirmed nameplate, above the other model's cover",
    attached: [POSING_AS_NAMEPLATE], ask: "RX420 supply voltage?", want: REFUSE, says: "other-model", about: "question" },
  { id: "X-49", who: "senior", doing: "asking about the sibling; the only source is a typed file that opens like a photo's OCR text, above the other model's cover",
    attached: [POSING_AS_OCR], ask: "RX420 supply voltage?", want: REFUSE, says: "other-model", about: "question" },
  { id: "X-50", who: "senior", doing: "asking about the sibling; the search finds no passage in the typed file that opens like a photo reading",
    attached: [POSING_AS_READING], ask: "RX420 supply voltage?", want: REFUSE, says: "other-model", about: "question", noPassages: true },
  { id: "X-51", who: "apprentice", doing: "asking in the relay's project; the only source is a sibling relay's sheet with the photo-reading line pasted on top",
    attached: [SIBLING_SHEET_POSING_AS_READING], identity: RELAY,
    ask: "What is the coil voltage?", want: REFUSE, says: "other-model", about: "notebook" },
  { id: "X-52", who: "senior", doing: "asking about the sibling; the file is shaped as a photo reading but its upload record is a nameplate's",
    attached: [READING_SHAPE_NAMEPLATE_RECORD], ask: "RX420 supply voltage?", want: REFUSE, says: "other-model", about: "question" },
  // The other half: a typed file is still an upload, and still answers for the
  // model its own cover declares. And a real reading is still read as one when
  // the search itself finds no passage, so its refusal still says why.
  { id: "X-53", who: "journeyman", doing: "asking about the model on the cover of a typed file that opens like a photo reading",
    attached: [POSING_AS_READING], ask: "RX410 supply voltage?", want: answer(POSING_AS_READING) },
  { id: "X-54", who: "senior", doing: "asking by another relay part number; the search finds no passage in this relay's confirmed nameplate",
    attached: [RELAY_PLATE], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN31BD?", want: REFUSE, says: "other-model", about: "question", noPassages: true },
];
