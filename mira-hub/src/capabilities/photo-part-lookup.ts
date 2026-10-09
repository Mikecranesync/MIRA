/**
 * Narrow photo-part guards for unconfirmed label readings. A LOOK transcription
 * is useful search input, but is not proof of a device class or compatibility.
 */
const PART_CODE = /\b(?=[A-Z0-9/-]{8,}\b)(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9]+(?:[-/][A-Z0-9]+){1,4}\b/gi;

// A serial label is the label TOKEN plus any run of NON-ALPHANUMERIC characters
// — never an enumerated punctuation list (Codex #4172 post-cap 7–10: ":",
// "-", "/", "—", "(" each slipped past a list in turn). The full words
// (serial — even OCR-split "Ser ial" — and S/N with ANY non-alphanumeric run
// between S and N: S.N., S / N, S-N, S⁄N, S.No.) are labels wherever they appear; the abbreviations
// (SER, Sr) only in a label shape — a number word (No/Nr/Num/Number/N°/№) or "#", a digit-bearing
// code after the separators, a "(SER)" suffix, or a bare suffix after a value
// — so "series", "service", "server", "snap" and a plain "Sr." never match.
const LABEL_SEP = String.raw`[^A-Za-z0-9]*`;
// The "number" word of a compound label, in any common spelling or language:
// No, Nr, Num, Number, Numero, Nummer, Nmbr, N°, №.
const NUM_WORD = String.raw`(?:n(?:o|r|um(?:ber|ero|mer)?|mbr|br)|n[\u00b0\u00ba]|\u2116)`;
const SERIAL_LABEL = new RegExp(
  // The number word may be JOINED to the token ("SerialNumber", "SerNo"): it is
  // tried before the no-letter-follows check, so a joined form is a label while
  // "serials" or "series" (no number word, a letter follows) is not.
  String.raw`\b(?:(?:s\s?e\s?r\s?i\s?a\s?l|s[^A-Za-z0-9]*n(?:o|r|um(?:ber|ero|mer)?|mbr|br)?)(?:${LABEL_SEP}${NUM_WORD})?\.?(?![a-z])(?:${LABEL_SEP}#)?` +
    String.raw`|(?:ser|sr)(?:${LABEL_SEP}${NUM_WORD}\.?(?![a-z])|(?![a-z])(?:${LABEL_SEP}#|\.?(?=\s*[)\]])` +
    String.raw`|${LABEL_SEP}(?=(?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]{3,}(?![A-Z0-9]))))` +
    // A suffix label after the value ("AB-1234567 SER.", "AB-1234567 SR, 24VDC"):
    // a digit-bearing code, separators, the abbreviation, then the end of the
    // text, a line break, or a non-alphanumeric character other than "." —
    // never a following word ("… ser. valve body" is prose).
    String.raw`|(?<=\d[A-Z0-9./-]*[^A-Za-z0-9]+)(?:ser|sr)\.?(?=\s*(?:$|[\r\n]|[^A-Za-z0-9\s.])))`,
  "gi",
);
// A customer-assigned identifier (ADR-0036: never sent to search). Presence
// is the whole rule, like a serial label. The strong words (asset, fixed asset,
// inventory, inv, CMMS, SAP, work order, WO) are labels wherever they appear as a
// whole word ("assets" is not). "tag" and the weak words that are ordinary
// prose on their own (equipment, unit, machine, location, site, plant, area,
// line, cell) count only in a label shape: with an id word (tag, id,
// identifier, ident, ref, number word, #), straight before a digit-bearing
// code, or — for "tag" — as a suffix right after such a code.
const ID_WORD = String.raw`(?:tag|ident(?:ifier)?|id|ref(?:erence)?|${NUM_WORD}|#)`;
const CODE_AHEAD = String.raw`(?=(?:is\b)?[^A-Za-z0-9]*(?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]{3,}(?![A-Z0-9]))`;
const ASSET_LABEL = new RegExp(
  String.raw`\b(?:(?:fixed\s*asset|asset|inventory|inv|cmms|sap|work\s*order|wo)(?![a-z])` +
    String.raw`|(?:tag|equip(?:ment)?|unit|machine|location|loc|site|plant|area|line|cell)(?![a-z])${LABEL_SEP}(?:${ID_WORD}(?![a-z])|${CODE_AHEAD})` +
    String.raw`|(?<=\d[A-Z0-9./-]*[^A-Za-z0-9]+)tag(?![a-z]))`,
  "gi",
);

