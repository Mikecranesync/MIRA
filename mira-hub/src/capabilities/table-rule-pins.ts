/**
 * Pinned table rules (#5503 F14/F15).
 *
 * Whether a non-row line under a model header (a group heading, a merged cell) belongs to that
 * table is decided by the table's own drawn vertical rules. Reading a page's drawing at upload
 * could not be made safe, so no drawing is read. The rules of the few manual pages that need
 * them were captured once, checked against a rendered image of the page, and are stored in
 * `table-rule-pins.json` keyed by the file's SHA-256 and page number.
 *
 * A document whose bytes are not pinned gets no rule evidence. A pinned page gets its rules only
 * while the text geometry read from it still matches the fingerprint taken at capture, so a
 * change in text extraction cannot move a pinned rule onto a different line. No evidence means
 * the line ends the table and what follows is withheld from its models.
 */
import { createHash } from "node:crypto";
import pins from "./table-rule-pins.json";

export type VerticalRule = { x: number; y0: number; y1: number };
/** `reviewed`: digest of the page's model-scope rows as checked against the page image
 *  (`model-scope-gate.ts`); absent = the page's rows were not reviewed.
 *  `release`: the approval switch of a reviewed page. Only the exact value `"enabled"` releases the
 *  reviewed rows; `"disabled"` (or anything else, or nothing) withdraws them everywhere while the
 *  approved digest stays recorded for the drift checks. Turning an approval off is a one-word
 *  change, never a deletion. */
export type PagePin = { fingerprint: string; rules: readonly VerticalRule[]; reviewed?: string; release?: string };

/** The reviewed digest of a pin only while its approval switch is enabled. */
function releasedDigest(pin: PagePin): string | null {
  return pin.release === "enabled" && typeof pin.reviewed === "string" ? pin.reviewed : null;
}
/** Page number (1-based, as a string key) to that page's pin. */
export type DocumentRulePins = Readonly<Record<string, PagePin>>;

const PINNED = pins.documents as unknown as Record<string, { source: string; pages: Record<string, PagePin> }>;

/** The pins of the document with exactly these bytes' SHA-256, or null when it is not pinned. */
export function rulePinsForSha(sha256: string): DocumentRulePins | null {
  return Object.hasOwn(PINNED, sha256) ? PINNED[sha256].pages : null;
}

/** True while the shipped pin of exactly this file (`sha256`) and page still records `digest` as
 *  that page's reviewed rows and its approval switch is enabled. A stored row released by the gate carries all three
 *  (`metadata.table_reviewed_sha`, its page, `metadata.table_reviewed`); retrieval honours the
 *  release only while this holds, so removing an approval from the pin file, for one file or for
 *  all, withdraws exactly the rows released under it, with no reprocess and no need for the
 *  original file. Anything missing or malformed is not a release. `lookup` exists for tests that
 *  stand stub bytes in for a pinned file; production always reads the shipped pins. */
export function isReleaseActive(sha256: unknown, pageNumber: unknown, digest: unknown,
  lookup: (sha256: string) => DocumentRulePins | null = rulePinsForSha): boolean {
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return false;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) return false;
  const page = typeof pageNumber === "string" && /^[1-9]\d*$/.test(pageNumber) ? Number(pageNumber) : pageNumber;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return false;
  const document = lookup(sha256);
  if (!document || !Object.hasOwn(document, String(page))) return false;
  return releasedDigest(document[String(page)]) === digest;
}

/** The shipped pins of every pinned file, keyed by SHA-256 (for `activeReleaseSql`). */
export function allRulePins(): Readonly<Record<string, DocumentRulePins>> {
  return Object.fromEntries(Object.entries(PINNED).map(([sha, document]) => [sha, document.pages]));
}

/** SQL condition (no parameters) on a `knowledge_entries` row that is true unless the row carries
 *  a release stamp (`metadata.table_reviewed`) or a hold mark (`metadata.table_held`) whose
 *  approval is not enabled now. A hold mark is written on every row of a page whose approval is
 *  recorded but switched off when the page is indexed (`heldRowsDigest`), so content an approval
 *  covers stays out of every answer while that approval is off, however and whenever it was
 *  indexed. Every query that can put a node row into an
 *  answer, a prompt or a citation adds `AND <this>`, so a withdrawn approval removes its released
 *  rows from every route at once, whatever the question names, with no reprocess and no need for
 *  the original file; the stored row itself is left as it is. The active releases are exactly the
 *  file, page and digest triples whose pin is enabled (`isReleaseActive`); with none, no stamped
 *  row qualifies. The values are pin-file hex and digits, validated here before they reach SQL.
 *  `documents` exists for tests that stand stub bytes in for a pinned file. */
