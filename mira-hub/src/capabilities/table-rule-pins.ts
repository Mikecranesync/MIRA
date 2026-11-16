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
export type PagePin = { fingerprint: string; rules: readonly VerticalRule[] };
/** Page number (1-based, as a string key) to that page's pin. */
export type DocumentRulePins = Readonly<Record<string, PagePin>>;

const PINNED = pins.documents as Record<string, { source: string; pages: Record<string, PagePin> }>;

/** The pins of the document with exactly these bytes' SHA-256, or null when it is not pinned. */
export function rulePinsForSha(sha256: string): DocumentRulePins | null {
  return Object.hasOwn(PINNED, sha256) ? PINNED[sha256].pages : null;
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
  const key = String(pageNumber);
  if (!document || !Object.hasOwn(document, key)) return null;
  const pin = document[key];
  return pin.fingerprint === layoutFingerprint(items) ? pin.rules : null;
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
