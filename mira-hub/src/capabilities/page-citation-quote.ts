import { queryTerms, relevantQuoteWindow } from "@/lib/quote-window";

/**
 * The quote for one cited page when several retrieved chunks share it (#5132). The page's
 * citation used to quote whichever chunk came first in retrieval order, so a page whose
 * first chunk was an unrelated table quoted the table. The chunk sharing the most distinct
 * question terms wins; a tie keeps the earliest, so a single-chunk page — and a page where
 * no chunk shares a term — quotes exactly what it quoted before.
 */
export function pageCitationQuote(contents: readonly string[], question: string): string {
  const terms = queryTerms(question);
  let best = 0;
  let bestHits = -1;
  contents.forEach((content, i) => {
    const words = new Set(content.toLowerCase().split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, "")));
    const hits = terms.filter((t) => words.has(t)).length;
    if (hits > bestHits) {
      best = i;
      bestHits = hits;
    }
  });
  return relevantQuoteWindow(contents[best] ?? "", question);
}
