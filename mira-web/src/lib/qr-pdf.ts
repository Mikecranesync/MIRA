// mira-web/src/lib/qr-pdf.ts
/**
 * Avery 5163 sticker sheet composer.
 *
 * Sheet: 8.5" × 11" letter portrait
 * Grid: 2 columns × 5 rows = 10 labels/page
 * Label: 2" × 4" (144 × 288 pts at 72 dpi)
 *
 * Layout per label (points, origin top-left of label):
 *   - QR: 1.6" × 1.6" block, left-aligned with 0.2" inset
 *   - Right panel (2.2" × 1.6"):
 *       * MIRA logo (placeholder text "MIRA") at top
 *       * asset_tag in 24pt bold (middle — human-readable backup)
 *       * factorylm.com in 8pt at bottom
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { generatePng } from "./qr-generate.js";

export interface StickerInput {
  asset_tag: string;
  scan_url: string;
}

// 72 dpi = 72 points per inch
const DPI = 72;
const IN = (inches: number): number => inches * DPI;

// Avery 5163 specs — top/bottom margins 0.5", side margins 0.156", rows tight
const MARGIN_TOP = IN(0.5);
const MARGIN_SIDE = IN(0.156);
const LABEL_W = IN(4);
const LABEL_H = IN(2);
const COLS = 2;
const ROWS = 5;
const PER_PAGE = COLS * ROWS;

export async function buildStickerSheetPdf(rows: StickerInput[]): Promise<Uint8Array> {
  if (rows.length === 0) {
    throw new Error("buildStickerSheetPdf: rows must be non-empty");
  }

  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (let start = 0; start < rows.length; start += PER_PAGE) {
    const page = pdf.addPage([IN(8.5), IN(11)]);
    const { height: pageH } = page.getSize();

    const sheetRows = rows.slice(start, start + PER_PAGE);
    for (let i = 0; i < sheetRows.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);

      // Top-left of this label on the sheet, measured in pdf-lib's
      // bottom-origin coords
      const labelX = MARGIN_SIDE + col * LABEL_W;
      const labelY = pageH - MARGIN_TOP - (row + 1) * LABEL_H; // bottom-left of label

      const { asset_tag, scan_url } = sheetRows[i];
      const qrPx = 160;
      const qrPng = await generatePng(scan_url, qrPx);
      const qrImg = await pdf.embedPng(qrPng);

      // QR block: 1.6" × 1.6", inset 0.2" from left + top edges of label
      page.drawImage(qrImg, {
        x: labelX + IN(0.2),
        y: labelY + (LABEL_H - IN(1.6)) / 2,
        width: IN(1.6),
        height: IN(1.6),
      });

      // Right panel text
      const rightX = labelX + IN(1.9);
      const rightCenter = labelY + LABEL_H / 2;

      // "MIRA" brand line top
      page.drawText("MIRA", {
        x: rightX,
        y: labelY + LABEL_H - IN(0.35),
        size: 12,
        font: helvBold,
        color: rgb(0.96, 0.65, 0.14),
      });

      // Asset tag — 24pt bold, centered vertically
      page.drawText(asset_tag, {
        x: rightX,
        y: rightCenter - 8,
        size: 24,
        font: helvBold,
        color: rgb(0, 0, 0),
      });

      // URL at bottom (small)
      page.drawText("factorylm.com/m/" + asset_tag, {
        x: rightX,
        y: labelY + IN(0.15),
        size: 7,
        font: helv,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
  }

  return await pdf.save();
}
