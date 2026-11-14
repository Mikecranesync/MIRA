/** Model applicability belongs to a section, before text windows are made (#5503).
 * No question words or model-specific constants: qualified layout captions supply explicit
 * scope; a complete per-model output-circuit row supplies relay applicability independently.
 */
import { exactModelKey, type LayoutItem, type TableChunk } from "./table-rows";
import { modelNumbersIn, sameModelFamily } from "./manual-applicability";

export type SectionScope = "section" | "shared" | "unresolved";
export type ScopedText = { text: string; models?: string[]; scope?: SectionScope; sharedHeader?: string };
type Heading = { text: string; at: number; table: boolean; size: number; sharedHeader?: string; relayTable?: boolean; sourceLine: number };
export type SectionLayout = { text: string; headings: Heading[]; hasTables: boolean; retainedLines: string[] };
type OutputMap = Map<string, boolean | null>;

/** A complete model-column table, with an explicit circuit type for every column. Unknown or
 * contradictory values prevent inferred relay restrictions. Relay/FET remains relay-capable.
 * Arbitrary model-keyed/accessory/VA tables cannot establish this evidence. */
export function readOutputTypes(chunks: readonly TableChunk[]): OutputMap {
  const qualified = chunks.filter((c) => !c.unqualified);
  // Preserve an observed but unreadable inventory. Dropping it would make relay evidence
  // ordinary unscoped text again. Tables with no circuit-type row establish no inventory.
  if (!chunks.some((c) => /\bOutput circuit type\b/i.test(c.text))) return new Map();
  const allModels = [...new Set(chunks.flatMap((c) => c.models.map(exactModelKey)))];
  if (allModels.length < 2) return new Map();
  const numbers = allModels.map((key) => modelNumbersIn(key)[0]);
  if (numbers.some((n) => !n) || !numbers.every((n) => sameModelFamily(numbers[0], n))) return new Map();
  const models: OutputMap = new Map(allModels.map((model) => [model, null]));
  const entries = qualified.flatMap((c) => {
    // Fold EVERY visible type row, even if two occur in one text window. A first-row win
    // would hide a later contradiction; windows containing only other attributes contribute none.
    return c.text.split("\n").filter((l) => /^[^:]+:\s*Output circuit type\s+/i.test(l)).map((line) => {
      const value = line.replace(/^[^:]+:\s*Output circuit type\s+/i, "");
      const relay = /^Relay(?:\s*\/\s*FET)?(?:\s*\([^)]*\))?(?:\s*;\s*FET\s*\([^)]*\))?(?:\s+(?:Ordinary|Hazardous) location\b.*)?$/i.test(value) ? true
        : /^(?:(?:\d+(?:\.\d+)?\s*V\s*)?DC\s+(?:source|sink)|Transistor|FET|Solid[- ]state(?:\s+(?:source|sink))?)(?:\s*\([^)]*\))?$/i.test(value) ? false : null;
      return [c.models.length === 1 ? exactModelKey(c.models[0]) : "", relay] as const;
    });
  });
  const read = new Set<string>();
  for (const [model, value] of entries) {
    if (!model) continue;
    models.set(model, read.has(model) && models.get(model) !== value ? null : value);
    read.add(model);
  }
  return models;
}

export function mergeOutputTypes(target: OutputMap, incoming: OutputMap): void {
  for (const [model, relay] of incoming) {
    target.set(model, target.has(model) && target.get(model) !== relay ? null : relay);
  }
}

/** Ignore model labels ONLY in the exact, layout-proven mixed-column header, never prose.
 * Old shared markers without this proof get the normal sibling-number check. */
export function withoutSharedTableHeader(text: string, header: unknown): string {
  if (typeof header !== "string" || !header.trim()) return text;
  const pattern = header.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return text.replace(new RegExp(pattern), " ");
}

/** Render every positioned item once, in page reading order. Caption positions, rather than
 * unpdf's object order, delimit sections (real p20 puts its top caption AFTER its lower chart).
 * Only pages containing a layout-qualified table caption use this rendering at ingest.
 */
