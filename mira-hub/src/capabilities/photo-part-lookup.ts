/**
 * Narrow photo-part guards for unconfirmed label readings. A LOOK transcription
 * is useful search input, but is not proof of a device class or compatibility.
 */
const PART_CODE = /\b(?=[A-Z0-9/-]{8,}\b)(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9]+(?:[-/][A-Z0-9]+){1,4}\b/gi;

export function unambiguousPartNumber(photoText: string): string | null {
  // Quotes are label punctuation, never identifier characters (#4150 F1/F4): a quoted
  // serial must still be recognized as a serial, and a quoted part number still read.
  const unquoted = photoText.replace(/["'\u2018\u2019\u201c\u201d`]/g, " ");
  // Remove explicitly marked serial fields before considering a code. A serial
  // number must never be sent to web search as if it were a part number.
  const searchable = unquoted.replace(
    /\b(?:serial(?:\s*(?:no\.?|number|#))?|s\/?n)\b\.?\s*[:#]?\s*[A-Z0-9][A-Z0-9./-]*/gi,
    " ",
  );
  const found = [
    ...[...searchable.matchAll(PART_CODE)].map((match) => match[0]),
    ...[...searchable.matchAll(/\b(?:P\/?N|part\s*(?:no\.?|number)|catalog(?:ue)?\s*(?:no\.?|number)|1P)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{5,})/gi)].map((match) => match[1]),
  ]
    // A trailing "." / "-" / "/" is sentence punctuation, not part of the code (#4150 F4).
    .map((code) => code.replace(/[./-]+$/, ""))
    .filter((code) => !/^X00[A-Z0-9]{7}$/i.test(code))
    .filter((code) => !/^\d+(?:\.\d+)?(?:\s*(?:-|to|\/)\s*\d+(?:\.\d+)?)?\s*(?:VAC|VDC|V|A|HZ|KHZ|W|KW|KVA|MA)$/i.test(code));
  const unique = new Map(found.map((code) => [code.toUpperCase(), code]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

const LOOKUP_VERB = String.raw`(?:find|look\s+up|search(?:\s+for)?|locate|get|download)`;
const DOC_WORD = String.raw`(?:manual|data\s*sheet|datasheet|pdf)`;
const AFFIRMATIVE_LOOKUP = [
  new RegExp(String.raw`\b${LOOKUP_VERB}\b[^.?!]{0,80}\b${DOC_WORD}\b`, "i"),
  new RegExp(String.raw`\b${DOC_WORD}\b[^.?!]{0,80}\b${LOOKUP_VERB}\b`, "i"),
];
/** A negated, deferred or descriptive mention ("do not look up", "before you search",
 *  "I could not find the manual") must never authorize egress (#4150 F2). */
const NOT_A_REQUEST = new RegExp(
  String.raw`(?:\b(?:not|never|no\s+need\s+to|stop|without|before)\b|n't\b)[^.?!]{0,40}\b${LOOKUP_VERB}\b`,
  "i",
);

/** Only an affirmative request in its own sentence authorizes a manual search. */
export function explicitManualLookupRequest(question: string): boolean {
  return question
    .split(/(?<=[.?!])\s+|\n+/)
    .some((sentence) => !NOT_A_REQUEST.test(sentence) && AFFIRMATIVE_LOOKUP.some((re) => re.test(sentence)));
}

export function asksPartCompatibility(question: string): boolean {
  return /\b(?:substitute|replacement|interchange(?:able)?|compatible|drop\s*in|replace|instead\s+of)\b/i.test(question);
}
