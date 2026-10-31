// Moved verbatim from lib/manual-rag.ts (#1875) so the notebook chat route can
// read the fault-code detector without importing the retrieval module.
// manual-rag re-exports it, so existing importers are unchanged.

// #1875 — fault-code token detector. A SINGLE letter followed by 2-4 digits:
// matches F004, F0004, E001, A002 (and parameter tokens like b005 — boosting a
// chunk that names them verbatim is still good retrieval). Deliberately does
// NOT match two-letter model prefixes (PF525, GS10) or bare model numbers
// (525) so the code pass never fires on a vendor/model token. Known limit:
// single-digit codes ("F4") are not matched — widening to \d{1,4} would start
// catching false positives, so terse codes rely on the normal BM25 path.
const FAULT_CODE_RE = /\b[A-Za-z]\d{2,4}\b/g;

/**
 * Extract fault-code tokens from a query, uppercased and de-duplicated.
 * Exported for unit testing. Empty array ⇒ the caller skips the code pass.
 */
export function extractFaultCodes(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of query.matchAll(FAULT_CODE_RE)) {
    const code = m[0].toUpperCase();
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
