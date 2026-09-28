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
  /\b(?:pass\s?codes?|passwords?|pins?\s+(?:codes?|numbers?)(?!\s*#?\d)|unlock\s+codes?|access\s+codes?|master\s+codes?|admin(?:istrator)?\s+codes?|(?:service|security|operator|admin|unlock|access)\s+pins?)\b/i;

/** A standalone "PIN" is a credential only when written as the acronym AND the
 *  message has no hardware-pin context; "Which PIN on my M12 connector carries
 *  24 V?" is a pinout question a manual answers (#4094 Codex round 2 F1). A
 *  qualified "service PIN" is always a credential (CREDENTIAL above). */
const PIN_ACRONYM = /\bPINs?\b/;
const HARDWARE_PIN_CONTEXT =
  /\b(?:connectors?|terminals?|plugs?|sockets?|headers?|pinouts?|harness(?:es)?|cables?|wires?|wiring|carr(?:y|ies)|volts?|vdc|vac|signal|m8|m12|db-?9|db-?25|rj-?45|encoder)\b|\d+\s*v\b/i;

/** "PIN 4", "PINs 3 and 5", "PIN #2" — a numbered pin is hardware, whatever
 *  else the message says (#4094 Codex round 3 F1). */
const NUMBERED_PIN = /\bPINs?\s*(?:#|no\.?\s*|numbers?\s*)?\d/i;

/** Login / lock words make a PIN a credential whatever else the sentence says. */
const CREDENTIAL_PIN_CONTEXT =
  /\b(?:log\s?-?in|logon|sign\s?-?in|unlock|locked|access|security|password|passcode|user|account|admin(?:istrator)?)\b/i;

/** Decide each "PIN" by ITS OWN sentence, so an unrelated clause elsewhere in
 *  the message can't decide it (#4094 Codex post-cap F2: "What is the PIN for
 *  my PLC login? The M12 connector is working."). */
function credentialPin(message: string): boolean {
  for (const sentence of message.split(/(?<=[.!?])\s+|\n+/)) {
    if (!PIN_ACRONYM.test(sentence)) continue;
    if (CREDENTIAL_PIN_CONTEXT.test(sentence)) return true;
    if (NUMBERED_PIN.test(sentence) || HARDWARE_PIN_CONTEXT.test(sentence)) continue;
    return true;
  }
  return false;
}

/** Firmware + a recovery verb within one short message span. The window may
 *  cross ONE sentence boundary ("My firmware is corrupted. How do I recover
 *  it?" — #4094 Codex round 3 F2) but stays short so an unrelated later
 *  sentence cannot combine with an earlier firmware mention. */
const FIRMWARE_SERVICE =
  /\bfirmware\b[^\n]{0,60}?\b(?:recover(?:y|ing)?|restor(?:e|ing)|re-?flash(?:ing)?|flash(?:ing)?|brick(?:ed)?|corrupt(?:ed)?)\b|\b(?:recover(?:y|ing)?|restor(?:e|ing)|re-?flash(?:ing)?|brick(?:ed)?|corrupt(?:ed)?)\b[^\n]{0,60}?\bfirmware\b/i;

export function declineKind(message: string): DeclineKind | null {
  if (CREDENTIAL.test(message)) return "credential";
  if (credentialPin(message)) return "credential";
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
