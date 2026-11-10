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

export type Manual = {
  key: string;
  /** What the product stores as `document_heading`: the first text block. */
  heading: string;
  filename: string;
  page: number;
  pageLabel: string;
  origin: "public-cover" | "synthetic";
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

export type Identity = { manufacturer: string; model: string };

/** What the product says when it refuses, as the suite reads it off the retrieval diagnostics. */
export type Reason =
  | "mismatch-named"          // a model the detector reads; the manual declares another
  | "asks-which-model"        // two models the detector reads, named as one machine
  | "other-model"             // a number the detector cannot read; the cover declares a look-alike
  | "coverage-not-shown"      // the number is on the cover or file, but not as what the manual is for
  | "cover-and-file-disagree" // cover and filename name different look-alikes
  | "several-look-alikes";    // the question names two look-alike numbers; no one manual is shown to cover both

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
  about?: "question" | "notebook";
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
];
