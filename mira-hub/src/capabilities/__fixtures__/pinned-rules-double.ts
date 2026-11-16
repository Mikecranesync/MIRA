/**
 * Test double for the document-identity boundary of pinned table rules (#5503 F14/F15).
 *
 * The writer tests simulate the PDF, so the bytes they pass are not a real manual and hash to
 * nothing pinned. This stands in for "these bytes are that manual": a captured page gets the REAL
 * pin of its source file, found by the real fingerprint of its text geometry (a test may place a
 * captured page at another page number). A page a test builds itself may declare `rules`; those
 * become a pin for that page alone. The page-number check is tested on the real lookup directly.
 */
import type { DocumentRulePins, PagePin, VerticalRule } from "../table-rule-pins";

type Actual = typeof import("../table-rule-pins");
export type DoublePage = { page: number; items: ReadonlyArray<{ str: string; x: number; y: number }>; rules?: readonly VerticalRule[] };

export function pinsDouble(actual: Actual, pages: readonly DoublePage[], sourceShas: readonly string[]): DocumentRulePins {
  const out: Record<string, PagePin> = {};
  for (const page of pages) {
    const fingerprint = actual.layoutFingerprint(page.items);
    if (page.rules) { out[String(page.page)] = { fingerprint, rules: page.rules }; continue; }
    for (const sha of sourceShas) {
      const pinned = Object.values(actual.rulePinsForSha(sha) ?? {}).find((pin) => pin.fingerprint === fingerprint);
      if (pinned) out[String(page.page)] = pinned;
    }
  }
  return out;
}
