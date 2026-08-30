/**
 * photo-ocr — thin, best-effort client for the mira-ask photo OCR endpoint
 * (`POST {MIRA_ASK_URL}/ocr/extract`, ask_api/ocr_extract.py). EVID-4 of the
 * technician-copilot PRD: a photographed page / label / spec table becomes
 * searchable evidence.
 *
 * Honesty / fallback contract:
 * - OCR is an ADDED text layer, never a dependency of the upload. Flag off,
 *   service down, timeout, engine missing, unreadable image — every one of
 *   those resolves to `null` and the caller keeps the photo exactly as it does
 *   today (parked, viewable, and SAID to be unsearchable). This module never
 *   throws.
 * - Quality is reported, not hidden: the service returns tesseract's mean
 *   per-word confidence and word count; `ocrQuality` turns those into the
 *   one decision the upload door needs (index it or not) and a label the
 *   client can show. A read with too few words is "none" — the photo is not
 *   indexed and the response says no readable text was found — rather than a
 *   two-word chunk that can never honestly answer a question.
 * - The photo itself is the source of truth. The OCR text is written through
 *   the ordinary ingestTextToNode writer against the SAME file, so a citation
 *   opens the photograph (P2's one-object citation), never a transcript.
 *
 * Call pattern mirrors src/lib/nameplate/detect.ts: MIRA_ASK_URL default,
 * optional X-Mira-Key, AbortSignal.timeout, any failure falls through.
 */

export interface PhotoOcrResult {
  text: string;
  /** Mean of tesseract's per-word confidences, 0–100; null when nothing was read. */
  meanConfidence: number | null;
  wordCount: number;
  engine: string;
  ms: number | null;
}

export type PhotoOcrQuality = "usable" | "weak" | "none";

const DEFAULT_ASK_URL = "http://mira-ask:8011";
const DEFAULT_TIMEOUT_MS = 60_000;

/** Fewer words than this is not a document — a logo, a part number on a
 * blank wall — and indexing it would let chat "cite" a chunk with no answer
 * in it. */
export const MIN_INDEXABLE_WORDS = 3;
/** Below this mean confidence the text is indexed (a spec table read at 45%
 * still answers questions) but labelled weak so the technician knows to check
 * the photo. */
export const WEAK_CONFIDENCE_BELOW = 60;

/**
 * Both sides of the wire share one switch: PHOTO_OCR_ENABLED gates the
 * mira-ask endpoint AND this client, so one Doppler var turns the whole path
 * on or off. Hub-side check first = no wasted round-trip while dark.
 */
export function isPhotoOcrEnabled(): boolean {
  return process.env.PHOTO_OCR_ENABLED === "1";
}

export function ocrQuality(r: Pick<PhotoOcrResult, "meanConfidence" | "wordCount">): PhotoOcrQuality {
  if (r.wordCount < MIN_INDEXABLE_WORDS) return "none";
  if (r.meanConfidence !== null && r.meanConfidence < WEAK_CONFIDENCE_BELOW) return "weak";
  return "usable";
}

/**
 * The bytes the writer chunks: a one-line provenance header, then the OCR
 * text. The header is what a citation shows first, so the technician always
 * knows this passage was READ from a photograph at a stated confidence —
 * never mistaken for a manual's own text.
 */
export function ocrSourceText(filename: string, r: PhotoOcrResult): string {
  const conf = r.meanConfidence === null ? "unknown" : `${Math.round(r.meanConfidence)}%`;
  return `Text read from photo "${filename}" (OCR, ${conf} confidence):\n\n${r.text.trim()}\n`;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Read the text off a photo. Best-effort: resolves to a PhotoOcrResult or
 * null, never throws, never blocks the upload on failure.
 */
export async function ocrPhotoText(buffer: Buffer | Uint8Array): Promise<PhotoOcrResult | null> {
  if (!isPhotoOcrEnabled()) return null;

  const base = (process.env.MIRA_ASK_URL ?? DEFAULT_ASK_URL).replace(/\/+$/, "");
  const timeoutMs = Number(process.env.PHOTO_OCR_FETCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  let raw: unknown;
  try {
    const resp = await fetch(`${base}/ocr/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ASK_API_KEY ? { "X-Mira-Key": process.env.ASK_API_KEY } : {}),
      },
      body: JSON.stringify({ image_base64: Buffer.from(buffer).toString("base64") }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      console.warn(`[photo-ocr] mira-ask returned ${resp.status}; photo stays viewable-only`);
      return null;
    }
    raw = await resp.json();
  } catch (err) {
    console.warn("[photo-ocr] unavailable; photo stays viewable-only", err);
    return null;
  }

  const body = (raw ?? null) as Record<string, unknown> | null;
  if (!body || body.available !== true) {
    if (body?.reason) console.info(`[photo-ocr] not available: ${String(body.reason)}`);
    return null;
  }
  const text = typeof body.text === "string" ? body.text : "";
  const wordCount = num(body.word_count) ?? 0;
  return {
    text,
    meanConfidence: num(body.mean_confidence),
    wordCount,
    engine: typeof body.engine === "string" ? body.engine : "unknown",
    ms: num(body.ms),
  };
}
