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

// #4068 — "how does <anything> work" is teaching, bound or not: declining it
// with "upload the manual" is the over-block the #4010 review rejected.
const HOW_IT_WORKS = /\bhow\s+(?:does|do)\b[^?.!]{0,60}?\bwork(?:s|ing)?\b/i;

// "why does a VFD trip…", "why do VFDs…", "when would an encoder…" — a question
// about a CLASS of equipment (indefinite article or bare plural), not this one.
// Only teaching when nothing binds it to the notebook's machine.
const GENERIC_CLASS_WHY =
  /\b(?:why|when|how\s+often)\s+(?:does|do|would|can|might|will|is|are)\s+(?:an?\s+[\w-]+|[\w-]+s)\b/i;

// Codex #4069 pass 7 F2: an unbound question about "a VFD" / "an encoder" is
// about a CLASS of equipment ("what should I check when a VFD trips?"), not
// this machine — teaching. Contextual shorthand without an article ("it trips
// every morning", "the drive trips") is unaffected.
// Pass 8: only "a/an" + an EQUIPMENT noun is a class subject — "after a power
// outage" or "for a minute" says nothing about which equipment is meant.
const EQUIPMENT_NOUN =
  "(?:vfds?|drives?|inverters?|plcs?|controllers?|hmis?|panels?|motors?|servos?|encoders?|sensors?|prox(?:imity)?|photo-?eyes?|relays?|contactors?|breakers?|pumps?|compressors?|valves?|actuators?|hoists?|conveyors?|gearboxe?s?|transformers?|robots?|switch(?:es)?|modules?|converters?|gateways?)";
const GENERIC_CLASS_SUBJECT = new RegExp(`\\ban?\\s+(?:[\\w-]+\\s+)?${EQUIPMENT_NOUN}\\b`, "i");
// Pass 9: "THE drive trips after we replaced a contactor" — a definite
// equipment subject with a symptom is a problem on real equipment; the
// incidental "a contactor" must not turn it into a class question.
const DEFINITE_EQUIPMENT_SUBJECT = new RegExp(`\\bthe\\s+(?:[\\w-]+\\s+)?${EQUIPMENT_NOUN}\\b`, "i");

// Symptoms: a problem is happening on real equipment ("it stopped
// communicating", "the drive trips every morning") — enough on their own.
const SYMPTOM =
  /\b(?:trips?|tripp(?:ed|ing)|faults?|faulted|faulting|errors?|alarms?|stopped|stops|stuck|won'?t|will\s+not|doesn'?t|does\s+not|not\s+(?:working|communicating|responding|starting)|lost|loses|check\s+first|should\s+I\s+check)\b/i;
// Procedure words: "wire", "install", "configure"… — a generic "how do I wire
// a VFD?" is teaching, so these count only when bound to THIS machine
// (Codex #4069 pass 6 F3).
const PROCEDURE_VERBS =
  /\b(?:recover|reset|replace|replaced|swap(?:ped)?|install|configure|set\s+up|connect|wire|troubleshoot|pass\s?code|password|unlock|register|registers|firmware|bootloader)\b/i;
const TROUBLESHOOTING = new RegExp(`${SYMPTOM.source}|${PROCEDURE_VERBS.source}`, "i");

// "what does fault code X mean", "what does F005 mean on my drive".
const CODE_MEANING = /\bwhat\s+(?:does|do|is)\b[^?.!]{0,60}?\bmean(?:s|ing)?\b/i;
// …and asks what to DO about it.
const PROCEDURE_ASK = /\b(?:check|fix|reset|recover|clear|repair|replace|troubleshoot|resolve|get\s+rid)\b/i;

/**
 * #4068 (owner decision 2026-09-27) — is this a question about THIS equipment
 * (a problem to work, a procedure to follow), as opposed to a teaching question?
 *
 * Used for exactly one decision: when a notebook is bound to a model and the
 * OEM search (model scope, then same-family fallback) found nothing citable,
 * such a question gets an honest decline instead of an uncited general answer.
 * Teaching questions ("how does a VFD work", "what does PNP mean") never match
 * — they keep the general lane, exactly as before.
 */
export function asksAboutThisEquipment(question: string, boundModel?: string | null): boolean {
  const q = question.trim();
  if (!q) return false;
  const bound = BINDING.test(q) || namesModel(q, boundModel);
  // Codex #4069 F1: a question that is about THIS machine AND works a problem
  // ("how does my drive work when it trips on F005, what should I check?") is
  // troubleshooting, whatever teaching phrasing it opens with.
  // A pure "what does code X mean" stays with the answer floor's code-meaning
  // rule (E10, answer-validation.ts), exactly as #4004 leaves it — unless the
  // question also asks what to DO about it.
  if (CODE_MEANING.test(q) && !PROCEDURE_ASK.test(q)) return false;
  if (bound && (TROUBLESHOOTING.test(q) || PROCEDURE_ASK.test(q))) return true;
  const teaching =
    STRONG_DEFINITIONAL.test(q) ||
    HOW_IT_WORKS.test(q) ||
    (!bound &&
      (WEAK_DEFINITIONAL.test(q) ||
        GENERIC_CLASS_WHY.test(q) ||
        (GENERIC_CLASS_SUBJECT.test(q) && !(DEFINITE_EQUIPMENT_SUBJECT.test(q) && SYMPTOM.test(q)))));
  if (teaching) return false;
  // #4069 F4: a binding word alone ("what does this machine do?") is not a
  // problem to work — declining it would be the over-block. Require a
  // troubleshooting or what-to-do signal, or a documented-value ask.
  return (
    SYMPTOM.test(q) ||
    (bound && (PROCEDURE_VERBS.test(q) || PROCEDURE_ASK.test(q))) ||
    asksForDocumentedValue(q, boundModel)
  );
}
