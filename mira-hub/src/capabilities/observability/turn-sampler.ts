/**
 * Which traces reach Langfuse (2026-09-29, #4103).
 *
 * The flight recorder exists to explain technician turns. On staging, the
 * automatic HTTP / fetch / pg instrumentation turned every health check, page
 * load and pool connect into its own trace: of the newest 1,000 traces, zero
 * were chat turns (889 `GET`, 90 `pg-pool.connect`), and the plan's usage
 * threshold suspended ingestion for 3.5 days.
 *
 * Default: export only traces ROOTED at a `mira.turn` span (chat and look turns
 * both open one), sampled by `MIRA_OTEL_TURN_SAMPLE_RATIO` (0..1, default 1).
 * Children follow their parent, so a kept turn keeps its whole waterfall.
 * The durable per-turn record is the Turn Evidence Packet on `decision_traces`
 * (Neon), which is written for 100% of turns regardless of this sampler.
 *
 * `MIRA_OTEL_AUTO_INSTRUMENT=1` restores the automatic HTTP/fetch/pg spans (and
 * with them every non-turn trace) for a debugging session.
 */
import { TraceFlags } from "@opentelemetry/api";
import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  ParentBasedSampler,
  SamplingDecision,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import type { Sampler, SamplingResult } from "@opentelemetry/sdk-trace-base";

export const TURN_ROOT_SPAN = "mira.turn";
/** A detached manual-acquisition run (#4160 R15): its own trace, linked to the
 *  turn that started it. Kept exactly when that turn was kept. */
export const ACQUISITION_ROOT_SPAN = "manual_acquisition.run";

export function autoInstrumentEnabled(): boolean {
  return process.env.MIRA_OTEL_AUTO_INSTRUMENT === "1";
}

/** The configured turn sampling ratio, clamped to [0, 1]; bad values mean 1. */
export function turnSampleRatio(): number {
  const raw = process.env.MIRA_OTEL_TURN_SAMPLE_RATIO;
  if (raw === undefined || raw.trim() === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/** Root spans: keep `mira.turn` (at the configured ratio), and a detached
 *  acquisition root whose creation-time link points at a SAMPLED span (its turn —
 *  so it inherits that turn's ratio decision); drop anything else. */
class TurnRootSampler implements Sampler {
  private readonly ratio: Sampler;

  constructor(ratio: number) {
    this.ratio = new TraceIdRatioBasedSampler(ratio);
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    if (spanName === ACQUISITION_ROOT_SPAN) {
      const linkedToKeptTurn = links.some(
        (l) => (l.context.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
      );
      return { decision: linkedToKeptTurn ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD };
    }
    if (spanName !== TURN_ROOT_SPAN) return { decision: SamplingDecision.NOT_RECORD };
    return this.ratio.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString(): string {
    return `TurnRootSampler{${TURN_ROOT_SPAN},${this.ratio.toString()}}`;
  }
}

/**
 * The SDK sampler: turn-rooted traces only, local children follow their parent.
 * A span continuing a REMOTE parent (an incoming `traceparent`, which Next.js
 * extracts itself) is never exported: the SDK default would export it whenever
 * the caller's flag said "sampled", bypassing the turn filter. Turns are
 * unaffected because the routes start `mira.turn` with `{ root: true }`.
 */
export function turnOnlySampler(ratio = turnSampleRatio()): Sampler {
  return new ParentBasedSampler({
    root: new TurnRootSampler(ratio),
    remoteParentSampled: new AlwaysOffSampler(),
    remoteParentNotSampled: new AlwaysOffSampler(),
  });
}
