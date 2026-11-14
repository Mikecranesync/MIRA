/** Model applicability belongs to a section, before text windows are made (#5503).
 * No question words or model-specific constants: qualified layout captions supply explicit
 * scope; a complete per-model output-circuit row supplies relay applicability independently.
 */
import { exactModelKey, type LayoutItem, type TableChunk } from "./table-rows";
import { isTitleLine, modelNumbersIn, sameModelFamily } from "./manual-applicability";
import { tableUnit } from "./supporting-quote";

export type SectionScope = "section" | "shared" | "unresolved";
export type ScopedText = { text: string; models?: string[]; scope?: SectionScope; sharedHeader?: string };
type Heading = { text: string; at: number; table: boolean; size: number; sharedHeader?: string; headerModels?: string[]; headerUnresolved?: boolean; headerInvalidLabels?: boolean; relayTable?: boolean; sourceLine: number; y: number; headerTop?: number; headerBottom?: number; columnUnresolved?: boolean };
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
  const pattern = header.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\t ]+")).join("[\\t ]*\\r?\\n[\\t ]*");
  return text.replace(new RegExp(`(^|\\n)[\\t ]*${pattern}[\\t ]*(?=\\r?\\n|$)`), "$1 ");
}

/** Render every positioned item once, in page reading order. Caption positions, rather than
 * unpdf's object order, delimit sections (real p20 puts its top caption AFTER its lower chart).
 * Only pages containing a layout-qualified table caption use this rendering at ingest.
 */
