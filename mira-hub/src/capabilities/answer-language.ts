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

/** Said outright when the question is English: a Siemens G120 question answered
 *  in Spanish three times out of three on staging (2026-11-26, panel #5956),
 *  because "the language the technician wrote in" left the model to infer it
 *  from a prompt that also carried non-English text. */
export const ENGLISH_ANSWER_RULE =
  "The technician wrote in English: answer in English, even when a manual title, " +
  "source excerpt or status line is in another language.";

/** Append the language rule to a system prompt. Pass the technician's question
 *  to state its language outright when it is English; without it (or for a
 *  non-English question) the rule is unchanged. */
export function withAnswerLanguage(systemPrompt: string, question?: string): string {
  // English is stated outright only for a question that is Latin-script AND not recognisably another
  // Latin-script language. A Japanese/Arabic/Hindi/Russian question carries no accented Latin letters,
  // but it is not English and is never called English here (#6030 F7).
  const english =
    question !== undefined && question.trim() !== "" && !looksNonEnglish(question) && nonLatinScriptsIn(question).size === 0;
  return `${systemPrompt}\n\n${ANSWER_LANGUAGE_RULE}${english ? ` ${ENGLISH_ANSWER_RULE}` : ""}`;
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


/** Script groups whose letters a Latin-script (English) answer does not normally contain. Greek is left
 *  out on purpose: Ω/µ/Δ are ordinary unit and drive symbols. */
export type ScriptGroup = "cjk" | "hangul" | "arabic" | "devanagari" | "cyrillic" | "thai" | "hebrew";

export const SCRIPT_PATTERNS: ReadonlyArray<readonly [ScriptGroup, string]> = [
  ["cjk", "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}"],
  ["hangul", "\\p{Script=Hangul}"],
  ["arabic", "\\p{Script=Arabic}"],
  ["devanagari", "\\p{Script=Devanagari}"],
  ["cyrillic", "\\p{Script=Cyrillic}"],
  ["thai", "\\p{Script=Thai}"],
  ["hebrew", "\\p{Script=Hebrew}"],
];

/** The non-Latin script groups present in `text` (letters only; digits, symbols and Latin are ignored). */
export function nonLatinScriptsIn(text: string): Set<ScriptGroup> {
  const out = new Set<ScriptGroup>();
  for (const [group, cls] of SCRIPT_PATTERNS) if (new RegExp(`[${cls}]`, "u").test(text)) out.add(group);
  return out;
}
