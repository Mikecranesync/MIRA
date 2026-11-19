/**
 * Model scope fails closed (#5503).
 *
 * Reading a page's layout can go wrong in more ways than can be listed: twelve review rounds each
 * found a new layout that stored a value under a model it does not belong to. So the layout
 * reader no longer decides, on its own, that a passage belongs to a model. It may only WITHHOLD.
 *
 * A stored row affirms a model when retrieval would admit it for a record because of its tag: a
 * model-table column chunk, or text under a section caption that names catalog numbers. Such a
 * row is written as read only on a REVIEWED page: a page of a pinned file (`table-rule-pins.json`,
 * the file's SHA-256 and page number) whose text positions still match the capture and whose
 * affirming rows are byte-for-byte the rows that were checked against the page image. On every
 * other page the same text is stored, but withheld from a record that holds a catalog number.
 *
 * This is the only place that decision is made, and the row writer applies it to every page.
 */
import { createHash } from "node:crypto";

/** The model-scope part of one row about to be stored. */
export type ScopedRow = {
  content: string;
  tableModels?: string[];
  tableUnqualified?: boolean;
  tableScope?: "section" | "shared" | "unresolved";
  tableHeader?: string;
  /** Set by `gatePageRows` on a row it RELEASES: the reviewed digest it was released under, stored
   *  as `metadata.table_reviewed` (the writer adds the file's SHA-256 as `table_reviewed_sha`).
   *  Retrieval honours the release only while the pin of that file and page still carries this
   *  digest (`isReleaseActive`), and the stamp makes every released row queryable without the
   *  original file. Not part of `scopeDigest`. */
  tableReviewed?: string;
  /** Set by `gatePageRows` on EVERY row of a page whose approval is recorded but switched off when
   *  the rows are exactly that approval's rows: the recorded digest, stored as `metadata.table_held`
   *  (with `table_held_sha`). Retrieval serves such a row only while that approval is enabled.
   *  Not part of `scopeDigest`. */
  tableHeld?: string;
};

/** True when retrieval could admit this row for some record BECAUSE of its model scope. */
export function affirmsModel(row: ScopedRow): boolean {
  if (row.tableScope === "shared") return true;
  if ((row.tableModels?.length ?? 0) === 0) return false;
  return row.tableUnqualified !== true && row.tableScope !== "unresolved";
}

/** Identity of what a page affirms, in stored order: each affirming row's text, models and
 *  scope. Rows that affirm nothing are not part of it: they are withheld or plain text on any
 *  page, and some of them depend on the pages before (a table continued from the previous page). */
export function scopeDigest(rows: readonly ScopedRow[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    if (!affirmsModel(row)) continue;
    hash.update(JSON.stringify([row.content, row.tableModels ?? [], row.tableScope ?? null, row.tableHeader ?? null]));
    hash.update("\u0001");
  }
  return hash.digest("hex");
}

/**
 * The same row with its affirmation removed and its text untouched.
 *  - a model-table column chunk keeps its models and becomes an unqualified line of that table
 *    (retrieval withholds it from a record of that family and reports the page);
 *  - text under a catalog caption stays bound to those catalogs but unresolved (withheld from
 *    every record that holds a catalog number, the listed ones included);
 *  - a "shared header" passage becomes unresolved, withheld from every record that holds a
 *    catalog number.
 * A withheld row is never admitted for a record its input row would have refused.
 */
export function withheld<Row extends ScopedRow>(row: Row): Row {
  if (!affirmsModel(row)) return row;
  // A shared-header passage names no models of its own. Dropping only its "shared" reading would
  // let it be judged as untagged text, which admits a record whose number is in the header even
  // when the body is a sibling's: wider than before. Unresolved is excluded for every record.
  if ((row.tableModels?.length ?? 0) === 0) return { ...row, tableScope: "unresolved", tableUnqualified: true, tableHeader: undefined };
  if (row.tableScope === undefined) return { ...row, tableUnqualified: true };
  return { ...row, tableScope: "unresolved", tableUnqualified: true, tableHeader: undefined };
}

/**
 * One page's rows as they may be stored. `reviewed` is the digest recorded for this page when its
 * rows were checked against the page image, or null when the page is not a reviewed page. Rows
 * are released only when they are exactly the reviewed rows; each released (affirming) row is
 * stamped with that digest and is otherwise unchanged.
 */
export function gatePageRows<Row extends ScopedRow>(rows: readonly Row[], reviewed: string | null | undefined,
  held?: string | null): Row[] {
  if (typeof reviewed === "string" && reviewed.length === 64 && reviewed === scopeDigest(rows)) {
    return rows.map((row) => (affirmsModel(row) ? { ...row, tableReviewed: reviewed } : row));
  }
  const out = rows.map(withheld);
  if (typeof held === "string" && held.length === 64 && held === scopeDigest(rows)) return out.map((row) => ({ ...row, tableHeld: held }));
  return out;
}
