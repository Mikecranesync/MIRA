/**
 * Printed-page citation helpers for Hub banners and retrieved chunks.
 *
 * OEM manuals (AutomationDirect GS10/GS20 and others) number pages as
 * chapter-section labels ("2-15", "4-188", "A-12") instead of a single
 * running PDF page. Those labels live in chunk metadata (`page_label` /
 * `page` / `page_num`). INTEGER `source_page` / `page_start` cannot hold
 * them, and JS coercion destroys them:
 *   Number("2-15") === NaN
 *   parseInt("2-15", 10) === 2
 *
 * Port of `is_chapter_section_label` in
 * `tools/drive-pack-extract/cite_integrity.py`. Display-only — never
 * mutates stored data, never sends a manual through an LLM.
 */

/** Same shape as cite_integrity._PAGE_LABEL_RE (hyphen or en-dash). */
const PAGE_LABEL_RE = /^\s*[0-9A-Za-z]+[-–][0-9]+[A-Za-z]?\s*$/;

const HAZARD_CHUNK_RE = /\b(WARNING|CAUTION|DANGER)\b/i;

export function isChapterSectionLabel(page: unknown): boolean {
  if (typeof page !== "string") return false;
  const trimmed = page.trim();
  if (!trimmed) return false;
  // An int-string ("162") is a page number, not a chapter-section label.
  if (/^\d+$/.test(trimmed)) return false;
  return PAGE_LABEL_RE.test(trimmed);
}

/**
 * Normalize a retrieved page-metadata value for display. Chapter-section
 * labels are preserved (en-dash → hyphen). Integer pages stay digit strings.
 * Never runs Number() / parseInt() on a label.
 */
export function citationPageLabel(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return String(Math.trunc(raw));
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isChapterSectionLabel(trimmed)) return trimmed.replace(/–/g, "-");
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

export type RetrievedPageChunk = {
  content?: string;
  pageLabel?: string | null;
  sourcePage?: number | null;
};

function labelOf(chunk: RetrievedPageChunk): string | null {
  const fromMeta = citationPageLabel(chunk.pageLabel);
  if (fromMeta) return fromMeta;
  if (
    typeof chunk.sourcePage === "number" &&
    Number.isFinite(chunk.sourcePage) &&
    chunk.sourcePage > 0
  ) {
    return String(chunk.sourcePage);
  }
  return null;
}

/**
 * Page to cite on a safety/warning banner. Prefers the retrieved WARNING /
 * CAUTION / DANGER chunk's printed label (TQ-29: p.2-15); otherwise the
 * first chunk that carries a usable page.
 */
export function pageFromRetrievedChunks(
  chunks: readonly RetrievedPageChunk[] | null | undefined,
): string | null {
  if (!chunks?.length) return null;
  const hazard = chunks.find((c) => HAZARD_CHUNK_RE.test(c.content ?? ""));
  if (hazard) {
    const page = labelOf(hazard);
    if (page) return page;
  }
  for (const chunk of chunks) {
    const page = labelOf(chunk);
    if (page) return page;
  }
  return null;
}

/** Append `(p.2-15)` (or `(p.42)`) to a banner. Idempotent; no-op without a page. */
export function withPageCitation(
  banner: string,
  page: string | null | undefined,
): string {
  if (!banner || !page) return banner;
  const cited = `(p.${page})`;
  if (banner.includes(cited)) return banner;
  return `${banner.trimEnd()} ${cited}`;
}
