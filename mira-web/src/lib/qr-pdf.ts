// mira-web/src/lib/qr-pdf.ts
/**
 * Avery sticker sheet composer.
 *
 * 5163 — 2" × 4" shipping labels, 2 cols × 5 rows = 10/page
 * 5160 — 1" × 2.625" address labels, 3 cols × 10 rows = 30/page
 *
 * Layout per label (points, origin top-left of label):
 *   - QR block, left-aligned with 0.1" inset
 *   - Right panel: MIRA brand, asset_tag bold, "Scan to diagnose"
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { generatePng } from "./qr-generate.js";

export interface StickerInput {
  asset_tag: string;
  scan_url: string;
}

export type LabelFormat = "5163" | "5160";

// 72 dpi = 72 points per inch
const DPI = 72;
const IN = (inches: number): number => inches * DPI;

interface LayoutSpec {
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  marginTop: number;
  marginSide: number;
  colGap: number;
}

const LAYOUTS: Record<LabelFormat, LayoutSpec> = {
  // Avery 5163 — 2" × 4" shipping labels, 2 cols × 5 rows
  "5163": {
    cols: 2, rows: 5,
    labelW: IN(4), labelH: IN(2),
    marginTop: IN(0.5), marginSide: IN(0.156), colGap: 0,
  },
  // Avery 5160 — 1" × 2.625" address labels, 3 cols × 10 rows
  "5160": {
    cols: 3, rows: 10,
    labelW: IN(2.625), labelH: IN(1),
    marginTop: IN(0.5), marginSide: IN(0.1875), colGap: IN(0.125),
  },
};

export async function buildStickerSheetPdf(
  rows: StickerInput[],
  format: LabelFormat = "5163",
): Promise<Uint8Array> {
  if (rows.length === 0) {
    throw new Error("buildStickerSheetPdf: rows must be non-empty");
  }

  const layout = LAYOUTS[format];
  const perPage = layout.cols * layout.rows;

  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // 5160 labels are small — scale down QR and font sizes
  const is5160 = format === "5160";
  const qrFrac = is5160 ? 0.78 : 0.80;
  const brandSize = is5160 ? 6 : 12;
  const tagSize = is5160 ? 10 : 20;
  const taglineSize = is5160 ? 5 : 7;
  const urlSize = is5160 ? 4 : 7;

  for (let start = 0; start < rows.length; start += perPage) {
    const page = pdf.addPage([IN(8.5), IN(11)]);
    const { height: pageH } = page.getSize();

    const sheetRows = rows.slice(start, start + perPage);
    for (let i = 0; i < sheetRows.length; i++) {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);

      // pdf-lib uses bottom-left origin
      const labelX = layout.marginSide + col * (layout.labelW + layout.colGap);
      const labelY = pageH - layout.marginTop - (row + 1) * layout.labelH;

      const { asset_tag, scan_url } = sheetRows[i];
      const qrSize = layout.labelH * qrFrac;
      const qrPng = await generatePng(scan_url, Math.round(qrSize * 4));
      const qrImg = await pdf.embedPng(qrPng);

      page.drawImage(qrImg, {
        x: labelX + IN(0.1),
        y: labelY + (layout.labelH - qrSize) / 2,
        width: qrSize,
        height: qrSize,
      });

      const rightX = labelX + qrSize + IN(0.15);
      const rightH = layout.labelH;

      // Brand name
      page.drawText("MIRA", {
        x: rightX,
        y: labelY + rightH - IN(is5160 ? 0.2 : 0.35),
        size: brandSize,
        font: helvBold,
        color: rgb(0.96, 0.65, 0.14),
      });

      // Asset tag
      page.drawText(asset_tag, {
        x: rightX,
        y: labelY + rightH / 2 - tagSize / 4,
        size: tagSize,
        font: helvBold,
        color: rgb(0, 0, 0),
      });

      // "Scan to diagnose — Powered by MIRA"
      page.drawText("Scan to diagnose", {
        x: rightX,
        y: labelY + IN(is5160 ? 0.18 : 0.28),
        size: taglineSize,
        font: helvOblique,
        color: rgb(0.35, 0.35, 0.35),
      });

      // URL
      page.drawText("factorylm.com/m/" + asset_tag, {
        x: rightX,
        y: labelY + IN(is5160 ? 0.08 : 0.15),
        size: urlSize,
        font: helv,
        color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  return await pdf.save();
}
