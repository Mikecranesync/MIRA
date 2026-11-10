import { modelMentionsInText } from "./model-token";
import {
  NAMEPLATE_BODY_MARK,
  NAMEPLATE_OPENER,
  PHOTO_OCR_OPENER_START,
  PHOTO_READING_BODY_MARK,
  PHOTO_READING_OPENER,
  type PhotoDocumentKind,
  productWrittenBody,
} from "./photo-document-text";

/**
 * #5369 — is this manual shown to be for the model number that was asked about?
 *
 * The wrong-model check in manual-rag.ts reads only the product families
 * model-token.ts has a pattern for. Any other model or catalog number
 * ("RX420", "CA3KN99ZZ", "2080-LC99-99ZZZ") read as "no model named", so a
 * sibling's manual answered. Adding one pattern per vendor never ends, so this
 * check is generic and relational: a number counts only when the manual's own
 * cover or filename carries that number or a look-alike of it. A fault or
 * parameter code that resembles nothing on the cover is never judged.
 *
 * Design rule, after seven review rounds on the shelved first attempt (#5371)
 * each found another cover wording that was misread: coverage is never inferred
 * from a mention. It must be shown —
 *   - only the FIRST cover line that carries the number or a look-alike is
 *     read; nothing below it is (a "related publications" list, a pointer);
 *   - that line must be a TITLE: no sentence word, no exclusion word, no
 *     sentence punctuation, not part of a sentence that wraps from the line
 *     above or onto the line below, and a product or document noun beside it
 *     (or nothing on the line but numbers). Prose shows nothing;
 *   - a joined word is read by its parts: "not-covered", "NOT_SUPPORTED" and
 *     "isn't" are negations, whatever joins them, and so is "NotSupported" on
 *     the model's own line or the line under it (review round 2 on #5389);
 *   - an exclusion is recognised by a listed word, phrase or mark ("not",
 *     "excluded", "n/a", "out of scope", a cross). A word no list holds is a
 *     maker, a range or an adjective, as on real covers. Asking that every
 *     word beside the model be known was tried and withdrawn: it refused
 *     ordinary covers (see "Known limits");
 *   - the line below is read for a remark on coverage: a negation together
 *     with a coverage word ("is not covered"), a joined negation, or an
 *     exclusion phrase or mark. A heading that ends in a colon and carries a
 *     negation is read a few lines up;
 *   - the filename counts only when the cover carries no such number at all,
 *     and a cover and a filename that name different look-alikes disagree.
 *
 * A document the PRODUCT wrote from a technician's photo (a kept photo reading,
 * a confirmed nameplate, the OCR text of an uploaded photo) has no cover, so
 * none of that applies to it. It is
 * read by what was read off the photo: it answers for a number it carries, is
 * refused for a number it carries only a look-alike of, and is not judged
 * otherwise. Its header lines are the product's own and are never read: the
 * machine's name in them ("CV-101") is a label, not a model number, and so is
 * a photo's file name. This is
 * what the existing check already does for the families it reads.
 * No model call, no database call. Pure.
 *
 * Known limits:
 *   - WRONG-ADMIT residual (open; the owner's decision on #5389): an
 *     exclusion written with no listed word, phrase or mark still reads as a
 *     title, wherever it sits. On the model's line: "RX420 Logic Controller
 *     sold by distributors", "RX420 (dealer stock) Logic Controller", "Dealer
 *     stock RX420 Logic Controller", "RX420 Logic Controller: N", "(X)". On the
 *     line below or above: "Cancelled", "Archived", "Sold through
 *     distributors:". Also: a word the lists do not hold ("(EOL)", "TBD",
 *     "nein", "isnt", "sold elsewhere" after the product noun, "wrong
 *     manual"); a negation on the line below with no coverage word beside it
 *     ("Controller: no.", "Version: false"); a line below that excludes the
 *     model and names another ("Use the RX430 manual instead - not covered
 *     here"); an exclusion two or more lines below the title; a heading above
 *     that carries no negation ("Models this guide leaves to others:"); "RX420
 *     Guide NF22" on a sibling's cover; a second title stacked directly under
 *     the first with no heading between; and an exclusion heading with no
 *     colon two or more lines up. A LISTED word is not read either when it is
 *     written in full-width letters ("ｎｏｔ", "N／A"); wrapped in emphasis or quote marks
 *     ("**not covered**"); letter-spaced; typed "N / A"; a phrase wrapped
 *     over two lines ("End of" / "life"); "no." after a colon at the end of
 *     the line; in a heading more than six lines up or one that does not end
 *     in a colon; or under the last of three stacked models.
 *     No finite word list closes this. Forty-one
 *     more words (false, invalid, skipped, TBD, elsewhere ...) and looser
 *     readings of headings and of the line below were built and withdrawn:
 *     they refused ordinary covers ("RX420 Drive Skipped Frequency Setup
 *     Guide", "Rev. TBD", "Applies to:" above the title, "Draft - not for
 *     distribution" below it). The alternative that does close it (every word
 *     beside the model must be a known title word) was measured on 181 realistic
 *     cover checks: it refused 38 that answer today, among them "(EN)",
 *     "(CE)", "(Rev 2, Dec 2020)", "Manual del usuario", "FX5U-32MR/ES" and a
 *     catalog number written before the product name;
 *   - WRONG REFUSALS accepted (a question that names the model is refused on
 *     the model's own manual): "N/A" meaning North America, or a field left
 *     empty under the title ("Part Number: N/A", "Revision: n/a"); a line
 *     under the title that carries a negation together with a coverage word
 *     about something else ("Supports Modbus, no extra license", "Includes
 *     Alternative Wiring Diagrams") or opens with a contraction ("Isn't it
 *     time to upgrade"); a joined warning or remark beside the model
 *     ("Do-Not-Open", "Non-UL-Listed", "Do-It-Yourself",
 *     "Not-Included-Accessories", "End-of-Service Notice"); an ordinary word
 *     that is a negation prefix run together with a coverage word, on the
 *     model's line or the line under it ("Uncovered Terminals", "Unlisted
 *     accessories"). An independent
 *     pass added more of the same kind, all under the title: "Cable not
 *     included", "Contains no hazardous substances", "The information
 *     contained herein is subject to change without notice", "Edition 2
 *     supersedes edition 1", "Prices excluding VAT"; and a heading that ends
 *     in a colon up to six lines above the title and carries a negation
 *     ("Appelez sans frais:", "Model No:");
 *   - an accessory's manual that names the model it is for ("EtherNet/IP
 *     Adapter for RX420 Drives") is not told apart from the model's own manual;
 *   - a filename that names the asked number counts when the cover names no
 *     number of the family, whatever else the name carries;
 *   - a variant written as a hyphen and letters only ("RX420-E" / "RX420-U")
 *     is not told apart; neither is one that differs by three or more
 *     characters at the end, or in a different letters/digits layout;
 *   - a real title next to a sentence ("Read this manual before use" on the
 *     line above) refuses a question that names that model; so does a model
 *     beside a maker name only, with no product or document word on its line
 *     or the lines touching it ("Northfield RX420" under a revision line);
 *   - a number written with a space ("RX 420") is not read, as today;
 *   - a different hundred-series ("RX910" against an "RX410" cover) is not a
 *     look-alike, so it is not judged, as today;
 *   - covers in languages other than English, German, French, Spanish and
 *     Italian are read with the English lists only;
 *   - "NO" and "DO" read as contact or channel notation only beside a count of
 *     one or two digits or their pair ("2 NO + 2 NC", "DI/DO");
 *   - "IS" and "IT" are always read as sentence words, so a cover that uses
 *     them as nouns ("RX420 IS Barrier Installation Guide", "RX420 IT Power
 *     Systems Guide") refuses a question that names that model;
 *   - a cover that names exactly one model, as a title, is trusted;
 *   - an uploaded file whose first line is the product's own photo-reading,
 *     nameplate or photo-OCR line is read as one;
 *   - a photo reading that mentions the asked number only in passing (a
 *     photographed page that points to another model's manual) answers for it;
 *   - a photo reading that carries one machine tag is refused for a question
 *     that names that tag and a look-alike tag ("CV-101 … CV-102").
 *
 * Checked 2026-11-10 against the first stored block of the pilot's public
 * manuals (the hub's own extractor and chunker over the PDFs): each answers
 * for its own part or catalog number and refuses a sibling's.
 */

