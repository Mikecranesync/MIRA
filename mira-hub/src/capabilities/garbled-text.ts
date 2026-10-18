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

/**
 * Is this ONE block cipher that decodes to English? Deliberately stricter than
 * the page-level gate: a block is short, so the density signal is noisier, and
 * rewriting a block that was already fine is the one outcome worth preventing.
 */
function blockIsShift29(block: string): boolean {
  const letters = (block.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 24) return false;
  // A code/parts table is number-heavy and is NOT prose in any cipher. Deciding
  // per block made this necessary: at page scale the table's own density kept
  // it safe, but one table line in isolation is short enough that a decode can
  // coin a common-word substring by accident. Measured: without this guard the
  // "1771-P7 120/220V AC 16A …" fixture was rewritten.
  const digits = (block.match(/\d/g) ?? []).length;
  if (digits / Math.max(letters + digits, 1) > 0.15) return false;
  const raw = englishDensity(block);
  if (raw >= RAW_CEILING) return false; // already reads as English — never touch it
  const decodedText = decodeShift29(block);
  const decoded = englishDensity(decodedText);
  if (decoded < DECODED_FLOOR || decoded < raw * IMPROVEMENT) return false;
  // Real prose decodes into SEVERAL different common words, not one repeated
  // coincidence. Three distinct hits is the floor.
  const distinct = new Set((decodedText.toLowerCase().match(COMMON_WORDS_RE) ?? []).map((w) => w.toLowerCase()));
  return distinct.size >= 3;
}

/**
 * Repair one extracted page, BLOCK BY BLOCK.
 *
 * Review A on #4486: a page whose header is English and whose body is cipher —
 * the actual TQ-05/06 shape — was left entirely garbled, because the header's
 * real words lifted whole-page density above the gate. Deciding per block
 * fixes that, and it also makes the false positive the reviewer feared
 * structurally impossible: a block that already reads as English is never
 * handed to the decoder, so a header can no longer be mangled by its
 * neighbours.
 *
 * Blocks are blank-line separated, falling back to single lines when a page
 * has no blank lines (OEM extractions often don't). Separators are preserved
 * exactly, so an untouched page is byte-identical. `unrepaired` = the page
 * reads as garbled but no block was the fixed shift — the OCR fallback's cue.
 */
export function repairExtractedPage(text: string): PageRepair {
  if (!text.trim()) return { text, repair: null, unrepaired: false };

  // Split while KEEPING the separators, so re-joining is lossless.
  const parts = text.split(/(\n\s*\n|\n)/);
  let decodedAny = false;
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // a captured separator
    if (!blockIsShift29(part)) return part;
    decodedAny = true;
    return decodeShift29(part);
  });
  if (decodedAny) return { text: out.join(""), repair: "shift29", unrepaired: false };

  // No block decoded. Fall back to the whole-page verdict so a page that is
  // garbled by some OTHER map still raises the OCR cue.
  const verdict = detectGarble(text);
  if (verdict.garbled && verdict.method === "shift29") {
    // The page-level check agrees but no single block did — decode wholesale.
    return { text: verdict.decoded, repair: "shift29", unrepaired: false };
  }
  return { text, repair: null, unrepaired: verdict.garbled };
}
