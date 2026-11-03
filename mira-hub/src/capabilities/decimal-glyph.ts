// #5128 / #5130 — some manuals (AutomationDirect GS1/GS10/GS30) were ingested
// with every period replaced by U+FFFD, so "30.0 sec" is stored as "30�0 sec".
// The model, the citation quote and the claim verifier then all see a garbled
// number. Read-side repair only: between two digits the lost glyph is a period
// (decimals, IP octets, parameter numbers like P01.12). Anywhere else the
// original character is unknown, so the text is left exactly as stored.
const DIGIT_GLYPH_DIGIT = /(?<=\d)�(?=\d)/g;

export function restoreDecimalGlyph(text: string): string {
  if (!text.includes("�")) return text;
  return text.replace(DIGIT_GLYPH_DIGIT, ".");
}
