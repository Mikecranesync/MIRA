/**
 * Answer in the technician's language (2026-09-27, MIRA 100x plan move 5).
 *
 * Maintenance crews are often multilingual while the manuals are English; an
 * English-only procedure on a Spanish-speaking crew is a documented
 * comprehension and safety gap. One rule, appended to every chat route's
 * system prompt, so the language behaviour lives in one place.
 */
export const ANSWER_LANGUAGE_RULE =
  "LANGUAGE: Answer in the language the technician wrote in. Keep manual titles, " +
  "parameter names, register addresses, fault codes and [n] citations exactly as written in the source.";

/** Append the language rule to a system prompt. */
export function withAnswerLanguage(systemPrompt: string): string {
  return `${systemPrompt}\n\n${ANSWER_LANGUAGE_RULE}`;
}
