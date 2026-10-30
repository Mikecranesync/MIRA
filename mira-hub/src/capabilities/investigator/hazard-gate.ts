/**
 * Hazard gate — the Maintenance Investigator's FIRST call (contract:
 * ../investigator/types.ts `HazardVerdict`). Runs before the plan, before
 * any tool call, before any model call. Zero model calls; pure regex.
 *
 * Reuses the Hub's own deterministic safety classifiers verbatim:
 *   - `isEnergizedWorkAsk` / `energizedHardStopEnabled` / `energizedWorkStop`
 *     (TQ-29 hard stop) — @/lib/safety-classifier, @/capabilities/energized-work-stop
 *   - `notebookSafetyTrigger` / `matchSafetyStop` (indirectly, via
 *     `notebookSafetyTrigger`) / `SAFETY_STOP` — @/lib/safety-classifier
 *
 * Divergence from the production notebook `chat/route.ts`, disclosed:
 *
 *   1. safety.md §3a documents a production gap: an earlier identity-422
 *      (`boundAsset.state === "unresolvable" && !safetyTrigger`) can pre-empt
 *      the TQ-29 energized-work stop, because that one check in the route
 *      forgot the `!energizedAskEarly` exemption its siblings carry. This
 *      gate has no such gap BY CONSTRUCTION: `hazardGate(message)` takes no
 *      identity input at all and is the investigator's first call — nothing
 *      upstream of it can run, so there is nothing to pre-empt it.
 *   2. The route answers the NFPA 70E conjunction sentinel
 *      (`ENERGIZED_ELECTRICAL_HAZARD`, high-voltage context + a
 *      measure/probe/meter intent — NOT necessarily hands-on work; "The DC
 *      bus reads 620V on my multimeter — is that within spec?" trips it)
 *      under a non-terminal directive banner, never a stop. This gate does
 *      the same: it is a FLAG here (via step 4's `notebookSafetyTrigger`,
 *      which re-derives this sentinel internally), not a terminal stop. A
 *      genuine hands-on energized-work ask is caught separately, and
 *      correctly stopped, by step 1's `isEnergizedWorkAsk`.
 *
 * Two additional terminal categories the shared classifiers do not cover on
 * their own (a plain "how do I reset F004" must stay a normal fault-code
 * question, not a stop):
 *   - An explicit ask to bypass/jumper/defeat/force/override/disable a
 *     safety input or interlock (verb-near-a-safety-target; see
 *     grounding.ts, which both modules share so "a safety-defeat ask" is
 *     defined once).
 *   - An explicit ask to reset repeatedly to clear a RECURRING fault — not a
 *     one-off "how do I reset F004", and not a technician's own past-tense
 *     report of having done so while asking for diagnosis help.
 *
 * Both of the above scan EVERY candidate match in the message, not just the
 * first, and clamp each match's negation window to the end of the previous
 * one (`isNegatedBefore`'s `minIndex`) — otherwise a negated decoy earlier
 * in the message ("Don't bypass the e-stop. Instead, jumper out the safety
 * relay.") would suppress a later, real request it has nothing to do with.
 */

import { notebookSafetyTrigger, isEnergizedWorkAsk, SAFETY_STOP } from "@/lib/safety-classifier";
import { energizedHardStopEnabled, energizedWorkStop, ENERGIZED_WORK_TRIGGER } from "@/capabilities/energized-work-stop";
import type { HazardVerdict } from "./types";
import { firstUnnegatedBypassMatch, isNegatedBefore } from "./grounding";

