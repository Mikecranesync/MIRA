import { canonicalModelKey } from "@/capabilities/model-token";

/**
 * Industrial query normalization + multi-query expansion + deterministic rerank
 * for Equipment Notebook retrieval. Pure functions (unit-tested) — no I/O.
 *
 * Why this exists (measured, docs/RESUME_2026-08-12-notebook-retrieval-answer-fix.md):
 * the notebook retrieval loses technician questions to VOCABULARY MISMATCH, not
 * corpus size. "What parameter is the slow down ramp?" tokenizes to
 * `paramet & slow & ramp`; the answer chunk says "decel", so english BM25 never
 * matches it — while `plainto('deceleration')` matches 6 chunks. And exact IDs
 * (P042, F004, terminal 07) that DO match get out-ranked by same-page siblings
 * under ts_rank_cd. This module (a) expands a technician question into the
 * manufacturer's vocabulary, (b) extracts exact tokens that must be retrievable
 * verbatim, and (c) reranks so the exact-token / phrase-bearing chunk floats up.
 *
 * These are GENERAL industrial synonyms (deceleration, frequency families,
 * terminals, faults) — not question-specific answer rules.
 */

/** Domain synonym expansion: each trigger (matched as a whole phrase, case-
 *  insensitive) contributes manufacturer-vocabulary terms to the query set. */
const SYNONYMS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\bslow(?:\s|-)?down\b|\bramp\s*down\b|\bdecel\w*\b/i, ["deceleration", "decel time"]],
  [/\b(?:too )?long to stop\b|\bstop(?:ping)?\s*time\b|\btakes? (?:too )?long to stop\b|\bslow to stop\b/i, ["deceleration", "decel time"]],
  [/\bspeed(?:\s|-)?up\b|\bramp\s*up\b|\baccel\w*\b/i, ["acceleration", "accel time"]],
  [/\bramp\b/i, ["accel time", "decel time"]],
  [/\bsecond\s+speed\b|\b2nd\s+speed\b/i, ["speed reference 2", "preset frequency", "start source 2"]],
  [/\bmotor\s+freq\w*\b/i, ["motor np hertz", "nameplate", "maximum freq", "minimum freq", "output freq"]],
  [/\bmotor\s+speed\b/i, ["output freq", "commanded freq", "preset freq"]],
  [/\b(nameplate|name\s*plate)\b/i, ["motor np hertz", "motor np volts", "motor np amps"]],
  [/\bpreset\b/i, ["preset freq"]],
  [/\bterminal\b|\bwire\b|\binput\b/i, ["digin termblk", "terminal block"]],
  // Keypad/panel NAVIGATION questions ("find it on the keypad") share no tokens
  // with the manual's procedure section — bridge to the generic drive-manual
  // vocabulary. Trigger only on navigation phrasing: a bare "keypad" mention
  // ("the keypad works but not from the PLC") is a control-source question and
  // must NOT be flooded with navigation chunks.
  [/\b(?:on|from|via|with|using)\s+the\s+keypad\b|\bfront panel\b/i, ["viewing and editing parameters", "programming menu", "navigation keys"]],
  [/\bfault\b|\btrip\b|\balarm\b|\berror\s*code\b/i, ["fault"]],
  // Technician "ACK" names a pictogram key; OEM manuals say "acknowledge" /
  // "group acknowledgment" and never the token ACK (#4645 / Comfort p.74).
  [/\back\b/i, ["acknowledge", "group acknowledgment", "fault clear"]],
  // Fault-clear and acknowledge are the same operator-action class. Expand
  // only when the object is a fault/alarm so a parameter-reset is not flooded.
  [/\b(?:reset|clear)\b[^.?!]*\b(?:fault|trip|alarm)|\b(?:fault|trip|alarm)\b[^.?!]*\b(?:reset|clear)\b/i, ["acknowledge", "group acknowledgment", "fault clear"]],
  [/\breset\b|\bclear\b/i, ["fault clear"]],
  [/\btorque\b/i, ["torque"]],
  [/\bmax(?:imum)?\s+freq\w*\b/i, ["maximum freq"]],
  [/\bmin(?:imum)?\s+freq\w*\b/i, ["minimum freq"]],
];
