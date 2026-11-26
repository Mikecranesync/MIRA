/**
 * Client-safe page display rules for citations (#5955). Pure: no Node APIs, no SQL, so UI
 * adapters, the legacy notebook chat and the server builders share ONE rule.
 *
 * Three rules live here:
 *   1. `displayPage` — the page a retrieved chunk may SHOW (see citation-passages.ts for the
 *      trust model: anchored page_start, or a document whose stamps show real page diversity).
 *   2. `numericLocatorUnproven` — a bare-integer metadata locator (`metadata.page_num = "1"`,
 *      which staging carries on EVERY row of the ordinal-stamped PowerFlex copies) is only a
 *      restatement of the stamped page, so it is withheld whenever that page is. A compound
 *      printed label ("2-15", "A-12") is independent evidence and is never withheld here.
 *   3. `effectiveCitationPage` / `withoutUnverifiedPage` — display of a SAVED or live citation.
 *      A citation persisted before #5955 may carry a wrong page with no way to check it. It is
 *      shown only when its source can be identified (a document id, a parked file, a browser
 *      address) or the server attested the page (`selector`). Nothing stored is changed and no
 *      page is guessed; the saved row, answer, ids and quotes are untouched.
 */

export type PageTrustFields = {
  sourcePage: number | null;
  chunkIndex?: number | null;
  pageAnchored?: boolean;
  pageTrust?: "trusted" | "unknown";
};

/** The page number safe to SHOW (and to deep-link). Null = unknown. */
export function displayPage(c: PageTrustFields): number | null {
  if (c.sourcePage == null) return null;
  if (c.chunkIndex != null && c.sourcePage === c.chunkIndex && !c.pageAnchored) return null;
  if (c.pageTrust === "unknown" && !c.pageAnchored) return null;
  return c.sourcePage;
}

/** True when `label` is a bare integer that merely restates a stamped page this chunk may not show. */
export function numericLocatorUnproven(c: PageTrustFields, label: string | null | undefined): boolean {
  if (!label || !/^\s*\d+\s*$/.test(label)) return false;
  if (displayPage(c) != null) return false;
  // A stamp that is present but withheld, OR a document verdict of "unknown" with no physical
  // page at all: the integer is an unproven alias either way. A chunk never assessed and with no
  // stamp (nothing says its label is wrong) keeps a printed number.
  return c.sourcePage != null || (c.pageTrust === "unknown" && !c.pageAnchored);
}

export type CitationPageFields = {
  page?: number | null;
  docId?: string | null;
  fileId?: string | null;
  originFileId?: string | null;
  sourceUrl?: string | null;
  selector?: { type: string; value: unknown } | null;
};

/** The server attests a page it proved by emitting this selector (buildCitations). */
export const pageSelector = (page: number) => ({ type: "page" as const, value: page });

/**
 * The page a citation may display. Null for a page that is absent, or that belongs to a source
 * with no stable identity or location and no server attestation (every bare/gdrive legacy
 * citation persisted before #5955: docId "", no file, no browser address).
 */
export function effectiveCitationPage(c: CitationPageFields): number | null {
  const page = c.page ?? null;
  if (page === null) return null;
  if (c.selector && c.selector.type === "page" && c.selector.value === page) return page;
  if (c.docId || c.fileId || c.originFileId) return page;
  if (/^https?:\/\//i.test(c.sourceUrl ?? "")) return page;
  return null;
}

/**
 * `url` with any numeric page locator in its fragment replaced by the KNOWN page, keeping every
 * other fragment argument/anchor and the address itself. A URL with no numeric locator is
 * returned unchanged (nothing is added).
 */
export function replaceNumericPage(url: string, page: number): string {
  const at = url.indexOf("#");
  if (at < 0) return url;
  const parts = url.slice(at + 1).split("&");
  let replaced = false;
  const out: string[] = [];
  for (const part of parts) {
    if (/^(?:page=\d+|p\d+)$/i.test(part)) {
      if (!replaced) out.push(`page=${page}`);
      replaced = true;
    } else out.push(part);
  }
  return replaced ? `${url.slice(0, at)}#${out.join("&")}` : url;
}

/** The click-through query for a citation's source page: only a page it may display. */
export const citationPageQuery = (c: CitationPageFields): string => {
  const page = effectiveCitationPage(c);
  return page != null ? `?page=${page}` : "";
};

/** `url` without a numeric page locator in its fragment (`#page=715`, `#p715`, `#view=Fit&page=3`). */
export function withoutUnverifiedPage(url: string): string {
  const at = url.indexOf("#");
  if (at < 0) return url;
  const rest = url.slice(at + 1).split("&").filter((part) => !/^(?:page=\d+|p\d+)$/i.test(part));
  return rest.length > 0 ? `${url.slice(0, at)}#${rest.join("&")}` : url.slice(0, at);
}
