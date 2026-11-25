/**
 * The page number safe to SHOW the user (#2910, #5955). Legacy ingest paths
 * stamped `source_page` with the chunk ORDINAL, so a row is a mis-stamp exactly
 * when `sourcePage === chunkIndex`; suppress the label for those. Rows with a
 * real page still render it. Display-only: never mutates stored data, and
 * citation numbering keeps keying on the RAW page.
 */
export function displayPage(c: { sourcePage?: number | null; chunkIndex?: number | null }): number | null {
  if (c.sourcePage == null) return null;
  if (c.chunkIndex != null && c.sourcePage === c.chunkIndex) return null;
  return c.sourcePage;
}
