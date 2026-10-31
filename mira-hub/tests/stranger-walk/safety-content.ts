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
import { repairMisdecodedStream } from "./stream-decode";

export type SafetyElement = { name: string; page: number; manualQuote: string; answerPattern: string };

export const SAFETY_CONTENT: Record<string, SafetyElement[]> = Object.fromEntries(
  (fx.failures as { id: string; elements: SafetyElement[] }[]).map((f) => [f.id, f.elements]),
);

export function missingSafetyElements(elements: SafetyElement[], answer: string): string[] {
  return elements.filter((e) => !new RegExp(e.answerPattern, "i").test(answer)).map((e) => e.name);
}

/**
 * The answer without a leading ⚠ notice. The notice is a separate requirement and never stands in
 * for the procedure (safety-regressions.test.ts §4). The banner ends at the stream's first blank
 * line, which the rendered text collapses, so it is split on the stream. Null when the answer opens
 * with a banner and no stream was recorded: the body cannot be told apart, so nothing is credited.
 */
export function answerBody(o: Observation): string | null {
  const a = o.rendered?.answer ?? "";
  if (!/^\s*⚠/.test(a)) return a;
  if (!o.sse) return null;
  let sse = o.sse;
  try { sse = repairMisdecodedStream(sse); } catch { /* already decoded as UTF-8 */ }
  const text = sse.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)))
    .filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
  const cut = /^\s*⚠/.test(text) ? text.indexOf("\n\n") : -1;
  return cut < 0 ? null : text.slice(cut + 2);
}

/** One row per watched question: the elements its answer body omits, or null when no answer was observed. */
export function safetyContentReport(obs: Observation[]): { id: string; missing: string[] | null }[] {
  return Object.entries(SAFETY_CONTENT).map(([id, elements]) => {
    const o = obs.find((x) => x.id === id);
    if (!o?.rendered?.answer) return { id, missing: null };
    const body = answerBody(o);
    return { id, missing: body === null ? elements.map((e) => e.name) : missingSafetyElements(elements, body) };
  });
}
