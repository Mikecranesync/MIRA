/** A detection-only view: raw UTF-16 offsets and all surrounding prose stay
 * intact. This is not a model/coverage recognizer or Unicode normalization. */
import { foldForDetection, HYPHEN_EQUIV_CHARS } from "./detection-fold";

export type IdentifierSpan = { raw: string; start: number; end: number; detected: string };

// Detection only, one UTF-16 unit each. The supported set is exactly the
// shared fold's hyphen equivalents (detection-fold.ts HYPHEN_EQUIV_CHARS):
// U+2010 hyphen, U+2011 nonbreaking hyphen, U+2012 figure dash, U+2212 minus,
// U+FE63 small hyphen-minus and U+FF0D fullwidth hyphen-minus. Written directly
// between two groups of one identifier, each stands for the catalog hyphen.
//
// Not supported, and left exactly as written:
// - U+2013 en dash and U+2014 em dash (and U+FE58): the shared fold excludes
//   them, and an en dash is also how a range is written.
// - A dash of any kind with a space on either side. The text cannot say whether
//   it separates catalog groups or clauses ("ZX731-09C - 24V"), and three review
//   rounds found a wrong-manual admission behind every rule that guessed
//   (#5484, PR #5500). A spaced spelling keeps the reading it already had.
// No whole NFKC or width-letter transformation, and no folding across a line.
const CHAINS = new RegExp(`[A-Za-z0-9]+(?:[-${HYPHEN_EQUIV_CHARS}][A-Za-z0-9]+)*`, "g");
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
        // The shared fold also strips markup/format characters; our bounded
        // alphabet admits neither. Never apply it to the whole question, and
        // fail closed if a future shared change would invalidate raw offsets.
        const detected = foldForDetection(source);
        if (detected.length === source.length) {
          spans.push({ raw: source, start, end, detected });
          for (let at = 0; at < detected.length; at++) chars[start + at] = detected[at];
        }
      }
      i = j;
    }
  }
  return { text: chars.join(""), spans };
}