export function sectionTableLayout(items: readonly LayoutItem[], includeBoundaries = true, remainderItems?: readonly LayoutItem[], annotation?: { after: LayoutItem; lines: string[] }): SectionLayout | null {
  if (annotation && !items.includes(annotation.after)) throw new Error("contact-column source row is not in this page's positioned items");
  const retained = remainderItems ? new Set(remainderItems) : null;
  const lines: Array<{ text: string; y: number; x: number; size: number; runs: number; removed: boolean; virtual: boolean }> = [];
  const bands: LayoutItem[][] = [];
  for (const item of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = bands.at(-1);
    if (last && Math.abs(last.at(-1)!.y - item.y) <= 2.5) last.push(item);
    else bands.push([item]);
  }
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x);
    const runs = band.filter((item, i) => i === 0 || item.x - (band[i - 1].x + band[i - 1].w) > 6).length;
    lines.push({ text: band.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " "),
      y: band[0].y, x: band[0].x, size: Math.max(...band.map((i) => i.size)), runs,
      removed: !!retained && band.every((item) => !retained.has(item)), virtual: false });
    // Derived contact columns belong to their physical source table, even when that table
    // was extracted into separate model chunks. Never append them under a later caption.
    if (annotation && band.includes(annotation.after)) {
      for (const text of annotation.lines) lines.push({ text, y: band[0].y, x: band[0].x, size: 0, runs: 1, removed: false, virtual: true });
    }
  }
  const captions = new Map<number, { text: string; end: number; sharedHeader?: string; relayTable: boolean }>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.virtual || line.text.length > 200) continue;
    let end = i;
    // Catalog lists may wrap. A continuation must keep the caption's font, left edge and pitch.
    while (end + 1 < lines.length && end - i < 3) {
      const next = lines[end + 1];
      if (next.virtual || Math.abs(next.size - line.size) > 0.2 || Math.abs(next.x - line.x) > 4 ||
          lines[end].y - next.y > line.size * 1.6 || !/^[A-Z0-9][A-Z0-9(), /–.-]*$/i.test(next.text) || modelNumbersIn(next.text).length === 0) break;
      end++;
    }
    const below = lines.slice(end + 1).filter((l) => !l.virtual && lines[end].y - l.y <= 60);
    const header = below.find((l) => /\b(?:Attribute|Description)\b/i.test(l.text));
    // Rating heads are short labels, not a footnote describing make/break arithmetic.
    // Smaller-font prose below a value row must not turn that row into a new caption.
    const headerLines = below.filter((l) => l.text.length <= 80 &&
      !l.text.replace(/\b(?:Maximum|Max|Volts|Amps|Amperes|Voltamperes|Continuous|Make|Break|Current|per|Point)\b/gi, "").replace(/[\s\d().,/–—-]/g, ""));
    const ratingHeader = headerLines.map((l) => l.text).join(" ");
    const ratingHeads = headerLines.filter((l) => /\b(?:Make|Break|Continuous)\b/i.test(l.text));
    const ratingHeadSize = Math.max(...ratingHeads.map((l) => l.size));
    const firstHead = ratingHeads.length > 0 ? lines.indexOf(ratingHeads[0]) : end + 1;
    // Identify the contact-table KIND from the page's heads, not its caption vocabulary.
    // Only its nearest larger-font caption qualifies; preceding body lines and page titles do not.
    const isRating = /\bMake\b/i.test(ratingHeader) && /\bBreak\b/i.test(ratingHeader) &&
      /\bContinuous\b/i.test(ratingHeader) && line.size > ratingHeadSize &&
      !lines.slice(end + 1, firstHead).some((l) => l.size > ratingHeadSize);
    const attributeCaption = /\b(?:Specifications|Requirements|Ratings|Relay|Contact)\b/i.test(line.text) &&
      header && header.size < line.size;
    if (!attributeCaption && !isRating) continue;
    // A mixed header has Attribute plus at least TWO value columns. Its model labels may
    // qualify just one sub-column, as on real DC-input p18. No header privilege for prose.
    let sharedHeader: string | undefined;
    if (header && header.runs >= 3) {
      const headerStart = lines.indexOf(header);
      let headerEnd = headerStart + 1;
      while (headerEnd < lines.length && !lines[headerEnd].virtual && lines[headerEnd].x > header.x + 4 &&
             Math.abs(lines[headerEnd].size - header.size) <= 0.2 &&
             lines[headerEnd - 1].y - lines[headerEnd].y <= header.size * 1.6 &&
             header.y - lines[headerEnd].y <= 60) {
        const catalogLabels = modelNumbersIn(lines[headerEnd].text);
        if (catalogLabels.length > 0) {
          let rest = lines[headerEnd].text;
          for (const n of catalogLabels) rest = rest.replace(new RegExp(n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
          rest = rest.replace(/\([A-Z]\)/gi, "").replace(/\b(?:for|and|or|only)\b/gi, "").replace(/[\s(),;./–—-]/g, "");
          if (rest) break; // catalog-bearing prose is not a column label, even in header typography
        }
        headerEnd++;
      }
      const candidate = lines.slice(headerStart, headerEnd).map((l) => l.text).join("\n");
      if (modelNumbersIn(candidate).length > 0) sharedHeader = candidate;
    }
    captions.set(i, { text: lines.slice(i, end + 1).map((l) => l.text).join(" "), end, sharedHeader,
      relayTable: isRating || /\brelay\b/i.test(line.text) });
  }
  if (captions.size === 0 && !includeBoundaries) return null;
  const sizes = new Map<number, number>();
  for (const line of lines) if (!line.virtual) sizes.set(line.size, (sizes.get(line.size) ?? 0) + line.text.length);
  const bodySize = Math.min(...sizes.keys());
  const captionSize = captions.size > 0 ? Math.min(...[...captions.keys()].map((i) => lines[i].size)) : bodySize + 0.5;
  const headings: Heading[] = [];
  let at = 0;
  let continuationEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const caption = captions.get(i);
    if (!line.virtual && i > continuationEnd && (caption || (line.size >= captionSize && line.text.length < 200))) {
      headings.push({ text: caption?.text ?? line.text, at, table: !!caption, size: line.size,
        ...(caption?.sharedHeader ? { sharedHeader: caption.sharedHeader } : {}),
        ...(caption?.relayTable ? { relayTable: true } : {}),
        // The source ordinal applies to retained AND intentionally removed headings.
        // Identical labels and prose references cannot move a physical boundary.
        sourceLine: lines.slice(0, i).filter((l) => !l.removed).length });
      if (caption) continuationEnd = caption.end;
    }
    at += line.text.length + 1;
  }
  const retainedLines = lines.filter((l) => !l.removed).map((l) => l.text);
  return headings.length > 0 ? { text: retainedLines.join("\n"), headings, hasTables: captions.size > 0, retainedLines } : null;
}

