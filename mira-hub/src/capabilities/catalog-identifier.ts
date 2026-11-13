/** A detection-only view: raw UTF-16 offsets and all surrounding prose stay
 * intact. This is not a model/coverage recognizer or Unicode normalization. */
export type IdentifierSpan = { raw: string; start: number; end: number; detected: string };

// Detection only, one UTF-16 unit each: U+2010 hyphen, U+2011 nonbreaking
// hyphen, U+2012 figure dash, U+2212 minus, U+FE63 small hyphen-minus and
// U+FF0D fullwidth hyphen-minus stand for an internal catalog hyphen. U+2013
// en dash is allowed only within the same bounded identifier shapes. U+2014
// em dash and U+FE58 small em dash remain clause punctuation. No whole NFKC
// or width-letter transformation, and no folding across a line break.
const SEPARATOR = /[-\u2010\u2011\u2012\u2013\u2212\uFE63\uFF0D]/g;
const CHAINS = /[A-Za-z0-9]+(?:[ \t]*[-\u2010\u2011\u2012\u2013\u2212\uFE63\uFF0D][ \t]*[A-Za-z0-9]+)*/g;
const hasDigit = (value: string) => /[0-9]/.test(value);

export function catalogIdentifierView(raw: string): { text: string; spans: readonly IdentifierSpan[] } {
  const chars = raw.split(""); // UTF-16 units, exactly as RegExp match.index.
  const spans: IdentifierSpan[] = [];
  for (const chain of raw.matchAll(CHAINS)) {
    const pieces = [...chain[0].matchAll(/[A-Za-z0-9]+/g)];
    for (let i = 0; i < pieces.length; i++) {
      const first = pieces[i][0];
      const shortPrefix = /^[A-Za-z]{1,3}$/.test(first) && /^\d/.test(pieces[i + 1]?.[0] ?? "");
      if (!hasDigit(first) && !shortPrefix) continue;
      // A numeric range ending in a unit (4–20mA) is not a numeric catalog
      // prefix. A numeric-led catalog instead continues with a letter-led
      // numbered component, as in 2080-LC20-20QWB.
      if (/^\d+$/.test(first) && !/^[A-Za-z][A-Za-z0-9]*\d/.test(pieces[i + 1]?.[0] ?? "")) continue;
      let j = shortPrefix ? i + 1 : i;
      while (j + 1 < pieces.length && hasDigit(pieces[j + 1][0])) {
        // Two independently letter-led models are endpoints/list items, not
        // an order suffix. Numeric-led catalog roots (2080-LC20-...) and
        // numeric-led suffixes (GS11N-20P2, QZ-743-24AX) remain joinable.
        if (/^[A-Za-z]/.test(pieces[j + 1][0]) && (/^[A-Za-z]/.test(first) || j > i)) break;
        j++;
      }
      const start = chain.index + pieces[i].index;
      const end = chain.index + pieces[j].index + pieces[j][0].length;
      const source = raw.slice(start, end);
      if (/[A-Za-z]/.test(source) && hasDigit(source)) {
        const detected = source.replace(SEPARATOR, "-");
        spans.push({ raw: source, start, end, detected });
        for (let at = 0; at < detected.length; at++) chars[start + at] = detected[at];
      }
      i = j;
    }
  }
  return { text: chars.join(""), spans };
}
