/**
 * A minimal real PDF writer for tests: Helvetica text rows and grey image boxes at exact positions,
 * so the real unpdf/pdf.js reader (`pdfDocPages`) runs on actual PDF bytes. Content is always the
 * invented fixture text — never real CAT documents.
 */

export interface PdfText {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface PdfImage {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPage {
  texts: PdfText[];
  images?: PdfImage[];
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export function buildPdf(pages: PdfPage[], width = 612, height = 792): Uint8Array {
  // Objects: 1 catalog, 2 pages, 3 font, 4 image, then per page: page object + content stream.
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n\x80\x80\x80\x80\nendstream";
  pages.forEach((p, i) => {
    const ops: string[] = [];
    for (const im of p.images ?? []) ops.push(`q ${im.w} 0 0 ${im.h} ${im.x} ${im.y} cm /Im1 Do Q`);
    for (const t of p.texts) ops.push(`BT /F1 ${t.size} Tf ${t.x} ${t.y} Td (${esc(t.text)}) Tj ET`);
    const stream = ops.join("\n");
    objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objs[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