/** One model or catalog number: `key` compares, `label` is shown. */
export type ModelNumber = { key: string; label: string };

export type UnlistedRefusalKind =
  | "other-model" // the cover declares a look-alike, not the asked number
  | "coverage-not-shown" // the number or a look-alike is there, but not as what the manual is for
  | "cover-and-file-disagree" // cover and filename name different look-alikes
  | "several-look-alikes"; // two look-alike numbers asked; this manual is not shown to cover both

/** What retrieval reports when every selected manual was refused by this check. */
export type UnlistedModelRefusal = {
  kind: UnlistedRefusalKind;
  /** The asked numbers that were not shown to be covered. */
  asked: string[];
  /** What the refused covers declare. Never a filename's number. */
  declared: string[];
  /** Whether the number came from the question, from the notebook's confirmed
   *  machine, or from an earlier question of this conversation that was not
   *  answered from a document (conversation-subject.ts). */
  source: "question" | "notebook" | "conversation";
  /** Set when every refused document is a photo reading the product wrote, not a manual. */
  reading?: true;
};

export type ManualVerdict =
  | { admit: true }
  | { admit: false; kind: UnlistedRefusalKind; asked: string[]; declared: string[]; /** A product-written photo reading, not a manual. */ reading?: true };

// A rating or a count is not a model number: 24VDC, 690V, 4-20mA, 2NO, 3PH, 1st.
const UNIT_RE =
  /^\d+(?:V|VAC|VDC|KV|MV|A|MA|KA|AH|MAH|W|KW|MW|VA|KVA|HP|HZ|KHZ|MHZ|RPM|MM|CM|M|IN|FT|NM|PSI|BAR|KPA|C|F|K|S|MS|MIN|H|HR|KG|G|LB|OZ|AWG|P|PH|NO|NC|X|D|ST|ND|RD|TH)$/;
// Neither is a standard or an interface: IP20, RS485, NEMA4X, CAT5E, IEC61131.
const STANDARD_RE = /^(?:IP|RS|UL|IEC|ISO|EN|NEMA|CAT|DIN|AWG|USB|SIL|ANSI|NFPA|CSA)\d+[A-Z]?$/;
const CHAIN_RE = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;
const hasDigit = (s: string) => /\d/.test(s);
const numberFrom = (run: string[]): ModelNumber | null => {
  const key = run.join("").toUpperCase();
  return /[A-Z]/.test(key) && key.length >= 4 && !UNIT_RE.test(key) && !STANDARD_RE.test(key)
    ? { key, label: run.join("-").toUpperCase() }
    : null;
};

/** The hyphen-joined runs of a text that could hold a model number: a run of
 *  groups that each carry a digit ("2080-LC20-20QBB"), or a short letter prefix
 *  hyphenated to its number ("RX-420"). */
function numberRuns(text: string): string[][] {
  const runs: string[][] = [];
  for (const chain of text.matchAll(CHAIN_RE)) {
    const segments = chain[0].split("-");
    for (let i = 0; i < segments.length; i++) {
      const prefixed = /^[A-Za-z]{1,3}$/.test(segments[i]) && /^\d/.test(segments[i + 1] ?? "");
      if (!hasDigit(segments[i]) && !prefixed) continue;
      let j = i;
      while (j + 1 < segments.length && hasDigit(segments[j + 1])) j++;
      runs.push(segments.slice(i, j + 1));
      i = j;
    }
  }
  return runs;
}

/** The model-number-shaped tokens in a text: letters and digits written
 *  together, hyphenated groups kept as one ("2080-LC20-20QBB"), and a short
 *  letter prefix hyphenated to its number ("RX-420" is "RX420"). */
export function modelNumbersIn(text: string): ModelNumber[] {
  return numberRuns(text).flatMap((run) => numberFrom(run) ?? []);
}

/** The same, as a COVER or a FILENAME is read: every group of a hyphenated run
 *  that is a model number on its own is read too. A cover writes a range
 *  ("RX410-RX415") or glues a model to its publication number
 *  ("RX410-UM001A-EN-P"); read only as one long number, the model in it would
 *  resemble nothing and the manual would look silent about its own family. */
function coverNumbersIn(text: string): ModelNumber[] {
  return numberRuns(text).flatMap((run) => [
    ...(numberFrom(run) ? [numberFrom(run)!] : []),
    ...(run.length > 1 ? run.flatMap((segment) => numberFrom([segment]) ?? []) : []),
  ]);
}

const layoutOf = (key: string) => key.replace(/[A-Z]+/g, "A").replace(/\d+/g, "D");
const leadOf = (key: string) => /^(?:[A-Z]+|\d+)/.exec(key)![0];

