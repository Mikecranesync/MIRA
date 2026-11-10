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
  /** Set when main is known to get this row wrong. The row then counts as FAIL. */
  knownFail?: { tracked: string; why: string };
};

export const DRIVE: Identity = { manufacturer: "AutomationDirect", model: "GS11N-20P2" };
export const PLC: Identity = { manufacturer: "Allen-Bradley", model: "Micro820" };
export const RELAY: Identity = { manufacturer: "Schneider Electric", model: "CA3KN22BD" };

const answer = (...m: Manual[]) => ({ answerFrom: m.map((x) => x.key) });
const REFUSE = { refuse: true } as const;

const LOOK_ALIKE = "#5369";
const CATALOG = "#5369 (catalog numbers; written pilot limit on #5232)";

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
    ask: "Supply voltage for 2080-LC99-99ZZZ?", want: REFUSE,
    knownFail: { tracked: CATALOG, why: "The check reads family names. A catalog number the cover does not list is not noticed. The number is invented, shape only." } },

  // Garage conveyor: the relay, known only by its part number.
  { id: "G-10", who: "journeyman", doing: "checking the relay coil", attached: [RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN22BD?", want: answer(RELAY_SHEET) },
  { id: "G-11", who: "senior", doing: "asking about a different relay part number", attached: [RELAY_SHEET], identity: RELAY,
    ask: "What is the coil voltage of the CA3KN99ZZ?", want: REFUSE,
    knownFail: { tracked: CATALOG, why: "Part numbers of this shape are not read as a model. The asked number is invented, shape only." } },

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
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "No pattern for this family, so the question reads as naming no model." } },
  { id: "S-03", who: "journeyman", doing: "asking about the sibling, the other way round", attached: [RX420_TITLED],
    ask: "What supply voltage does the RX410 controller accept?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "Same gap, mirrored." } },
  { id: "S-04", who: "apprentice", doing: "asking with no model named", attached: [RX410_TITLED],
    ask: "What supply voltage does it accept?", want: answer(RX410_TITLED) },
  { id: "S-05", who: "senior", doing: "asking about the sibling; the file is named by document number",
    attached: [RX410_OPAQUE_FILE],
    ask: "RX420 supply voltage?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "Same gap; the filename gives no help." } },
  { id: "S-06", who: "journeyman", doing: "asking about the manual's own model; only the filename names it",
    attached: [RX410_GENERIC_TITLE],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_GENERIC_TITLE) },
  { id: "S-07", who: "journeyman", doing: "asking about the sibling; only the filename names the manual's model",
    attached: [RX410_GENERIC_TITLE],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "Same gap." } },
  { id: "S-08", who: "apprentice", doing: "asking with no model named; nothing names a model anywhere",
    attached: [NO_MODEL_ANYWHERE],
    ask: "What supply voltage does it accept?", want: answer(NO_MODEL_ANYWHERE) },
  { id: "S-09", who: "journeyman", doing: "asking about the manual's own model; the cover also points to the sibling's guide",
    attached: [RX410_WITH_SEE_ALSO],
    ask: "What supply voltage does the RX410 controller accept?", want: answer(RX410_WITH_SEE_ALSO) },
  { id: "S-10", who: "journeyman", doing: "asking about the sibling the cover points away to",
    attached: [RX410_WITH_SEE_ALSO],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "Same gap." } },
  { id: "S-11", who: "journeyman", doing: "asking about one model of a combined guide", attached: [RX410_RX420_COMBINED],
    ask: "What supply voltage does the RX420 controller accept?", want: answer(RX410_RX420_COMBINED) },
  { id: "S-12", who: "journeyman", doing: "asking about the sibling; the first block only excludes it",
    attached: [RX410_EXCLUSION_ONLY],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "The case left open when #5371 was shelved: an exclusion sentence, and a filename with no model number." } },
  { id: "S-13", who: "journeyman", doing: "asking about the sibling; the first block only points to its own manual",
    attached: [RX410_SEPARATE_MANUAL],
    ask: "What supply voltage does the RX420 controller accept?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "Same open case, worded as a cross-reference." } },
  { id: "S-14", who: "apprentice", doing: "asking with no model named; the first block only excludes a sibling",
    attached: [RX410_EXCLUSION_ONLY],
    ask: "What supply voltage does it accept?", want: answer(RX410_EXCLUSION_ONLY) },
  { id: "S-15", who: "senior", doing: "asking when the cover and the filename name different siblings",
    attached: [RX420_COVER_RX410_FILE],
    ask: "RX420 supply voltage?", want: REFUSE,
    knownFail: { tracked: LOOK_ALIKE, why: "Conflicting evidence about which model the file is for is not noticed." } },
  { id: "S-16", who: "journeyman", doing: "asking about one model with both siblings' guides attached",
    attached: [RX410_TITLED, RX420_TITLED],
    ask: "What supply voltage does the RX420 controller accept?", want: answer(RX420_TITLED),
    knownFail: { tracked: LOOK_ALIKE, why: "Both guides are admitted, so the sibling's page can be cited." } },
];
