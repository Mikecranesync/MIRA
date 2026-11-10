import { modelMentionsInText } from "./model-token";

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
 *   - the filename counts only when the cover carries no such number at all,
 *     and a cover and a filename that name different look-alikes disagree.
 * No model call, no database call. Pure.
 *
 * Known limits:
 *   - WRONG-ADMIT residual: a note with no sentence word, no listed exclusion
 *     word and a title noun beside it reads as a title ("RX420 Guide NF22" on
 *     a sibling's cover, or a second title stacked directly under the first
 *     with no heading between). No finite word list closes this; the lists
 *     fail toward refusing wherever a sentence is recognisable;
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
 *   - a cover that names exactly one model, as a title, is trusted.
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
  /** Whether the number came from the question or from the notebook's confirmed machine. */
  source: "question" | "notebook";
};

export type ManualVerdict = { admit: true } | { admit: false; kind: UnlistedRefusalKind; asked: string[]; declared: string[] };

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

/** The model numbers a text names that model-token.ts does NOT read. Whatever
 *  the detector reads is left to the existing check, whole: "GS11N-20P2" must
 *  not come back as a leftover "20P2". */
export function unlistedModelNumbers(text: string): ModelNumber[] {
  const chars = [...text];
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

// An abbreviation's full stop is not the end of a sentence, and "No." is a
// label, not a negation: "Model No. RX420", "Cat. No.", "Rev. 3", "Corp.".
const plain = (line: string) =>
  line
    .replace(/\b(?:no|nr)\.(?=\s|$)/gi, "number")
    .replace(/\b(rev|cat|corp|inc|ltd|co|vol|ver|ed|pub|doc|mfg|art|ref|fig|mod|dept|div)\.(?=\s|$)/gi, "$1");
const strip = (word: string) => word.replace(/^[("'[]+|[)"'\]:;.!?]+$/g, "");
const wordsOf = (line: string) => plain(line).split(/[\s,/]+/).map(strip).filter(Boolean);
const isExclusionWord = (lower: string) => EXCLUSION_WORDS.has(lower) || EXCLUSION_STEMS.some((stem) => lower.startsWith(stem));
const isSentenceWord = (word: string): boolean => {
  const lower = word.toLowerCase().replace(/[’']s$/, "");
  if (SENTENCE_WORDS.has(lower) || isExclusionWord(lower)) return true;
  // "not-RX420": a word hyphenated to a model number is read by its parts.
  return word.includes("-") && modelNumbersIn(word).length > 0 && word.split("-").some((part) => part !== word && isSentenceWord(part));
};
// "May 2021", "12 May 2021", "May 12, 2021": the month, not the verb.
const isMonthMay = (words: string[], i: number) => words[i].toLowerCase() === "may" && /^(?:\d{1,2}|(?:19|20)\d{2})$/.test(words[i + 1] ?? "");
const sentenceWordAt = (words: string[], i: number) => isSentenceWord(words[i]) && !isMonthMay(words, i);
const hasSentenceWord = (line: string) => {
  const words = wordsOf(line);
  return /\bw\/o\b/i.test(line) || words.some((_, i) => sentenceWordAt(words, i));
};
/** The word is one model number ("RX420", "2080-LC20-20QBB", "RX420-U"). */
const isWholeNumber = (word: string) => modelNumbersIn(word).length === 1;
const hasTitleNoun = (line: string) => wordsOf(line).some((w) => TITLE_NOUNS.has(w.toLowerCase()));

/** The line itself reads as a title (rule 1). Exported for its own tests. */
export function isTitleLine(input: string): boolean {
  const line = plain(input);
  // A sentence end, or a second sentence, on the line.
  if (/[.!?]\s*$/.test(line) || /[.!?;]\s/.test(line)) return false;
  if (hasSentenceWord(line)) return false;
  // A colon or a dash after the number (or on it: "RX420:") either finishes
  // the title ("RX410 - Hardware User Guide", "RX420 Drive Manual – English")
  // or starts a remark about the number ("RX420: NF0000022"). A remark points
  // at another number, or leaves the line with no product or document noun.
  // Before the number a colon is a label ("Catalog Numbers:").
  let numberSeen = false;
  const raws = line.split(/[\s,/]+/);
  for (let i = 0; i < raws.length; i++) {
    const isNumber = isWholeNumber(strip(raws[i]));
    if ((numberSeen || isNumber) && (raws[i].includes(":") || /^[—–-]+$/.test(raws[i]))) {
      return modelNumbersIn(raws.slice(i + 1).join(" ")).length === 0 && hasTitleNoun(line);
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
  // "and accessories …"). A brand that starts small ("iC7 Series") is not one.
  if (/^[a-z]+$/.test(words[0] ?? "")) return true;
  // "CAN Interface Module" is a part, "Can be found in …" is a sentence.
  const acronym = (words[0] ?? "") === "CAN" && /[a-z]/.test(below);
  if ((PREDICATE_WORDS.has(first) && !isMonthMay(words, 0) && !acronym) || isExclusionWord(first)) return true;
  return POINTER_WORDS.has(first) && modelNumbersIn(below).length === 0;
}

/** Rules 1–3 for the line at `at` (which may run on to `end` when a list wraps). */
function declaresAsTitle(lines: string[], at: number, end: number, line: string, inFamily: (n: ModelNumber) => boolean): boolean {
  if (!isTitleLine(line)) return false;
  const above = lines.slice(0, at).reverse().find((l) => l.trim());
  const below = lines.slice(end + 1).find((l) => l.trim());
  // Rule 2. Above: any sentence word makes the number its object ("Not covered:\nRX420 …").
  // Below: a line that carries on the sentence — it starts in lower case, with
  // a verb or a negation ("RX420 Logic Controller\nIs not covered …"), with an
  // exclusion word, or with a pointer that names no number of its own ("See the
  // separate manual"). A heading ("Related Publications") or a remark with its
  // own subject ("For the RX420 see publication …") is a new line, not a continuation.
  if (above && hasSentenceWord(above)) return false;
  if (below && continuesSentence(below)) return false;
  // Rule 3. A line of nothing but this family's numbers is a model list. A model
  // next to an unrelated number ("RX420 NF0000022") is a row of a cross-reference table.
  const bare = wordsOf(line).every((w) => JOINERS.has(w.toLowerCase()) || (isWholeNumber(w) && inFamily(modelNumbersIn(w)[0])));
  const beside = [above, below].some((l) => l && isTitleLine(l) && hasTitleNoun(l));
  return bare || hasTitleNoun(line) || beside;
}

type OneVerdict =
  | { kind: "silent" | "covers" | "coverage-not-shown" | "cover-and-file-disagree" }
  | { kind: "other-model"; declared: string[] };

const stemOf = (filename: string) => filename.replace(/\.[a-z0-9]{1,6}$/i, "");

function coverageOf(asked: ModelNumber, heading: string, filename: string): OneVerdict {
  const inFamily = (n: ModelNumber) => sameFamily(n, asked);
  const isAsked = (n: ModelNumber) => n.key === asked.key;
  const familyOn = (text: string) => coverNumbersIn(text).filter(inFamily);
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
    if (!declaresAsTitle(lines, first, end, line, inFamily)) declared = null;
    else {
      declared = familyOn(line);
      // Models stacked one per line ("RX410 Drive\nRX420 Drive") are one list:
      // each next line counts while it is itself a title line of this family.
      // The first line that is anything else ends it ("Related Publications").
      for (let next = end + 1; next < lines.length && familyOn(lines[next]).length > 0; ) {
        const stacked = lineAt(next);
        if (!declaresAsTitle(lines, next, stacked.end, stacked.line, inFamily)) break;
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
 *  refuses the manual, whatever else the question names. */
export function manualAnswersFor(asked: ModelNumber[], heading: string, filename: string): ManualVerdict {
  const failed: Array<{ number: ModelNumber; verdict: OneVerdict }> = [];
  for (const number of asked) {
    const verdict = coverageOf(number, heading, filename);
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
  return { admit: false, kind, asked: (pair ? asked : failed.map((f) => f.number)).map((n) => n.label), declared: [...new Set(declared)] };
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
  };
}

const listed = (labels: string[]) => (labels.length > 6 ? `${labels.slice(0, 6).join(" / ")} and others` : labels.join(" / "));

/** Static text plus model-number labels only: no value, page or wording from a
 *  refused manual reaches it (the rule namedModelMismatchText already follows). */
export function unlistedModelRefusalText(r: UnlistedModelRefusal): string {
  const asked = listed(r.asked);
  const whose = r.source === "notebook" ? "this notebook is set up for" : "you asked about";
  const add = `Add the ${asked} manual (or the page that covers it) to this notebook and ask again.`;
  switch (r.kind) {
    case "other-model":
      return `The manual in this notebook is for the ${listed(r.declared)}, not the ${asked} ${whose}, so I won't answer from it — its values may not apply to the ${asked}. ${add}`;
    case "cover-and-file-disagree":
      return `The manual in this notebook has a cover and a file name that point at different models, so I can't confirm it covers the ${asked} ${whose}, and I won't answer from it. Check that the right file is attached, or add the ${asked} manual, and ask again.`;
    case "several-look-alikes":
      return `You named the ${r.asked.join(" and the ")}. They are different models, and no manual in this notebook is shown to cover all of them, so I won't answer from one model's manual for another. Ask about one model at a time.`;
    default:
      return `I can't confirm that the manual in this notebook covers the ${asked} ${whose}. A similar model number appears on its cover or in its file name, but nothing there shows the manual is for the ${asked}, so I won't answer from it. ${add}`;
  }
}
