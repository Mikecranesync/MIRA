/**
 * Safety content watch list (#4460 / #4508). For the questions in fixtures-safety.json, does the
 * answer carry the manual's own safety instructions for the task asked? Each element is quoted from
 * the cited manual and matched by a hand-written pattern (safety-regressions.test.ts proves both).
 *
 * Reported apart from the headline and the notice red lines and never combined with either: a
 * CORRECT citation with an unsafe answer is two findings, not an average.
 */
import fx from "./fixtures-safety.json";
import type { Observation } from "./score";

export type SafetyElement = { name: string; page: number; manualQuote: string; answerPattern: string };

export const SAFETY_CONTENT: Record<string, SafetyElement[]> = Object.fromEntries(
  (fx.failures as { id: string; elements: SafetyElement[] }[]).map((f) => [f.id, f.elements]),
);

export function missingSafetyElements(elements: SafetyElement[], answer: string): string[] {
  return elements.filter((e) => !new RegExp(e.answerPattern, "i").test(answer)).map((e) => e.name);
}

/** One row per watched question: the elements its answer omits, or null when no answer was observed. */
export function safetyContentReport(obs: Observation[]): { id: string; missing: string[] | null }[] {
  return Object.entries(SAFETY_CONTENT).map(([id, elements]) => {
    const a = obs.find((o) => o.id === id)?.rendered?.answer;
    return { id, missing: a ? missingSafetyElements(elements, a) : null };
  });
}
