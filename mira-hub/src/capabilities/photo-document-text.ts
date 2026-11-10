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

/**
 * The three documents the product writes from a photo. The first two are named
 * as the upload records name them (`namespace_direct_uploads.source`); the
 * third is the mark the upload route puts on a photo's OCR text when it stores
 * it (`metadata.derived_from` on its passages).
 */
export type PhotoDocumentKind = "photo_text" | "nameplate_text" | "photo_ocr";

const SHAPES = [
  ["photo_text", PHOTO_READING_OPENER, PHOTO_READING_BODY_MARK],
  ["nameplate_text", NAMEPLATE_OPENER, NAMEPLATE_BODY_MARK],
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
 * Which of the product's photo documents a stored text is SHAPED like, going by
 * its opening line; `null` for anything else.
 *
 * A shape is not an origin. The opening lines are ordinary text, and anyone
 * can type them at the top of a file and upload it. Use this only to decide
 * whether the upload records are worth asking; never to decide how to read the
 * text. `productWrittenBody` does that, and it needs the records' answer.
 */
export function photoDocumentShape(stored: string): PhotoDocumentKind | null {
  const first = stored.split("\n", 1)[0];
  if (first.startsWith(PHOTO_OCR_OPENER_START)) return "photo_ocr";
  for (const [kind, opener] of SHAPES) if (first === opener) return kind;
  return null;
}

/**
 * What a product-written photo document says was read off the photo: the text
 * after its marker line.
 *
 * `writtenAs` is what the upload records say the product wrote this document
 * as, or `null` when they say nothing. The reading is given only when the
 * records and the text's own shape agree. Otherwise this is `null`, and the
 * caller reads the text as an uploaded file: by its cover.
 *
 * An empty string when it is such a document but the marker falls outside the
 * stored block, so nothing of the reading is in view.
 */
export function productWrittenBody(stored: string, writtenAs: PhotoDocumentKind | null): string | null {
  if (writtenAs === null || photoDocumentShape(stored) !== writtenAs) return null;
  const lines = stored.split("\n");
  if (writtenAs === "photo_ocr") return lines.slice(1).join("\n");
  const mark = SHAPES.find(([kind]) => kind === writtenAs)![2];
  const at = lines.indexOf(mark);
  return at < 0 ? "" : lines.slice(at + 1).join("\n");
}
