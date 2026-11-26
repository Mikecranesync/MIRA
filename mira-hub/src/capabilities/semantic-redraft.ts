/**
 * #5941 (owner decision 2026-11-25, "redraft once"): when the semantic judge
 * calls a doc-grounded answer unsafe, the route regenerates it ONCE with a fixed
 * instruction to state isolation and restart conditions inline, then runs the
 * new draft through every deterministic check and the judge again. Only a clean,
 * judged-safe redraft is served; anything else ends in the SAFETY STOP card
 * exactly as before. The judge keeps the final say: this can only turn a stop
 * into an answer that the judge itself has passed, never weaken a block.
 *
 * The instruction is fixed text keyed on the closed hazard class, not the
 * judge's free-text reason: the judge reads the retrieved sources, so its reason
 * can carry document text into the generator (the #3790 poisoned-source shape).
 * The rejected draft is never sent back to the model.
 */

/** Closed outcome codes for the Turn Evidence Packet. Codes only, never text. */
export type RedraftOutcome =
  | "served"
  | "stopped_aborted"
  | "stopped_generation"
  | "stopped_check"
  | "stopped_judge_unsafe"
  | "stopped_judge_undecided";

const CLASS_CLAUSE: Record<string, string> = {
  pressure:
    "For pressure: state that the circuit is depressurised and confirmed at zero before any fitting, bolt or " +
    "component is loosened or adjusted, and that pressure is brought back only after the work is complete.",
  "machine-motion":
    "For machine motion: state that the machine is stopped and locked out before anyone reaches into it, and " +
    "that guards are refitted and the area is clear before it is reset or restarted.",
  electrical:
    "For electrical work: state that the equipment is locked out and confirmed de-energized with a tested meter " +
    "before conductors or terminals are touched, and that power is restored only by a qualified person afterwards.",
};

/** The fixed revision instruction appended to the system prompt for the one redraft. */
export function redraftInstruction(hazardClass: string): string {
  const clause = CLASS_CLAUSE[hazardClass] ?? "";
  return [
    "SAFETY REVISION: write the answer to the technician's question again, from the same manual excerpts.",
    "In every step that reaches into the machine, opens a circuit, releases stored energy, or clears, resets or " +
      "restarts anything, state inline in that step the isolation it is done under and the condition that must " +
      "hold before restart.",
    "A step that needs power or pressure (a reset, a test run, a pressure hold) is its own later step, done " +
      "after the lockout is removed and the area is clear; never put a powered check inside a locked-out step.",
    clause,
    "Add no step, value or claim the excerpts do not support, and keep the [n] citation markers.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The provider messages with the instruction appended to the leading system message. */
export function withRedraftInstruction<M extends { role: string; content: string }>(
  messages: readonly M[],
  hazardClass: string,
): M[] {
  const instruction = redraftInstruction(hazardClass);
  const out = messages.map((m) => ({ ...m }));
  const sys = out.findIndex((m) => m.role === "system");
  if (sys >= 0) out[sys] = { ...out[sys], content: `${out[sys].content}\n\n${instruction}` };
  else out.unshift({ role: "system", content: instruction } as M);
  return out;
}

/**
 * One redraft attempt. Every dependency is the route's own: `generate` is the
 * non-streaming cascade over this turn's providers, `screen` the same
 * deterministic floors draft 1 passed (it returns the text to serve, or null to
 * stop), `judge` the same semantic judge, run on exactly the text that would be
 * served. Any failure, including a thrown error, ends in a stop.
 */
export async function runSemanticRedraft(deps: {
  aborted: () => boolean;
  generate: () => Promise<string | null>;
  screen: (text: string) => string | null;
  judge: (text: string) => Promise<"safe" | "unsafe" | "unknown">;
}): Promise<{ outcome: RedraftOutcome; text: string | null }> {
  const stop = (outcome: RedraftOutcome) => ({ outcome, text: null });
  if (deps.aborted()) return stop("stopped_aborted");
  let text: string | null;
  try {
    text = await deps.generate();
  } catch {
    return stop("stopped_generation");
  }
  if (!text || !text.trim()) return stop("stopped_generation");
  let served: string | null;
  try {
    served = deps.screen(text);
  } catch {
    served = null;
  }
  if (!served) return stop("stopped_check");
  if (deps.aborted()) return stop("stopped_aborted");
  let verdict: "safe" | "unsafe" | "unknown";
  try {
    verdict = await deps.judge(served);
  } catch {
    verdict = "unknown";
  }
  if (verdict === "unsafe") return stop("stopped_judge_unsafe");
  if (verdict !== "safe") return stop("stopped_judge_undecided");
  return { outcome: "served", text: served };
}
