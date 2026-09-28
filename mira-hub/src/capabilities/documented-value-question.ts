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

import { faultCodeTokens } from "./answer-validation";

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
  /\b(?:what\s+an?\b|difference\s+between|means?\b|stands?\s+for\b|used\s+for\b|in\s+general\b|explain\s+(?:what|how)\b)/i;
const WEAK_DEFINITIONAL =
  /\bwhat(?:'s|\s+is|\s+are|\s+does)\s+(?!(?:the|this|its|it|my|your|that|these|those)\b)/i;
// #4068 pass 10: strong binding words name this machine outright; weak ones
// (pronouns) may refer back to a generic subject in the same question.
const STRONG_BINDING = /\b(?:this|my|your|our|these|those)\b|\b(?:on|for|of)\s+the\b/i;
const WEAK_BINDING = /\b(?:it|its|that)\b/i;
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

// Symptoms: a problem is happening on real equipment ("it stopped
// communicating", "the drive trips every morning") — enough on their own.
const SYMPTOM =
  /\b(?:trips?|tripp(?:ed|ing)|faults?|faulted|faulting|errors?|alarms?|stopped|stops|stopping|randomly|intermittent(?:ly)?|stuck|won'?t|will\s+not|doesn'?t|does\s+not|not\s+(?:working|communicating|responding|starting)|lost|loses|overheat(?:s|ed|ing)?|over-?temp(?:erature)?|smok(?:e|es|ing)|burn(?:s|ed|ing|t)?|check\s+first|should\s+I\s+check)\b/i;
// Procedure words: "wire", "install", "configure"… — a generic "how do I wire
// a VFD?" is teaching, so these count only when bound to THIS machine
// (Codex #4069 pass 6 F3).
const PROCEDURE_VERBS =
  /\b(?:recover|reset|replace|replaced|swap(?:ped)?|install|configure|set\s+up|connect|wire|troubleshoot|pass\s?code|password|unlock|register|registers|firmware|bootloader)\b/i;
const TROUBLESHOOTING = new RegExp(`${SYMPTOM.source}|${PROCEDURE_VERBS.source}`, "i");

// "what does fault code X mean", "what does F005 mean on my drive".
const CODE_MEANING = /\bwhat\s+(?:does|do|is)\b[^?.!]{0,60}?\bmean(?:s|ing)?\b/i;
// Anything after the "what does X mean" clause beyond a location ("on my
// drive") — another clause or question — makes it a mixed question.
const SECOND_CLAUSE = /[,;?]\s*\S|\b(?:and|also|but|why|how|when|where|should|can|could|is|are|was|keeps?)\b/i;
// Pass 14: "what is X" teaches only as a short, whole-question concept
// definition ("What is a VFD?", "what is DH-485") — never a diagnostic frame
// ("what is wrong with…", "what's going on with…", "what is the problem…").
const CONCEPT_DEFINITION =
  /^\s*what(?:'s|\s+is|\s+are)\s+(?:an?\s+)?(?!(?:wrong|going|happening|causing|making|up|the|this|its|it|my|your|that|these|those)\b)[\w/.+-]+(?:\s+[\w/.+-]+){0,3}\s*\??\s*$/i;
// "what does the/this/that/it …" — the thing meant is on a machine, not a term.
const MACHINE_STATE_MEANING = /\bwhat\s+(?:does|do)\s+(?:the|this|that|it|my|our)\b/i;
// Pass 16: the fault code must be what the "what does … mean" clause asks
// about, and a code-shaped MODEL name (TP700, GS10, PLX32) is not a fault code.
function codeInMeaningClause(q: string, boundModel?: string | null): boolean {
  const clause = q.match(CODE_MEANING)?.[0] ?? "";
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const model = norm(boundModel ?? "");
  return faultCodeTokens(clause).some((t) => !(model && model.includes(norm(t))));
}

// A question that marks itself as general knowledge, not this machine.
const GENERAL_MARKER = /\b(?:in\s+general|generally|difference\s+between|used\s+for|explain)\b/i;
// A condition on the machine's state ("when it overheats", "if the fan is
// blocked", "after the swap") — never part of a pure concept question.
const CONDITION_CLAUSE = /\b(?:when|whenever|while|if|after|once|since)\s+(?:it|the|my|this|our|its|we|i)\b/i;
// …and asks what to DO about it.
const PROCEDURE_ASK = /\b(?:check|fix|reset|recover|clear|repair|replace|troubleshoot|resolve|get\s+rid)\b/i;

// Acknowledgements are not questions — never decline "thanks".
const ACKNOWLEDGEMENT = /^(?:thanks?|thank\s+you|ty|ok(?:ay)?|got\s+it|cool|great|perfect|nice|understood)\b[\s,.!]*(?:got\s+it|thanks?)?[\s.!]*$/i;

/**
 * #4068 — should a machine-bound notebook with NOTHING citable decline this
 * question honestly instead of giving an uncited general answer?
 *
 * OWNER DECISION 2026-09-27 (Mike, after ten review passes each found new
 * phrasings misclassified in both directions): **lean to declining.** Decline
 * unless the question is on a short, high-confidence teaching list — how does
 * X work, what is X / what does X mean, the difference between, explain, used
 * for, in general — or is a pure fault-code-meaning question (E10, #4004).
 * Occasionally declining a general question is the accepted residual; an
 * uncited answer about this machine is not.
 */
export function asksAboutThisEquipment(question: string, boundModel?: string | null): boolean {
  const q = question.trim();
  if (!q || ACKNOWLEDGEMENT.test(q)) return false;
  // Pass 10 F1: "it"/"its"/"that" refer back to the nearest subject — in "why
  // does a VFD trip when it overheats" that is "a VFD", not the notebook's
  // machine. They bind only when no generic class subject is named.
  const genericSubject = GENERIC_CLASS_WHY.test(q) || GENERIC_CLASS_SUBJECT.test(q);
  const bound =
    STRONG_BINDING.test(q) ||
    namesModel(q, boundModel) ||
    (WEAK_BINDING.test(q) && !genericSubject);
  // A pure "what does code X mean" stays with the answer floor's code-meaning
  // rule (E10, answer-validation.ts), exactly as #4004 leaves it — unless it
  // also asks what to DO, or another clause describes a symptom (pass 10 F2;
  // the code-meaning clause itself is excluded, since "fault code" contains
  // the symptom word "fault").
  // Pass 11 F1: only a PURE meaning question qualifies — any second clause
  // ("…, and why is it overheating?", "…? how do I stop it") ends the exception.
  // Pass 15: only a question about an actual fault CODE qualifies — "what does
  // the flashing red light mean on my drive" is a machine-state question E10
  // does not cover, so it takes the bound-machine decline like any other.
  // A meaning question about a STATE of this machine ("what does the flashing
  // light mean on my drive", "what does it mean when the drive beeps") is a
  // problem to work; "what does PNP mean" (a term) still teaches.
  const askedCode = codeInMeaningClause(q, boundModel);
  if (CODE_MEANING.test(q) && !askedCode && (bound || MACHINE_STATE_MEANING.test(q))) {
    return true;
  }
  if (CODE_MEANING.test(q) && askedCode && !PROCEDURE_ASK.test(q)) {
    const rest = q.replace(CODE_MEANING, " ");
    // Mixed: the "mean" in the first clause must not read as the teaching
    // list's "what does X mean" — lean to declining (owner decision).
    return SYMPTOM.test(rest) || SECOND_CLAUSE.test(rest);
  }
  // Codex #4069 F1: teaching phrasing wrapped around a problem on THIS machine
  // ("how does my drive work when it trips on F005?") is troubleshooting.
  if (bound && (TROUBLESHOOTING.test(q) || PROCEDURE_ASK.test(q))) return true;
  // Pass 13: a described symptom ("what is causing the drive to trip every
  // morning?") is a problem to work, bound or not — unless the question marks
  // itself as general ("in general", "generally", "difference between", …).
  // Lean to declining (owner decision): the class, not one phrasing.
  if (SYMPTOM.test(q) && !GENERAL_MARKER.test(q)) return true;
  // Pass 12: "how does my drive work WHEN IT OVERHEATS" is a condition on this
  // machine, not a concept question. Bound + a condition clause is never teaching.
  const conditional = bound && CONDITION_CLAUSE.test(q);
  const teaching =
    !conditional &&
    (STRONG_DEFINITIONAL.test(q) ||
      GENERAL_MARKER.test(q) ||
      HOW_IT_WORKS.test(q) ||
      (!bound && CONCEPT_DEFINITION.test(q)));
  return !teaching;
}
