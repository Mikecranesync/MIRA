/**
 * #4508 — plan a `metadata.page_label` backfill for ONE already-ingested PDF.
 *
 * Uploads before the ingest change carry no printed page labels, and the
 * upload bytes are deleted after parsing, so the labels can only come from a
 * local copy of the PDF. This planner refuses the whole document unless every
 * stored row is placed on its recorded page of that copy: the row's opening
 * text (whitespace-normalised) must appear in the local text of the same page.
 * Identical chunking is NOT required — chunk boundaries drift between parser
 * builds (staging ACS355, 2026-11-01: 258 of 974 rows chunked differently, all
 * 974 on their own page), while the page index a row came from does not. A
 * text-repaired row (decoded after extraction) is checked by page range only.
 * Pure: it plans, the caller writes.
 */

export type BackfillRow = {
  id: string;
  sourcePage: number | null;
  content: string;
  pageLabel: string | null;
  textRepair: string | null;
};

export type BackfillRefusal =
  | "no_labels"
  | "no_rows"
  | "page_out_of_range"
  | "content_not_on_page"
  | "label_conflict";

export type BackfillPlan =
  | { ok: true; updates: Array<{ id: string; label: string }>; unchanged: number }
  | { ok: false; reason: BackfillRefusal };

/** Opening characters of a row that must be found on its page. */
const PROBE_CHARS = 60;

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

export function planPageLabelBackfill(
  rows: readonly BackfillRow[],
  pages: readonly string[],
  labels: ReadonlyArray<string | null> | null,
): BackfillPlan {
  if (!labels || labels.length !== pages.length) return { ok: false, reason: "no_labels" };
  if (rows.length === 0) return { ok: false, reason: "no_rows" };

  const pageText = pages.map(normalise);
  const updates: Array<{ id: string; label: string }> = [];
  let unchanged = 0;
  for (const row of rows) {
    const p = row.sourcePage;
    if (p == null || !Number.isInteger(p) || p < 1 || p > pages.length) {
      return { ok: false, reason: "page_out_of_range" };
    }
    if (!row.textRepair && !pageText[p - 1].includes(normalise(row.content).slice(0, PROBE_CHARS))) {
      return { ok: false, reason: "content_not_on_page" };
    }

    const label = labels[p - 1];
    if (row.pageLabel) {
      if (row.pageLabel !== label) return { ok: false, reason: "label_conflict" };
      unchanged++;
    } else if (label) {
      updates.push({ id: row.id, label });
    } else {
      unchanged++;
    }
  }
  return { ok: true, updates, unchanged };
}
