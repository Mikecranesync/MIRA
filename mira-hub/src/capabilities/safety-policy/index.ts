/**
 * Safety policy module (#4372 typed-plan safety architecture). Phase 1: typed hazard-critical
 * numbers + the L3 evidence verifier + the number-safe renderer, in SHADOW. Nothing here is wired
 * into a route: `shadowNumbersVerdict` returns closed-vocabulary codes only, for telemetry and
 * offline replay, and never changes a served answer.
 */
import { extractNumbers, type ExtractOptions } from "./extract";
import { verifyNumbers } from "./verify";
import type { NumberVerdict, TurnVerdict } from "./types";

export * from "./types";
export * from "./schema";
export { extractNumbers, citedIds, markerToChunkId } from "./extract";
export { verifyNumbers, applicability, CONSERVATIVE } from "./verify";
export { renderDischargeProcedure, numberSafeFallback, chunkIdToMarker } from "./render";

/** Telemetry-safe shadow verdict: codes and counts, never question, answer or source text. */
export interface ShadowNumbersVerdict {
  verdict: TurnVerdict;
  enforcedCodes: NumberVerdict[];
  deferredCodes: NumberVerdict[];
  enforcedCount: number;
  deferredCount: number;
}

export function shadowNumbersVerdict(opts: ExtractOptions): ShadowNumbersVerdict {
  const ex = extractNumbers(opts);
  const r = verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks: opts.chunks, bound: opts.bound, question: opts.question });
  const codes = (enforced: boolean) => [...new Set(r.checks.filter((c) => c.enforced === enforced).map((c) => c.verdict))].sort();
  return {
    verdict: r.verdict,
    enforcedCodes: codes(true),
    deferredCodes: codes(false),
    enforcedCount: r.checks.filter((c) => c.enforced).length,
    deferredCount: r.checks.filter((c) => !c.enforced).length,
  };
}
