/**
 * #4143 — say what was read off the photo. On staging 9e4bf1f2 a TP700 nameplate
 * photo got "The device in the enclosure is a Siemens TP 700 Comfort controller,
 * part number 6AV2124-0GC01-0AX0": right model, but the answer never said it was
 * printed on the label, so the technician asked "where did it come up with that
 * model number?" — and "controller" was inferred, not read (it is an HMI panel).
 *
 * Deterministic and conditional, like label-data-identifiers.ts (#4131): the
 * note is added only when a photo observation is in this turn's context
 * (current or earlier LOOK). Stable knowledge as an artifact, no new call.
 * The example deliberately names no real product so it cannot leak into answers.
 */

export const PHOTO_PROVENANCE_NOTE =
  "PHOTO LABEL TEXT: when you identify equipment from a photo, first say what the label appears to read, quoting the exact text (for example: The label appears to read \"<text exactly as printed>\"). This is an unconfirmed transcription. Keep label text separate from inference. Do not infer or explain a device type or part-number suffix from shape, color, wiring, or code patterns; name a type only when it is explicitly printed on the label or confirmed by a cited source. Never claim two part numbers are compatible without a cited source that establishes the match.";

/** The system prompt, plus the note when a photo observation is in context. */
export function withPhotoProvenance(systemPrompt: string, photoContext: string): string {
  return photoContext.trim() ? `${systemPrompt}\n\n${PHOTO_PROVENANCE_NOTE}` : systemPrompt;
}
