/** Exact, unique quote matching against PDF.js text runs. No fuzzy/numeric-only
 * fallback: an unavailable anchor is preferable to marking the wrong evidence. */
export type PdfTextRun = { str: string; transform: number[]; width: number; height: number; fontName: string };
export type HighlightRect = { left: number; top: number; width: number; height: number };
export type QuoteAnchor = { rects: HighlightRect[]; message: string };
const normalize = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
export function anchorQuote(quote: string | null, runs: PdfTextRun[], viewport: {
  width: number; height: number; convertToViewportPoint(x: number, y: number): number[];
}, styles: Record<string, { ascent?: number; descent?: number }> = {}): QuoteAnchor {
  const unavailable = (reason: string): QuoteAnchor => ({ rects: [], message: `Highlight unavailable: ${reason}` });
  const needle = normalize(quote ?? "");
  if (needle.length < 12 || !/\p{L}/u.test(needle)) return unavailable("the citation has no sufficiently detailed quote.");
  runs = runs.filter(run => normalize(run.str).length > 0);
  const parts = runs.map(run => normalize(run.str));
  const text = parts.join(" ");
  const start = text.indexOf(needle);
  if (start < 0) return unavailable("the quoted text was not found on this page. Check the original below.");
  if (text.indexOf(needle, start + 1) >= 0) return unavailable("the quoted text occurs more than once on this page.");
  const rects: HighlightRect[] = [];
  let offset = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const end = offset + parts[i].length;
    if (end > start && offset < start + needle.length && parts[i]) {
      const [a, b, c, d, x, y] = run.transform;
      const magnitude = Math.hypot(a, b);
      const vertical = Math.hypot(c, d);
      if (![a,b,c,d,x,y,run.width,run.height].every(Number.isFinite) || magnitude <= 0 || vertical <= 0 || run.width <= 0) return unavailable("this PDF's text geometry cannot be highlighted reliably.");
      const style = styles[run.fontName];
      const ascent = style?.ascent ?? 0.8;
      const descent = style?.descent ?? -0.2;
      const points = [0, run.width].flatMap(dx => [descent, ascent].map(dy =>
        viewport.convertToViewportPoint(x + a / magnitude * dx + c * dy, y + b / magnitude * dx + d * dy)));
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const left = Math.max(0, Math.min(...xs)), top = Math.max(0, Math.min(...ys));
      const right = Math.min(viewport.width, Math.max(...xs)), bottom = Math.min(viewport.height, Math.max(...ys));
      if (![left,top,right,bottom].every(Number.isFinite) || right <= left || bottom <= top) return unavailable("the matching text is outside the visible page.");
      rects.push({ left: left / viewport.width * 100, top: top / viewport.height * 100, width: (right-left) / viewport.width * 100, height: (bottom-top) / viewport.height * 100 });
    }
    offset = end + 1;
  }
  return rects.length ? { rects, message: "Quoted passage located. Highlight covers the matching PDF text runs; compare the quote with the original." } : unavailable("this page has no selectable text.");
}
