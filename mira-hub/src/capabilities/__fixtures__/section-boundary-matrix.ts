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