export function sectionTableLayout(items: readonly LayoutItem[], includeBoundaries = true, remainderItems?: readonly LayoutItem[], annotation?: { after: LayoutItem; lines: string[] }): SectionLayout | null {
  if (annotation && !items.includes(annotation.after)) throw new Error("contact-column source row is not in this page's positioned items");
  const retained = remainderItems ? new Set(remainderItems) : null;
  const lines: Array<{ text: string; y: number; x: number; size: number; columns: Array<{ text: string; x: number; right: number }>; removed: boolean; virtual: boolean }> = [];
  const bands: LayoutItem[][] = [];
  for (const item of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = bands.at(-1);
    if (last && Math.abs(last.at(-1)!.y - item.y) <= 2.5) last.push(item);
    else bands.push([item]);
  }
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x);
    const columns: Array<{ text: string; x: number; right: number }> = [];
    for (const item of band) {
      const last = columns.at(-1);
      if (last && item.x - last.right <= 6) { last.text += ` ${item.str.trim()}`; last.right = item.x + item.w; }
      else columns.push({ text: item.str.trim(), x: item.x, right: item.x + item.w });
    }
    lines.push({ text: band.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " "),
      y: band[0].y, x: band[0].x, size: Math.max(...band.map((i) => i.size)), columns,
      removed: !!retained && band.every((item) => !retained.has(item)), virtual: false });
    // Derived contact columns belong to their physical source table, even when that table
    // was extracted into separate model chunks. Never append them under a later caption.
    if (annotation && band.includes(annotation.after)) {
      for (const text of annotation.lines) lines.push({ text, y: band[0].y, x: band[0].x, size: 0, columns: [], removed: false, virtual: true });
    }
  }
  const captions = new Map<number, { text: string; end: number; sharedHeader?: string; headerModels?: string[]; headerUnresolved?: boolean; headerInvalidLabels?: boolean; columnUnresolved?: boolean; headerTop?: number; headerBottom?: number; relayTable: boolean }>();
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
      // A service sentence containing "contact" is not a caption, even above a
      // Description column in a fault table. Explicit model restrictions remain
      // observable (including qualifiers such as "only").
      // A trailing "only" is a scope qualifier on engineering headings.
      (isTitleLine(line.text.replace(/\bonly(?=\s*(?:[-–—]|$))/gi, "")) || captionModels(line).length > 0) &&
      header && header.size < line.size;
    if (!attributeCaption && !isRating) continue;
    // Unit/annotation columns do not establish another applicability domain. A common
    // electrical category must be positively identified; unsupported labels stay ambiguous.
    let sharedHeader: string | undefined;
    let headerModels: string[] | undefined;
    let headerUnresolved = false;
    let headerInvalidLabels = false;
    let columnUnresolved = false;
    let headerTop: number | undefined;
    let headerBottom: number | undefined;
    if (header) {
      const attributeColumn = header.columns.findIndex((c) => /^(?:Attribute|Description)$/i.test(c.text));
      const headerAt = lines.indexOf(header);
      let headerStart = headerAt;
      // A vertically centred Attribute cell can sit below the first model-header line.
      while (headerStart > end + 1 && headerAt - headerStart < 3) {
        const above = lines[headerStart - 1];
        if (above.virtual || Math.abs(above.size - header.size) > 0.2 ||
            above.y - lines[headerStart].y > header.size * 1.6 || modelNumbersIn(above.text).length === 0) break;
        headerStart--;
      }
      let headerEnd = headerAt + 1;
      let rejectedCatalogs: ReturnType<typeof modelNumbersIn> = [];
      while (headerEnd < lines.length && !lines[headerEnd].virtual &&
             (lines[headerEnd].x > header.x + 4 || modelNumbersIn(lines[headerEnd].text).length > 0) &&
             Math.abs(lines[headerEnd].size - header.size) <= 0.2 &&
             lines[headerEnd - 1].y - lines[headerEnd].y <= header.size * 1.6 &&
             header.y - lines[headerEnd].y <= 60) {
        const catalogLabels = modelNumbersIn(lines[headerEnd].text);
        if (catalogLabels.length > 0) {
          let rest = lines[headerEnd].text;
          for (const n of catalogLabels) rest = rest.replace(new RegExp(n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
          rest = rest.replace(/\([A-Z]\)/gi, "").replace(/\b(?:for|and|or|only)\b/gi, "").replace(/[\s(),;./–—-]/g, "");
          if (rest) {
            // Reject its shared-label proof without forgetting observed ambiguity. Later
            // windows must not lose this catalog-bearing, header-positioned restriction.
            rejectedCatalogs = catalogLabels;
            break;
          }
        }
        headerEnd++;
      }
      headerTop = lines[headerStart].y;
      headerBottom = lines[headerEnd - 1].y;
      const candidate = lines.slice(headerStart, headerEnd).map((l) => l.text).join("\n");
      const numbers = [...modelNumbersIn(candidate), ...rejectedCatalogs];
      if (numbers.length > 0) {
        headerUnresolved = attributeColumn < 0 || rejectedCatalogs.length > 0;
        headerInvalidLabels = rejectedCatalogs.length > 0;
        headerModels = [...new Set(numbers.map((n) => n.key))];
        const metadata = (label: string) => tableUnit(label) !== null || /^(?:units?(?:\s+of\s+measure)?|u\.?o\.?m\.?|si\s+units?|notes?|footnotes?|remarks?|status|reference|ref\.?|conditions?|method|tolerance)(?:\s*\([^)]*\))?$/i.test(label);
        const catalogOnly = (text: string) => {
          for (const n of modelNumbersIn(text)) text = text.replace(new RegExp(n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
          return !text.replace(/\([A-Z]\)/gi, "").replace(/\b(?:for|and|or|only)\b/gi, "").replace(/[\s(),;./–—-]/g, "");
        };
        const categories = header.columns.filter((_column, index) => index !== attributeColumn).map((column) => ({ ...column, metadata: metadata(column.text), models: new Set<string>() }));
        for (const above of lines.slice(headerStart, headerAt)) for (const column of above.columns) {
          if (catalogOnly(column.text) && !categories.some((c) => Math.abs(c.x - column.x) <= 4)) {
            categories.push({ ...column, metadata: false, models: new Set<string>() });
          }
        }
        categories.sort((a, b) => a.x - b.x);
        for (const sourceLine of lines.slice(headerStart, headerEnd)) {
          for (const column of sourceLine.columns) {
            const labels = modelNumbersIn(column.text);
            if (labels.length === 0) {
              if (sourceLine !== header) {
                const category = categories.find((c) => Math.abs(column.x - c.x) <= 4);
                if (category && !category.metadata) category.text += ` ${column.text}`;
              }
              continue;
            }
            if (!catalogOnly(column.text)) headerInvalidLabels = true;
            const owner = categories.findLastIndex((c) => column.x >= c.x - 4);
            if (owner < 0 || Math.abs(column.x - categories[owner].x) > 4 || categories[owner].metadata || !catalogOnly(column.text) ||
                (categories[owner + 1] && column.right > categories[owner + 1].x - 4)) {
              headerUnresolved = true;
              continue;
            }
            for (const n of labels) categories[owner].models.add(n.key);
          }
        }
        columnUnresolved = headerUnresolved || headerInvalidLabels;
        const values = categories.filter((c) => !c.metadata);
        const common = values.filter((c) => c.models.size === 0);
        const commonCategory = (label: string) => /\b(?:inputs?|outputs?|channels?)\b/i.test(label) &&
          /^(?:(?:non[- ]?)?isolated|normal|standard|high[- ]speed|analog|digital|ac|dc|relay|transistor|sink(?:ing)?|sourc(?:e|ing)|inputs?|outputs?)\b/i.test(label) &&
          !label.replace(/\b(?:non|isolated|normal|standard|high|speed|analog|digital|ac|dc|relay|transistor|sink|sinking|source|sourcing|inputs?|outputs?|channels?|shared|with|for|and|or|only)\b/gi, "").replace(/[\s\d(),./…–—-]/g, "");
        // Top-level catalogs are explicit model columns, never subordinate shared labels.
        // A fully model-qualified header scopes every later window, even after its text ends.
        if (!headerUnresolved && values.length > 0 && common.length === 0) {
          // Different model groups carry different flat values. Only the existing row
          // reader can qualify those separately; residual text must not union the groups.
          headerUnresolved = new Set(values.map((c) => [...c.models].sort().join(","))).size > 1;
        }
        else if (!headerUnresolved && headerStart === headerAt && modelNumbersIn(header.text).length === 0 && values.some((c) => c.models.size > 0) &&
                 common.length > 0 && common.every((c) => commonCategory(c.text))) sharedHeader = candidate;
        else headerUnresolved = true;
      }
    }
    captions.set(i, { text: lines.slice(i, end + 1).map((l) => l.text).join(" "), end, sharedHeader,
      headerModels, headerUnresolved, headerInvalidLabels, columnUnresolved, headerTop, headerBottom,
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
        ...(caption?.headerModels ? { headerModels: caption.headerModels } : {}),
        ...(caption?.headerUnresolved ? { headerUnresolved: true } : {}),
        ...(caption?.headerInvalidLabels ? { headerInvalidLabels: true } : {}),
        ...(caption?.relayTable ? { relayTable: true } : {}),
        // The source ordinal applies to retained AND intentionally removed headings.
        // Identical labels and prose references cannot move a physical boundary.
        sourceLine: lines.slice(0, i).filter((l) => !l.removed).length, y: line.y,
        ...(caption?.columnUnresolved ? { columnUnresolved: true } : {}),
        ...(caption?.headerTop !== undefined ? { headerTop: caption.headerTop, headerBottom: caption.headerBottom } : {}) });
      if (caption) continuationEnd = caption.end;
    }
    at += line.text.length + 1;
  }
  const retainedLines = lines.filter((l) => !l.removed).map((l) => l.text);
  return headings.length > 0 ? { text: retainedLines.join("\n"), headings, hasTables: captions.size > 0, retainedLines } : null;
}