/** Two different numbers of one family. Either:
 *  - the same leading group and the same letters/digits layout
 *    ("CA3KN22BD"/"CA3KN31BD", "2080-LC20-…"/"2080-LC50-…"); for
 *    letters-then-digits ("RX410"/"RX420") also the same digit count and first
 *    digit, the relation #5371's reviews settled, so a fault code (F0004, A093)
 *    does not pair with a model; or
 *  - a variant: the same first four characters or more, and at most two
 *    characters different or added at the end ("LC1D09BD"/"LC1D09B7" is a coil
 *    voltage, "CA3KN22BD"/"CA3KN22BD3", "RX420"/"RX420S"). */
function lookAlike(a: ModelNumber, b: ModelNumber): boolean {
  if (a.key === b.key) return false;
  let shared = 0;
  while (shared < a.key.length && shared < b.key.length && a.key[shared] === b.key[shared]) shared++;
  if (shared >= 4 && a.key.length - shared <= 2 && b.key.length - shared <= 2) return true;
  if (leadOf(a.key) !== leadOf(b.key) || layoutOf(a.key) !== layoutOf(b.key)) return false;
  if (layoutOf(a.key) !== "AD") return true;
  const da = a.key.replace(/^[A-Z]+/, "");
  const db = b.key.replace(/^[A-Z]+/, "");
  return da.length === db.length && da[0] === db[0];
}
const sameFamily = (a: ModelNumber, b: ModelNumber) => a.key === b.key || lookAlike(a, b);
/** The same number, or two numbers of one family. */
export const sameModelFamily = sameFamily;

/** The model numbers a text names that model-token.ts does NOT read. Whatever
 *  the detector reads is left to the existing check, whole: "GS11N-20P2" must
 *  not come back as a leftover "20P2". */
export function unlistedModelNumbers(text: string): ModelNumber[] {
  // UTF-16 units, not code points: the detector's positions and `text[i]` below
  // count units, and an emoji is two. Only letters, digits and hyphens are ever
  // blanked, so a surrogate pair is never split.
  const chars = text.split("");
  const blank = (start: number, end: number) => {
    let s = start;
    let e = end;
    while (s > 0 && /[A-Za-z0-9-]/.test(text[s - 1])) s--;
    while (e < text.length && /[A-Za-z0-9-]/.test(text[e])) e++;
    for (let i = s; i < e; i++) chars[i] = " ";
  };
  for (const m of modelMentionsInText(text)) blank(m.start, m.end);
  // modelIdentitiesInText also reads a GS catalog number written with spaces round its hyphen.
  for (const m of text.matchAll(/\bGS\d{1,2}[a-z]?\s*-\s*[a-z0-9]+\b/gi)) blank(m.index, m.index + m[0].length);
  const seen = new Set<string>();
  return modelNumbersIn(chars.join("")).filter((n) => !seen.has(n.key) && seen.add(n.key));
}

// How a title is told from a sentence. Three things, all needed:
//   1. no sentence word (a verb, a negation, a pronoun, a pointer) and no
//      exclusion word on the line, and no sentence or clause punctuation;
//   2. the lines directly above and below do not make it part of a sentence
//      (an exclusion that wraps onto, or off, the number's line);
//   3. something positive: a product or document noun on the line or on a
//      clean line beside it, or a line that is nothing but this family's numbers.
// A maker, series or adjective the lists do not know is allowed: real covers
// are full of them ("SINAMICS … converter", "Adjustable Frequency AC Drive").
// Measured cost of the stricter alternative (every word from a fixed list): it
// refused "ACS355 User's manual" and "TP1200 Comfort Operating Instructions".
const TITLE_NOUNS = new Set(
  (
    "controller controllers drive drives vfd inverter inverters converter converters relay relays contactor " +
    "contactors starter starters motor motors gearmotor gearmotors servo amplifier amplifiers sensor sensors " +
    "switch switches breaker breakers module modules panel panels hmi plc pump pumps valve valves gearbox " +
    "reducer reducers conveyor conveyors encoder encoders actuator actuators transmitter transmitters meter " +
    "meters supply supplies terminal terminals adapter adapters series " +
    "manual manuals guide guides instruction instructions handbook datasheet sheet specification " +
    "specifications catalog catalogue " +
    // The same document and product words on German, French, Spanish and Italian covers.
    "betriebsanleitung bedienungsanleitung montageanleitung anleitung handbuch gerätehandbuch datenblatt " +
    "frequenzumrichter umrichter antrieb steuerung manuel notice variateur manuale istruzioni instrucciones guía guia"
  ).split(" "),
);
// Closed-class sentence words. Articles and plain prepositions (for, of, the,
// with, to, from …) are deliberately absent: "User Manual for the RX410" is a
// title. So are words that are also ordinary cover words: "can" (CAN
// interface), "use" (Instructions for Use), "note" (Application Note).
const SENTENCE_WORDS = new Set(
  (
    "is are was were be been being does do did has have had will would cannot could may might must should " +
    "shall not no non never none neither nor without except unless unlike instead only also other others " +
    "another see refer consult please it its this that these those you your we our they " +
    "their if when where which who what how why because but however while than versus vs missing former " +
    "formerly legacy previous successor predecessor related associated compatible additional further pending " +
    // Negations and pointers on German, French, Spanish and Italian covers.
    "nicht kein keine ohne außer ausser siehe sauf sans pas voir excepto salvo sin véase vease senza vedi"
  ).split(" "),
);
// Exclusion and pointer words. Whole words where a stem would also catch a
// product or a maker ("Differential", "Separator", "Removable", "Applied",
// "Cover"); a stem where every inflection is an exclusion.
const EXCLUSION_WORDS = new Set(
  (
    "applies apply applicable applying covered covers covering coverage remove removed removing differ differs " +
    "differing different differently separate separately separated replace replaces replaced replacing " +
    "replacement replacements lack lacks lacking"
  ).split(" "),
);
const EXCLUSION_STEMS = [
  "exclud", "omit", "unsupport", "unavailab", "incompatib", "discontinu", "obsolet", "deprecat",
  "supersed", "withdraw", "substitut", "alternativ",
];
const JOINERS = new Set(["and", "or", "&", "+"]);
const DANGLING_JOIN_RE = /(?:\b(?:and|or)|[&/,+])\s*$/i;
// The plain negations and exclusions among the sentence words: what makes a
// joined word, a heading above or the line below a remark that something is
// left out. Only words the lists held before review round 2 on #5389.
const NEGATION_WORDS = new Set(
  (
    "not no non never none neither nor without except unless cannot " +
    "nicht kein keine ohne außer ausser sauf sans excepto salvo sin senza"
  ).split(" "),
);
// Exclusions written as a phrase or an abbreviation no word list reads: "w/o",
// "N/A", "n.a.", "out of scope", "end-of-life".
const EXCLUSION_PHRASE_RES = [
  /\bw\/o\b/i,
  /\bn\/a\b/i,
  /(?<![a-z0-9])n\.\s?a\.?(?![a-z0-9])/i,
  /\bout[\W_]+of[\W_]+(?:scope|stock|production|service|date|print)\b/i,
  /\bend[\W_]+of[\W_]+(?:life|sale|sales|support|service|production)\b/i,
  // A cross, a "no entry" sign, "not equal", "not an element of".
  /[\u2715-\u2718\u274c\u274e\u2a2f\u{1f6ab}\u26d4\u2260\u2209\u2298]/u,
];
const hasExclusionPhrase = (line: string) => EXCLUSION_PHRASE_RES.some((re) => re.test(line));
// An abbreviation's full stop is not the end of a sentence, and "No." is a
// label, not a negation: "Model No. RX420", "Cat. No.", "Rev. 3", "Corp.".
// The line is read as stored. Folding compatibility forms, and reading "No." at
// the end of a line as an answer, were built and withdrawn: they refused a
// "Catalog No." label above its number, "Nº de pedido …" and a title that
// trails off in "…", and those covers stopped declaring their own product.
const plain = (line: string) =>
  line
    .replace(/\b(?:no|nr)\.(?=\s|$)/gi, "number")
    .replace(/\b(rev|cat|corp|inc|ltd|co|vol|ver|ed|pub|doc|mfg|art|ref|fig|mod|dept|div)\.(?=\s|$)/gi, "$1");
