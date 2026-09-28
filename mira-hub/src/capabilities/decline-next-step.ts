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
  /\b(?:pass\s?codes?|passwords?|unlock\s+codes?|access\s+codes?|master\s+codes?|admin(?:istrator)?\s+codes?)\b/i;

/** Every "pin" mention, with an optional pin NUMBER after it ("PIN 4", "PINs 3
 *  and 5", "PIN #2", "pin number 4"). A numbered pin is hardware, whatever else
 *  the message says (#4094 Codex round 3 F1). */
const PIN_MENTION = /\bpins?\b(\s*(?:#|no\.?\s*|numbers?\s*)?\d)?/gi;

/** A qualifier that always makes a PIN a credential: "service PIN", "PIN code". */
const QUALIFIER_BEFORE = /\b(?:service|security|operator|admin(?:istrator)?|unlock|access|login|user)\s+$/i;
const CODE_AFTER = /^\s*codes?\b/i;
const NUMBER_AFTER = /^\s*numbers?\b/i;

const HARDWARE_PIN_CONTEXT =
  /\b(?:connectors?|terminals?|plugs?|sockets?|headers?|pinouts?|harness(?:es)?|cables?|wires?|wiring|carr(?:y|ies)|volts?|vdc|vac|signal|m8|m12|db-?9|db-?25|rj-?45|encoder)\b|\d+\s*v\b/i;

/** Login / lock words make a PIN a credential anywhere in its sentence. */
const CREDENTIAL_PIN_CONTEXT =
  /\b(?:log\s?-?in|logon|sign\s?-?in|unlock|locked|access|security|password|passcode|user|account|admin(?:istrator)?)\b/i;

const SENTENCES = /(?<=[.!?])\s+|\n+/;
const CLAUSES = /[,;]|\s+(?:and|but|or)\s+/i;

/** Decide EACH pin mention on its own (#4094 post-cap r3 F3: "What is the login
 *  PIN to unlock my PLC, and what does PIN 4 on its cable do?" — the numbered
 *  cable pin must not hide the login PIN). Login words count across the
 *  mention's sentence (post-cap F2: "What is the PIN for my PLC login? The M12
 *  connector is working." keeps the unrelated next sentence out); hardware words
 *  count only within its clause. Case-insensitive, so a lowercase login "pin"
 *  is a credential (post-cap r3 F2). Hardware words override a bare "pin
 *  number(s)" (post-cap r3 F1: "Which pin numbers on my PLC connector carry
 *  24 V?"). A bare lowercase "pin" with no context stays generic. */
function credentialPin(message: string): boolean {
  for (const sentence of message.split(SENTENCES)) {
    const credentialSentence = CREDENTIAL_PIN_CONTEXT.test(sentence);
    for (const clause of sentence.split(CLAUSES)) {
      for (const m of clause.matchAll(PIN_MENTION)) {
        if (m[1]) continue; // numbered pin: hardware
        const before = clause.slice(0, m.index);
        const after = clause.slice((m.index ?? 0) + m[0].length);
        if (QUALIFIER_BEFORE.test(before) || CODE_AFTER.test(after)) return true;
        if (credentialSentence) return true;
        if (HARDWARE_PIN_CONTEXT.test(clause)) continue;
        if (NUMBER_AFTER.test(after) || /^PINs?$/.test(m[0])) return true;
      }
    }
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
