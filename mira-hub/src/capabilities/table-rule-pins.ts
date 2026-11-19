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
 *  (`model-scope-gate.ts`); absent = the page's rows were not reviewed. */
export type PagePin = { fingerprint: string; rules: readonly VerticalRule[]; reviewed?: string };
/** Page number (1-based, as a string key) to that page's pin. */
export type DocumentRulePins = Readonly<Record<string, PagePin>>;

const PINNED = pins.documents as unknown as Record<string, { source: string; pages: Record<string, PagePin> }>;

/** The pins of the document with exactly these bytes' SHA-256, or null when it is not pinned. */
export function rulePinsForSha(sha256: string): DocumentRulePins | null {
  return Object.hasOwn(PINNED, sha256) ? PINNED[sha256].pages : null;
}

const REVIEWED_DIGESTS: ReadonlySet<string> = new Set(
  Object.values(PINNED).flatMap((d) => Object.values(d.pages).map((p) => p.reviewed))
    .filter((d): d is string => typeof d === "string" && /^[0-9a-f]{64}$/.test(d)),
);

/** True while the shipped pin file still records `digest` as a page's reviewed rows. Retrieval
 *  honours a stored row's release stamp (`metadata.table_reviewed`) only while this holds, so
 *  removing an approval from the pin file withdraws every row released under it, with no
 *  reprocess and no need for the original file. */
export function isReviewedDigestActive(digest: unknown): boolean {
  return typeof digest === "string" && REVIEWED_DIGESTS.has(digest);
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
 *  pinned, the page is pinned, its text geometry matches and its rows were reviewed. */
export function reviewedRowsDigest(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): string | null {
  return matchingPin(document, pageNumber, items)?.reviewed ?? null;
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