const strip = (word: string) => word.replace(/^[("'[{<]+|[)"'\]}>:;.!?]+$/g, "");
const wordsOf = (line: string) => plain(line).split(/[\s,/]+/).map(strip).filter(Boolean);
const isExclusionWord = (lower: string) => EXCLUSION_WORDS.has(lower) || EXCLUSION_STEMS.some((stem) => lower.startsWith(stem));
// A web or mail address is not prose: "www.example.com/how-to" stays as it was read before.
const ADDRESS_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|@/i;
const NOTATION_PARTS = new Set(["no", "nc", "di", "do"]);
/** The words of a line as they are written joined: split at spaces, commas and
 *  slashes only, addresses left out. */
const joinedTokens = (line: string) =>
  plain(line).split(/\s+/).filter((t) => !ADDRESS_RE.test(t)).flatMap((t) => t.split(/[,/]+/)).map(strip).filter(Boolean);
/**
 * Codex round 2 on #5389: "RX420 (not-covered)" read as a title, because
 * "not-covered" is one word and no list holds it. A word joined by anything
 * that is not a letter or a digit (every kind of hyphen and dash, an
 * underscore, a dot, a plus, an apostrophe) is read by its parts: one part that
 * `counts` makes the whole word count. So does "un-" (un-supported), the parts
 * run together (can-not), and a contraction (isn't).
 * Not counted: contact or channel notation ("NO-NC", "DI-DO", "2-NO").
 * The word must also say what is negated: a coverage word, a sentence word
 * or, after a negation, a model number ("non-supported", "not-for-this-model",
 * "ohne-RX420"). A product word ("Non-Isolated", "Non-Sparking", "No-Load")
 * stays a product word with no list of them kept: nothing in it says what is
 * negated. So does a rating or a module name with a digit in it ("NO-24VDC",
 * "DO-16TP", "IS-Barrier-24V"): read the other way, the rule refused real
 * covers (measured, see "Known limits").
 */
function joinedSentenceWord(word: string, counts: (lower: string) => boolean): boolean {
  if (/n['’‘`´]t$/i.test(word)) return true;
  const parts = word.toLowerCase().replace(/['’]s$/, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length < 2) return false;
  if (parts.every((part) => NOTATION_PARTS.has(part) || /^\d{1,2}$/.test(part))) return false;
  const hit = parts.findIndex((part) => part === "un" || counts(part));
  if (hit < 0) return counts(parts.join(""));
  // "non-RX420", "ohne-RX420": a negation joined to a model number. Only a
  // negation: "DO-16TP" and "NO-24VDC" are an output module and a contact rating.
  const negatesNumber = (part: string) => countsAsNegation(parts[hit]) && !NOTATION_PARTS.has(parts[hit]) && modelNumbersIn(part).length > 0;
  return parts.some((part, i) => i !== hit && (isCoverageWord(part) || SENTENCE_WORDS.has(part) || negatesNumber(part)));
}
// "NotSupported", "notcovered", "unlisted", "nichtenthalten": a negation run
// together with a word about coverage. Only those: "Notebook", "Nonius" and
// "Universal" are ordinary words. Read on the model's own line, the line above
// it and the line below it ("RX420 Logic Controller\nNotSupported by this
// manual" refuses, as "NOT-SUPPORTED by …" does).
const RUN_TOGETHER_RE = /^(?:not|non|never|no|un|nicht|kein)(.{4,})$/;
const COVERAGE_STEMS = ["support", "cover", "includ", "contain", "list", "avail", "valid", "applic", "enthalten", "inhalt", "unterst"];
const isCoverageWord = (lower: string) => COVERAGE_STEMS.some((stem) => lower.startsWith(stem)) || isExclusionWord(lower);
const isRunTogetherNegation = (lower: string) => {
  const rest = RUN_TOGETHER_RE.exec(lower)?.[1];
  return rest !== undefined && isCoverageWord(rest);
};
const isSentenceWord = (word: string, strict = true): boolean => {
  const lower = word.toLowerCase().replace(/[’']s$/, "");
  if (SENTENCE_WORDS.has(lower) || isExclusionWord(lower) || (strict && isRunTogetherNegation(lower))) return true;
  // "not-RX420": a word hyphenated to a model number is read by its parts.
  return word.includes("-") && modelNumbersIn(word).length > 0 && word.split("-").some((part) => part !== word && isSentenceWord(part, strict));
};
// "May 2021", "12 May 2021", "May 12, 2021": the month, not the verb.
const isMonthMay = (words: string[], i: number) => words[i].toLowerCase() === "may" && /^(?:\d{1,2}|(?:19|20)\d{2})$/.test(words[i + 1] ?? "");
// "NO" and "DO" are also nouns on a cover: normally-open contacts ("2 NO + 2 NC",
// "NO/NC") and digital outputs ("4 DO", "DI/DO"). They count as the noun only
// beside a contact or channel count or their pair.
// "IS" and "IT" are always read as the sentence words. They can be nouns too
// (intrinsic safety, IT power systems), and until review round 3 on #5389 a
// shouted one in a mixed-case line was read that way; but nothing on the page
// tells "RX420 IS Barrier Guide" from "RX420 IS sold elsewhere Logic
// Controller" for certain, no cover in the pilot or the bench needs it, and a
// wrong refusal is the safe side.
const CONTACT_PAIRS: Record<string, string[]> = { no: ["nc"], do: ["di"] };
const isNotationNoun = (words: string[], i: number): boolean => {
  const pairs = CONTACT_PAIRS[words[i].toLowerCase()];
  if (!pairs) return false;
  const at = (step: number) => (words[i + step] ?? "").toLowerCase();
  const paired = [-1, 1].some((d) => pairs.includes(at(d)) || (at(d) === "+" && pairs.includes(at(2 * d))));
  return /^\d{1,2}$/.test(at(-1)) || paired;
};
const sentenceWordAt = (words: string[], i: number, strict = true) => isSentenceWord(words[i], strict) && !isMonthMay(words, i) && !isNotationNoun(words, i);
const countsAsSentence = (lower: string) => SENTENCE_WORDS.has(lower) || isExclusionWord(lower) || isRunTogetherNegation(lower);
const countsAsNegation = (lower: string) =>
  NEGATION_WORDS.has(lower) || EXCLUSION_STEMS.some((stem) => lower.startsWith(stem)) || isRunTogetherNegation(lower);
/** `strict`: see isTitleLine. Not strict is the reading the declared-product
 *  check had before review round 2 on #5389. One thing differs, because both
 *  readings strip the same brackets: a listed negation in curly or angle
 *  brackets is read there too ("RX420 {not covered}" declares nothing). */
const hasSentenceWord = (line: string, strict = true) => {
  const words = wordsOf(line);
  if (!strict) return /\bw\/o\b/i.test(line) || words.some((_, i) => sentenceWordAt(words, i, false));
  return hasExclusionPhrase(plain(line)) || words.some((_, i) => sentenceWordAt(words, i)) || joinedTokens(line).some((t) => joinedSentenceWord(t, countsAsSentence));
};
/** A negation or an exclusion anywhere on the line. */
const hasNegation = (line: string) => {
  const words = wordsOf(line);
  return (
    hasExclusionPhrase(plain(line)) ||
    words.some((w, i) => countsAsNegation(w.toLowerCase()) && !isNotationNoun(words, i)) ||
    joinedTokens(line).some((t) => joinedSentenceWord(t, countsAsNegation))
  );
};
/** The line says something is NOT covered: a negation together with a word
 *  about coverage ("This controller is not covered"), a joined negation
 *  ("not-supported"), or an exclusion phrase or mark ("N/A", "End of life", a
 *  cross). A negation about something else is not one ("Draft - not for
 *  distribution", "Warning: do not operate without guard"). Exported for
 *  manual-rag.ts, which reads the same remark beside a member of a range. */
export const remarksOnCoverage = (line: string) =>
  hasExclusionPhrase(plain(line)) ||
  joinedTokens(line).some((t) => joinedSentenceWord(t, countsAsNegation)) ||
  // "NotSupported": the negation and the coverage word in one word.
  wordsOf(line).some((w) => isRunTogetherNegation(w.toLowerCase())) ||
  (hasNegation(line) && wordsOf(line).some((w) => isCoverageWord(w.toLowerCase())));
/** The word is one model number ("RX420", "2080-LC20-20QBB", "RX420-U"). */
const isWholeNumber = (word: string) => modelNumbersIn(word).length === 1;
const hasTitleNoun = (line: string) => wordsOf(line).some((w) => TITLE_NOUNS.has(w.toLowerCase()));

/**
 * The line itself reads as a title (rule 1). Exported for its own tests.
 *
 * Two questions are put to a cover, and they fail safe in opposite directions:
 *   - "is this manual shown to be for the number that was ASKED?" (coverageOf).
 *     A miss refuses. That reading is `strict`: any sentence word inside a
 *     joined word counts ("see-RX430"), and the lines around the title are read
 *     for an exclusion too (declaresAsTitle).
 *   - "does this cover DECLARE a product?" (coverDeclaredNumbers), asked when
 *     the notebook is set up for a machine. A miss there lets another product's
 *     manual answer, so that reading is the one it had before review round 2
 *     on #5389 (but for curly and angle brackets, stripped in both readings:
 *     see hasSentenceWord). A draft that read joined negations and exclusion
 *     phrases there too was withdrawn: covers stopped declaring their own
 *     product ("Version N/A" above the title, "Do-It-Yourself" below it).
 *
 * Neither reading asks that every word be a known title word. That was tried
 * for bracketed notes, tails, labels and trailing words and withdrawn: it
 * refused ordinary covers ("(EN)", "(CE)", "Manual del usuario", a catalog
 * number before the product name). An exclusion is recognised by a listed word,
 * phrase or mark; see "Known limits".
 */
export function isTitleLine(input: string, strict = true): boolean {
  const line = plain(input);
  // A sentence end, or a second sentence, on the line.
  if (/[.!?]\s*$/.test(line) || /[.!?;]\s/.test(line)) return false;
  if (hasSentenceWord(line, strict)) return false;
  // A colon or a dash after the number (or on it: "RX420:") either finishes
  // the title ("RX410 - Hardware User Guide", "RX420 Drive Manual – English")
  // or starts a remark about the number ("RX420: NF0000022"). What follows
  // must name no other number and the line must carry a product or document noun.
  let numberSeen = false;
  const raws = line.split(/[\s,/]+/);
  for (let i = 0; i < raws.length; i++) {
    const isNumber = isWholeNumber(strip(raws[i]));
    if ((numberSeen || isNumber) && (raws[i].includes(":") || /^[—–-]+$/.test(raws[i]))) {
      const tail = raws.slice(i + 1).join(" ");
      return modelNumbersIn(tail).length === 0 && hasTitleNoun(line);
    }
    numberSeen ||= isNumber;
  }
  return true;
}

const PREDICATE_WORDS = new Set(
  ("is are was were be been being does do did has have had will would can cannot could may might must should " +
    "shall not no non never none neither nor without except unless").split(" "),
);
const POINTER_WORDS = new Set(["see", "refer", "consult", "use"]);
/** The line below carries on the sentence of the line above it. */
function continuesSentence(below: string): boolean {
  const words = wordsOf(below);
  const first = (words[0] ?? "").toLowerCase();
  // A wrapped sentence starts with an ordinary lower-case word ("is not …",
  // "and accessories …"). A brand that starts small ("iC7 Series") is not one,
  // nor is a web address ("http://…" sits under the catalog list on a real cover).
  if (/^[a-z]+$/.test(words[0] ?? "") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(below.trim())) return true;
  // "CAN Interface Module" is a part, "Can be found in …" is a sentence.
  const acronym = (words[0] ?? "") === "CAN" && /[a-z]/.test(below);
  if ((PREDICATE_WORDS.has(first) && !isMonthMay(words, 0) && !acronym && !isNotationNoun(words, 0)) || isExclusionWord(first)) return true;
  return POINTER_WORDS.has(first) && modelNumbersIn(below).length === 0;
}

const HEADING_REACH = 6;
// The lines the product itself writes at the top of a photo document. A typed
// file may open like one; its cover is then read as if the line were not there.
const isProductLine = (l: string) => {
  const t = l.trim();
  return t.startsWith(PHOTO_OCR_OPENER_START) || [PHOTO_READING_OPENER, PHOTO_READING_BODY_MARK, NAMEPLATE_OPENER, NAMEPLATE_BODY_MARK].includes(t);
};
/** Rules 1–3 for the line at `at` (which may run on to `end` when a list wraps). `strict`: see isTitleLine. */
function declaresAsTitle(lines: string[], at: number, end: number, line: string, inFamily: (n: ModelNumber) => boolean, strict: boolean): boolean {
  if (!isTitleLine(line, strict)) return false;
  const above = lines.slice(0, at).reverse().find((l) => l.trim());
  const below = lines.slice(end + 1).find((l) => l.trim());
  // Rule 2. Above: any sentence word makes the number its object ("Not covered:\nRX420 …").
  // Below: a line that carries on the sentence — it starts in lower case, with
  // a verb or a negation ("RX420 Logic Controller\nIs not covered …"), with an
  // exclusion word, or with a pointer that names no number of its own ("See the
  // separate manual"). A heading ("Related Publications") or a remark with its
  // own subject ("For the RX420 see publication …") is a new line, not a continuation.
  if (above && hasSentenceWord(above, strict)) return false;
  if (below && continuesSentence(below)) return false;
  if (strict) {
    // A heading that ends in a colon and says what is left out governs the lines
    // under it ("Not covered in this guide:\nHardware\nRX420 Logic Controller"):
    // the nearest few are read.
    const endsInColon = (l: string) => /:\s*$/.test(plain(l)) && !isProductLine(l);
    if (lines.slice(0, at).filter((l) => l.trim()).slice(-HEADING_REACH).some((l) => endsInColon(l) && hasNegation(l))) return false;
    // A word broken across two lines ("… Controller unsup-\nported", "… ex-\ncluding RX420") is read whole.
    // The look-behind starts the match at the start of the run of letters only:
    // without it a long run with no hyphen was scanned once per letter.
    const broken = (upper: string | undefined, lower: string | undefined) => {
      const head = /(?<!\p{L})(\p{L}+)[-‐‑]\s*$/u.exec(plain(upper ?? ""))?.[1];
      const rest = /^\s*(\p{L}+)/u.exec(plain(lower ?? ""))?.[1];
      return head !== undefined && rest !== undefined && countsAsSentence(`${head}${rest}`.toLowerCase());
    };
    if (broken(above, line) || broken(line, below)) return false;
    // A remark on coverage anywhere on the line below is about the model above
    // it ("RX420 Logic Controller\nThis controller is not covered") — unless
    // that line names a different number: then it is about that one ("RX410
    // Drive User Manual\nRX420 Drive is sold separately").
    if (below && remarksOnCoverage(below)) {
      const mine = new Set(coverNumbersIn(line).map((n) => n.key));
      const theirs = coverNumbersIn(below);
      if (theirs.length === 0 || theirs.some((n) => mine.has(n.key))) return false;
    }
  }
  // Rule 3. A line of nothing but this family's numbers is a model list. A model
  // next to an unrelated number ("RX420 NF0000022") is a row of a cross-reference table.
  const bare = wordsOf(line).every((w) => JOINERS.has(w.toLowerCase()) || (isWholeNumber(w) && inFamily(modelNumbersIn(w)[0])));
  // The line beside is read for its noun, not for a remark about the number: it
  // is never the strict reading, so a joined phrase on it stays a product word
  // ("RX420 Compact" above "The Do-It-Yourself Logic Controller").
  const beside = [above, below].some((l) => l && isTitleLine(l, false) && hasTitleNoun(l));
  return bare || hasTitleNoun(line) || beside;
}

/**
 * The title lines stacked directly under a cover's title, for a caller that has
 * read the title itself and asks what the cover goes on to name (manual-rag.ts:
 * a title that names only a range, "Micro800 Programmable Controllers", over
 * "Micro850 48-point Controllers User Manual").
 *
 * `declared`: the lines that `carries` says name a product AND that declare it
 * as a title: rules 1-3 in the strict reading, the same ones an asked number
 * is judged by. A wrapped list is one line. The block ends at the first line
 * that is not a title line, or that names a product without declaring it
 * ("Micro850 Controllers\nare covered in a separate manual"): what follows a
 * sentence is not the title block, however much like a title a later line looks.
 * `rest`: that line and every line after it, unread.
 *
 * A line that gives the DOCUMENT its number and names no product ("Rockwell
 * Automation Publication 2080-UM002H-EN-E - May 2020", "Supersedes Publication
 * 2080-UM002G-EN-E", "Replaces 2080-UM002G") is not part of the title block
 * and not a remark on the product beside it: it is read as if it were blank.
 * A line with no number on it, one that ends in a colon, or one that carries a
 * plain negation is never such a line.
 * Without that, the publication line every Rockwell cover carries under its
 * title made the title above it "superseded" and the block empty.
 */
export function titleLinesBelow(input: string[], carries: (line: string) => boolean): { declared: string[]; rest: string[] } {
  // Only a line that carries such a number, and only when it cannot be a
  // heading over the lines under it: "Not covered in this document:" ends in a
  // colon and carries a negation, and must stay what it is.
  const numbersTheDocument = (line: string) => {
    const numbers = modelNumbersIn(line);
    if (numbers.length === 0 || /:\s*$/.test(plain(line))) return false;
    if (wordsOf(line).some((w) => NEGATION_WORDS.has(w.toLowerCase()))) return false;
    return PUBLICATION_LINE_RE.test(line) || numbers.every(isPublicationNumber);
  };
  const lines = input.map((line) => (!carries(line) && numbersTheDocument(line) ? "" : line));
  const declared: string[] = [];
  let at = 0;
  while (at < lines.length) {
    let line = lines[at];
    let end = at;
    while (end + 1 < lines.length && DANGLING_JOIN_RE.test(line)) line += ` ${lines[++end]}`;
    if (line.trim()) {
      if (!isTitleLine(line)) break;
      if (carries(line)) {
        if (!declaresAsTitle(lines, at, end, line, () => true, true)) break;
        declared.push(line);
      }
    }
    at = end + 1;
  }
  return { declared, rest: lines.slice(at) };
}

type OneVerdict =
  | { kind: "silent" | "covers" | "coverage-not-shown" | "cover-and-file-disagree" }
  | { kind: "other-model"; declared: string[] };

const stemOf = (filename: string) => filename.replace(/\.[a-z0-9]{1,6}$/i, "");

function coverageOf(asked: ModelNumber, heading: string, filename: string, writtenAs: PhotoDocumentKind | null): OneVerdict {
  const inFamily = (n: ModelNumber) => sameFamily(n, asked);
  const isAsked = (n: ModelNumber) => n.key === asked.key;
  const familyOn = (text: string) => coverNumbersIn(text).filter(inFamily);
  // A photo reading or a confirmed nameplate THE PRODUCT WROTE: what was read
  // off the photo is the evidence, sentence or not. Its filename is the
  // product's own, too. A file that only opens like one is read by its cover.
  const read = productWrittenBody(heading, writtenAs);
  if (read !== null) {
    const carried = familyOn(read);
    if (carried.length === 0) return { kind: "silent" };
    return carried.some(isAsked) ? { kind: "covers" } : { kind: "other-model", declared: [...new Set(carried.map((c) => c.label))] };
  }
  const onFile = familyOn(stemOf(filename));
  const lines = heading.split("\n");
  // A list that wraps ("… 2080-LC20-20QBB,\n2080-LC20-20AWB, …") is one line.
  const lineAt = (at: number) => {
    let line = lines[at];
    let end = at;
    while (end + 1 < lines.length && DANGLING_JOIN_RE.test(line)) line += ` ${lines[++end]}`;
    return { line, end };
  };
  // undefined: the cover carries no number of this family. null: it carries
  // one, but not on a title line. Otherwise: what its title lines declare.
  let declared: ModelNumber[] | null | undefined;
  const first = lines.findIndex((l) => familyOn(l).length > 0);
  if (first >= 0) {
    const { line, end } = lineAt(first);
    if (!declaresAsTitle(lines, first, end, line, inFamily, true)) declared = null;
    else {
      declared = familyOn(line);
      // Models stacked one per line ("RX410 Drive\nRX420 Drive") are one list:
      // each next line counts while it is itself a title line of this family.
      // The first line that is anything else ends it ("Related Publications").
      for (let next = end + 1; next < lines.length && familyOn(lines[next]).length > 0; ) {
        const stacked = lineAt(next);
        if (!declaresAsTitle(lines, next, stacked.end, stacked.line, inFamily, true)) break;
        declared.push(...familyOn(stacked.line));
        next = stacked.end + 1;
      }
    }
  }
  if (declared === undefined) {
    if (onFile.length === 0) return { kind: "silent" };
    // A filename is evidence, never a declaration: nothing is published from it.
    return onFile.some(isAsked) ? { kind: "covers" } : { kind: "other-model", declared: [] };
  }
  if (declared === null) return { kind: "coverage-not-shown" };
  const cover = declared;
  if (onFile.length > 0 && !onFile.some((f) => cover.some((c) => c.key === f.key))) return { kind: "cover-and-file-disagree" };
  return cover.some(isAsked) ? { kind: "covers" } : { kind: "other-model", declared: [...new Set(cover.map((c) => c.label))] };
}

/** May this manual answer a question (or a notebook) that names these numbers?
 *  Every asked number must be either unknown to this manual (nothing like it on
 *  the cover or filename) or shown to be covered. One number that is not shown
 *  refuses the manual, whatever else the question names.
 *
 *  `writtenAs`: what the upload records say the product wrote this document as
 *  (a photo reading, a confirmed nameplate, a photo's OCR text). Leave it out
 *  for anything they do not vouch for; it is then judged by its cover. */
export function manualAnswersFor(asked: ModelNumber[], heading: string, filename: string, writtenAs: PhotoDocumentKind | null = null): ManualVerdict {
  const failed: Array<{ number: ModelNumber; verdict: OneVerdict }> = [];
  for (const number of asked) {
    const verdict = coverageOf(number, heading, filename, writtenAs);
    if (verdict.kind !== "silent" && verdict.kind !== "covers") failed.push({ number, verdict });
  }
  if (failed.length === 0) return { admit: true };
  const first = failed[0].verdict;
  const declared = failed.flatMap((f) => (f.verdict.kind === "other-model" ? f.verdict.declared : []));
  // Two look-alikes in one question ("the RX420 replaced an RX410 …"): the
  // manual is refused unless it is shown to cover both, and the reply says so.
  const pair = asked.some((a) => asked.some((b) => lookAlike(a, b)));
  const kind: UnlistedRefusalKind = pair
    ? "several-look-alikes"
    : first.kind === "other-model"
      ? declared.length > 0 ? "other-model" : "coverage-not-shown"
      : (first.kind as UnlistedRefusalKind);
  return {
    admit: false,
    kind,
    asked: (pair ? asked : failed.map((f) => f.number)).map((n) => n.label),
    declared: [...new Set(declared)],
    ...(productWrittenBody(heading, writtenAs) !== null ? { reading: true as const } : {}),
  };
}

/** Does this manual's cover or filename show it covers this one number? */
export function manualCoversNumber(number: ModelNumber, heading: string, filename: string, writtenAs: PhotoDocumentKind | null = null): boolean {
  return coverageOf(number, heading, filename, writtenAs).kind === "covers";
}

// A cover line that gives the DOCUMENT its number, not the product.
const PUBLICATION_LINE_RE = /\b(?:publication|pub|document|doc|literature|drawing|dwg|rev|revision|edition|version|issue)\b/i;
// A publication-type group ("2080-IN009C", "520-UM001") or a long serial of digits ("NF0000021").
const PUBLICATION_PART_RE = /^(?:UM|IN|RM|QS|TD|PM|AT|SG|WD|IM|QR|AP|PP|BR|SR|TG|RN|PC)\d{3,4}[A-Z]?$/;
const isPublicationNumber = (n: ModelNumber) => n.label.split("-").some((part) => PUBLICATION_PART_RE.test(part)) || /\d{6,}/.test(n.key);

/**
 * The model or catalog numbers a cover DECLARES as its own product, when no
 * number was asked: "is this manual for some other product than the project's
 * machine?" (an attached manual is not automatically an applicable one).
 *
 * Read the way coverageOf reads an asked number, and no further:
 *   - only numbers model-token.ts does not read (it reads its own families,
 *     and the caller compares those with the existing identity check);
 *   - only the FIRST cover line that carries one decides, with the lines
 *     stacked directly under it; a rating table or a "related publications"
 *     list further down is never read ("AC-15", "C300, R150");
 *   - that line must be a title (declaresAsTitle, not strict: see
 *     isTitleLine); prose declares nothing. A joined negation is not read
 *     here: "RX420 (not-covered)" declares RX420, as it did before;
 *   - a publication or document number is not a product: a line labelled as
 *     one, a publication-type group, or six digits in a row.
 * A photo reading the product wrote has no cover and declares nothing (a file
 * that only opens like one is an upload, and its cover is read). The filename is never a
 * declaration. Every miss here fails toward "declares nothing", which is what
 * the product did before this rule existed — and which lets the manual answer
 * in a notebook set up for another machine. That is why this reading is not the
 * strict one: the lines around the title are not read for an exclusion here.
 */
export function coverDeclaredNumbers(heading: string, writtenAs: PhotoDocumentKind | null = null): ModelNumber[] {
  if (productWrittenBody(heading, writtenAs) !== null) return [];
  const lines = heading.split("\n");
  const lineAt = (at: number) => {
    let line = lines[at];
    let end = at;
    while (end + 1 < lines.length && DANGLING_JOIN_RE.test(line)) line += ` ${lines[++end]}`;
    return { line, end };
  };
  const own = (line: string) =>
    PUBLICATION_LINE_RE.test(line) ? [] : unlistedModelNumbers(line).filter((n) => !isPublicationNumber(n));
  const first = lines.findIndex((l) => own(l).length > 0);
  if (first < 0) return [];
  const declared: ModelNumber[] = [];
  for (let at = first; at < lines.length; ) {
    const { line, end } = lineAt(at);
    const numbers = own(line);
    if (numbers.length === 0 || !declaresAsTitle(lines, at, end, line, (n) => numbers.some((m) => m.key === n.key), false)) break;
    declared.push(...numbers);
    at = end + 1;
  }
  const seen = new Set<string>();
  return declared.filter((n) => !seen.has(n.key) && seen.add(n.key));
}

/** #5369 follow-up: every selected manual's cover declares a product that is
 *  not the project's confirmed machine, and the question named no model. */
export type OtherProductRefusal = {
  /** What the covers declare (model or catalog number labels only). */
  declared: string[];
  /** The project's confirmed machine, as recorded. */
  project: string;
};

/** Static text plus labels only; nothing from a refused manual's pages. */
export function otherProductRefusalText(r: OtherProductRefusal): string {
  const have = listed(r.declared);
  return `The manual in this notebook is for the ${have}, and this notebook is set up for the ${r.project}, so I won't answer from it — its values may not apply to the ${r.project}. If your question is about the ${have}, name it in the question and ask again. Otherwise add the ${r.project} manual (or the page that covers it) to this notebook.`;
}

/** One reason for the whole reply, from the refusal of every selected manual. */
export function summarizeUnlistedRefusals(
  refusals: Array<Extract<ManualVerdict, { admit: false }>>,
  source: UnlistedModelRefusal["source"],
): UnlistedModelRefusal {
  const kinds = new Set(refusals.map((r) => r.kind));
  // Manuals refused for different reasons share only the weakest claim.
  const kind: UnlistedRefusalKind = kinds.size === 1 ? refusals[0].kind : kinds.has("several-look-alikes") ? "several-look-alikes" : "coverage-not-shown";
  return {
    kind,
    asked: [...new Set(refusals.flatMap((r) => r.asked))],
    declared: kind === "other-model" ? [...new Set(refusals.flatMap((r) => r.declared))] : [],
    source,
    ...(refusals.every((r) => r.reading) ? { reading: true as const } : {}),
  };
}

/** The way out when the subject was carried from an earlier question. */
export const EARLIER_SUBJECT_WAY_OUT =
  "If this question is about a different machine, name its model in the question or start a new chat.";

const listed = (labels: string[]) => (labels.length > 6 ? `${labels.slice(0, 6).join(" / ")} and others` : labels.join(" / "));

/** Static text plus model-number labels only: no value, page or wording from a
 *  refused manual reaches it (the rule namedModelMismatchText already follows). */
export function unlistedModelRefusalText(r: UnlistedModelRefusal): string {
  const asked = listed(r.asked);
  const whose =
    r.source === "notebook" ? "this notebook is set up for"
    : r.source === "conversation" ? "you asked about earlier in this conversation"
    : "you asked about";
  const add =
    r.source === "conversation"
      ? `${EARLIER_SUBJECT_WAY_OUT} Otherwise add the ${asked} manual (or the page that covers it) to this notebook and ask again.`
      : `Add the ${asked} manual (or the page that covers it) to this notebook and ask again.`;
  switch (r.kind) {
    case "other-model":
      if (r.reading)
        return `The photo reading saved in this notebook shows the ${listed(r.declared)}, not the ${asked} ${whose}, so I won't answer from it — its values may not apply to the ${asked}. ${add}`;
      return `The manual in this notebook is for the ${listed(r.declared)}, not the ${asked} ${whose}, so I won't answer from it — its values may not apply to the ${asked}. ${add}`;
    case "cover-and-file-disagree":
      return `The manual in this notebook has a cover and a file name that point at different models, so I can't confirm it covers the ${asked} ${whose}, and I won't answer from it. Check that the right file is attached, or add the ${asked} manual, and ask again.`;
    case "several-look-alikes":
      return `You named the ${r.asked.join(" and the ")}. They are different models, and no manual in this notebook is shown to cover all of them, so I won't answer from one model's manual for another. Ask about one model at a time.`;
    default:
      return `I can't confirm that the manual in this notebook covers the ${asked} ${whose}. A similar model number appears on its cover or in its file name, but nothing there shows the manual is for the ${asked}, so I won't answer from it. ${add}`;
  }
}
