import type { LayoutItem } from "../table-rows";

/** Synthetic geometry only; no manufacturer ratings or product suitability claim. */
export type BoundaryMatrixCase = {
  id: string;
  kind: "named" | "negative" | "unnamed";
  titleFont: number;
  catalogFont: number;
  fragments: "same-line" | "wrapped" | "catalog-split" | "joined";
  body: "inline" | "indented" | "raw";
  placement: "same-page" | "next-page" | "page-end";
  gap: number;
  prefix?: string;
  suffix?: string;
};

export const boundaryMatrix: BoundaryMatrixCase[] = [];
const fonts = [[10, 10], [8, 8], [6, 6], [10, 8], [8, 10], [6, 4]] as const;
for (const kind of ["named", "negative"] as const)
  for (const [titleFont, catalogFont] of fonts)
    for (const fragments of ["same-line", "wrapped", "catalog-split"] as const)
      for (const body of ["inline", "indented", "raw"] as const)
        for (const placement of ["same-page", "next-page", "page-end"] as const)
          for (const gap of [28, 92]) {
            boundaryMatrix.push({ id: [kind, titleFont, catalogFont, fragments, body, placement, gap].join("/"),
              kind, titleFont, catalogFont, fragments, body, placement, gap });
          }
for (const [titleFont, catalogFont] of [[10, 10], [8, 8], [6, 6], [10, 6]] as const)
  for (const fragments of ["joined", "same-line"] as const)
    for (const body of ["inline", "indented", "raw"] as const)
      for (const placement of ["same-page", "next-page", "page-end"] as const)
        for (const gap of [28, 92]) {
          boundaryMatrix.push({ id: ["unnamed", titleFont, catalogFont, fragments, body, placement, gap].join("/"),
            kind: "unnamed", titleFont, catalogFont, fragments, body, placement, gap });
        }

for (const prefix of ["Description for", "DC Output Data " + "Electrical channel limits ".repeat(12) + "for"])
  for (const [titleFont, catalogFont] of fonts)
    for (const placement of ["same-page", "next-page", "page-end"] as const)
      boundaryMatrix.push({ id: "", kind: "named", titleFont, catalogFont, fragments: "same-line",
        body: "inline", placement, gap: 28, prefix });

for (const [titleFont, catalogFont] of [[10, 8], [6, 4]] as const)
  for (const placement of ["same-page", "next-page"] as const)
    boundaryMatrix.push({ id: "", kind: "named", titleFont, catalogFont, fragments: "same-line",
      body: "inline", placement, gap: 28, suffix: " 24 V DC" });

// Compact, unique reporter names retain every axis (Vitest truncates long $id values).
for (const [index, c] of boundaryMatrix.entries()) {
  c.id = [index, c.kind[0], c.titleFont + "x" + c.catalogFont, c.fragments[0],
    c.body === "indented" ? "d" : c.body[0], c.placement[0], c.gap].join("-");
}

const row = (str: string, y: number, size = 8, x = 100): LayoutItem =>
  ({ str, x, y, size, w: str.length * size * 0.4 });

