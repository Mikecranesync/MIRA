/**
 * #4004 — does this question ask for a value that only the equipment's own
 * documentation can establish?
 *
 * Used for exactly one decision: when a notebook is bound to a specific model
 * (identity-bound OEM retrieval) and the correctly-scoped search finds no
 * manual for that model, a documented-value question must abstain honestly
 * ("I don't have the <model> manual") instead of falling through to an uncited
 * general answer that reads like a spec sheet. Conceptual questions on the same
 * notebook ("how does a touch panel work?") are NOT matched and keep answering.
 *
 * Deterministic and deliberately conservative: a miss leaves the pre-existing
 * general-lane behaviour (and the answer floor's specificity checks) in place;
 * it never makes an answer less guarded than it was.
 */

// A documentation-only quantity or artifact of THIS equipment.
const DOCUMENTED_VALUE =
  /\b(?:(?:supply|input|output|operating|rated|nominal|control|coil)\s+(?:voltage|current|power|frequency)|voltage|amperage|amps?\b|current\s+(?:rating|draw)|power\s+(?:rating|consumption|supply)|(?:operating|ambient|storage)\s+temperature|temperature\s+range|rating|ratings|spec(?:s|ification|ifications)?|datasheet|data\s+sheet|dimensions?|weight|torque|pressure\s+rating|ip\s?\d{2}\b|ip\s+rating|enclosure\s+rating|part\s+number|catalog\s+number|wiring|pin\s?out|terminal\s+(?:assignment|layout|designation)s?|parameter|default\s+setting|factory\s+setting)\b/i;
// Fault/error/alarm CODE meanings are deliberately NOT matched: the answer
// floor's code-meaning rule (E10, answer-validation.ts) already replaces an
// invented code meaning with its own controlled fallback on every notebook.

// Phrasings that ask what the value IS, rather than what a concept means.
const ASKS_FOR_VALUE =
  /\b(?:what(?:'s|\s+is|\s+are)?|which|how\s+(?:much|many|hot|cold|high|low)|does\s+(?:it|the\s+\w+)\s+(?:need|take|use|require)|need|required|list|give\s+me|tell\s+me)\b/i;

export function asksForDocumentedValue(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  return DOCUMENTED_VALUE.test(q) && ASKS_FOR_VALUE.test(q);
}