export function activeReleaseSql(alias = "",
  documents: Readonly<Record<string, DocumentRulePins>> = allRulePins()): string {
  if (alias !== "" && !/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`activeReleaseSql: bad alias ${alias}`);
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  const stamp = `${col("metadata")}->>'table_reviewed'`;
  const held = `${col("metadata")}->>'table_held'`;
  const page = `COALESCE(${col("page_start")}, ${col("source_page")})::text`;
  const active: string[] = [];
  for (const sha of Object.keys(documents).sort()) {
    if (!/^[0-9a-f]{64}$/.test(sha)) continue;
    const pages = documents[sha];
    for (const page of Object.keys(pages).sort()) {
      const digest = releasedDigest(pages[page]);
      if (digest === null || !/^[1-9]\d*$/.test(page) || !/^[0-9a-f]{64}$/.test(digest)) continue;
      active.push(`('${sha}', '${page}', '${digest}')`);
    }
  }
  if (active.length === 0) return `(${stamp} IS NULL AND ${held} IS NULL)`;
  const triples = active.join(", ");
  return `((${stamp} IS NULL OR (${col("metadata")}->>'table_reviewed_sha', ${page}, ${stamp}) IN (${triples}))` +
    ` AND (${held} IS NULL OR (${col("metadata")}->>'table_held_sha', ${page}, ${held}) IN (${triples})))`;
}

/** Identity of a page's positioned text: every item's text and position, in reading order. */
export function layoutFingerprint(items: ReadonlyArray<{ str: string; x: number; y: number }>): string {
  const hash = createHash("sha256");
  for (const item of items) hash.update(`${item.str}\u0000${item.x.toFixed(2)}\u0000${item.y.toFixed(2)}\u0001`);
  return hash.digest("hex");
}

/** The pinned rules of one page, only when its text geometry is the geometry that was pinned. */
export function pinnedRules(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): readonly VerticalRule[] | null {
  return matchingPin(document, pageNumber, items)?.rules ?? null;
}

/** The pin of one page, only when its text geometry is the geometry that was pinned. */
function matchingPin(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): PagePin | null {
  const key = String(pageNumber);
  if (!document || !Object.hasOwn(document, key)) return null;
  const pin = document[key];
  return pin.fingerprint === layoutFingerprint(items) ? pin : null;
}

/** The reviewed-rows digest of one page of a pinned document: null unless the document is
 *  pinned, the page is pinned, its text geometry matches, its rows were reviewed and that
 *  approval is enabled. */
export function reviewedRowsDigest(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): string | null {
  const pin = matchingPin(document, pageNumber, items);
  return pin ? releasedDigest(pin) : null;
}

/** The recorded digest of one page whose approval is recorded but NOT enabled (same geometry check
 *  as `reviewedRowsDigest`); null otherwise. The writer marks that page's rows as held under it
 *  when they are exactly the reviewed rows, so the content stays out of answers until the
 *  approval is enabled again (`activeReleaseSql`). */
export function heldRowsDigest(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): string | null {
  const pin = matchingPin(document, pageNumber, items);
  if (!pin || typeof pin.reviewed !== "string" || releasedDigest(pin) !== null) return null;
  return pin.reviewed;
}

/** A rule runs through a text line only when it passes below the baseline and up through the
 * body of the letters; one that merely reaches the baseline stops at the line. */
const BELOW_BASELINE_PT = 1;
const ABOVE_BASELINE_PT = 4;

/** Indices of the rules whose extent runs through the text line at baseline `y`. */
export function rulesCrossing(rules: readonly VerticalRule[], y: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < rules.length; i++) if (rules[i].y0 <= y - BELOW_BASELINE_PT && y + ABOVE_BASELINE_PT <= rules[i].y1) ids.push(i);
  return ids;
}