/** The known valid section always precedes a separate, deliberately unqualified section. */
export function boundaryMatrixPages(c: BoundaryMatrixCase): LayoutItem[][] {
  const original = [row("Output Specifications for 2080-LC20-20QWB", 740, 12),
    row("Attribute Value", 720), row("zzmatrixoriginal Load current max 2 A", 706)];
  const catalog = (c.kind === "negative" ? "2080-LC20-20QWB)" : "2080-LC20-20QBB") + (c.suffix ?? "");
  const prefix = c.prefix ?? (c.kind === "negative" ? "DC Output Data (not for" : "DC Output Data for");
  let heading: LayoutItem[];
  if (c.kind === "unnamed") {
    heading = c.fragments === "joined" ? [row("DC Output Data", 676, c.titleFont)]
      : [row("DC Output", 676, c.titleFont), row("Data", 676, c.catalogFont, 350)];
  } else if (c.fragments === "wrapped") {
    heading = [row(prefix, 676, c.titleFont), row(catalog, 662, c.catalogFont, 350)];
  } else if (c.fragments === "catalog-split") {
    heading = [row(prefix, 676, c.titleFont), row(catalog.slice(0, 10), 676, c.catalogFont, 350),
      row(catalog.slice(10), 676, Math.max(3, c.catalogFont - 2), 450)];
  } else {
    heading = [row(prefix, 676, c.titleFont), row(catalog, 676, c.catalogFont, 350)];
  }
  const y = c.placement === "page-end" ? 720 : Math.min(...heading.map((r) => r.y)) - c.gap;
  const body: LayoutItem[] = [];
  const value = (token: string, amperes: number, at: number) => {
    if (c.body === "raw") body.push(row(amperes + " A", at, 8, 350), row(token, at, 8, 450));
    else if (c.body === "indented") body.push(row(token + " Point current max", at, 11, 180), row(amperes + " A", at, 8, 350));
    else body.push(row(token + " Point current max " + amperes + " A", at));
  };
  value("zzmatrixfirst", 9, y);
  for (let n = 0; n < 24; n++) body.push(row("Additional electrical operating conditions remain recorded here without any further catalog assertion.", y - 14 - n * 9));
  value("zzmatrixlast", 11, y - 244);
  const pages = c.placement === "same-page" ? [[...original, ...heading, ...body]]
    : c.placement === "next-page" ? [original, [...heading, ...body]]
    : [[...original, ...heading], body];
  pages.push([row("zzmatrixcontinued Point current max 11 A", 720)]);
  return pages;
}

export const measuredMatrix = (["labelled", "leading", "same-catalog", "numeric-grid"] as const)
  .flatMap((kind) => [6, 8, 10, 14].map((font) => ({ kind, font, id: kind + "-" + font })));

/** Preserve ordinary measured rows and the earlier conservative treatment of
 * oversized, unqualified rows. Neither case may lose the valid preceding row. */
export function measuredMatrixPage(c: typeof measuredMatrix[number]): LayoutItem[] {
  const rows = [row("Output Specifications for 2080-LC20-20QWB", 740, 12),
    row("Attribute Value", 720), row("zzmeasureoriginal Load current max 2 A", 706)];
  if (c.kind === "labelled") rows.push(row("zzmeasurefirst Load current max", 690, c.font), row("2 A", 690, 8, 350));
  if (c.kind === "leading") rows.push(row("2 A", 690, c.font), row("zzmeasurefirst (max)", 690, 8, 350));
  if (c.kind === "same-catalog") rows.push(row("2080-LC20-20QWB", 690, c.font), row("zzmeasurefirst 2 A", 690, 8, 350));
  if (c.kind === "numeric-grid") rows.push(row("2", 690, c.font), row("4", 690, 8, 280), row("8", 690, c.font, 350));
  rows.push(row("zzmeasurelast Switching time max 10 ms", 670));
  return rows;
}

export const columnBoundaryMatrix = boundaryMatrix.filter((c) =>
  !c.prefix && c.kind !== "unnamed" && c.body === "inline" && c.gap === 28);

