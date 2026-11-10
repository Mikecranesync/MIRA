// Synthetic-technician bench, second sheet: is an ATTACHED manual an APPLICABLE one?
//
// The first sheet (bench.ts) asks whether a manual answers for a model the
// QUESTION names. These rows ask the other half: the question names no model,
// the project is confirmed as one machine, and the manual attached to it is
// for something else. Seen on screen 2026-11-10 (local walk, stand-in answers):
//  - a project confirmed as a controller, with only a relay's data sheet
//    attached, answered "What is the supply voltage?" from the relay sheet;
//  - a project with only a controller sheet attached was told "the plate reads
//    … GS11N-20P2", refused, then answered the next question from that sheet.
//
// Real covers are typed from the first stored block of the maker's or the
// distributor's public PDF (the hub's own extractor and chunker, 2026-11-10).
// No serial number, network address, lot or date code. Synthetic rows say so.
// Nothing here calls a model, a network or a database.
import {
  CONTROLLER_PHOTO_READING, DRIVE, GS10, MICRO820_SHEET, MICRO820_SHEET_AS_STORED, NO_MODEL_ANYWHERE, PLC,
  PLC_BY_CATALOG, PLC_WITH_CATALOG_FIELD, RELAY, RELAY_PLATE, RELAY_SHEET, RELAY_SHEET_AS_STORED,
  type Identity, type Job, type Manual,
} from "./bench";

const answer = (...m: Manual[]) => ({ answerFrom: m.map((x) => x.key) });
const REFUSE = { refuse: true } as const;

/** What the machine card stores today: the number without its family name. */
export const PLC_AS_CARD: Identity = { manufacturer: "Allen-Bradley", model: "820" };
export const DRIVE_AS_CARD: Identity = { manufacturer: "AutomationDirect", model: "GS11N" };

/** The controller's user manual: generic first line, the model on the second. */
export const MICRO820_USER_MANUAL_AS_STORED: Manual = {
  key: "micro820-user-manual-as-stored",
  heading:
    "User Manual Original Instructions\nMicro820 Programmable\nControllers\n"
    + "Catalog Numbers 2080-LC20-20QWB, 2080-L20E-20QWB,\n2080-LC20-20QBB, 2080-L20E-20QBB, 2080-LC20-20AWB,\n"
    + "2080-L20E-20AWB, 2080-LC20-20QWBR, 2080-L20E-20QWBR,\n2080-LC20-20QBBK, 2080-L20E-20QBBK, 2080-LC20-20QBBR,\n"
    + "2080-L20E-20QBBR, 2080-LC20-20AWBR, 2080-L20E-20AWBR",
  filename: "2080-um005_-en-e.pdf", page: 31, pageLabel: "31", origin: "public-cover",
};
/** The relay's sheet as a distributor republishes it: a disclaimer and a date come first. */
export const RELAY_SHEET_DISTRIBUTOR_AS_STORED: Manual = {
  key: "ca3kn22bd-distributor-sheet-as-stored",
  heading:
    "Disclaimer: This documentation is not intended as a substitute for and is not to be used for determining "
    + "suitability or reliability of these products for specific user applications\nJul 31, 2017\n1\n"
    + "Product data sheet\nCharacteristics\nCA3KN22BD\nTeSys K control relay - 2 NO + 2 NC - <= 690 V -\n"
    + "24 V DC standard coil\nMain\nRange TeSys\nProduct name TeSys CAK\nProduct or component type Control relay\n"
    + "Device short name CA3K\nContactor application Control circuit\nUtilisation category AC-15\nDC-13",
  filename: "CA3KN22BD.pdf", page: 1, pageLabel: "1", origin: "public-cover",
};
/** The controller's sheet as a distributor republishes it: the catalog number alone on the first line. */
export const PLC_SHEET_DISTRIBUTOR_AS_STORED: Manual = {
  key: "micro820-distributor-sheet-as-stored",
  heading:
    "2080-LC20-20QBB\nAllen Bradley PLC – Micro 820\nTechnical Specifications:\nManufacturer\nBrand\n"
    + "Part Number/Catalog No.\nProduct Type\nInputs\nOutputs",
  filename: "2080-LC20-20QBB.pdf", page: 1, pageLabel: "1", origin: "public-cover",
};
const synthetic = (key: string, heading: string, filename: string): Manual => ({
  key, heading, filename, page: 27, pageLabel: "27", origin: "synthetic",
});
/** Generic guides that name no product. Their covers carry a publication or document number. */
export const GENERIC_WITH_PUBLICATION = synthetic(
  "generic-guide-publication-number", "Wiring and Grounding Guidelines\nPublication NF-IN041B-EN-P\nOriginal Instructions", "nf-in041_-en-p.pdf");
