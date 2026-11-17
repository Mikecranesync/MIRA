/**
 * Table rows at upload (garage pilot plan row 1-A) — shared PDF layout-item reader.
 *
 * `pageLayoutItems` fetches one page's positioned text items the same way the work packet's
 * caption reader does (`getPage(n).getTextContent()`), converting pdf.js's `transform` array into
 * the flat `{str,x,y,w,size}` shape `table-rows.ts` and `work-packet/pdf-figure-lines.ts` both
 * already use. Pages are read one at a time, and `page.cleanup()` is called when the proxy exposes
 * it, so peak memory for a long manual stays one page, not the whole document. Returns an empty
 * array when the proxy has no `getPage` (an older/stub proxy) — the caller then falls back to flat
 * text, never a half-read table.
 *
 * `layoutItemsFromTextContent` is the pure half: just the transform -> LayoutItem conversion, with
 * no `getTextContent()`/`cleanup()` call of its own. A caller that already fetched the page's text
 * content and owns that page's lifecycle (abort handling, its own `cleanup()` — e.g.
 * `work-packet/document-text.ts`'s `readPdfPages`) reuses this conversion directly, so the page is
 * never fetched or cleaned up twice.
 */

import { pinnedRules, rulePinsForSha, rulesCrossing } from "./table-rule-pins";

/** `vr`: indices of the page's pinned vertical rules crossing this item's baseline (absent = no rule evidence); `vrx`: those rules' x positions, index-aligned. */
export type LayoutItem = { str: string; x: number; y: number; w: number; size: number; vr?: readonly number[]; vrx?: readonly number[] };

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

interface PdfTextContent {
  items: unknown[];
}

interface PdfPage {
  getTextContent: () => Promise<PdfTextContent>;
  cleanup?: () => boolean;
}

interface PdfDocumentProxy {
  getPage?: (pageNumber: number) => Promise<PdfPage>;
}

/** Converts an already-fetched page's `getTextContent()` result into `LayoutItem[]`. Pure. */
export function layoutItemsFromTextContent(content: PdfTextContent): LayoutItem[] {
  const items: LayoutItem[] = [];
  for (const raw of content.items) {
    const it = raw as PdfTextItem;
    if (!it || typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
    const [, b, , d, x, y] = it.transform;
    items.push({ str: it.str, x, y, w: it.width ?? 0, size: Math.round(Math.hypot(b, d) * 10) / 10 });
  }
  return items;
}

/**
 * Annotates each item with the pinned vertical rules crossing its baseline (#5503 F14/F15). The
 * page's drawing is never read: rules exist only for a pinned document's pinned page whose text
 * geometry still matches. Anything else leaves the items unannotated, which downstream means
 * "no rule evidence" and grants nothing.
 */
function annotateRules(documentSha256: string | undefined, pageNumber: number, items: LayoutItem[]): void {
  if (!documentSha256) return;
  const rules = pinnedRules(rulePinsForSha(documentSha256), pageNumber, items);
  if (!rules || rules.length === 0) return;
  for (const item of items) {
    const crossing = rulesCrossing(rules, item.y);
    if (crossing.length > 0) {
      item.vr = crossing;
      item.vrx = crossing.map((id) => rules[id].x);
    }
  }
}

/** One page's positioned text items, fetched and released by this call alone. `documentSha256`
 * is the SHA-256 of the PDF bytes; without it the items carry no rule evidence. */
export async function pageLayoutItems(pdf: PdfDocumentProxy, pageNumber: number, documentSha256?: string): Promise<LayoutItem[]> {
  if (!pdf.getPage) return [];
  const page = await pdf.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    const items = layoutItemsFromTextContent(content);
    annotateRules(documentSha256, pageNumber, items);
    return items;
  } finally {
    if (page.cleanup && !page.cleanup()) {
      throw new Error("PDF page resources could not be released");
    }
  }
}