/** A later unqualified table uses the earlier columns' x positions deliberately. */
export function columnBoundaryMatrixPages(c: BoundaryMatrixCase): LayoutItem[][] {
  const pages = boundaryMatrixPages(c);
  pages[0].splice(0, 3,
    row("Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 740, 12),
    row("Attribute", 720), row("2080-LC20-20QWB", 720, 8, 280), row("2080-LC20-20AWB", 720, 8, 420),
    row("zzmatrixoriginal Load current max", 706), row("2 A", 706, 8, 280), row("1 A", 706, 8, 420),
    row("Switching time max", 692), row("10 ms", 692, 8, 280), row("8 ms", 692, 8, 420));
  for (const page of pages) for (const token of ["zzmatrixfirst", "zzmatrixlast"]) {
    const at = page.findIndex((r) => r.str.includes(token));
    if (at >= 0) {
      const y = page[at].y;
      page.splice(at, 1, row(token + " Point current max", y), row("9 A", y, 8, 280), row("11 A", y, 8, 420));
    }
  }
  return pages;
}

export type ColumnSemanticCase = {
  id: string;
  bodyFont: number;
  titleFont: number;
  kind: "named" | "negative" | "unnamed" | "description" | "same-qwb" | "same-awb";
  fragments: "joined" | "split";
  gap: number;
  spelling?: "for" | "parenthesis" | "dash" | "colon" | "comma" | "trailing" | "leading" | "bare" | "prose" | "long-prose";
  x?: number;
  text?: string;
  wrapped?: boolean;
  headingless?: boolean;
  shiftedCells?: boolean;
};

/** Include the entire title in ONE PDF item: separate title/catalog cells can
 * stop the column reader for another reason and conceal a missed boundary. */
export const columnSemanticMatrix: ColumnSemanticCase[] = [];
for (const bodyFont of [6, 8, 10])
  for (const titleFont of [bodyFont - 2, bodyFont, bodyFont + 2])
    for (const kind of ["named", "negative", "unnamed", "description", "same-qwb", "same-awb"] as const)
      for (const fragments of ["joined", "split"] as const)
        for (const gap of [12, 28])
          columnSemanticMatrix.push({ bodyFont, titleFont, kind, fragments, gap,
            id: [bodyFont, titleFont, kind, fragments, gap].join("-") });

for (const kind of ["named", "negative"] as const)
  for (const spelling of ["for", "parenthesis", "dash", "colon", "comma", "trailing", "leading", "bare", "prose", "long-prose"] as const)
    for (const titleFont of [6, 8, 10])
      for (const x of [100, 180, 350])
        for (const gap of [12, 28])
          columnSemanticMatrix.push({ bodyFont: 8, titleFont, kind, fragments: "joined", gap, spelling, x,
            id: ["f13", kind, spelling, titleFont, x, gap].join("-") });

// These lines have no catalog and no shared title grammar. Their failure to
// belong to the column grid, rather than their words or font, ends ownership.
for (const text of ["Relay Output Characteristics", "Sink/Source Outputs", "Derating", "See the following conditions.", "Operating envelope at 24 V", "These source conditions remain recorded without any declaration of equipment ownership. ".repeat(4)])
  for (const titleFont of [6, 8, 10])
    for (const x of [100, 180, 350])
      for (const fragments of ["joined", "split", "wrapped"] as const)
        for (const gap of [12, 28])
          columnSemanticMatrix.push({ bodyFont: 8, titleFont, kind: "unnamed", fragments: fragments === "wrapped" ? "split" : fragments, wrapped: fragments === "wrapped", gap, x, text,
            id: ["f13-unproven", text, titleFont, x, fragments, gap].join("-") });

for (const text of ["Derating", "See the following conditions.", "The following conditions remain in the source without asserting model ownership. ".repeat(4)])
  for (const titleFont of [6, 8])
    for (const wrapped of [false, true])
      columnSemanticMatrix.push({ bodyFont: 8, titleFont, kind: "unnamed", fragments: wrapped ? "split" : "joined", wrapped, gap: 12, text, headingless: true,
        id: ["f13-headingless", text, titleFont, wrapped].join("-") });

for (const titleFont of [6, 8, 10]) for (const gap of [12, 28])
  columnSemanticMatrix.push({ bodyFont: 8, titleFont, kind: "unnamed", fragments: "joined", gap, shiftedCells: true,
    id: ["f13-unaligned-cells", titleFont, gap].join("-") });

const originalColumns = (font: number): LayoutItem[] => [
  row("Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 740, 12),
  row("Attribute", 720), row("2080-LC20-20QWB", 720, 8, 280), row("2080-LC20-20AWB", 720, 8, 420),
  row("zzcolumnoriginal Load current max", 706, font), row("2 A", 706, font, 280), row("1 A", 706, font, 420),
  row("Switching time max", 692, font), row("10 ms", 692, font, 280), row("8 ms", 692, font, 420),
];

export function columnSemanticMatrixPages(c: ColumnSemanticCase): LayoutItem[][] {
  const y = 692 - c.gap;
  const prefix = c.kind === "description" || c.kind.startsWith("same-") ? "Description for"
    : c.kind === "negative" ? "DC Output Data (not for" : "DC Output Data for";
  const catalog = c.kind === "negative" ? "2080-LC20-20QWB)" : c.kind === "same-qwb" ? "2080-LC20-20QWB"
    : c.kind === "same-awb" ? "2080-LC20-20AWB" : "2080-LC20-20QBB";
  let heading = c.kind === "unnamed" ? (c.fragments === "joined" ? [row("DC Output Data", y, c.titleFont)]
    : [row("DC Output", y, c.titleFont), row("Data", y, c.titleFont, 350)])
    : c.fragments === "joined" ? [row(prefix + " " + catalog, y, c.titleFont)]
      : [row(prefix, y, c.titleFont), row(catalog, y, c.titleFont, 350)];
  if (c.spelling) {
    const model = c.kind === "negative" ? "2080-LC20-20QWB" : "2080-LC20-20QBB";
    const target = (c.kind === "negative" ? "not " : "") + model;
    const titles = {
      for: "DC Output Data for " + target,
      parenthesis: "DC Output Data (" + target + ")",
      dash: "DC Output Data - " + target,
      colon: "DC Output Data: " + target,
      comma: "DC Output Data, " + target,
      trailing: "DC Output Data " + target,
      leading: target + " - DC Output Data",
      bare: target,
      prose: "See " + target + " for another operating configuration.",
      "long-prose": "The following source conditions remain recorded without changing their wording. ".repeat(4) + "See " + target + " for another configuration.",
    };
    heading = [row(titles[c.spelling], y, c.titleFont, c.x ?? 100)];
  }
  if (c.text) {
    const x = c.x ?? 100;
    const space = c.text.indexOf(" ");
    const first = space < 0 ? Math.floor(c.text.length / 2) : space;
    heading = c.fragments === "joined" ? [row(c.text, y, c.titleFont, x)]
      : [row(c.text.slice(0, first), y, c.titleFont, x), row(c.text.slice(first + (space < 0 ? 0 : 1)),
        c.wrapped ? y - c.titleFont * 1.1 : y, c.titleFont, c.wrapped ? x : x + 75)];
  }
  if (c.shiftedCells) heading = [row("Unplaced characteristic", y, c.titleFont), row("7 A", y, c.titleFont, 320), row("6 A", y, c.titleFont, 460)];
  return [[...originalColumns(c.bodyFont).slice(c.headingless ? 1 : 0), ...heading,
    row("zzcolumnfirst Point current max", y - c.gap, c.bodyFont), row("9 A", y - c.gap, c.bodyFont, 280), row("11 A", y - c.gap, c.bodyFont, 420),
    row("zzcolumnlast Point current max", y - c.gap - 14, c.bodyFont), row("19 A", y - c.gap - 14, c.bodyFont, 280), row("21 A", y - c.gap - 14, c.bodyFont, 420)],
  [row("zzcolumncontinued Point current max", 720, c.bodyFont), row("39 A", 720, c.bodyFont, 280), row("41 A", 720, c.bodyFont, 420)]];
}

/** Kinds whose ownership rests on a non-row line: proven only by a painted column separator (#5503 F14). */
const ruleDependentKinds = ["numbered-footnote", "merged-measurement", "numbered-heading", "numbered-heading-small", "voltage-heading", "voltage-heading-small", "split-title", "split-voltage-title"] as const;
export const columnMeasuredMatrix = (["ordinary", "bold-label", "smaller-label", "catalog-qwb", "catalog-awb", "foreign-row", ...ruleDependentKinds] as const)
  .flatMap((kind) => [6, 8, 10].flatMap((bodyFont) => [12, 28].flatMap((gap) =>
    ((ruleDependentKinds as readonly string[]).includes(kind) ? [false, true] : [false]).map((ruled) =>
      ({ kind, bodyFont, gap, ruled, id: [kind, bodyFont, gap, ruled ? "ruled" : "unruled"].join("-") })))));

/** Whether the row after the interposed line keeps the original models' qualification.
 * A numbered line at the label margin is never proof (footnote and numbered title are
 * indistinguishable). Cells aligned to the columns without a row label are proof only
 * inside the header's painted rules. */
export function columnMeasuredLaterQualified(c: typeof columnMeasuredMatrix[number]): boolean {
  if (c.kind === "bold-label" || c.kind === "foreign-row") return false; // oversized-row uncertainty and contradictory catalog evidence
  if (c.kind.startsWith("numbered-")) return false;
  if ((ruleDependentKinds as readonly string[]).includes(c.kind)) return c.ruled;
  return true;
}

/** One painted separator between the label and the first model column, from the header through the last row. */
export function columnMeasuredMatrixRules(c: typeof columnMeasuredMatrix[number]): Array<{ x: number; y0: number; y1: number }> {
  return c.ruled ? [{ x: 270, y0: 692 - c.gap - 24, y1: 730 }] : [];
}

export function columnMeasuredMatrixPage(c: typeof columnMeasuredMatrix[number]): LayoutItem[] {
  const labelFont = c.kind === "bold-label" ? 14 : c.kind === "smaller-label" ? c.bodyFont - 2 : c.bodyFont;
  const catalog = c.kind.startsWith("catalog-");
  const footnote = c.kind === "numbered-footnote";
  const merged = c.kind === "merged-measurement";
  const numbered = c.kind.startsWith("numbered-heading");
  const voltage = c.kind.startsWith("voltage-heading");
  const titleFont = c.kind.endsWith("-small") ? c.bodyFont - 2 : c.bodyFont;
  const split = c.kind.startsWith("split-");
  const y = 692 - c.gap - (catalog || footnote || merged || numbered || voltage || split ? 14 : 0);
  return [...originalColumns(c.bodyFont),
    ...(catalog ? [row(c.kind === "catalog-qwb" ? "2080-LC20-20QWB" : "2080-LC20-20AWB", 692 - c.gap, c.bodyFont)] : []),
    ...(footnote ? [row("(1) Values apply under the recorded conditions.", 692 - c.gap, c.bodyFont - 2)] : []),
    // Round 11 F14: a numbered section title at the label margin and a voltage-bearing
    // title at the first value column, neither repeating a model header.
    ...(numbered ? [row("2. DC Output Characteristics", 692 - c.gap, titleFont)] : []),
    ...(voltage ? [row("24 V DC Outputs", 692 - c.gap, titleFont, 280)] : []),
    // A title set across both value columns with no label: aligned like a wrapped
    // continuation line, so position alone proves nothing.
    ...(split ? (c.kind === "split-title"
      ? [row("DC Output", 692 - c.gap, c.bodyFont, 280), row("Characteristics", 692 - c.gap, c.bodyFont, 420)]
      : [row("24 V DC", 692 - c.gap, c.bodyFont, 280), row("Outputs", 692 - c.gap, c.bodyFont, 420)]) : []),
    ...(merged ? [row("Common interval", 692 - c.gap, c.bodyFont), row("12 ms", 692 - c.gap, c.bodyFont, 280)] : []),
    row("zzcolumnmeasured " + (c.kind === "foreign-row" ? "Test load 2080-LC20-20QBB" : "Point current max"), y, labelFont),
    row("3 A", y, c.bodyFont, 280), row("4 A", y, c.bodyFont, 420)];
}