const PART_LABEL = /\b(?:P\/?N|part\s*(?:no\.?|number)|catalog(?:ue)?\s*(?:no\.?|number)|1P)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{5,})/gi;
/** A trailing "." / "-" / "/" is sentence punctuation, not part of the code (#4150 F4). */
const trimCode = (code: string) => code.replace(/[./-]+$/, "");
/** Quotes are label punctuation, never identifier characters (#4150 F1/F4); invisible
 *  characters (soft hyphen, zero-width, BOM) are nothing at all, so "Ser\u00adial" is
 *  still "Serial" (#4172). */
const normalize = (t: string) => t.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "").replace(/["'\u2018\u2019\u201c\u201d`]/g, " ");

/**
 * Every distinct, serial-safe part code in the text (#4172: exported so a caller
 * can tell "no code" from "several codes", which unambiguousPartNumber() folds
 * into the same null).
 */
export function partCodes(photoText: string): string[] {
  const text = normalize(photoText);
  // A serial number must never be sent to web search (ADR-0036). Fail closed
  // (#4150 r2 F1): every code-shaped token within reach of a serial label is a
  // serial, whatever the separator ("S/N = …", "Serial number is …", "(…)").
  const serials = new Set<string>();
  for (const m of text.matchAll(SERIAL_LABEL)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    // The value directly after the label ("S/N = X", "Serial number is X", "(X)").
    const code = after.match(/^[^A-Za-z0-9]*(?:is\b)?\s*([A-Z0-9][A-Z0-9./-]{3,})/i);
    if (code) serials.add(trimCode(code[1]).toUpperCase());
    // A suffix label marks the code just before it: "AB-1234567 (S/N)" — or,
    // when NO value follows the label, a bare "AB-1234567 SER." (never when a
    // value does follow: "SY3120-5LZD Serial AB-1234567" keeps its model).
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    const prior = before.match(/([A-Z0-9][A-Z0-9./-]{3,})\s*[(\[]\s*$/i) ?? (code ? null : before.match(/([A-Z0-9][A-Z0-9./-]{3,})[^A-Za-z0-9]+$/i));
    if (prior) serials.add(trimCode(prior[1]).toUpperCase());
  }
  const labelled = [...text.matchAll(PART_LABEL)].map((m) => trimCode(m[1]));
  // Any serial label on the photo means only an explicitly labelled part number
  // is safe, even when the serial's value could not be parsed ("AB-1234567 S/N",
  // "AB-1234567 serial number") — #4150 review r4 F1. A customer-assigned
  // identifier label (asset tag, unit id, …) is the same signal (F14, ADR-0036).
  const serialLabelPresent =
    serials.size > 0 || new RegExp(SERIAL_LABEL.source, "i").test(text) || new RegExp(ASSET_LABEL.source, "i").test(text);
  // Vision descriptions such as "RJ45-style" are prose, not printed codes.
  // An explicit P/N label remains a candidate, even with that suffix.
  const unlabelled = serialLabelPresent ? [] : [...text.matchAll(PART_CODE)]
    .map((m) => trimCode(m[0]))
    .filter((code) => !/-(?:style|like|shaped)$/i.test(code));
  const found = [...unlabelled, ...labelled]
    .filter((code) => !serials.has(code.toUpperCase()))
    .filter((code) => !/^X00[A-Z0-9]{7}$/i.test(code))
    .filter((code) => !/^\d+(?:\.\d+)?(?:\s*(?:-|to|\/)\s*\d+(?:\.\d+)?)?\s*(?:VAC|VDC|V|A|HZ|KHZ|W|KW|KVA|MA)$/i.test(code));
  return [...new Map(found.map((code) => [code.toUpperCase(), code])).values()];
}

export function unambiguousPartNumber(photoText: string): string | null {
  const codes = partCodes(photoText);
  return codes.length === 1 ? codes[0] : null;
}

/**
 * Does this text carry a serial-number label anywhere (#4172 Codex r3 F6)? Any
 * identity bound for search egress from such text must be the explicitly
 * labelled part number that unambiguousPartNumber() returns — never a value
 * another parser (the OEM retrieval model reader) picked out (ADR-0036).
 */
export function mentionsAssetLabel(text: string): boolean {
  return new RegExp(ASSET_LABEL.source, "i").test(normalize(text));
}

export function mentionsSerialLabel(text: string): boolean {
  return new RegExp(SERIAL_LABEL.source, "i").test(normalize(text));
}

const LOOKUP_VERB = String.raw`(?:find|look\s+up|search(?:\s+for)?|locate|get|download)`;
const DOC_WORD = String.raw`(?:manual|data\s*sheet|datasheet|pdf)`;
/** A request addressed to MIRA: the sentence OPENS with the lookup verb, optionally
 *  after "please" or "can/could/would/will you". */
const ADDRESSED_REQUEST = new RegExp(
  String.raw`^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?${LOOKUP_VERB}\b[^.?!]{0,80}\b${DOC_WORD}\b`,
  "i",
);
/** Anything that withdraws, negates, defers or merely describes a lookup. Checked
 *  over the WHOLE message: ambiguity never authorizes egress (#4150 r2 F2). */
const NOT_A_REQUEST =
  /(?:\b(?:no|not|never|stop|cancel\w*|actually|without|before|myself|later|tomorrow|local(?:ly)?|offline|how\s+(?:to|do|would|can))\b|n't\b|\bdont\b)/i;

/** Only an unambiguous, affirmative request to MIRA authorizes a manual search. */
export function explicitManualLookupRequest(question: string): boolean {
  // Quoted text is something the technician is reading out, not an instruction.
  const unquoted = question.replace(/["\u201c\u201d][^"\u201c\u201d]*["\u201c\u201d]/g, " ");
  if (NOT_A_REQUEST.test(unquoted)) return false;
  return unquoted
    .split(/(?<=[.?!])\s+|\n+/)
    .some((sentence) => ADDRESSED_REQUEST.test(sentence.trim()));
}

export function asksPartCompatibility(question: string): boolean {
  if (/\b(?:substitute|replacement|interchange(?:able)?|compatible|drop\s*in|replace)\b/i.test(question)) return true;
  // A state report cannot erase a suitability request elsewhere in the turn.
  // Check the whole turn before evaluating individual observed comparisons;
  // component subjects and passive verbs carry the same intent as I/we/you.
  if (/\binstead\s+of\b/i.test(question)
    && (/\b(?:can|could|would|will|may|should|does|do)\b[^.!?]{0,100}\b(?:use(?:d)?|install(?:ed)?|fit(?:ted)?|swap(?:ped)?|connect(?:ed)?|put|work|function|operate|run|recommend)\b/i.test(question)
      || /\b(?:am|is|are|would|will)\b[^.!?]{0,100}\b(?:safe|allowed|ok(?:ay)?|acceptable|suitable|legal|permitted)\b/i.test(question))) return true;
  // A separate question requesting permission/suitability is not an observed
  // indication, even when its verb is outside the known installation list.
  // Keep explicit read-only diagnostic requests available; ambiguity fails closed.
  if (/\binstead\s+of\b/i.test(question) && question.split(/(?<=[.!?;,])\s+|\n+/).some(clause => {
    const text = clause.trim();
    // Any explicit question requires a recognized diagnostic interpretation;
    // permission and elliptical action requests need not use a modal prefix.
    const actionRequest = /^(?:ok(?:ay)?|safe|allowed|permitted|any\s+reason|mind\s+if|please|install|fit|swap|connect|put|run|proceed)\b/i.test(text)
      || /\b(?:want|plan|intend|going)\b[^.!?]*\b(?:use|install|fit|swap|connect|put|run|proceed)\b/i.test(text)
      || ((text.includes("?") || /^(?:am|can|could|would|will|may|should|is|are|do|does|what|which|how)\b/i.test(text))
        && /\bto\s+(?:use|install|fit|swap|connect|put|run|proceed)\b/i.test(text));
    if (actionRequest) return true;
    if (!text.includes("?") && !/^(?:am|can|could|would|will|may|should|is|are|do|does|what|which|how)\b/i.test(text)) return false;
    // Comparisons that themselves ask about an indication are checked below;
    // a separate question never inherits that observation exemption.
    if (/\binstead\s+of\b/i.test(text)) return false;
    const diagnostic = /^(?:can|could|would|will|may|should)\s+(?:i|we|you)\s+(?:please\s+)?(?:check|inspect|read|measure|observe|diagnose|troubleshoot)\b/i.test(text)
      || /^(?:do|does)\b[^.!?]*\b(?:mean|indicate|show|read)\b/i.test(text)
      || /^what\s+(?:does|is|are)\b/i.test(text)
      || /^what\s+(?:do|should|can|could)\s+(?:i|we|you)\s+(?:know|check|inspect|read|measure|observe|diagnose|troubleshoot)\b/i.test(text)
      || /^how\s+(?:do|does|can|could|should)\b[^.!?]*\b(?:check|inspect|read|interpret|measure|observe|diagnose|troubleshoot)\b/i.test(text)
      || /^which\b[^.!?]*\b(?:is|are|shows?|reads?)\b[^.!?]*\b(?:red|green|white|amber|yellow|blue|black|orange|on|off|online|offline)\b/i.test(text)
      || /^(?:is|are)\s+(?:it|they|the (?:led|indicator|display|screen))\s+(?:red|green|white|amber|yellow|blue|black|orange|on|off|online|offline)\s*[?!.]*$/i.test(text);
    return !diagnostic;
  })) return true;
  // "Instead of" also describes an observed state. Evaluate each sentence so
  // an indication report cannot erase a separate genuine substitution request.
  return question.split(/(?<=[.!?])\s+|\n+/).some((sentence) =>
    [...sentence.matchAll(/\binstead\s+of\b/gi)].some((comparison) => {
      const before = sentence.slice(0, comparison.index);
      const after = sentence.slice((comparison.index ?? 0) + comparison[0].length);
      const indication = /^\s+(?:being\s+)?(?:red|green|white|amber|yellow|blue|black|orange|on|off|online|offline|\d+(?:\.\d+)?)\s*(?:[.,;:!?]|$)/i.test(after);
      // A component noun alone does not establish an observed state.
      const observation = /\b(?:tablet|indicator|led|screen|display)\s+(?:is|was|shows?|reads?)\b/i.test(before)
        || /\bit\s+(?:shows?|reads?)\b/i.test(before)
        || /\bit(?:'s|’s|\s+(?:is|was))\s+(?:red|green|white|amber|yellow|blue|black|orange|on|off|online|offline|\d+(?:\.\d+)?)\b/i.test(before)
        || /^\s*why\s+(?:is|was)\s+(?:the\s+)?(?:tablet|indicator|led|screen|display)\s+(?:red|green|white|amber|yellow|blue|black|orange|on|off|online|offline|\d+(?:\.\d+)?)\b/i.test(before)
        || /^\s*(?:(?:(?:the\s+)?(?:gateway|seat|it)\s+(?:is|was)|it's|it’s)\s+)?(?:red|green|white|amber|yellow|blue|black|orange|on|off|online|offline|\d+(?:\.\d+)?)\s*$/i.test(before);
      // Voice input often omits sentence punctuation. A later state clause
      // ("use a handheld ... it is white") is not the object being substituted.
      const stateAt = [...before.matchAll(/\b(?:it\s+(?:is|was)|it's|it’s|(?:the\s+)?(?:tablet|indicator|led|screen|display)\s+(?:is|was|shows?|reads?))\b/gi)].at(-1)?.index ?? -1;
      const useAt = [...before.matchAll(/\b(?:use|install|fit|swap|connect|put)\b/gi)].at(-1)?.index ?? -1;
      // Proposed suitability and conditional attributes are not observed states.
      // Fail closed for ambiguous substitution questions, including color-only
      // alternatives where the component name is omitted after "instead of".
      const proposedSuitability = /\b(?:can|could|would|may|should)\b[^.!?]*\b(?:use|install|fit|work|swap|connect|put)\b/i.test(before)
        && !/\b(?:it(?:'s|’s|\s+(?:is|was))\s+[^.!?]*\bon\s+(?:the\s+)?(?:tablet|screen|display)|(?:the\s+)?(?:tablet|screen|display)\s+(?:shows?|reads?))\b/i.test(before);
      const suitabilityAttribute = /\b(?:ok|acceptable|suitable|safe|allowed|work|works)\b/i.test(before)
        || /\bif\s+it\s+(?:is|was)\b/i.test(before);
      const substitution = (useAt > stateAt && before.length - useAt <= 100)
        || proposedSuitability || suitabilityAttribute;
      return !(indication && observation && !substitution);
    }),
  );
}

// ── #4150 owner decision (2026-09-30): search only after an explicit, one-time,
// candidate-bound confirmation. A request never authorizes egress by itself; it
// can only produce a proposal that shows the EXACT string MIRA would send. The
// proposal is stored with that turn; the very next message must be the exact
// confirmation for that same string, and the photo must still yield it.

export const PART_SEARCH_PROPOSAL_KIND = "part_search_proposal";
/** The proposal binds the WHOLE identity that will be sent: the part and the
 *  maker printed with it (null when none was recognised) — #4171 Codex F4. */
export type PartSearchProposalEntry = {
  kind: typeof PART_SEARCH_PROPOSAL_KIND;
  candidate: string;
  manufacturer?: string | null;
  /** #4185/#4186: how many of the technician's own turns this offer has
   *  survived, counting the turn it was first proposed on as 1. Absent on a
   *  legacy entry, treated the same as 1. */
  age?: number;
  /** #4193 Codex round 2 F3+F6: the ORIGIN turn — the turn that first
   *  persisted this proposal. Carried UNCHANGED through every re-show copy
   *  (a re-show persists a NEW turn row with a copy of the proposal, so the
   *  turn a given copy lives on can no longer identify "this offer" once it
   *  has been re-shown even once). Claiming locks and marks consumed on THIS
   *  row — never on whichever turn happens to hold the copy being confirmed
   *  — so every copy of one logical offer shares one canonical arbiter. See
   *  `part-search-claim.ts`.
   *
   *  Absent on a proposal that predates this field — a TRUE legacy entry
   *  (round 1's `id` field, or no identity at all). Round 1's `id` is NOT an
   *  adequate substitute: it is still per-copy (round 1 minted a fresh
   *  random id on every re-show of an id-less entry, Codex F6), so it names
   *  no canonical row at all. Every caller resolves a legacy entry's origin
   *  as the turn it currently sits on, the FIRST time it is read after this
   *  fix ships — see `partSearchDecision()`. */
  originTurnId?: string;
};
/** Marker appended to the proposal's own turn when a confirmation spends it
 *  (atomically, before any search) — a proposal authorizes ONE search (F3). */
export const PART_SEARCH_CONSUMED_KIND = "part_search_proposal_consumed";
export const PART_SEARCH_CANCEL = "Don't search";

export function partSearchConfirmation(candidate: string): string {
  return `Search the web for "${candidate}"`;
}

/** The candidate named by an exact confirmation message, or null. Nothing else
 *  in the message is allowed: extra words are not a confirmation. Quotes are
 *  OPTIONAL (#4185: "search the web for X" with no quotes at all \u2014 the shape
 *  the #4160 Pixel walk incident actually typed \u2014 must still count); straight
 *  or curly quotes are accepted when present. */
export function confirmedPartSearchCandidate(message: string): string | null {
  const m = message
    .trim()
    .match(/^search the web for (?:["\u201c]([^"\u201c\u201d\n]{1,80})["\u201d]|([^"\u201c\u201d\n]{1,80}?))\.?$/i);
  return m ? (m[1] ?? m[2]) : null;
}

/** #4185/#4186: a bare affirmative right after an offer confirms it without
 *  re-typing the candidate string. Only meaningful when a proposal is
 *  actually pending (checked by the caller) \u2014 "yes" on its own is never a
 *  lookup request. */
const SHORT_AFFIRMATIVE = /^(?:yes(?:\s+search)?|search|go\s+ahead)[.!]?$/i;

export function isPartSearchProposal(entry: unknown): entry is PartSearchProposalEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as { kind?: unknown; candidate?: unknown };
  return e.kind === PART_SEARCH_PROPOSAL_KIND && typeof e.candidate === "string";
}

export type PartSearchDecision =
  | { action: "none" }
  // `originTurnId` is absent on a FRESH propose (age 1): the pure function
  // computing this decision does not yet know the new turn's own id — the
  // caller assigns it (this turn IS the origin) when persisting the proposal.
  // It is always present on a RE-SHOW (age > 1), resolved from the pending
  // entry that is being re-shown.
  | { action: "propose"; candidate: string; age: number; originTurnId?: string }
  | { action: "search"; candidate: string; originTurnId: string }
  | { action: "cancelled"; candidate: string }
  | { action: "mismatch"; candidate: string | null }
  /** #4193 Codex round 1 F2: re-showing one more time would mint an offer
   *  past `PART_SEARCH_OFFER_TURN_LIMIT` that `pendingPartSearchProposal()`
   *  can never again treat as valid — an offer the app would render as
   *  actionable (a chip, "reply exactly: ...") that the very next turn
   *  cannot confirm. The offer stops here instead: no further proposal, no
   *  chip, just a plain statement that it expired. */
  | { action: "expired"; candidate: string };

/** #4185/#4186: how many of the technician's own turns an offer stays valid
 *  for, when their reply doesn't match it. The offer is kept alive by being
 *  re-proposed on each non-matching turn (see `partSearchDecision` below), so
 *  a caller only ever needs the evidence of the single immediately-preceding
 *  turn — the age travels forward with it. */
const PART_SEARCH_OFFER_TURN_LIMIT = 3;

/** The still-valid pending proposal in `previousEvidence` — not yet consumed,
 *  and not older than `PART_SEARCH_OFFER_TURN_LIMIT` — or null. A proposal
 *  past the limit is treated exactly like no proposal at all: it cannot be
 *  confirmed, cancelled, or re-shown. Exported so a caller that re-persists a
 *  re-shown offer can read its bound manufacturer back out. */
export function pendingPartSearchProposal(previousEvidence: readonly unknown[]): PartSearchProposalEntry | null {
  const consumed = previousEvidence.some(
    (e) => typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === PART_SEARCH_CONSUMED_KIND,
  );
  const raw = consumed ? null : (previousEvidence.find(isPartSearchProposal) ?? null);
  return raw && (raw.age ?? 1) <= PART_SEARCH_OFFER_TURN_LIMIT ? raw : null;
}

/** Case-insensitive identity match — a technician confirming by typing a
 *  slightly different case ("ss5y3-duw01302") still names the same string;
 *  the string that actually leaves is always the canonical `opts.candidate`,
 *  never what was typed. */
function sameCandidate(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toUpperCase() === b.toUpperCase();
}

/** #4193 Codex round 2 F3+F6: the origin turn of a pending proposal — the
 *  canonical row every copy of this logical offer is claimed against.
 *
 *  - A round-2 proposal already carries `originTurnId` (set once when first
 *    proposed, unchanged on every re-show): use it as-is.
 *  - A TRUE legacy entry (no `originTurnId`, including a round-1 entry whose
 *    only identity was the per-copy `id` Codex F6 found inadequate) is
 *    anchored to `previousTurnId` — the turn IT CURRENTLY SITS ON. This is
 *    safe exactly because it is resolved fresh on every read: a legacy
 *    proposal is only ever "pending" on the single most-recent turn that
 *    carries it (an already-consumed or already-superseded copy is excluded
 *    by `pendingPartSearchProposal()`), so at the moment this function is
 *    called there is exactly one row to anchor to. */
function originOf(pending: PartSearchProposalEntry, previousTurnId: string | null): string | undefined {
  return pending.originTurnId ?? previousTurnId ?? undefined;
}

/**
 * Decide this turn's photo-part search. `candidate` is the part number the
 * current photo evidence yields (serial/FNSKU exclusions already applied);
 * `previousEvidence` is the evidence stored with the technician's immediately
 * preceding turn in this thread (empty when unknown — fail closed).
 * `previousTurnId` is that same turn's own id (null when unknown) — used ONLY
 * to anchor a true-legacy proposal's origin (see `originOf` above); a
 * round-2 proposal already carries its own `originTurnId`.
 */
export function partSearchDecision(opts: {
  message: string;
  candidate: string | null;
  /** The maker the current photo yields with that part (null when none). */
  manufacturer?: string | null;
  previousEvidence: readonly unknown[];
  previousTurnId?: string | null;
}): PartSearchDecision {
  const pending = pendingPartSearchProposal(opts.previousEvidence);
  const previousTurnId = opts.previousTurnId ?? null;
  const makerNow = opts.manufacturer ?? null;
  const confirmed = confirmedPartSearchCandidate(opts.message);
  // A bare affirmative only means anything when there is something pending to
  // affirm — otherwise it is not a lookup request at all (falls through below).
  const shortAffirmative = pending !== null && SHORT_AFFIRMATIVE.test(opts.message.trim());
  if (confirmed !== null || shortAffirmative) {
    // Three-way match: what was proposed, what (if anything) was typed back,
    // and what the photo yields now. Any difference means no egress.
    const matches =
      pending !== null &&
      opts.candidate !== null &&
      sameCandidate(pending.candidate, opts.candidate) &&
      (confirmed === null || sameCandidate(confirmed, opts.candidate)) &&
      (pending.manufacturer ?? null) === makerNow;
    if (!matches) return { action: "mismatch", candidate: opts.candidate };
    // `matches` is true only when `pending !== null`, so an origin always
    // resolves here (see `originOf` above) — never a bare `null`/`undefined`.
    const originTurnId = originOf(pending as PartSearchProposalEntry, previousTurnId);
    return originTurnId
      ? { action: "search", candidate: opts.candidate as string, originTurnId }
      : { action: "mismatch", candidate: opts.candidate };
  }
  if (pending && opts.message.trim().replace(/[.!]$/, "").toLowerCase() === PART_SEARCH_CANCEL.toLowerCase()) {
    return { action: "cancelled", candidate: pending.candidate };
  }
  if (opts.candidate && explicitManualLookupRequest(opts.message)) {
    // A FRESH propose: no origin yet — the caller assigns one (this turn's
    // own, about-to-be-persisted id) when it actually persists the proposal.
    return { action: "propose", candidate: opts.candidate, age: 1 };
  }
  // #4185/#4186: a reply that neither confirms, cancels, nor starts a fresh
  // lookup does not expire a pending offer — it re-shows it, aging it by one
  // turn, until PART_SEARCH_OFFER_TURN_LIMIT is reached.
  //
  // #4193 Codex round 1 F2: but NOT past the limit. `pendingPartSearchProposal()`
  // only ever treats age <= PART_SEARCH_OFFER_TURN_LIMIT as valid, so
  // re-showing at age === LIMIT would mint an age === LIMIT + 1 offer that is
  // actionable in THIS turn's reply (a chip, confirmation instructions) but
  // can never be confirmed in the NEXT one — the offer would already read as
  // expired the moment it is re-shown. Stop one turn earlier instead: say the
  // offer expired, with no further proposal to act on.
  if (pending) {
    const age = pending.age ?? 1;
    if (age >= PART_SEARCH_OFFER_TURN_LIMIT) {
      return { action: "expired", candidate: pending.candidate };
    }
    // #4193 Codex round 2 F6: the re-shown copy carries the SAME origin turn
    // forward (never a freshly minted identity) — claiming locks and marks
    // consumed on that ONE row (see part-search-claim.ts), so a confirmation
    // racing a re-show can consume the offer at most once no matter which
    // physical turn row ends up holding the copy that gets confirmed.
    return { action: "propose", candidate: pending.candidate, age: age + 1, originTurnId: originOf(pending, previousTurnId) };
  }
  return { action: "none" };
}