/** Per-document state, never shared across uploads. Captions reset scope; text windows inherit
 * the resulting scope. All-model sections have an explicit shared marker so catalog numbers
 * in a SUB-column (real DC-input table) do not turn the whole section into sibling-only prose.
 */
export class SectionTableScope {
  private active: Pick<ScopedText, "models" | "scope" | "sharedHeader"> = {};
  private headingSize = 0;
  private hasReadableSection = false;
  constructor(private readonly outputs: OutputMap, private readonly observed = outputs.size > 0) {}

  unreadable(text: string): ScopedText[] {
    // A missing layout cannot establish that the preceding section continues. Keep its text,
    // but withhold it for a confirmed model until a readable caption establishes applicability.
    // Empty padding before the first readable section has no scope to interrupt. Once a
    // section has been established, a blank/image-only gap breaks its proven continuity.
    if (!text.trim() && !this.hasReadableSection && !this.active.scope) return [{ text }];
    this.active = this.observed ? { models: [...this.outputs.keys()], scope: "unresolved" } : {};
    return [{ text, ...this.active }];
  }

  split(text: string, layout: SectionLayout | null): ScopedText[] {
    if (!this.observed) return [{ text }];
    if (!layout) {
      // A shared marker suppresses prose model detection; never carry that privilege into a
      // page with no readable layout. An explicit restriction may continue conservatively.
      if (this.active.scope === "shared") this.active = {};
      return [{ text, ...this.active }];
    }
    // With no inherited scope and no table caption, there is no applicability boundary to
    // split. Preserve original text AND window boundaries on unrelated prose pages.
    if (!layout.hasTables && (!this.active.scope || this.active.scope === "shared")) {
      this.active = {}; // a mixed-column header's privilege never crosses onto another page
      return [{ text }];
    }
    // An inherited section interrupted by a physical heading needs physical order. PDF
    // object order can put the new section's body before its heading (real p20 does this).
    // Unrelated plain pages above retain original bytes; model-table remainders stay grids-out.
    if (!layout.hasTables && this.headingSize > 0 &&
        layout.headings.some((h) => h.size >= this.headingSize) && layout.text) text = layout.text;
    // A missing table boundary is uncertainty, never permission to inherit the previous scope.
    // Bind every heading to the exact physical source sequence, never a text occurrence.
    let at = 0;
    const actual = text.split("\n").map((line) => {
      const start = at; at += line.length + 1;
      return { text: line.replace(/\s+/g, " ").trim(), at: start };
    });
    if (layout.retainedLines.length !== actual.length || layout.retainedLines.some((line, i) => line !== actual[i].text)) return this.unreadable(text);
    const offsets = [...actual.map((line) => line.at), text.length];
    if (layout.headings.some((h) => offsets[h.sourceLine] === undefined)) return this.unreadable(text);
    const headings = layout.headings.map((h) => ({ ...h, at: offsets[h.sourceLine] }));
    const sections: ScopedText[] = [];
    let start = 0;
    for (const h of headings) {
      if (!h.table && (this.headingSize === 0 || h.size < this.headingSize)) continue; // running page furniture
      if (h.at > start) sections.push({ text: text.slice(start, h.at), ...this.active });
      this.active = {};
      this.headingSize = h.size;
      if (h.table) {
        this.hasReadableSection = true;
        const lastFor = [...h.text.matchAll(/\bfor\s+/gi)].at(-1);
        const afterFor = lastFor ? h.text.slice(lastFor.index! + lastFor[0].length) : "";
        const known = [...this.outputs.keys()].flatMap((key) => modelNumbersIn(key));
        const oneFamily = known.length > 0 && known.every((n) => sameModelFamily(known[0], n));
        const named = modelNumbersIn(afterFor).filter((n) => known.some((own) => sameModelFamily(own, n)));
        if (named.length > 0) this.active = { models: [...new Set(named.map((n) => n.key))], scope: "section" };
        else if ((!afterFor || modelNumbersIn(afterFor).length === 0) || (h.relayTable && this.outputs.size === 0)) {
          if (h.relayTable) {
            const values = [...this.outputs.values()];
            const relays = [...this.outputs].filter(([, relay]) => relay === true).map(([model]) => model);
            const canonical = /^Relay\s+(?:Contact Ratings|Output Specifications)(?:\s*\(\d+\))?$/i.test(h.text);
            const allRelay = oneFamily && values.length > 0 && values.every((v) => v === true);
            if (canonical && oneFamily && !values.includes(null) && values.includes(false) && relays.length > 0) {
              this.active = { models: relays, scope: "section" };
            } else if (!allRelay) {
              this.active = { models: [...this.outputs.keys()], scope: "unresolved" };
            }
          } else if (oneFamily && h.sharedHeader) {
            this.active = { scope: "shared", sharedHeader: h.sharedHeader };
          }
        }
      }
      start = h.at;
    }
    sections.push({ text: text.slice(start), ...this.active });
    return sections;
  }
}
