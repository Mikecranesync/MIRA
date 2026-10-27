/**
 * #4858 — isolation-safety framing for a grounded answer that directs
 * hands-on electrical or mechanical work.
 *
 * Staging D4 F005 (PF525 OverVoltage) at v3.419.28 / 92e892a48: the answer
 * said "extend the decel time or install the dynamic brake option [1]" with
 * no disconnect, lockout, or verify-dead line. Installing a brake resistor
 * is DC-bus work.
 *
 * This is an ADVISORY, not a safety trigger — same shape as restart-advisory:
 *   - It never stops a turn. The technician keeps the answer.
 *   - It never changes grounding. The route keeps it off `safetyTrigger`.
 *   - Its banner is fixed server text and cites no manual page: it is site
 *     safety practice (Mike, 2026-10-27: disconnect per the manual; lock out
 *     per site procedure), not a claim about the document.
 *
 * Detection reuses the settled pieces; it does not invent a new stack:
 *   - HANDS_ON_VERB_RE / WORK_OBJECT_RE from safety-classifier.ts
 *   - ISOLATED from step-energy.ts (already-isolated answers stay silent)
 *   - the banner is prepended by validateAnswer the same way ENERGIZED_WARNING
 *     / hazard_warning already are (route.ts ~4324–4337).
 *
 * Zero-token, deterministic, Hub-only.
 */

import { HANDS_ON_VERB_RE, WORK_OBJECT_RE, LETHAL_VOLTAGE_CONTEXT } from "@/lib/safety-classifier";
import { ISOLATED } from "./step-energy";

/** Fixed banner shown above a hands-on answer. No page citation (see header). */
export const ISOLATION_BANNER =
  "⚠️ **Before hands-on work.** Disconnect power per the manual. Lock out per site procedure. Verify absence of voltage.";

/**
 * Discharge-wait line for VFD / DC-bus work. Never a number of minutes —
 * cite OEM text that is already in the answer, or say this.
 */
export const DISCHARGE_WAIT_LINE = "Follow the manual's discharge wait.";

/** Verify-dead half of step-energy's DEAD_CHECK — the phrases that mean the
 *  answer already told the tech to prove the circuit is dead. The rest of
 *  DEAD_CHECK blanks tester/resistance/insulation so they do not count as
 *  needing power; those are not "already isolated". */
const VERIFY_DEAD =
  /\b(?:absence of voltage|zero (?:volts|voltage|energy)|no voltage|confirmed dead|verif\w* (?:it is |they are )?dead)\b/i;

/** Dual-use verbs: parameter edits ("change P039", "adjust decel time") use
 *  the same words as hands-on work. They count only with a WORK_OBJECT. */
const DUAL_USE_VERB_RE =
  /\b(?:chang(?:e|ing)|adjust(?:ing)?|check(?:ing)?|measur(?:e|ing)|prob(?:e|ing)|test(?:ing)?)\b/i;

const PROHIBITION_SENTENCE =
  /^\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:do not|don't|never|do\s+not)\b/i;

const VERB_SRC = HANDS_ON_VERB_RE.source.replace(/^\\b/, "").replace(/\\b$/, "");

/** A hands-on verb in instruction position: clause-initial (sentence, list
 *  item) or coordinated / modal ("or install", "you should replace"). Bare
 *  "to <verb>" is excluded — "not safe to open the cabinet" is a prohibition,
 *  not a work direction (pinned by answer-validation.test.ts). */
const INSTRUCTION_RE = new RegExp(
  "(?:" +
    "(?:^|[.!?:;]\\s+|[—–]\\s*|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+|so\\s+)?" +
    "|" +
    "\\b(?:or|and(?:\\s+then)?|you\\s+(?:can|should|must|may|need\\s+to))\\s+" +
    ")" +
    VERB_SRC,
  "gi",
);

const ALREADY_DISCHARGE =
  /\b(?:discharge wait|wait(?:ing)? for (?:the )?(?:dc\s*)?bus|bus (?:to )?discharg)\b/i;

/** Opening a display / HMI / log is navigation, not enclosure work — the
 *  same object set A1 already excludes from `leave-on-then-act`
 *  (`open(?!…hmi|screen|alarm|…)` in answer-validation.ts). */
const DISPLAY_SURFACE_RE =
  /\b(?:hmi|screen|alarm|menu|page|display|tab|app|log|history|trend|faceplate)\b/i;

/** LETHAL_VOLTAGE_CONTEXT entries that name stored electrical energy. */
const STORED_ENERGY = LETHAL_VOLTAGE_CONTEXT.filter(
  (p) => p === "bus" || p === "dc bus" || p === "panel interior",
);

function alreadyIsolated(text: string): boolean {
  return ISOLATED.test(text) || VERIFY_DEAD.test(text);
}

function isStoredEnergyWork(text: string): boolean {
  const msg = text.toLowerCase();
  return STORED_ENERGY.some((p) => {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(msg);
  });
}

function withoutProhibitions(text: string): string {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .filter((s) => !PROHIBITION_SENTENCE.test(s))
    .join(" ");
}

/** True when the answer directs hands-on work (not a parameter edit). */
export function directsHandsOnWork(answer: string): boolean {
  const kept = withoutProhibitions(answer || "");
  if (!kept.trim()) return false;
  INSTRUCTION_RE.lastIndex = 0;
  for (const m of kept.matchAll(INSTRUCTION_RE)) {
    const verbMatch = HANDS_ON_VERB_RE.exec(m[0]);
    HANDS_ON_VERB_RE.lastIndex = 0;
    const verb = verbMatch?.[0] ?? "";
    const after = kept.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80);
    const clause = `${verb} ${after}`;
    // "open the HMI alarm history" is a screen, not a cover.
    if (/^open/i.test(verb) && DISPLAY_SURFACE_RE.test(after) && !WORK_OBJECT_RE.test(after)) {
      continue;
    }
    if (WORK_OBJECT_RE.test(clause) || (verb && !DUAL_USE_VERB_RE.test(verb))) {
      return true;
    }
  }
  return false;
}

/** Banner to prepend, or null when the answer already isolates or is not hands-on. */
export function isolationBannerFor(answer: string): string | null {
  const text = (answer || "").trim();
  if (!text) return null;
  if (alreadyIsolated(text)) return null;
  if (!directsHandsOnWork(text)) return null;
  if (!isStoredEnergyWork(text)) return ISOLATION_BANNER;
  if (ALREADY_DISCHARGE.test(text)) return ISOLATION_BANNER;
  return `${ISOLATION_BANNER} ${DISCHARGE_WAIT_LINE}`;
}
