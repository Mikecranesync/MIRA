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

// The manuals (and the BM25 index over them) are English. A Spanish question
// retrieved nothing on staging 2026-09-27 and the model then guessed a register
// — so a non-English question is searched in English and answered in its own
// language. Detection is deliberately conservative: an accented / ¿¡ character,
// or at least two non-English function words. English questions never pay for
// the extra call.
const NON_ENGLISH_CHARS = /[¿¡áéíóúñüàèìòùâêîôûçãõäöß]/i;
const NON_ENGLISH_WORDS =
  /\b(qué|que|cómo|como|cuál|cual|dónde|donde|los|las|del|para|por|una|está|esta|pero|und|der|die|das|wie|ist|nicht|les|des|est|pour|comment|quel|avec|não|nao|uma|isso)\b/gi;

export function looksNonEnglish(text: string): boolean {
  if (NON_ENGLISH_CHARS.test(text)) return true;
  return (text.match(NON_ENGLISH_WORDS) ?? []).length >= 2;
}

type Translate = (text: string) => Promise<string | null>;

/** The query to SEARCH the English corpus with. Falls back to the original
 *  text on any failure — a failed translation must never cost the answer. */
export async function englishSearchQuery(text: string, translate: Translate): Promise<string> {
  if (!looksNonEnglish(text)) return text;
  try {
    const out = (await translate(text))?.trim();
    return out && out.length <= 600 ? out : text;
  } catch {
    return text;
  }
}
