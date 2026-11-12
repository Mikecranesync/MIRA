/**
 * Is a stored document a WHOLE manual, and did its numbers read?
 *
 * Garage pilot L2 (plan row 5-A/C, M5). The auto-acquired GS10 "manual" was
 * one chapter file (cdn.automationdirect.com/static/manuals/gs10m/ch1.pdf):
 * 18 pages whose page 1 is the chapter's own heading and table of contents,
 * and whose specification tables carry U+FFFD where every decimal point should
 * be ("5�1" for 5.1 A — the PDF's ToUnicode map has no entry for the
 * point glyph). The applicability check verified it (the model number IS in
 * its text), so it was promoted and answered from, with numbers that could
 * not be read. This module is the second judgement, next to applicability:
 * a candidate that is not complete is never promoted and the technician is
 * told to add the full manual.
 *
 * Two signals, both from the document's own stored text, no model call:
 *
 *   chapter_start   — the document's FIRST page names exactly one chapter
 *                     (or one appendix). A whole manual's first page is a
 *                     cover, a title, or a table of contents listing MANY
 *                     chapters; a chapter file's first page is "Chapter 1:
 *                     Getting Started" plus that chapter's section list. Every
 *                     full manual has chapter headings on LATER pages, so only
 *                     the first page is judged. (Measured: GS10 full manual
 *                     p.1 cover / p.10 lists ch. 2–4; Micro820 user manual
 *                     p.3 lists ch. 1–3; install sheet, relay sheet: none.)
 *   unmapped_glyphs — U+FFFD with a digit on BOTH sides, on any page. A
 *                     leader dot in a table of contents ("Overview � �
 *                     1–2") has spaces around it and is not a number.
 *
 * Pure, zero-token, deterministic. Called by the acquisition after the
 * applicability check; the same glyph predicate is what the ingest uses to
 * stamp `metadata.text_repair = "unmapped_glyph"` on a page's chunks.
 */

export type CompletenessReason = "chapter_start" | "unmapped_glyphs";

export interface Completeness {
  /** False when any reason holds. */
  complete: boolean;
  /** In fixed order: chapter_start, then unmapped_glyphs. Empty when complete. */
  reasons: CompletenessReason[];
  /** The lowest page number among the chunks (the page judged for chapter_start), or null. */
  firstPage: number | null;
  /** Distinct pages carrying a digit-glyph-digit sequence. */
  unreadablePages: number;
}

export interface CompletenessChunk {
  content: string;
  page: number | null;
}

/** A replacement character with a digit on both sides: a number whose glyph did not map.
 *  Exported so the document-wide SQL probe in manual-acquisition.ts is built from THIS
 *  pattern's `.source` (a valid Postgres ARE: `\d` is recognized there too) rather than a
 *  hand-copied regex string that could drift from this one (Codex #5429 r1 F3). */
export const DIGIT_GLYPH_DIGIT = /\d�\d/;

export function hasUnmappedGlyphBetweenDigits(text: string): boolean {
  return DIGIT_GLYPH_DIGIT.test(text);
}

// Case-insensitive (#5434): "CHAPTER 1" / "chapter 1" / "APPENDIX A" are the manual's typography,
// not evidence of completeness. The captured label is upper-cased so "a" and "A" are one appendix.
const CHAPTER_HEADING = /\bChapter\s*(\d{1,2})\b/gi;
const APPENDIX_HEADING = /\bAppendix\s*([A-Z])\b/gi;

function distinct(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(m[1]!.toUpperCase());
  return out;
}

export function assessCompleteness(
  chunks: ReadonlyArray<CompletenessChunk>,
  opts?: {
    /** Distinct pages carrying the glyph pattern across the WHOLE stored document, from a
     *  tenant-scoped SQL count — not just the bounded identity-evidence sample passed as
     *  `chunks`. A long manual's unreadable tables can sit past that sample's limit; when
     *  the caller supplies this (it is a superset of what `chunks` alone can see), it is
     *  authoritative for `unreadablePages`/the `unmapped_glyphs` reason. Omit it to keep the
     *  old chunk-only behavior (Codex #5429 r1 F3). */
    unreadablePagesDocumentWide?: number;
  },
): Completeness {
  const reasons: CompletenessReason[] = [];

  let firstPage: number | null = null;
  for (const c of chunks) {
    if (c.page !== null && Number.isFinite(c.page) && (firstPage === null || c.page < firstPage)) firstPage = c.page;
  }
  if (firstPage !== null) {
    const firstPageText = chunks
      .filter((c) => c.page === firstPage)
      .map((c) => c.content)
      .join("\n");
    const chapters = distinct(firstPageText, CHAPTER_HEADING);
    const appendices = distinct(firstPageText, APPENDIX_HEADING);
    // Exactly one chapter named (and no other chapter) — or, with no chapter
    // at all, exactly one appendix. Two or more distinct headings is a table
    // of contents; none is a cover or a sheet.
    const oneChapter = chapters.size === 1;
    const oneAppendix = chapters.size === 0 && appendices.size === 1;
    if (oneChapter || oneAppendix) reasons.push("chapter_start");
  }

  const glyphPages = new Set<number | null>();
  for (const c of chunks) {
    if (hasUnmappedGlyphBetweenDigits(c.content)) glyphPages.add(c.page);
  }
  const unreadablePages = opts?.unreadablePagesDocumentWide ?? glyphPages.size;
  if (unreadablePages > 0) reasons.push("unmapped_glyphs");

  return { complete: reasons.length === 0, reasons, firstPage, unreadablePages };
}

/** The technician-facing reason a document is not complete, for the acquisition outcome message. */
export function partialManualReason(c: Completeness): string {
  const parts: string[] = [];
  if (c.reasons.includes("chapter_start")) parts.push("it reads like one chapter of the manual, not the whole manual");
  if (c.reasons.includes("unmapped_glyphs")) {
    parts.push(`numbers on ${c.unreadablePages} of its pages did not read`);
  }
  return parts.join(" and ");
}
