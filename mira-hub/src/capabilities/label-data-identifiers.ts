/**
 * #4131 — label data identifiers. Industrial product labels prefix a value with
 * an ANSI MH10.8.2 / ISO/IEC 15418 data identifier ("1P 6AV2124-0GC01-0AX0",
 * "S LBS3073983"). The answer model does not know the convention: on staging
 * cc71d1e61 it explained a Siemens TP700's "1P" as "single-phase power" on 5 of
 * 5 attempts (the same label reads "Supply 24 Vdc"). A general "don't interpret
 * codes" rule did not move it; this factual note took it to 0/5 with no change
 * to part-number, supply or model answers (A/B on gpt-oss-120b, 5 reps per case;
 * numbers on #4131 — raw captures stay off-repo because they quote serial numbers).
 *
 * Deterministic and conditional: the note is added only when a photo
 * observation in this turn's context actually shows a "1P <code>" field.
 * Stable knowledge as an artifact (zero-token-architecture), no new call.
 */

export const LABEL_DATA_IDENTIFIER_NOTE =
  "LABEL DATA IDENTIFIERS (ANSI MH10.8.2 / ISO/IEC 15418, used on industrial product labels): a short prefix printed before a value names that value \u2014 \"1P\" = the supplier's part (order) number, \"S\" = serial number, \"Q\" = quantity, \"4L\" = country of origin, \"10D\" = date code. The prefix is not part of the value and says nothing about the product's electrical supply or configuration.";

/** A "1P" data identifier followed by a code (the order number), as a vision
 *  model transcribes it: "1P 6AV2124-0GC01-0AX0", "1P6ES7…". Case-sensitive: a
 *  lowercase "1p" is not the identifier. */
const DATA_IDENTIFIER_FIELD = /(?<![A-Za-z0-9])1P\s?[A-Z0-9][A-Z0-9.\-/]{4,}/;

export function showsLabelDataIdentifier(observationText: string): boolean {
  return DATA_IDENTIFIER_FIELD.test(observationText);
}

/** The system prompt, plus the note when the photo context shows a data identifier. */
export function withLabelDataIdentifiers(systemPrompt: string, photoContext: string): string {
  return showsLabelDataIdentifier(photoContext) ? `${systemPrompt}\n\n${LABEL_DATA_IDENTIFIER_NOTE}` : systemPrompt;
}
