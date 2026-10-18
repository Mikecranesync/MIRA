/**
 * Garbled-extraction repair (2026-10-17 prod-test TQ-05 / TQ-06, the PLC-5 manual).
 *
 * Some OEM PDFs (the Allen-Bradley PLC-5 manuals among them) embed a font
 * whose glyph codes sit a FIXED 29 code points below ASCII, so pdf.js text
 * extraction hands back every letter shifted: `,QDGGLWLRQ` is `Inaddition`,
 * `WKH` is `the`. The page is "text" to the parser, so it is never treated as
 * scanned, the chunks land in `knowledge_entries` as noise, and BM25 can never
 * match a technician's words against them — two prod-test questions missed on
 * exactly this.
 *
 * Zero-token and reversible: a page is only rewritten when the +29 decode
 * reads MUCH more like English than the original (common-word density), so a
 * normal page, a parts table or a short header is never touched. The decode
 * is one arithmetic map, so a wrong call is auditable from the row's
 * `metadata.text_repair` marker and reversible with `encodeShift29`.
 *
 * Known limitation: the original space (0x20) lands at 0x03 under the shift.
 * pdf.js keeps it as a control char in most builds (we map it back), but if a
 * build drops it, decoded words run together ("Inaddition") — still far more
 * searchable than the cipher, not perfect. OCR is the full repair; see the
 * `NOTEBOOK_GARBLE_OCR_FALLBACK` seam in node-knowledge-ingest.ts.
 */

export const GARBLE_SHIFT = 29;

/** Common English + manual vocabulary, matched as substrings (the shift
 *  often eats the spaces, so word boundaries cannot be relied on). */
const COMMON_WORDS = [
  "the", "and", "for", "with", "that", "this", "from", "not", "are", "you",
  "can", "will", "when", "use", "all", "input", "output", "power", "module",
  "processor", "program", "data", "set", "fault", "error", "table", "bit",
  "word", "file", "address", "install", "connect", "wire", "remove", "replace",
  "battery", "memory", "status", "mode", "voltage", "current", "terminal",
];
const COMMON_WORDS_RE = new RegExp(COMMON_WORDS.join("|"), "gi");

/** Common-word hits per 100 letters. ~0 for cipher text, typically 8–20 for
 *  English prose, 2–6 for dense tables. */
export function englishDensity(text: string): number {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 40) return 0;
  const hits = (text.match(COMMON_WORDS_RE) ?? []).length;
  return (hits * 100) / letters;
}

/** Apply the +29 map. Only codes that land in printable ASCII move; anything
 *  already past the window (lowercase b–z, `{|}~`, non-ASCII) is left alone so
 *  a mixed page cannot be double-shifted. Under the shift the original
 *  space/punctuation/digits (0x20–0x3C) sit in the C0 control range
 *  (0x03–0x1F) — those are mapped back too. Layout whitespace the parser
 *  itself inserts (space, \n, \r, \t) is kept as whitespace: it is not cipher. */
export function decodeShift29(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === "\n" || ch === "\r" || ch === "\t" || c === 0x20) {
      out += ch;
    } else if (c < 0x20 || (c > 0x20 && c + GARBLE_SHIFT <= 0x7e)) {
      out += String.fromCharCode(c + GARBLE_SHIFT);
    } else {
      out += ch;
    }
  }
  return out;
}

/** The inverse map — used by tests to build fixtures from real sentences and
 *  by an operator to reverse a repair that turns out wrong. Whitespace is kept
 *  as whitespace (never encoded into the control range the decoder reads
 *  back), and `=` (whose cipher IS a space) is left alone — so a round trip
 *  is exact for every character except `=`. */
export function encodeShift29(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === "\n" || ch === "\r" || ch === "\t" || c === 0x20 || c === 0x3d) out += ch;
    else if (c > 0x20 && c <= 0x7e) out += String.fromCharCode(c - GARBLE_SHIFT);
    else out += ch;
  }
  return out;
}

export type GarbleVerdict =
  | { garbled: false; density: number }
  | { garbled: true; method: "shift29"; density: number; decodedDensity: number; decoded: string }
  | { garbled: true; method: "unknown"; density: number; decodedDensity: number };

/** A page is garbled when it reads like nothing (density < 1) — and it is the
 *  fixed shift when the decode reads like English (≥ 3) and at least 4× better. */
const RAW_CEILING = 1.0;
const DECODED_FLOOR = 3.0;
const IMPROVEMENT = 4;

export function detectGarble(text: string): GarbleVerdict {
  const density = englishDensity(text);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 80 || density >= RAW_CEILING) return { garbled: false, density };
  const decoded = decodeShift29(text);
  const decodedDensity = englishDensity(decoded);
  if (decodedDensity >= DECODED_FLOOR && decodedDensity >= density * IMPROVEMENT) {
    return { garbled: true, method: "shift29", density, decodedDensity, decoded };
  }
  // Reads like nothing both ways: not the fixed shift — a different font map
  // or a genuinely image-only page the parser still returned glyphs for.
  // Only flagged when the page is clearly letter-bearing yet wordless.
  if (letters >= 200 && density < 0.3) {
    return { garbled: true, method: "unknown", density, decodedDensity };
  }
  return { garbled: false, density };
}

/**
 * The re-extract plan for rows ALREADY in `knowledge_entries` (the PLC-5
 * manual ingested before this repair existed). Pure: returns only the rows
 * the decoder would rewrite, with their new content. The script that applies
 * it (`scripts/repair-garbled-chunks.ts`) runs only behind
 * NOTEBOOK_GARBLE_REEXTRACT=1 and `--apply`; everything else is a dry run.
 */
export function planChunkRepairs(
  rows: ReadonlyArray<{ id: string; content: string }>,
): Array<{ id: string; content: string; repair: "shift29" }> {
  const out: Array<{ id: string; content: string; repair: "shift29" }> = [];
  for (const row of rows) {
    const verdict = repairExtractedPage(row.content);
    if (verdict.repair === "shift29") out.push({ id: row.id, content: verdict.text, repair: "shift29" });
  }
  return out;
}

export type PageRepair = { text: string; repair: "shift29" | null; unrepaired: boolean };

/** Repair one extracted page. `unrepaired` = garbled but not the fixed shift
 *  (the OCR fallback's cue); the text is returned unchanged in that case. */
export function repairExtractedPage(text: string): PageRepair {
  const verdict = detectGarble(text);
  if (!verdict.garbled) return { text, repair: null, unrepaired: false };
  if (verdict.method === "shift29") return { text: verdict.decoded, repair: "shift29", unrepaired: false };
  return { text, repair: null, unrepaired: true };
}
