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
  const unlabelled = serialLabelPresent ? [] : [...text.matchAll(PART_CODE)].map((m) => trimCode(m[0]));
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
  return /\b(?:substitute|replacement|interchange(?:able)?|compatible|drop\s*in|replace|instead\s+of)\b/i.test(question);
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
  /** #4193 Codex F3: a stable identity for this logical offer, minted once
   *  when it is first proposed and carried UNCHANGED through every re-show
   *  copy (a re-show persists a NEW turn row with a copy of the proposal, so
   *  the turn id alone can no longer identify "this offer" once it has been
   *  re-shown). Claiming is keyed on this id, not on whichever turn row
   *  happens to hold the copy that gets confirmed — see
   *  `part-search-claim.ts`. Absent on a legacy entry; such an entry falls
   *  back to the turn-id-only claim it always had. */
  id?: string;
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
  | { action: "propose"; candidate: string; age: number; id: string }
  | { action: "search"; candidate: string; id?: string }
  | { action: "cancelled"; candidate: string }
  | { action: "mismatch"; candidate: string | null }
  /** #4193 Codex F2: re-showing one more time would mint an offer past
   *  `PART_SEARCH_OFFER_TURN_LIMIT` that `pendingPartSearchProposal()` can
   *  never again treat as valid — an offer the app would render as
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

/**
 * Decide this turn's photo-part search. `candidate` is the part number the
 * current photo evidence yields (serial/FNSKU exclusions already applied);
 * `previousEvidence` is the evidence stored with the technician's immediately
 * preceding turn in this thread (empty when unknown — fail closed).
 */
export function partSearchDecision(opts: {
  message: string;
  candidate: string | null;
  /** The maker the current photo yields with that part (null when none). */
  manufacturer?: string | null;
  previousEvidence: readonly unknown[];
}): PartSearchDecision {
  const pending = pendingPartSearchProposal(opts.previousEvidence);
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
    return matches
      ? { action: "search", candidate: opts.candidate as string, id: pending?.id }
      : { action: "mismatch", candidate: opts.candidate };
  }
  if (pending && opts.message.trim().replace(/[.!]$/, "").toLowerCase() === PART_SEARCH_CANCEL.toLowerCase()) {
    return { action: "cancelled", candidate: pending.candidate };
  }
  if (opts.candidate && explicitManualLookupRequest(opts.message)) {
    return { action: "propose", candidate: opts.candidate, age: 1, id: crypto.randomUUID() };
  }
  // #4185/#4186: a reply that neither confirms, cancels, nor starts a fresh
  // lookup does not expire a pending offer — it re-shows it, aging it by one
  // turn, until PART_SEARCH_OFFER_TURN_LIMIT is reached.
  //
  // #4193 Codex F2: but NOT past the limit. `pendingPartSearchProposal()`
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
    // #4193 Codex F3: the re-shown copy carries the SAME stable id forward —
    // claiming is keyed on this id (see part-search-claim.ts), not on the
    // turn id the copy happens to live on, so a confirmation racing a
    // re-show can consume the offer at most once no matter which physical
    // turn row ends up holding the copy that gets confirmed. A legacy entry
    // with no id mints one now rather than leaving the re-show unidentified.
    return { action: "propose", candidate: pending.candidate, age: age + 1, id: pending.id ?? crypto.randomUUID() };
  }
  return { action: "none" };
}

