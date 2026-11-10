/**
 * The text of the documents the product writes itself from a technician's
 * photo — a kept photo reading, a confirmed nameplate, and the OCR text of an
 * uploaded photo — and how to tell them from an uploaded manual. Pure: no
 * database, no model call.
 *
 * All are evidence about what was photographed. None has a cover. Each opens
 * with lines the PRODUCT writes (what kind of evidence it is, the machine's
 * name or the photo's file name, the photo's file id and hash), then what was
 * read off the photo. Only that part says anything about a model or part
 * number: the machine's name is a label the technician chose ("CV-101"), and
 * a photo's file name is whatever the camera or the technician called it.
 *
 * The markers live here so the writers and the reader cannot drift apart. The
 * OCR writer (lib/photo-ocr.ts) is pinned to its opener by a test instead.
 */

export const PHOTO_READING_OPENER = "Photo source: technician photo";
export const PHOTO_READING_BODY_MARK = "What the photo shows:";
export const NAMEPLATE_OPENER = "EQUIPMENT NAMEPLATE — TECHNICIAN-CONFIRMED";
export const NAMEPLATE_BODY_MARK = "CONFIRMED IDENTITY (as corrected by the technician)";

/** How the first line of a photo's OCR text starts; the photo's file name follows. The reading starts on the next line. */
export const PHOTO_OCR_OPENER_START = 'Text read from photo "';

const SHAPES = [
  [PHOTO_READING_OPENER, PHOTO_READING_BODY_MARK],
  [NAMEPLATE_OPENER, NAMEPLATE_BODY_MARK],
] as const;

/** The header states, inside the document, what kind of evidence it is. */
export function buildPhotoSourceText(opts: {
  readonly machineName: string;
  readonly fileId: string;
  readonly photoSha256: string | null;
  readonly capturedAt: string | null;
  readonly observation: string;
  readonly reviewed?: boolean;
}): string {
  return [
    PHOTO_READING_OPENER,
    `Machine: ${opts.machineName}`,
    opts.reviewed ? "Evidence: technician-reviewed transcription of this photo. Review confirms the text, not a diagnosis or authorization to operate equipment." : "Evidence: a vision model's transcription of a technician's photo. The technician confirmed this photo belongs to this machine; the transcription itself is NOT technician-verified. Check any identifier against the original photo before acting on it.",
    `Photo file: ${opts.fileId}`,
    ...(opts.photoSha256 ? [`Photo sha256: ${opts.photoSha256}`] : []),
    ...(opts.capturedAt ? [`Captured: ${opts.capturedAt}`] : []),
    "",
    PHOTO_READING_BODY_MARK,
    opts.observation.trim(),
    "",
  ].join("\n");
}

/**
 * What a product-written photo document says was read off the photo: the text
 * after its marker line. `null` when the stored text is not such a document
 * (an uploaded manual). An empty string when it is one but the marker falls
 * outside the stored block, so nothing of the reading is in view.
 *
 * Recognised by the opening line alone, because that is all a stored block
 * carries. An uploaded file that opens the same way is read the same way.
 */
export function photoDocumentBody(stored: string): string | null {
  const lines = stored.split("\n");
  if (lines[0].startsWith(PHOTO_OCR_OPENER_START)) return lines.slice(1).join("\n");
  for (const [opener, mark] of SHAPES) {
    if (lines[0] !== opener) continue;
    const at = lines.indexOf(mark);
    return at < 0 ? "" : lines.slice(at + 1).join("\n");
  }
  return null;
}
