/** Model applicability belongs to a section, before text windows are made (#5503).
 * No question words or model-specific constants: qualified layout captions supply explicit
 * scope; a complete per-model output-circuit row supplies relay applicability independently.
 */
import { exactModelKey, type LayoutItem, type TableChunk } from "./table-rows";
import { modelNumbersIn, sameModelFamily } from "./manual-applicability";

export type SectionScope = "section" | "shared" | "unresolved";
export type ScopedText = { text: string; models?: string[]; scope?: SectionScope };
type Heading = { text: string; at: number; table: boolean; size: number };
export type SectionLayout = { text: string; headings: Heading[] };
type OutputMap = Map<string, boolean | null>;

/** A complete model-column table, with an explicit circuit type for every column. Unknown or
 * contradictory values prevent inferred relay restrictions. Relay/FET remains relay-capable.
 * Arbitrary model-keyed/accessory/VA tables cannot establish this evidence. */
export function readOutputTypes(chunks: readonly TableChunk[]): OutputMap {
  const qualified = chunks.filter((c) => !c.unqualified);
  if (qualified.length < 2 || qualified.some((c) => c.models.length !== 1)) return new Map();
  const entries = qualified.map((c) => {
    const line = c.text.split("\n").find((l) => /^[^:]+:\s*Output circuit type\s+/i.test(l));
    const value = line?.replace(/^[^:]+:\s*Output circuit type\s+/i, "");
    const relay = value && /^Relay(?:\s*\/\s*FET)?(?:\s*\([^)]*\))?(?:\s*;\s*FET\s*\([^)]*\))?(?:\s+(?:Ordinary|Hazardous) location\b.*)?$/i.test(value) ? true
      : value && /^(?:(?:\d+(?:\.\d+)?\s*V\s*)?DC\s+(?:source|sink)|Transistor|FET|Solid[- ]state(?:\s+(?:source|sink))?)(?:\s*\([^)]*\))?$/i.test(value) ? false : null;
    return [exactModelKey(c.models[0]), relay] as const;
  });
  if (entries.some(([, v]) => v === null)) return new Map();
  const models = new Map(entries);
  if (entries.some(([model, value]) => models.get(model) !== value) ||
      chunks.some((c) => c.models.some((m) => !models.has(exactModelKey(m))))) return new Map();
  const numbers = entries.map(([key]) => modelNumbersIn(key)[0]);
  if (numbers.some((n) => !n) || !numbers.every((n) => sameModelFamily(numbers[0], n))) return new Map();
  return new Map(entries);
}

export function mergeOutputTypes(target: OutputMap, incoming: OutputMap): void {
  for (const [model, relay] of incoming) {
    target.set(model, target.has(model) && target.get(model) !== relay ? null : relay);
  }
}

/** Render every positioned item once, in page reading order. Caption positions, rather than
 * unpdf's object order, delimit sections (real p20 puts its top caption AFTER its lower chart).
 * Only pages containing a layout-qualified table caption use this rendering at ingest.
 */
export function sectionTableLayout(items: readonly LayoutItem[], includeBoundaries = true): SectionLayout | null {
  const lines: Array<{ text: string; y: number; x: number; size: number }> = [];
  const bands: LayoutItem[][] = [];
  for (const item of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = bands.at(-1);
    if (last && Math.abs(last[0].y - item.y) <= 2.5) last.push(item);
    else bands.push([item]);
  }
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x);
    lines.push({ text: band.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " "),
      y: band[0].y, x: band[0].x, size: Math.max(...band.map((i) => i.size)) });
  }
  const captions = new Map<number, { text: string; end: number }>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\b(?:Specifications|Requirements|Ratings)\b/i.test(line.text) || line.text.length > 200) continue;
    let end = i;
    // Catalog lists may wrap. A continuation must keep the caption's font, left edge and pitch.
    while (end + 1 < lines.length && end - i < 3) {
      const next = lines[end + 1];
      if (Math.abs(next.size - line.size) > 0.2 || Math.abs(next.x - line.x) > 4 ||
          lines[end].y - next.y > line.size * 1.6 || !/^[A-Z0-9][A-Z0-9(), /–.-]*$/i.test(next.text) || modelNumbersIn(next.text).length === 0) break;
      end++;
    }
    const below = lines.slice(end + 1).filter((l) => lines[end].y - l.y <= 60);
    const header = below.find((l) => /\b(?:Attribute|Description)\b/i.test(l.text));
    const ratingHeader = below.map((l) => l.text).join(" ");
    const isRating = /\bRatings\b/i.test(line.text) && /\bMake\b/i.test(ratingHeader) &&
      /\bBreak\b/i.test(ratingHeader) && /\bContinuous\b/i.test(ratingHeader);
    if (!(header && header.size < line.size) && !isRating) continue;
    captions.set(i, { text: lines.slice(i, end + 1).map((l) => l.text).join(" "), end });
  }
  if (captions.size === 0 && !includeBoundaries) return null;
  const sizes = new Map<number, number>();
  for (const line of lines) sizes.set(line.size, (sizes.get(line.size) ?? 0) + line.text.length);
  const bodySize = Math.min(...sizes.keys());
  const captionSize = captions.size > 0 ? Math.min(...[...captions.keys()].map((i) => lines[i].size)) : bodySize + 0.5;
  const headings: Heading[] = [];
  let at = 0;
  let continuationEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const caption = captions.get(i);
    if (i > continuationEnd && (caption || (line.size >= captionSize && line.text.length < 200))) {
      headings.push({ text: caption?.text ?? line.text, at, table: !!caption, size: line.size });
      if (caption) continuationEnd = caption.end;
    }
    at += line.text.length + 1;
  }
  return headings.length > 0 ? { text: lines.map((l) => l.text).join("\n"), headings } : null;
}

