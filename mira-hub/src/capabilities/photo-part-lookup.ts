/**
 * Narrow photo-part guards for unconfirmed label readings. A LOOK transcription
 * is useful search input, but is not proof of a device class or compatibility.
 */
const PART_CODE = /\b(?=[A-Z0-9/-]{8,}\b)(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9]+(?:[-/][A-Z0-9]+){1,4}\b/gi;

const SERIAL_LABEL = /\b(?:serial(?:\s*(?:no\.?|number|#))?|s\/?n)\b/gi;
const PART_LABEL = /\b(?:P\/?N|part\s*(?:no\.?|number)|catalog(?:ue)?\s*(?:no\.?|number)|1P)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{5,})/gi;
/** A trailing "." / "-" / "/" is sentence punctuation, not part of the code (#4150 F4). */
const trimCode = (code: string) => code.replace(/[./-]+$/, "");

export function unambiguousPartNumber(photoText: string): string | null {
  // Quotes are label punctuation, never identifier characters (#4150 F1/F4).
  const text = photoText.replace(/["'\u2018\u2019\u201c\u201d`]/g, " ");
  // A serial number must never be sent to web search (ADR-0036). Fail closed
  // (#4150 r2 F1): every code-shaped token within reach of a serial label is a
  // serial, whatever the separator ("S/N = …", "Serial number is …", "(…)").
  const serials = new Set<string>();
  for (const m of text.matchAll(SERIAL_LABEL)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    const code = after.match(/[A-Z0-9][A-Z0-9./-]{3,}/i);
    if (code) serials.add(trimCode(code[0]).toUpperCase());
  }
  const labelled = [...text.matchAll(PART_LABEL)].map((m) => trimCode(m[1]));
  // With a serial on the label, only an explicitly labelled part number is safe.
  const unlabelled = serials.size ? [] : [...text.matchAll(PART_CODE)].map((m) => trimCode(m[0]));
  const found = [...unlabelled, ...labelled]
    .filter((code) => !serials.has(code.toUpperCase()))
    .filter((code) => !/^X00[A-Z0-9]{7}$/i.test(code))
    .filter((code) => !/^\d+(?:\.\d+)?(?:\s*(?:-|to|\/)\s*\d+(?:\.\d+)?)?\s*(?:VAC|VDC|V|A|HZ|KHZ|W|KW|KVA|MA)$/i.test(code));
  const unique = new Map(found.map((code) => [code.toUpperCase(), code]));
  return unique.size === 1 ? [...unique.values()][0] : null;
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
  /(?:\b(?:no|not|never|stop|without|before|myself|later|how\s+(?:to|do|would|can))\b|n't\b|\bdont\b)/i;

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
