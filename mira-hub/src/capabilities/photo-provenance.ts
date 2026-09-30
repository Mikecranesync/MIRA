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
  "PHOTO LABEL TEXT: when you identify equipment from a photo, first say what the label shows by quoting the exact text you read (for example: The nameplate reads \"<text exactly as printed>\"), then give your identification. Keep what you read separate from what you infer. Name the device type (controller, drive, panel, relay) only if the label or the photo observation names it; otherwise describe what is visible.";

/** The system prompt, plus the note when a photo observation is in context. */
export function withPhotoProvenance(systemPrompt: string, photoContext: string): string {
  return photoContext.trim() ? `${systemPrompt}\n\n${PHOTO_PROVENANCE_NOTE}` : systemPrompt;
}
