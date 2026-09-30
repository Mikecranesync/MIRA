/**
 * Narrow photo-part guards for unconfirmed label readings. A LOOK transcription
 * is useful search input, but is not proof of a device class or compatibility.
 */
const PART_CODE = /\b(?=[A-Z0-9/-]{8,}\b)(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9]+(?:[-/][A-Z0-9]+){1,4}\b/gi;

export function unambiguousPartNumber(photoText: string): string | null {
  // Remove explicitly marked serial fields before considering a code. A serial
  // number must never be sent to web search as if it were a part number.
  const searchable = photoText.replace(/\b(?:serial(?:\s*(?:no\.?|number))?|s\/n)\s*[:#]?\s*[A-Z0-9][A-Z0-9./-]*/gi, " ");
  const found = [
    ...[...searchable.matchAll(PART_CODE)].map((match) => match[0]),
    ...[...searchable.matchAll(/\b(?:P\/?N|part\s*(?:no\.?|number)|catalog(?:ue)?\s*(?:no\.?|number)|1P)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{5,})/gi)].map((match) => match[1]),
  ]
    .filter((code) => !/^X00[A-Z0-9]{7}$/i.test(code))
    .filter((code) => !/^\d+(?:\.\d+)?(?:\s*(?:-|to|\/)\s*\d+(?:\.\d+)?)?\s*(?:VAC|VDC|V|A|HZ|KHZ|W|KW|KVA|MA)$/i.test(code));
  const unique = new Map(found.map((code) => [code.toUpperCase(), code]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function explicitManualLookupRequest(question: string): boolean {
  return /\b(?:find|look\s+up|search\s+for|locate|get|download)\b[\s\S]{0,80}\b(?:manual|data\s*sheet|datasheet|pdf)\b/i.test(question) ||
    /\b(?:manual|data\s*sheet|datasheet|pdf)\b[\s\S]{0,80}\b(?:find|look\s+up|search|locate|get|download)\b/i.test(question);
}

export function asksPartCompatibility(question: string): boolean {
  return /\b(?:substitute|replacement|interchange(?:able)?|compatible|drop\s*in|replace|instead\s+of)\b/i.test(question);
}
