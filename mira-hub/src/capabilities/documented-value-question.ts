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
  /\b(?:(?:supply|input|output|operating|rated|nominal|control|coil)\s+(?:voltage|current|power|frequency)|voltage|amperage|amps?\b|current\s+(?:rating|draw)|power\s+(?:rating|consumption|supply)|(?:operating|ambient|storage)\s+temperature|temperature\s+range|rating|ratings|spec(?:s|ification|ifications)?|datasheet|data\s+sheet|dimensions?|weight|torque|pressure\s+rating|ip\s?\d{2}\b|ip\s+rating|enclosure\s+rating|part\s+number|catalog\s+number|wiring|pin\s?out|terminal\s+(?:assignment|layout|designation)s?|parameter|default\s+setting|factory\s+setting|(?:carrier|switching|pwm)\s+frequency|(?:max(?:imum)?|min(?:imum)?|base)\s+frequency|(?:accel(?:eration)?|decel(?:eration)?|ramp)\s+time|(?:fuse|breaker|wire|cable|conductor)\s+(?:size|sizing|gauge|rating))\b/i;
// #4015: drive-tuning quantities (carrier frequency, ramp times, fuse/wire
// sizing) are model-documented too — "what carrier frequency should this drive
// not exceed" fell through to an uncited general answer.
// Fault/error/alarm CODE meanings are deliberately NOT matched: the answer
// floor's code-meaning rule (E10, answer-validation.ts) already replaces an
// invented code meaning with its own controlled fallback on every notebook.

// Phrasings that ask what the value IS, rather than what a concept means.
const ASKS_FOR_VALUE =
  /\b(?:what(?:'s|\s+is|\s+are)?|which|how\s+(?:much|many|hot|cold|high|low)|does\s+(?:it|the\s+\w+)\s+(?:need|take|use|require)|need|required|list|give\s+me|tell\s+me)\b/i;

// #4010 review: a TEACHING question must never abstain with "upload the
// manual" — that is the over-block direction the owner rejected (#3982/#3984).
// Decided on the WHOLE question (round 2): a binding anywhere ("for this
// panel", "on the TP700", "my drive", the bound model's own name) makes it a
// question about THIS equipment, however it opens.
//  - STRONG teaching frames are always conceptual: "difference between",
//    "… mean", "used for", "in general", "what a/an …", "explain what/how".
//  - A WEAK frame ("what is voltage?") is conceptual only when nothing binds it.
const STRONG_DEFINITIONAL =
  /\b(?:what\s+an?\b|difference\s+between|means?\b|used\s+for\b|in\s+general\b|explain\s+(?:what|how)\b)/i;
const WEAK_DEFINITIONAL =
  /\bwhat(?:'s|\s+is|\s+are|\s+does)\s+(?!(?:the|this|its|it|my|your|that|these|those)\b)/i;
const BINDING =
  /\b(?:this|its|it|my|your|our|that|these|those)\b|\b(?:on|for|of)\s+the\b/i;

function namesModel(q: string, boundModel: string | null | undefined): boolean {
  if (!boundModel) return false;
  const lq = q.toLowerCase();
  // Any model token carrying a digit ("TP700", "525", "V20") is a binding.
  return boundModel
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((t) => t.length >= 2 && /\d/.test(t) && new RegExp(`\\b${t}\\b`).test(lq));
}

export function asksForDocumentedValue(question: string, boundModel?: string | null): boolean {
  const q = question.trim();
  if (!q) return false;
  if (STRONG_DEFINITIONAL.test(q)) return false;
  const bound = BINDING.test(q) || namesModel(q, boundModel);
  if (WEAK_DEFINITIONAL.test(q) && !bound) return false;
  return DOCUMENTED_VALUE.test(q) && ASKS_FOR_VALUE.test(q);
}
