/**
 * #4645 defect 1 — restart-safety framing for reset / restart-after-fault asks.
 *
 * Staging, Siemens TP700 Comfort manual, 2026-10-23: none of 16 answers to
 * "how do I clear / reset / acknowledge a fault, get it running again" said to
 * find the cause first, keep people clear before a restart, or lock out before
 * reaching in.
 *
 * This is an ADVISORY, not a safety trigger:
 *   - It never stops a turn. Acknowledging a fault on an HMI is a normal
 *     operator action; answering it is the point.
 *   - It never changes grounding. The route keeps it separate from
 *     `safetyTrigger`, because a safety trigger lets a turn be answered with no
 *     retrieved evidence — and an invented reset procedure is exactly the
 *     failure #4645 is about.
 *   - Its banner is fixed server text and cites no manual page: it is site
 *     safety practice, not a claim about the document.
 *
 * Zero-token, deterministic, Hub-only (mirrors nothing in guardrails.py).
 */

/** A fault-type object a technician resets, clears or acknowledges. Alarm
 *  HISTORY / LOG / BUFFER / LIST is record-keeping, not a machine state. */
const FAULT_OBJECT =
  "(?:faults?|faulted|trips?|tripped|alarms?(?!\\s+(?:history|log|logs|buffer|list|archive)\\b)|errors?|e-?stops?|interlocks?)";

/** reset / clear / acknowledge within four words BEFORE the fault object. */
const VERB_THEN_OBJECT = new RegExp(
  `\\b(?:reset|re-set|clear|acknowledge|acknowledging)\\b(?:\\W+\\w+){0,4}?\\W+${FAULT_OBJECT}\\b`,
  "i",
);

/** "fault reset", "trip reset procedure", "alarm clear" — object first. */
const OBJECT_THEN_VERB = new RegExp(`\\b${FAULT_OBJECT}\\W+(?:\\w+\\W+){0,1}?(?:reset|clear|acknowledg(?:e|ment))\\b`, "i");

/** A restart phrase. On its own it is too broad ("restart my laptop"), so it
 *  only counts with a fault / stop context in the same message. */
const RESTART_PHRASE =
  /\b(?:re-?start(?:ing)?|start\s+(?:it|this|that|the\s+\w+)\s+(?:back\s+)?up|get(?:ting)?\s+(?:it|this|that|the\s+\w+(?:\s+\w+)?)\s+(?:running|going|started|moving)\s+again|back\s+up\s+and\s+running)\b/i;
const STOP_CONTEXT = new RegExp(`\\b(?:${FAULT_OBJECT}|stopped|went\\s+down|shut\\s+down|tripped)\\b`, "i");

/** True when the message asks how to reset / clear / acknowledge a fault-type
 *  condition, or how to restart a machine that faulted or stopped. */
export function isFaultResetAsk(message: string): boolean {
  const msg = (message || "").trim();
  if (!msg) return false;
  if (VERB_THEN_OBJECT.test(msg) || OBJECT_THEN_VERB.test(msg)) return true;
  return RESTART_PHRASE.test(msg) && STOP_CONTEXT.test(msg);
}

/** Fixed banner shown above the answer. No page citation (see header). */
export const RESTART_BANNER =
  "⚠️ **Before you reset or restart.** Find and correct the cause first — if it trips again, the cause is still there. " +
  "A reset can restart motion: make sure everyone is clear. Lock out before anyone reaches in.";

/** Prompt directive for an advisory turn. Grounding rules are unchanged. */
export const RESTART_DIRECTIVE = `## RESET / RESTART AFTER A FAULT

The technician wants to clear, acknowledge or reset a fault or alarm, or restart a
stopped machine. Answer from the documents exactly as you otherwise would; do not invent
steps the documents do not contain. Where the answer gives reset or restart
steps, state these conditions inline at the step they apply to: identify and correct
the cause before resetting; confirm people are clear before anything can move;
lockout/tagout before any hands-in work. A factory reset, a firmware or
operating-system update, or deleting project or user data is NOT a way to clear a
fault — never present one as a fault reset. The UI already shows a restart banner
above your answer; do not repeat it as a lecture.`;
