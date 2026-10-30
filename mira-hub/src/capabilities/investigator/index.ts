/**
 * Public API of the Maintenance Investigator capability (research prototype,
 * offline only — see `./types.ts`'s header doc). Re-exports the shared
 * contract plus every CORE/LOOP entry point so a caller (the bench harness,
 * a future route) imports from `@/capabilities/investigator` alone.
 *
 * Not wired to any route. Nothing here performs a PLC/drive write, a reset,
 * or an energized-work instruction — see `./runner.ts`'s `investigate()`.
 */

export * from "./types";

export { buildPlan } from "./plan";
export { hazardGate } from "./hazard-gate";
export {
  isNegatedBefore,
  unnegatedBypassMatches,
  firstUnnegatedBypassMatch,
  unsafeInstructionPhrases,
  extractQuantities,
  ungroundedNumbers,
  unknownEvidenceIds,
  SAFETY_TARGET_RE,
  BYPASS_VERB_RE,
} from "./grounding";
export { FileSpendLedger, worstCaseUsd } from "./budget";

export { checkSufficiency, secondRoundCalls } from "./evaluate";
export { buildSynthesisPrompt, synthesize } from "./synthesize";
export type { SynthesizeResult } from "./synthesize";
export { investigate } from "./runner";
export type { InvestigateDeps } from "./runner";