/** Per-document state, never shared across uploads. Captions reset scope; text windows inherit
 * the resulting scope. All-model sections have an explicit shared marker so catalog numbers
 * in a SUB-column (real DC-input table) do not turn the whole section into sibling-only prose.
 */
export class SectionTableScope {
  private active: Pick<ScopedText, "models" | "scope"> = {};
  private headingSize = 0;
  constructor(private readonly outputs: OutputMap) {}

  unreadable(text: string): ScopedText[] {
    // A missing layout cannot establish that the preceding section continues. Keep its text,
    // but withhold it for a confirmed model until a readable caption establishes applicability.
    this.active = this.outputs.size > 0 ? { models: [...this.outputs.keys()], scope: "unresolved" } : {};
    return [{ text, ...this.active }];
  }

  split(text: string, layout: SectionLayout | null): ScopedText[] {
    if (this.outputs.size === 0) return [{ text }];
    if (!layout) {
      // A shared marker suppresses prose model detection; never carry that privilege into a
      // page with no readable layout. An explicit restriction may continue conservatively.
      if (this.active.scope === "shared") this.active = {};
      return [{ text, ...this.active }];
    }
    // Existing model-table remainder is already layout ordered. A removed caption is skipped,
    // never used to tag another table's text. Resolve offsets in that remainder, not the PDF.
    let seek = 0;
    const headings = layout.headings.flatMap((h) => {
      // Match the WHOLE wrapped caption, in order. Prefix matching would conflate two
      // "Output Specifications for ..." sections and give both bodies the last one's models.
      const pattern = h.text.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
      const match = new RegExp(pattern, "g");
      match.lastIndex = seek;
      const found = match.exec(text);
      if (!found) return [];
      seek = found.index + found[0].length;
      return [{ ...h, at: found.index }];
    });
    const sections: ScopedText[] = [];
    let start = 0;
    for (const h of headings) {
      if (!h.table && h.size < this.headingSize) continue; // running page furniture
      if (h.at > start) sections.push({ text: text.slice(start, h.at), ...this.active });
      this.active = {};
      this.headingSize = h.size;
      if (h.table) {
        const lastFor = [...h.text.matchAll(/\bfor\s+/gi)].at(-1);
        const afterFor = lastFor ? h.text.slice(lastFor.index! + lastFor[0].length) : "";
        const known = [...this.outputs.keys()].flatMap((key) => modelNumbersIn(key));
        const oneFamily = known.length > 0 && known.every((n) => sameModelFamily(known[0], n));
        const named = modelNumbersIn(afterFor).filter((n) => known.some((own) => sameModelFamily(own, n)));
        if (named.length > 0) this.active = { models: [...new Set(named.map((n) => n.key))], scope: "section" };
        else if (oneFamily && (!afterFor || modelNumbersIn(afterFor).length === 0)) {
          this.active = { scope: "shared" };
          if (/^Relay\s+(?:Contact Ratings|Output Specifications)\b/i.test(h.text)) {
            const values = [...this.outputs.values()];
            const relays = [...this.outputs].filter(([, relay]) => relay === true).map(([model]) => model);
            if (!values.includes(null) && values.includes(false) && relays.length > 0) {
              this.active = { models: relays, scope: "section" };
            }
          }
        }
      }
      start = h.at;
    }
    sections.push({ text: text.slice(start), ...this.active });
    return sections;
  }
}