// The repeat/recurrence cue must be BOUND to the reset verb — "reset F004
// AND KEEP the conveyor running" has "keep" nowhere near "reset" in
// meaning, even though both words sit in the same message. Each
// alternative below ties a repetition/recurrence word to a `reset*`
// occurrence within at most two intervening tokens ("reset F004 every
// time"), in one direction or the other — a cue anywhere else in the
// message does not count.
const BOUND_REPEAT_RE = new RegExp(
  "\\bkeep(?:s|ing)?\\s+(?:on\\s+)?reset\\w*" +
    "|\\breset\\w*\\s+(?:\\S+\\s+){0,2}?(?:it\\s+)?(?:again(?:\\s+and\\s+again)?|repeatedly|over\\s+and\\s+over|constantly|every\\s+(?:time|shift)|each\\s+time|multiple\\s+times|several\\s+times|\\d+\\s*times)\\b",
  "i",
);
const BOUND_RECURRING_RE = new RegExp(
  "\\breset\\w*[^.?!;]{0,15}?\\b(?:recurring|keeps?\\s+(?:coming\\s+back|tripping|happening)|comes?\\s+back)\\b" +
    "|\\b(?:recurring|keeps?\\s+(?:coming\\s+back|tripping|happening)|comes?\\s+back)\\b[^.?!;]{0,15}?\\breset\\w*",
  "i",
);
const RESET_VERB_RE = /\breset\w*/gi;
// Either an explicit fault/alarm/trip/error/warning/code word (wildcarded —
// "trips"/"tripping" must count, not just bare "trip"), OR a code-shaped
// token (F004), OR the bare phrase "to clear it" — "just keep resetting IT
// to clear it" names no fault word at all.
const CLEAR_SIGNAL_RE = /\bto\s+clear\b|\b(?:fault|alarm|trip|error|warning|code)\w*\b|\b[A-Za-z]{1,3}\d{2,4}\b/i;
// A technician REPORTING past/habitual resets ("Operators just reset it
// every shift", "I just reset it every time") is describing a RECURRING-
// TRIP SYMPTOM, not requesting to keep doing it. A bound repeat cue is not
// enough on its own — this category stops ONLY when one of these explicit
// request shapes is ALSO present:
//   - a sentence-initial imperative ("Just keep resetting it to clear it.")
//   - a permission ask before the verb, same clause ("Should I ... reset?",
//     "Can we ... reset?", "Do operators ... reset?")
//   - the "is it OK/safe to ... reset" form
// Bare "just" anywhere in the message is deliberately NOT a marker on its
// own — "I just reset it every time" is a report, not a request, and
// "just" there modifies "reset", not the technician's ask.
const REQUEST_MARKER_RE = new RegExp(
  "(?:^|[.!?;]\\s+)(?:just\\s+)?(?:keep\\s+(?:on\\s+)?)?reset\\w*" +
    "|\\b(?:should|can|could|may|do|shall)\\s+(?:i|we|they|operators?)\\b[^.?!;]{0,40}?\\breset\\w*" +
    "|\\bis\\s+it\\s+(?:ok(?:ay)?|safe|fine|alright)\\s+to\\b[^.?!;]{0,40}?\\breset\\w*",
  "i",
);
// A technician REPORTING past repeated resets while asking for diagnosis
// help ("...what should I check?") is not a request to keep doing it.
const DIAGNOSIS_QUESTION_RE =
  /\bwhat\s+(?:should|do|can|would)\s+i\s+(?:check|do|look|try|inspect)\b|\bwhat('?s|\s+is)\s+(?:wrong|causing|the\s+cause)\b|\bwhy\s+(?:does|is|do|would)\b/i;

/** The first UNNEGATED reset-verb occurrence that sits in a message carrying
 *  a clear-signal, a BOUND repetition/recurrence cue, an explicit request
 *  marker, and no diagnosis question — or null. Scans every `reset*`
 *  occurrence, not just the first, so an earlier negated "don't reset it
 *  yourself" cannot suppress a later, real "just keep resetting it to clear
 *  it" in the same message. */
function repeatedResetToClearIsRequest(msg: string): { index: number } | null {
  if (!CLEAR_SIGNAL_RE.test(msg)) return null;
  if (!(BOUND_REPEAT_RE.test(msg) || BOUND_RECURRING_RE.test(msg))) return null;
  if (DIAGNOSIS_QUESTION_RE.test(msg)) return null;
  if (!REQUEST_MARKER_RE.test(msg)) return null;
  let minIndex = 0;
  for (const m of msg.matchAll(RESET_VERB_RE)) {
    const idx = m.index ?? 0;
    if (!isNegatedBefore(msg, idx, 4, minIndex)) return { index: idx };
    minIndex = idx + m[0].length;
  }
  return null;
}

export function hazardGate(message: string): HazardVerdict {
  const msg = (message ?? "").toString();

  // 1. Energized-work ask — the TQ-29 hard stop. No identity gap possible:
  //    this gate takes no identity input and runs before everything.
  if (energizedHardStopEnabled() && isEnergizedWorkAsk(msg)) {
    return { kind: "stop", trigger: ENERGIZED_WORK_TRIGGER, text: energizedWorkStop(null) };
  }

  // 2. Explicit ask to bypass/jumper/defeat/force/override/disable a safety
  //    input/interlock — active or passive voice.
  const bypass = firstUnnegatedBypassMatch(msg);
  if (bypass) {
    return { kind: "stop", trigger: "safety-defeat-request", text: SAFETY_STOP };
  }

  // 3. Repeated reset-to-clear on a recurring fault (a REQUEST to keep doing
  //    it, not a report asking for diagnosis help).
  const repeated = repeatedResetToClearIsRequest(msg);
  if (repeated) {
    return { kind: "stop", trigger: "repeated-reset-to-clear", text: SAFETY_STOP };
  }

  // 4. A Tier-1/Tier-2 phrase-level hazard trigger, TQ-30's lockout-verb
  //    forms, or the NFPA 70E high-voltage+meter conjunction sentinel — FLAG
  //    only; the investigation continues under a banner (see header note 2).
  const trigger = notebookSafetyTrigger(msg);
  if (trigger) {
    return { kind: "flag", trigger };
  }

  return { kind: "clear" };
}