/** Caption and header are independent assertions about this physical table. Neither
 * wins a contradiction. Different valid per-model columns are NOT a contradiction. */
function captionModels(h: Pick<Heading, "text">) {
  const lastFor = [...h.text.matchAll(/\bfor\s+/gi)].at(-1);
  return lastFor ? modelNumbersIn(h.text.slice(lastFor.index! + lastFor[0].length)) : [];
}
function contradictoryTableHeading(h: Pick<Heading, "text" | "headerModels">): boolean {
  const caption = captionModels(h);
  const header = (h.headerModels ?? []).flatMap((key) => modelNumbersIn(key));
  return header.length > 0 && caption.length > 0 &&
    (header.some((n) => !caption.some((own) => own.key === n.key)) ||
     caption.some((n) => !sameModelFamily(header[0], n)));
}

/** Bind each extracted block to its physical caption, even when its source lines have
 * been removed from the remainder. Coordinates are parser-local; persisted scope is the
 * same authoritative unresolved marker used by residual sections and retrieval. */
export function scopeTableChunks(chunks: readonly TableChunk[], layout: SectionLayout | null | undefined): TableChunk[] {
  return chunks.map((chunk) => {
    const heading = chunk.sourceTop === undefined ? undefined : layout?.headings
      .find((h) => h.table && h.headerTop !== undefined && h.headerBottom !== undefined &&
        chunk.sourceTop! <= h.headerTop + 2.5 && chunk.sourceTop! >= h.headerBottom - 2.5);
    // Missing geometry cannot qualify a table against its surrounding scope.
    const source = heading ?? { text: chunk.sourceCaption ?? "", headerModels: chunk.sourceModels };
    const named = captionModels(source).map((n) => n.key);
    const header = heading?.headerModels ?? [];
    const invalid = !layout || chunk.sourceTop === undefined ||
      contradictoryTableHeading(source) || heading?.columnUnresolved ||
      (named.length > 0 && chunk.models.some((m) => !named.includes(exactModelKey(m)))) ||
      (header.length > 0 && chunk.models.some((m) => !header.includes(exactModelKey(m))));
    return invalid ? { ...chunk, unqualified: true, scope: "unresolved" } : chunk;
  });
}

/** Explicit layout-bound model assertions establish section scope independently of
 * any output-circuit table. Circuit types are needed only for inferred relay scope. */
