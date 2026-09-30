import type { LookResult } from "../api/resources";

export const PHOTO_UPLOAD_FAILED = "The photo didn't upload — try again.";
/** Shared with the legacy surface so both say the same thing (see #3837). */
export const PHOTO_ANALYSIS_UNAVAILABLE =
  "The photo was saved, but MIRA couldn't analyze it. Try another photo before asking about it.";
export const PHOTO_NOT_LINKED = "The photo didn't attach to this project — try again.";
export const PHOTO_NOT_SAVED = "MIRA read the photo but couldn't save what it saw — try again.";

/**
 * Whether a LOOK result may ride a question, and if not, what to tell the
 * technician. Every refusal is a case where sending would answer "about the
 * photo" from nothing, because the chat route only grounds on a photo that is
 * parked, read, LINKED to this notebook, and whose observation was SAVED:
 *
 *  - no fileId: the photo never uploaded;
 *  - no observation: vision failed (502) or is unconfigured (503);
 *  - no link: the chat route silently ignores an unlinked photo;
 *  - not persisted: /look's save is fail-open, and chat re-derives the photo's
 *    evidence from the saved observation (#4082; the web client has refused
 *    this since #4024 round 3).
 *
 * Returns null when the photo can ride.
 */
export function lookRefusal(look: LookResult): string | null {
  if (!look.fileId) return PHOTO_UPLOAD_FAILED;
  if (!look.observation) return PHOTO_ANALYSIS_UNAVAILABLE;
  if (!look.attachment?.linkId) return PHOTO_NOT_LINKED;
  if (!look.observationPersisted) return PHOTO_NOT_SAVED;
  return null;
}
