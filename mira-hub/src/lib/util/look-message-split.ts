/**
 * Server-side message splitting for LOOK visual evidence.
 *
 * The mobile LOOK probe composes:
 *   Visual observation (HH:MM:SS, phone photo): <observation>
 *   <blank line>
 *   <technician question>
 *
 * This helper extracts the observation text so it can be stored and delivered
 * to the model separately from the question, preventing negated observations
 * (e.g. "No visible damage, burn marks...") from triggering false-positive
 * SAFETY_STOP on immediate-tier keywords (issue #3852).
 *
 * The split is performed BEFORE matchSafetyStop classification, so the
 * classifier sees only the technician's question, not the machine-generated
 * observation prose that may contain negations of safety-relevant terms.
 */

/**
 * Split a LOOK message into observation and question parts.
 *
 * Returns {observation, question} where:
 *   - observation: string | null — the visual observation text (null if format doesn't match)
 *   - question: string — the technician's question (always a string; fallback to full message if split fails)
 *
 * Pure, deterministic, no dependencies — testable standalone.
 */
export function splitLookMessage(fullMessage: string): {
  observation: string | null;
  question: string;
} {
  // Match the prefix up to and including the colon. Use [ \t]* to match only horizontal whitespace,
  // not vertical (no newlines), so the \n\n separator is not consumed.
  const PREFIX_PATTERN = /^Visual observation \(\d{2}:\d{2}:\d{2}, phone photo\):[ \t]*/;
  const SEPARATOR = "\n\n";

  const match = fullMessage.match(PREFIX_PATTERN);
  if (!match) {
    // Format doesn't match; return as a single question, no observation
    return { observation: null, question: fullMessage };
  }

  const prefixEnd = match[0].length;
  const rest = fullMessage.slice(prefixEnd);
  const separatorIndex = rest.indexOf(SEPARATOR);

  if (separatorIndex === -1) {
    // No separator found; treat everything as observation
    return { observation: rest.trim(), question: "" };
  }

  const observation = rest.slice(0, separatorIndex);
  const question = rest.slice(separatorIndex + SEPARATOR.length).trim();

  return { observation, question };
}
