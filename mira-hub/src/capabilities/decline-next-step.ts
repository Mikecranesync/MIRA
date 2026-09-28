/**
 * The next step a machine-bound decline offers, when "upload the manual" is the
 * wrong one (2026-09-28 Answer Radar on staging 76887423c, graded by Claude and
 * gpt-5.5):
 *
 *   - A passcode / service password is never in a manual MIRA can search, so
 *     telling the technician to upload one implies it would unlock the answer
 *     (seed 006, `wrong_document_requested`). Route to the owner or OEM service.
 *   - Firmware recovery goes through the OEM service channel as often as through
 *     a manual (seed 003; the adversary grader deducted for not saying so).
 *
 * Deterministic phrase matching on the technician's own message; it only picks
 * the COPY of a decline that has already been decided upstream. It never drives
 * retrieval, never names a device the server did not resolve, and never makes a
 * turn answer instead of decline.
 */

export type DeclineKind = "credential" | "service_procedure";

const CREDENTIAL =
  /\b(?:pass\s?codes?|passwords?|pins?\s+(?:codes?|numbers?)|unlock\s+codes?|access\s+codes?|master\s+codes?|admin(?:istrator)?\s+codes?|(?:service|security|operator|admin|unlock|access)\s+pins?)\b/i;

/** A bare "PIN" is a credential only when written as the acronym; a lower-case
 *  "pin" is a connector or terminal pin ("which pin carries 24 V"). */
const PIN_ACRONYM = /\bPINs?\b/;

const FIRMWARE_SERVICE =
  /\bfirmware\b[^.?!\n]{0,40}\b(?:recover(?:y|ing)?|restor(?:e|ing)|re-?flash(?:ing)?|flash(?:ing)?|brick(?:ed)?|corrupt(?:ed)?)\b|\b(?:recover(?:y|ing)?|restor(?:e|ing)|re-?flash(?:ing)?|brick(?:ed)?|corrupt(?:ed)?)\b[^.?!\n]{0,40}\bfirmware\b/i;

export function declineKind(message: string): DeclineKind | null {
  if (CREDENTIAL.test(message) || PIN_ACRONYM.test(message)) return "credential";
  if (FIRMWARE_SERVICE.test(message)) return "service_procedure";
  return null;
}

/** The whole decline for a kind. `machine` and `manufacturer` are the
 *  server-resolved identity (notebook binding), never parsed from free text. */
export function declineText(kind: DeclineKind, machine: string, manufacturer: string): string {
  if (kind === "credential") {
    return `Passcodes and service passwords for the ${machine} aren't something I can look up or guess, and uploading a manual won't unlock one. Get it from the equipment owner or ${manufacturer} service.`;
  }
  return `I couldn't find a ${machine} firmware recovery procedure in the manuals I have, so I won't guess at one. Contact ${manufacturer} service or your distributor before attempting it — a failed flash can leave the unit inoperable. If you have the ${machine} firmware or service manual, upload it to this notebook and ask again.`;
}