export function modelSectionModels(layout: SectionLayout | null | undefined): string[] {
  return [...new Set(layout?.headings.filter((h) => h.table).flatMap((h) => [
    ...captionModels(h).map((n) => n.key),
    // A product/parameter name in header prose is not a catalog declaration.
    ...(!h.headerInvalidLabels ? h.headerModels ?? [] : []),
  ]) ?? [])];
}
export function hasModelSectionScope(layout: SectionLayout | null | undefined): boolean {
  return modelSectionModels(layout).length > 0;
}

/** Per-document state, never shared across uploads. Captions reset scope; text windows inherit
 * the resulting scope. All-model sections have an explicit shared marker so catalog numbers
 * in a SUB-column (real DC-input table) do not turn the whole section into sibling-only prose.
 */
export class SectionTableScope {
  private active: Pick<ScopedText, "models" | "scope" | "sharedHeader"> = {};
  private headingSize = 0;
  private hasReadableSection = false;
  constructor(private readonly outputs: OutputMap, private observed = outputs.size > 0, private readonly sectionModels: readonly string[] = []) {}

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
    if (!this.observed && !hasModelSectionScope(layout)) return [{ text }];
    this.observed = true;
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
    if (!layout.hasTables && layout.headings.some((h) => h.size >= this.headingSize)) {
      // No qualified boundary exists on this page. Keep its original text/windows, but
      // do not let a running header or a possible new section release the restriction.
      this.active = { models: this.active.models ?? [...this.outputs.keys()], scope: "unresolved" };
      return [{ text, ...this.active }];
    }
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
      // Font and page position cannot prove that a model restriction ended. A running
      // title can be larger than the section caption. Without a qualified table boundary,
      // continuity is unresolved, including for the formerly eligible model.
      if (!h.table && this.active.scope) {
        this.active = { models: this.active.models ?? [...this.outputs.keys()], scope: "unresolved" };
        start = h.at;
        continue;
      }
      this.active = {};
      this.headingSize = h.size;
      if (h.table) {
        this.hasReadableSection = true;
        const lastFor = [...h.text.matchAll(/\bfor\s+/gi)].at(-1);
        const afterFor = lastFor ? h.text.slice(lastFor.index! + lastFor[0].length) : "";
        const known = [...new Set([...this.outputs.keys(), ...this.sectionModels])].flatMap((key) => modelNumbersIn(key));
        const sectionFamily = known.length > 0 && known.every((n) => sameModelFamily(known[0], n));
        // Other section catalogs cannot invalidate independent circuit-type evidence.
        const outputNumbers = [...this.outputs.keys()].flatMap((key) => modelNumbersIn(key));
        const oneFamily = outputNumbers.length > 0 && outputNumbers.every((n) => sameModelFamily(outputNumbers[0], n));
        const captionNumbers = modelNumbersIn(afterFor);
        const named = known.length > 0 ? captionNumbers.filter((n) => known.some((own) => sameModelFamily(own, n))) : captionNumbers;
        const headerNumbers = (h.headerModels ?? []).flatMap((key) => modelNumbersIn(key));
        const headerApplies = headerNumbers.length > 0 && (known.length === 0 || headerNumbers.some((n) => known.some((own) => sameModelFamily(own, n))));
        const headerFamily = headerNumbers.length > 0 && headerNumbers.every((n) => sameModelFamily(headerNumbers[0], n));
        const captionConflict = contradictoryTableHeading(h);
        // A global, pure single-model header can agree with its explicit caption even
        // when it is centred above several channel categories (real ML1100 DWD inputs).
        const singleModelAgreement = !h.headerInvalidLabels && headerNumbers.length === 1 && captionNumbers.length > 0 &&
          captionNumbers.every((n) => n.key === headerNumbers[0].key);
        if (captionConflict || (headerApplies && ((!singleModelAgreement && h.headerUnresolved) || !headerFamily))) {
          this.active = { models: [...new Set([...this.outputs.keys(), ...(h.headerModels ?? []), ...captionNumbers.map((n) => n.key)])], scope: "unresolved" };
        } else if (headerApplies && !h.sharedHeader) this.active = { models: h.headerModels, scope: "section" };
        else if (named.length > 0) this.active = { models: [...new Set(named.map((n) => n.key))], scope: "section" };
        else if (h.sharedHeader && (!sectionFamily || !headerFamily ||
                 !known.every((n) => sameModelFamily(headerNumbers[0], n)))) {
          // A rejected shared proof is uncertainty, not permission to forget the model
          // labels when later windows no longer contain the physical header.
          this.active = { models: [...new Set([...this.outputs.keys(), ...(h.headerModels ?? [])])], scope: "unresolved" };
        }
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
          } else if (sectionFamily && h.sharedHeader) {
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