export const GENERIC_WITH_DOCUMENT_NUMBER = synthetic(
  "generic-guide-document-number", "Conveyor Safety Guide\nDocument No. NF0000077 Rev. C", "NF0000077.pdf");

/** A project someone confirmed with the machine's tag typed as its model. */
export const TAG_AS_MODEL: Identity = { manufacturer: "Allen-Bradley", model: "CV-101" };
/** A sheet whose cover gives a catalog number and nothing else about the product. */
export const CATALOG_ONLY_COVER = synthetic(
  "catalog-only-cover", "2080-LC20-20QBB\nTechnical Specifications\nInputs\nOutputs\nSupply", "2080-LC20-20QBB.pdf");

const SUPPLY = "What is the supply voltage?";
const PLATE = "The plate reads AutomationDirect GS11N-20P2. It will not start.";

export const PROJECT_JOBS: Job[] = [
  // ── Seen on screen: another product's manual answered in a confirmed project ──
  { id: "P-01", who: "apprentice", doing: "asking in the controller's project; only the relay's sheet is attached",
    attached: [RELAY_SHEET], identity: PLC, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-02", who: "apprentice", doing: "the same, with the controller as the machine card records it and the sheet as stored",
    attached: [RELAY_SHEET_AS_STORED], identity: PLC_AS_CARD, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-03", who: "apprentice", doing: "the same, with the catalog number in its own field and the distributor's copy of the sheet",
    attached: [RELAY_SHEET_DISTRIBUTOR_AS_STORED], identity: PLC_WITH_CATALOG_FIELD, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-04", who: "apprentice", doing: "asking in the drive's project; only the relay's sheet is attached",
    attached: [RELAY_SHEET_AS_STORED], identity: DRIVE, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-05", who: "apprentice", doing: "the same, with the drive as the machine card records it",
    attached: [RELAY_SHEET], identity: DRIVE_AS_CARD, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-06", who: "apprentice", doing: "asking in the relay's project; only the controller's sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], identity: RELAY, ask: "What is the coil voltage?", want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-07", who: "apprentice", doing: "asking in the relay's project; only the drive's manual is attached",
    attached: [GS10], identity: RELAY, ask: "What is the coil voltage?", want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-08", who: "journeyman", doing: "naming the machine by its tag in the controller's project; only the relay's sheet is attached",
    attached: [RELAY_SHEET_AS_STORED], identity: PLC,
    ask: "What supply voltage does the controller on CV-101 need?", want: REFUSE, says: "another-product", about: "notebook" },
  // Already refused, but with no stated reason.
  { id: "P-09", who: "apprentice", doing: "asking in the drive's project; only the controller's sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], identity: DRIVE_AS_CARD,
    ask: "What supply voltage does it need?", want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-10", who: "apprentice", doing: "asking in the controller's project; only the drive's manual is attached",
    attached: [GS10], identity: PLC_AS_CARD,
    ask: "What supply voltage does it need?", want: REFUSE, says: "another-product", about: "notebook" },
  // The project's own manual and another product's, question names no model: only its own answers.
  { id: "P-11", who: "apprentice", doing: "asking in the controller's project; its sheet and the relay's sheet are attached",
    attached: [MICRO820_SHEET_AS_STORED, RELAY_SHEET_AS_STORED], identity: PLC, ask: SUPPLY, want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "P-12", who: "apprentice", doing: "asking in the drive's project; its manual and the relay's sheet are attached",
    attached: [GS10, RELAY_SHEET_DISTRIBUTOR_AS_STORED], identity: DRIVE_AS_CARD,
    ask: "How do I change how fast it ramps up?", want: answer(GS10) },

  // ── Controls: these must still answer ─────────────────────────────────────────
  // Each pilot manual under the identity the bench, the card and the catalog field give it.
  { id: "P-20", who: "apprentice", doing: "asking in the drive's project as the card records it; its manual is attached",
    attached: [GS10], identity: DRIVE_AS_CARD, ask: "How do I change how fast it ramps up?", want: answer(GS10) },
  { id: "P-21", who: "apprentice", doing: "asking in the controller's project as the card records it; its sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], identity: PLC_AS_CARD, ask: SUPPLY, want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "P-22", who: "apprentice", doing: "asking in the controller's project; its user manual is attached",
    attached: [MICRO820_USER_MANUAL_AS_STORED], identity: PLC, ask: SUPPLY, want: answer(MICRO820_USER_MANUAL_AS_STORED) },
  { id: "P-23", who: "apprentice", doing: "the same, as the card records the controller",
    attached: [MICRO820_USER_MANUAL_AS_STORED], identity: PLC_AS_CARD, ask: SUPPLY, want: answer(MICRO820_USER_MANUAL_AS_STORED) },
  { id: "P-24", who: "apprentice", doing: "the same, with the catalog number in its own field",
    attached: [MICRO820_USER_MANUAL_AS_STORED], identity: PLC_WITH_CATALOG_FIELD, ask: SUPPLY, want: answer(MICRO820_USER_MANUAL_AS_STORED) },
  { id: "P-25", who: "apprentice", doing: "asking in the relay's project; the distributor's copy of its sheet is attached",
    attached: [RELAY_SHEET_DISTRIBUTOR_AS_STORED], identity: RELAY, ask: "What is the coil voltage?", want: answer(RELAY_SHEET_DISTRIBUTOR_AS_STORED) },
  { id: "P-26", who: "apprentice", doing: "asking in a controller project confirmed by catalog number; the distributor's sheet is attached",
    attached: [PLC_SHEET_DISTRIBUTOR_AS_STORED], identity: PLC_BY_CATALOG, ask: SUPPLY, want: answer(PLC_SHEET_DISTRIBUTOR_AS_STORED) },
  { id: "P-27", who: "apprentice", doing: "the same, with the family name as the model and the catalog number in its own field",
    attached: [PLC_SHEET_DISTRIBUTOR_AS_STORED], identity: PLC_WITH_CATALOG_FIELD, ask: SUPPLY, want: answer(PLC_SHEET_DISTRIBUTOR_AS_STORED) },
  // The distributor's cover gives the catalog number on its first line and "Micro 820" on its
  // second, so it is tied to a project recorded by family name too.
  { id: "P-51", who: "apprentice", doing: "asking in a controller project recorded by family name only; the distributor's sheet is attached",
    attached: [PLC_SHEET_DISTRIBUTOR_AS_STORED], identity: PLC, ask: SUPPLY, want: answer(PLC_SHEET_DISTRIBUTOR_AS_STORED) },
  { id: "P-52", who: "apprentice", doing: "the same, as the machine card records the controller",
    attached: [PLC_SHEET_DISTRIBUTOR_AS_STORED], identity: PLC_AS_CARD, ask: SUPPLY, want: answer(PLC_SHEET_DISTRIBUTOR_AS_STORED) },
  // The known cost of the rule, counted: a cover that gives ONLY a catalog number, in a project
  // recorded only by family name. Nothing on the cover ties the two together, so the sheet is
  // refused, with the reason and the way out, until the catalog number is recorded or named.
  // (Synthetic cover: none of the pilot's real covers is this bare.)
  { id: "P-54", who: "apprentice", doing: "asking in a controller project recorded by family name only; the sheet's cover gives only a catalog number",
    attached: [CATALOG_ONLY_COVER], identity: PLC, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-55", who: "apprentice", doing: "the same, as the machine card records the controller",
    attached: [CATALOG_ONLY_COVER], identity: PLC_AS_CARD, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  { id: "P-53", who: "journeyman", doing: "the way out: the same project, naming the catalog number in the question",
    attached: [CATALOG_ONLY_COVER], identity: PLC_AS_CARD,
    ask: "What supply voltage does the 2080-LC20-20QBB need?", want: answer(CATALOG_ONLY_COVER) },
  { id: "P-56", who: "apprentice", doing: "the other way out: the same sheet once the project records the catalog number",
    attached: [CATALOG_ONLY_COVER], identity: PLC_WITH_CATALOG_FIELD, ask: SUPPLY, want: answer(CATALOG_ONLY_COVER) },
  // A project whose model field holds a machine tag, not a product. A same-maker family manual may
  // well be that machine's, so it is kept; a cover that gives only another catalog number is not.
  { id: "P-57", who: "apprentice", doing: "asking in a project recorded by its machine tag; a same-maker controller manual is attached",
    attached: [MICRO820_USER_MANUAL_AS_STORED], identity: TAG_AS_MODEL, ask: SUPPLY, want: answer(MICRO820_USER_MANUAL_AS_STORED) },
  { id: "P-58", who: "apprentice", doing: "the same project; only the relay's sheet is attached (counted cost: named, it answers)",
    attached: [RELAY_SHEET_AS_STORED], identity: TAG_AS_MODEL, ask: SUPPLY, want: REFUSE, says: "another-product", about: "notebook" },
  // A part's own sheet answers in the machine's project when the question names the part.
  { id: "P-28", who: "journeyman", doing: "asking about the relay by part number in the controller's project; the relay's sheet is attached",
    attached: [RELAY_SHEET_AS_STORED], identity: PLC,
    ask: "What is the coil voltage of the CA3KN22BD?", want: answer(RELAY_SHEET_AS_STORED) },
  { id: "P-29", who: "journeyman", doing: "the same in the drive's project, with the distributor's copy of the sheet",
    attached: [RELAY_SHEET_DISTRIBUTOR_AS_STORED], identity: DRIVE,
    ask: "What is the coil voltage of the CA3KN22BD?", want: answer(RELAY_SHEET_DISTRIBUTOR_AS_STORED) },
  // A manual that names no product stays usable in any project.
  { id: "P-30", who: "apprentice", doing: "asking in the controller's project; only a guide that names no product is attached",
    attached: [NO_MODEL_ANYWHERE], identity: PLC, ask: SUPPLY, want: answer(NO_MODEL_ANYWHERE) },
  { id: "P-31", who: "apprentice", doing: "asking in the controller's project; a general guide whose cover carries a publication number",
    attached: [GENERIC_WITH_PUBLICATION], identity: PLC, ask: "How should the cabinet be grounded?", want: answer(GENERIC_WITH_PUBLICATION) },
  { id: "P-32", who: "apprentice", doing: "asking in the relay's project; a general guide whose cover carries a document number",
    attached: [GENERIC_WITH_DOCUMENT_NUMBER], identity: RELAY, ask: "What guarding does the conveyor need?", want: answer(GENERIC_WITH_DOCUMENT_NUMBER) },
  // No confirmed machine: nothing is scoped, as today.
  { id: "P-33", who: "apprentice", doing: "asking in a project with no machine; only the relay's sheet is attached",
    attached: [RELAY_SHEET_AS_STORED], ask: SUPPLY, want: answer(RELAY_SHEET_AS_STORED) },
  { id: "P-34", who: "apprentice", doing: "asking in a project whose controller was typed but never confirmed; only the relay's sheet is attached",
    attached: [RELAY_SHEET_AS_STORED], identity: PLC, unconfirmed: true, ask: SUPPLY, want: answer(RELAY_SHEET_AS_STORED) },
  // What the technician photographed in this project is not judged as a manual cover.
  { id: "P-35", who: "apprentice", doing: "asking in the controller's project; a confirmed relay nameplate and a controller photo reading are attached",
    attached: [RELAY_PLATE, CONTROLLER_PHOTO_READING], identity: PLC,
    ask: "What has been read off the parts so far?", want: answer(RELAY_PLATE, CONTROLLER_PHOTO_READING) },

  // ── A conversation: the model the technician named is still the subject ───────
  // Seen on screen: the plate message found no passage at all, so no reason was given.
  { id: "P-40", who: "apprentice", doing: "telling MIRA what the plate reads; only a controller sheet is attached and the search finds nothing",
    attached: [MICRO820_SHEET_AS_STORED], noPassages: true,
    ask: PLATE, want: REFUSE, says: "mismatch-named", about: "question" },
  { id: "P-41", who: "apprentice", doing: "asking the next question after that refusal; only a controller sheet is attached",
    attached: [MICRO820_SHEET_AS_STORED], earlier: [PLATE],
    ask: "What supply voltage does it need?", want: REFUSE, says: "mismatch-named", about: "conversation" },
  { id: "P-42", who: "apprentice", doing: "asking a third question after two refusals",
    attached: [MICRO820_SHEET_AS_STORED], earlier: ["What supply voltage does it need?", PLATE],
    ask: "How do I reset it?", want: REFUSE, says: "mismatch-named", about: "conversation" },
  { id: "P-43", who: "apprentice", doing: "asking after a refused fault-code question that followed the plate message",
    attached: [MICRO820_SHEET_AS_STORED], earlier: ["What does fault F0004 mean?", PLATE],
    ask: "What supply voltage does it need?", want: REFUSE, says: "mismatch-named", about: "conversation" },
  { id: "P-44", who: "journeyman", doing: "asking with no model after a refused question about a sibling relay",
    attached: [RELAY_SHEET_AS_STORED], earlier: ["What is the coil voltage of the CA3KN31BD?"],
    ask: "What is the coil voltage?", want: REFUSE, says: "other-model", about: "conversation" },
  { id: "P-45", who: "journeyman", doing: "asking with no model after a refused question about another drive family; both manuals are attached",
    attached: [GS10, MICRO820_SHEET], earlier: ["Which parameter sets acceleration time on the GS23-4010?"],
    ask: "Which parameter sets the acceleration time?", want: REFUSE, says: "mismatch-named", about: "conversation" },
  // A project with a CONFIRMED machine keeps answering for that machine: a question that names no
  // model is about the project's machine, whatever an earlier refused question named. (The stricter
  // reading, refusing here too, is a decision for the owner; it is not what was seen on screen.)
  { id: "P-46", who: "journeyman", doing: "the same in a project confirmed as the drive, with its own manual attached",
    attached: [GS10], identity: DRIVE, earlier: ["Which parameter sets acceleration time on the GS23-4010?"],
    ask: "Which parameter sets the acceleration time?", want: answer(GS10) },
  // Controls: naming a model now wins; a subject the project does cover narrows to its manual.
  { id: "P-47", who: "apprentice", doing: "naming the attached sheet's own model after the plate message was refused",
    attached: [MICRO820_SHEET_AS_STORED], earlier: [PLATE],
    ask: "What supply voltage does the Micro820 need?", want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "P-48", who: "journeyman", doing: "asking with no model after a refused question about the drive whose manual IS attached, beside a controller sheet",
    attached: [GS10, MICRO820_SHEET], earlier: ["What is the terminal torque on the GS11N-20P2?"],
    ask: "What supply voltage does it need?", want: answer(GS10) },
  { id: "P-49", who: "journeyman", doing: "asking with no model after a refused fault-code question; nothing named a model",
    attached: [MICRO820_SHEET_AS_STORED], earlier: ["What does fault F0004 mean?"],
    ask: "What supply voltage does it need?", want: answer(MICRO820_SHEET_AS_STORED) },
  { id: "P-50", who: "journeyman", doing: "asking in the drive's project after a refused question that named the drive itself",
    attached: [GS10], identity: DRIVE, earlier: ["What is the terminal torque on the GS11N-20P2?"],
    ask: "Which parameter sets the acceleration time?", want: answer(GS10) },
];
