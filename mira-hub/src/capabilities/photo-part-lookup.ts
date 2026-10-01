/**
 * Narrow photo-part guards for unconfirmed label readings. A LOOK transcription
 * is useful search input, but is not proof of a device class or compatibility.
 */
const PART_CODE = /\b(?=[A-Z0-9/-]{8,}\b)(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9]+(?:[-/][A-Z0-9]+){1,4}\b/gi;

// Codex post-cap 7 F12 (#4172): the abbreviated labels a nameplate prints
// ("SER:", "Ser. No.", "Ser#", "Ser.Nr.") are serial labels too — the same
// vocabulary identity-proposal.ts's LABEL_WORDS already treats as a label.
// "SER" counts only in a label shape — a separator, a "no/nr/#" word, a
// code-shaped value right after it, or a "(SER)" suffix — so "series",
// "service" and "server" never match.
const SERIAL_LABEL =
  /\b(?:(?:serial(?:\s*(?:no\.?|nr\.?|number|#))?|s\/?n|s\.\s?n|ser\.?\s*(?:no\.?|nr\.?|number|#))\b\.?|ser\s*[:#=]|ser(?=\s+[A-Z0-9][A-Z0-9./-]{3,}\b)|(?<=[(\[]\s*)ser(?=\s*[)\]]))/gi;
const PART_LABEL = /\b(?:P\/?N|part\s*(?:no\.?|number)|catalog(?:ue)?\s*(?:no\.?|number)|1P)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{5,})/gi;
/** A trailing "." / "-" / "/" is sentence punctuation, not part of the code (#4150 F4). */
const trimCode = (code: string) => code.replace(/[./-]+$/, "");

/**
 * Every distinct, serial-safe part code in the text (#4172: exported so a caller
 * can tell "no code" from "several codes", which unambiguousPartNumber() folds
 * into the same null).
 */
export function partCodes(photoText: string): string[] {
  // Quotes are label punctuation, never identifier characters (#4150 F1/F4).
  const text = photoText.replace(/["'\u2018\u2019\u201c\u201d`]/g, " ");
  // A serial number must never be sent to web search (ADR-0036). Fail closed
  // (#4150 r2 F1): every code-shaped token within reach of a serial label is a
  // serial, whatever the separator ("S/N = …", "Serial number is …", "(…)").
  const serials = new Set<string>();
  for (const m of text.matchAll(SERIAL_LABEL)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    // The value directly after the label ("S/N = X", "Serial number is X", "(X)").
    const code = after.match(/^\s*(?:[:#=(\[]|is\b)?\s*([A-Z0-9][A-Z0-9./-]{3,})/i);
    if (code) serials.add(trimCode(code[1]).toUpperCase());
    // A suffix label marks the code just before it: "AB-1234567 (S/N)".
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    const prior = before.match(/([A-Z0-9][A-Z0-9./-]{3,})\s*[(\[]\s*$/i);
    if (prior) serials.add(trimCode(prior[1]).toUpperCase());
  }
  const labelled = [...text.matchAll(PART_LABEL)].map((m) => trimCode(m[1]));
  // Any serial label on the photo means only an explicitly labelled part number
  // is safe, even when the serial's value could not be parsed ("AB-1234567 S/N",
  // "AB-1234567 serial number") — #4150 review r4 F1.
  const serialLabelPresent = serials.size > 0 || new RegExp(SERIAL_LABEL.source, "i").test(text);
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
export function mentionsSerialLabel(text: string): boolean {
  return new RegExp(SERIAL_LABEL.source, "i").test(text.replace(/["'\u2018\u2019\u201c\u201d`]/g, " "));
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
};
/** Marker appended to the proposal's own turn when a confirmation spends it
 *  (atomically, before any search) — a proposal authorizes ONE search (F3). */
export const PART_SEARCH_CONSUMED_KIND = "part_search_proposal_consumed";
export const PART_SEARCH_CANCEL = "Don't search";

export function partSearchConfirmation(candidate: string): string {
  return `Search the web for "${candidate}"`;
}

/** The candidate named by an exact confirmation message, or null. Nothing else
 *  in the message is allowed: extra words are not a confirmation. */
export function confirmedPartSearchCandidate(message: string): string | null {
  const m = message.trim().match(/^search the web for ["\u201c]([^"\u201c\u201d\n]{1,80})["\u201d]\.?$/i);
  return m ? m[1] : null;
}

export function isPartSearchProposal(entry: unknown): entry is PartSearchProposalEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as { kind?: unknown; candidate?: unknown };
  return e.kind === PART_SEARCH_PROPOSAL_KIND && typeof e.candidate === "string";
}

export type PartSearchDecision =
  | { action: "none" }
  | { action: "propose"; candidate: string }
  | { action: "search"; candidate: string }
  | { action: "cancelled"; candidate: string }
  | { action: "mismatch"; candidate: string | null };

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
  const consumed = opts.previousEvidence.some(
    (e) => typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === PART_SEARCH_CONSUMED_KIND,
  );
  const pending = consumed ? null : (opts.previousEvidence.find(isPartSearchProposal) ?? null);
  const makerNow = opts.manufacturer ?? null;
  const confirmed = confirmedPartSearchCandidate(opts.message);
  if (confirmed !== null) {
    // Exact string equality, three ways: what was proposed, what is confirmed,
    // and what the photo yields now. Any difference means no egress.
    return pending &&
      opts.candidate &&
      confirmed === opts.candidate &&
      pending.candidate === opts.candidate &&
      (pending.manufacturer ?? null) === makerNow
      ? { action: "search", candidate: opts.candidate }
      : { action: "mismatch", candidate: opts.candidate };
  }
  if (pending && opts.message.trim().replace(/[.!]$/, "").toLowerCase() === PART_SEARCH_CANCEL.toLowerCase()) {
    return { action: "cancelled", candidate: pending.candidate };
  }
  if (opts.candidate && explicitManualLookupRequest(opts.message)) {
    return { action: "propose", candidate: opts.candidate };
  }
  return { action: "none" };
}

