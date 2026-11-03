/**
 * #5129 — back-up framing for an answer that tells the technician to erase
 * settings or a program (notebook chat, gated lane).
 *
 * Staging, Oct 23 – Nov 2: "Set P041 [Reset To Defalts] to option 1", "Set
 * P9.08 [Restore to Default] to 99", "use an empty transfer card to delete the
 * password-protected program ... erases the CPU internal load memory" — none
 * said to save the parameters or project first.
 *
 * This is an ADVISORY, same shape as restart-advisory and isolation-advisory:
 *   - It never stops a turn and never changes grounding.
 *   - Its banner is fixed server text and cites no manual page. The wording
 *     is pending owner sign-off (#5129).
 *
 * It fires only on an erase in instruction position — clause-initial, after a
 * modal ("you can"), or "is to <verb>" — whose clause names an erase target.
 * A prohibition ("do not reset to defaults"), a description ("a factory reset
 * deletes ..."), an erase inside an if-clause, or a back-up instruction earlier
 * in the answer keeps it silent.
 *
 * Zero-token, deterministic, Hub-only.
 */

import { PROHIBITION } from "./step-energy";

/** Fixed banner shown above an erase answer. No page citation (see header). */
export const BACKUP_BANNER =
  "⚠️ **This erases settings.** Back up the parameters or project first — a reset to defaults cannot be undone.";

const ERASE_VERB =
  "(?:set|select|choose|press|tap|hold|use|run|perform|enter|go\\s+to|navigate\\s+to|restore|reset|return|delete|erase|clear|format|wipe|initiali[sz]e)";

/** An erase verb at a clause start (sentence, list item, after a comma or dash),
 *  after a modal, or after "is to". */
const INSTRUCTION_RE = new RegExp(
  "(?:(?:^|[.!?:;,](?=\\s)|[—–]|\\s-\\s|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+|also\\s+)?" +
    "|\\b(?:then|or|and(?:\\s+then)?|you\\s+(?:can|should|must|may|need\\s+to|have\\s+to)|is\\s+to)\\s+)" +
    `${ERASE_VERB}\\b`,
  "gi",
);

/** What makes the clause an erase. "fault memory" / "alarm memory" are logs, not settings. */
const ERASE_TARGET =
  /\b(?:(?:reset|restore|return)s?\b(?:\s+[\w-]+){0,3}?\s+(?:to\s+)?(?:the\s+)?(?:factory\s+)?defa\w*lts?|factory\s+(?:reset|defaults?|settings)|(?:delete|erase|clear|format|wipe|initiali[sz]e)s?\b(?:\s+[\w-]+){0,3}?\s+(?:project|program|user\s+data|recipes?|(?<!(?:fault|alarm|error)\s)memory|sd\s+card|memory\s+card)|empty\s+transfer\s+card)\b/i;

/** A back-up instruction already in the answer, before the erase. */
const BACKUP_RE =
  /\b(?:back\s*up|backup|save|export|upload|copy|write\s+down|record)\b[^.!?]*?\b(?:parameters?|settings?|project|program|config\w*|values|recipes?)\b/i;

/** End of the clause that starts at an erase verb. "P9.08" is not a sentence end. */
const CLAUSE_END = /[.!?;](?=\s|$)|\n/;

/** BACKUP_BANNER when the answer instructs an erase with no back-up before it, else null. */
export function backupBannerFor(answerText: string): string | null {
  const text = (answerText || "").replace(PROHIBITION, (m) => " ".repeat(m.length));
  for (const m of text.matchAll(INSTRUCTION_RE)) {
    const start = m.index ?? 0;
    const rest = text.slice(start + m[0].search(/\S/));
    const end = rest.search(CLAUSE_END);
    const clause = end > 0 ? rest.slice(0, end) : rest;
    if (!ERASE_TARGET.test(clause)) continue;
    if (BACKUP_RE.test(answerText.slice(0, start))) return null;
    return BACKUP_BANNER;
  }
  return null;
}

/** The model's answer with the back-up notice prepended; unchanged when no
 *  notice applies. The route calls it on the raw candidate, before any server
 *  banner is stacked above. No explicit dedupe: the banner itself says "Back
 *  up …", so BACKUP_RE keeps an already-bannered answer silent. */
export function withBackupBanner(answerText: string): string {
  if (!answerText || !backupBannerFor(answerText)) return answerText;
  return `${BACKUP_BANNER}\n\n${answerText}`;
}

// #5131 — a question about clearing a FAULT answered with FACTORY-reset steps
// (staging TP700, 2026-10-23: "What is the fault reset procedure?" → "select
// Prepare for Reset to reset the HMI device to factory settings"). Same advisory
// shape as above; the wording is pending owner sign-off with the back-up banner.

/** Fixed banner shown above a factory reset offered for a fault. No page citation. */
export const FACTORY_NOT_FAULT_BANNER =
  "⚠️ **This is a factory reset, not a fault reset.** It wipes the device's settings and is not the step for clearing a fault. Check the fault code and the manual's fault-reset steps first.";

/** The technician asks to reset, clear or acknowledge a fault, error, alarm or trip. */
const FAULT_RESET_QUESTION =
  /\b(?:reset|re-set|clear|acknowledge|ack)\w*\b.{0,40}\b(?:fault|error|alarm|trip)s?\b|\b(?:fault|error|alarm|trip)s?\b.{0,30}\b(?:reset|clear)\w*\b|\bfault(?:ed|s)?\b.{0,80}\breset\b/i;

/** The technician asked for the factory reset themselves. */
const ASKS_FACTORY = /\bfactory\b|\bdefaults?\b|\bprepare\s+for\s+reset\b|\binitiali[sz]e\b/i;

/** A factory reset, as opposed to any other erase. */
const FACTORY_TARGET =
  /\b(?:factory\s+(?:reset|defaults?|settings)|(?:reset|restore|return)s?\b(?:\s+[\w-]+){0,3}?\s+(?:to\s+)?(?:the\s+)?(?:factory\s+)?defa\w*lts?|prepare\s+for\s+reset)\b/i;

/** FACTORY_NOT_FAULT_BANNER when a fault-reset question gets factory-reset instructions, else null. */
export function factoryNotFaultBannerFor(question: string, answerText: string): string | null {
  const q = question || "";
  if (!FAULT_RESET_QUESTION.test(q) || ASKS_FACTORY.test(q)) return null;
  const text = (answerText || "").replace(PROHIBITION, (m) => " ".repeat(m.length));
  for (const m of text.matchAll(INSTRUCTION_RE)) {
    const rest = text.slice((m.index ?? 0) + m[0].search(/\S/));
    const end = rest.search(CLAUSE_END);
    if (FACTORY_TARGET.test(end > 0 ? rest.slice(0, end) : rest)) return FACTORY_NOT_FAULT_BANNER;
  }
  return null;
}

/** The answer with the factory-vs-fault notice on top (above any back-up notice); once only. */
export function withFactoryNotFaultBanner(question: string, answerText: string): string {
  if (!answerText || answerText.startsWith(FACTORY_NOT_FAULT_BANNER)) return answerText;
  if (!factoryNotFaultBannerFor(question, answerText)) return answerText;
  return `${FACTORY_NOT_FAULT_BANNER}\n\n${answerText}`;
}
