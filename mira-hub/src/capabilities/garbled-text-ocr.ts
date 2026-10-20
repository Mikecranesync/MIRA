/**
 * OCR fallback seam for a garbled page the +29 decoder could not repair
 * (`repairExtractedPage(...).unrepaired`). Reached ONLY behind
 * `NOTEBOOK_GARBLE_OCR_FALLBACK=1` (default off), from writePdfChunksForNode.
 *
 * ⚠️ NOT WIRED TO A SERVICE YET — returns null, and says so once per process.
 *
 * Why (2026-10-18): the only OCR the Hub can reach today is mira-ingest
 * `POST /ingest/photo`, which takes an IMAGE plus an asset tag and INGESTS it
 * (writes its own knowledge rows) — it does not return text. Using it here
 * would need (a) rasterizing the page (`unpdf.renderPageAsImage`, which needs
 * a canvas binding the Hub image does not ship), and (b) a text-returning OCR
 * contract on the ingest service. Both are owner decisions (a new service
 * dependency and a paid/compute lane), not an overnight patch. The seam is
 * here so the ingest path is already shaped for it: return a string and the
 * page is written as that text with `metadata.text_repair = "ocr"`.
 */

export type OcrPageRequest = {
  tenantId: string;
  uploadId: string;
  filename: string;
  /** 1-based page number in the PDF. */
  page: number;
  /** The garbled text the parser returned, for logging/diagnosis only. */
  extracted: string;
};

let announced = false;

export async function ocrExtractPage(req: OcrPageRequest): Promise<string | null> {
  if (!announced) {
    announced = true;
    console.warn(
      `[garbled-text-ocr] NOTEBOOK_GARBLE_OCR_FALLBACK is on but no text-returning OCR service is wired (first page: ${req.filename} p.${req.page}); garbled pages are written as-is`,
    );
  }
  return null;
}
