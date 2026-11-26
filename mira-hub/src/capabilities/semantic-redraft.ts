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
  | "stopped_turn_cap"
  | "stopped_generation"
  | "stopped_incomplete"
  | "stopped_check"
  | "stopped_unsupported"
  | "stopped_judge_unsafe"
  | "stopped_judge_undecided";

const CLASS_CLAUSE: Record<string, string> = {
  pressure:
    "For pressure: tell the technician to relieve the pressure and verify it reads zero before any fitting, bolt " +
    "or component is loosened or adjusted, and to bring pressure back only once the work is complete.",
  "machine-motion":
    "For machine motion: tell the technician to stop and lock out the machine before reaching into it, and to " +
    "refit the guards and clear the area before it is reset or restarted.",
  electrical:
    "For electrical work: tell the technician to lock out and verify absence of voltage with a meter proven on a " +
    "known source before touching conductors or terminals, without writing a voltage number, and to leave " +
    "re-energizing to a qualified person afterwards.",
};

/** The hazard classes a redraft is attempted for: the ones with a clause above. */
export const REDRAFT_CLASSES: readonly string[] = Object.keys(CLASS_CLAUSE);

/** The fixed revision instruction appended to the system prompt for the one redraft. */
export function redraftInstruction(hazardClass: string): string {
  const clause = CLASS_CLAUSE[hazardClass] ?? "";
  return [
    "SAFETY REVISION: write the answer to the technician's question again, from the same manual excerpts.",
    "In every step that reaches into the machine, opens a circuit, releases stored energy, or clears, resets or " +
      "restarts anything, say in that step what to isolate and verify before starting it and what must hold " +
      "before restart. Write these as instructions to the technician, never as a state already reached.",
    "Where the excerpts give an isolation or restart procedure, use it; where they give none, say to isolate " +
      "under the site's lockout procedure and do not invent one.",
    "A step that needs power or pressure (a reset, a test run, a pressure hold) is its own later step, done " +
      "after the lockout is removed and the area is clear; never put a powered check inside a locked-out step.",
    "If a step would defeat, bypass, jumper or mute a guard, interlock, trip or safety device, leave that step " +
      "out and say the safeguard stays in service.",
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
 * stop), `supported` the source-support check on the redraft's cited steps (#6020;
 * kept apart from the judge, which checks physical safety, not support), `judge`
 * the same semantic judge, run on exactly the text that would be served. Any
 * failure, including a thrown error, ends in a stop.
 */
export async function runSemanticRedraft(deps: {
  aborted: () => boolean;
  /** `complete` is false when the provider cut the completion (finish_reason other than "stop"). */
  generate: () => Promise<{ text: string; complete: boolean } | null>;
  screen: (text: string) => string | null;
  /** True only when every cited step is supported by the page it cites (#6020). */
  supported: (text: string) => boolean;
  judge: (text: string) => Promise<"safe" | "unsafe" | "unknown">;
}): Promise<{ outcome: RedraftOutcome; text: string | null }> {
  const stop = (outcome: RedraftOutcome) => ({ outcome, text: null });
  if (deps.aborted()) return stop("stopped_aborted");
  let gen: { text: string; complete: boolean } | null;
  try {
    gen = await deps.generate();
  } catch {
    return stop("stopped_generation");
  }
  if (!gen || !gen.text.trim()) return stop("stopped_generation");
  // A procedure cut at the output cap may have lost its restart condition or a caution.
  if (!gen.complete) return stop("stopped_incomplete");
  const text = gen.text;
  let served: string | null;
  try {
    served = deps.screen(text);
  } catch {
    served = null;
  }
  if (!served) return stop("stopped_check");
  let supported: boolean;
  try {
    supported = deps.supported(text);
  } catch {
    supported = false;
  }
  if (!supported) return stop("stopped_unsupported");
  if (deps.aborted()) return stop("stopped_aborted");
  let verdict: "safe" | "unsafe" | "unknown";
  try {
    verdict = await deps.judge(served);
  } catch {
    verdict = "unknown";
  }
  if (verdict === "unsafe") return stop("stopped_judge_unsafe");
  if (verdict !== "safe") return stop("stopped_judge_undecided");
  // A Stop that arrived while the judge ran: the redraft was never released, so it is not adopted.
  if (deps.aborted()) return stop("stopped_aborted");
  return { outcome: "served", text: served };
}

/** The smallest output allowance a redraft is attempted with; below it the stop stands. */
export const REDRAFT_MIN_OUTPUT_TOKENS = 256;

/** A provider-reported token count (a non-negative safe integer), or null for anything else (#6021). */
export function tokenCount(n: unknown): number | null {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * The redraft's output allowance: what is left of the per-turn ceiling after
 * the output already spent, capped at draft 1's own request cap. An unknown or
 * malformed count (negative, non-finite, not a number) is booked as the whole
 * request cap (unknown is not small, #6021). Null when too little remains to
 * attempt one. The route calls it again before each redraft provider with the
 * output spent so far, so a billed attempt shrinks what the next one may use.
 */
export function redraftOutputAllowance(turnCeiling: number, requestCap: number, firstOutputTokens: number | null): number | null {
  const remaining = turnCeiling - (tokenCount(firstOutputTokens) ?? requestCap);
  const allowance = Math.min(requestCap, remaining);
  return allowance >= REDRAFT_MIN_OUTPUT_TOKENS ? allowance : null;
}

type Usage = {
  provider: string | null;
  model: string | null;
  routeReason: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsdEstimate: number | null;
  status: "ok" | "empty" | "error" | "capped";
  attempted: string[];
};

/**
 * Draft 1's usage with the redraft's added: both generations were billed whether
 * or not the redraft was served. The served generation names the provider,
 * model, route reason and attempted list. An unknown count on either side makes
 * the total unknown; a missing cache count is zero cached.
 */
export function withRedraftUsage<U extends Usage>(first: U, redraft: Usage, servedByRedraft: boolean): U {
  const sum = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
  // A token sum beyond the safe-integer range is unknown, never an imprecise number (R3-C3).
  const tokens = (n: number | null) => (n === null || Number.isSafeInteger(n) ? n : null);
  const who = servedByRedraft ? redraft : first;
  return {
    ...first,
    provider: who.provider,
    model: who.model,
    routeReason: who.routeReason,
    status: who.status,
    attempted: who.attempted,
    inputTokens: tokens(sum(first.inputTokens, redraft.inputTokens)),
    cachedInputTokens:
      first.cachedInputTokens === null && redraft.cachedInputTokens === null
        ? null
        : tokens((first.cachedInputTokens ?? 0) + (redraft.cachedInputTokens ?? 0)),
    outputTokens: tokens(sum(first.outputTokens, redraft.outputTokens)),
    costUsdEstimate: sum(first.costUsdEstimate, redraft.costUsdEstimate),
  };
}
