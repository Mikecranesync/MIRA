/**
 * TurnRecorder — the per-request accumulator that feeds a Turn Evidence
 * Packet as a chat/look turn's stages complete.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §4. Route code (lane I2) calls `startTurnRecorder` once per request, feeds
 * it via `stage`/`timing`/`error`/`generationAttempt` as each stage runs, and
 * calls `finish()` once at the end to get the packet + deterministic
 * anomalies to persist (`persist-usage.ts`).
 *
 * FAIL-SAFE BY CONSTRUCTION: every method here is try/caught internally and
 * never throws. A turn that is already being persisted/streamed to a
 * technician must never fail BECAUSE the diagnostics layer had a bug — losing
 * one packet field is acceptable; crashing the turn is not.
 */
import {
  emptyPacket,
  TURN_EVIDENCE_PACKET_VERSION,
  type GenerationAttempt,
  type PacketInit,
  type TurnEvidencePacket,
  type TurnKind,
} from "./turn-evidence-packet";
import { detectAnomalies, type Anomaly } from "./anomalies";
// STUB today (see tracing.ts header) — replaced by lane I1's real tracer at
// integration. Same import shape either way, so this file needs no change.
import { activeTraceId, setSpanAttrs, type SpanAttrs } from "./tracing";

/** Packet sections a route may push partial stage data into via `.stage()`.
 * Excludes top-level scalars (v/kind/trace_id/...), `timings_ms` (has its own
 * `.timing()` method) and `errors` (has its own `.error()` method). */
export type StageKey =
  | "ids"
  | "request"
  | "vision"
  | "visual_evidence"
  | "identity"
  | "retrieval"
  | "context"
  | "generation"
  | "answer_gate"
  | "persistence";

export type TurnRecorderInit = {
  kind: TurnKind;
  tenantId: string;
  notebookId: string;
  threadId?: string | null;
  clientRequestId?: string | null;
  ownerUserId?: string | null;
  mode?: "general" | "grounded";
  environment?: string;
  gitSha?: string;
  serviceVersion?: string;
  traceId?: string | null;
};

export interface TurnRecorder {
  readonly traceId: string | null;
  readonly packet: TurnEvidencePacket;
  readonly startedAt: number;
  stage<K extends StageKey>(stage: K, data: Partial<TurnEvidencePacket[K]>): void;
  timing(stage: keyof TurnEvidencePacket["timings_ms"], ms: number): void;
  error(stage: string, code: string): void;
  generationAttempt(a: GenerationAttempt): void;
  finish(opts?: { productionRouteVars?: string[]; anomalyChecks?: boolean }): {
    packet: TurnEvidencePacket;
    anomalies: Anomaly[];
  };
}

/**
 * Flattens a stage's partial update into `mira.<stage>.<field>` span
 * attributes, scalars/arrays only (nested objects — e.g.
 * `generation.attempts` — are not low-cardinality and are skipped; they stay
 * on the packet, never mirrored onto a span). For the "retrieval" stage this
 * produces exactly `mira.retrieval.strategy`, `.executed`,
 * `.candidate_count`, `.returned_doc_ids`, `.oem_corpus_searched`,
 * `.zero_result_reason`, `.prior_visual_observations_considered` — the
 * design §3 worked example — and the same rule applies uniformly to every
 * other stage.
 */
function toSpanAttrs(stage: string, data: Record<string, unknown>): SpanAttrs {
  const attrs: SpanAttrs = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      attrs[`mira.${stage}.${key}`] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) {
      attrs[`mira.${stage}.${key}`] = value as string[] | number[];
    }
  }
  return attrs;
}

class TurnRecorderImpl implements TurnRecorder {
  readonly traceId: string | null;
  readonly packet: TurnEvidencePacket;
  readonly startedAt: number;

  constructor(init: TurnRecorderInit) {
    this.startedAt = Date.now();
    let traceId: string | null = null;
    try {
      traceId = init.traceId ?? activeTraceId();
    } catch {
      traceId = null;
    }
    this.traceId = traceId;

    const packetInit: PacketInit = {
      kind: init.kind,
      trace_id: traceId,
      vision_trace_id: null,
      environment: init.environment ?? "unknown",
      git_sha: init.gitSha ?? "unknown",
      service_version: init.serviceVersion ?? "unknown",
      tenant_id: init.tenantId,
      notebook_id: init.notebookId,
      thread_id: init.threadId ?? null,
      turn_id: null,
      client_request_id: init.clientRequestId ?? null,
      owner_user_id: init.ownerUserId ?? null,
    };
    this.packet = emptyPacket(packetInit);
    if (init.mode) this.packet.request.mode = init.mode;
  }

  stage<K extends StageKey>(stage: K, data: Partial<TurnEvidencePacket[K]>): void {
    try {
      Object.assign(this.packet[stage] as object, data);
    } catch (err) {
      this.safeError(`stage_merge_failed:${String(stage)}`, err);
      return;
    }
    try {
      setSpanAttrs(toSpanAttrs(String(stage), data as Record<string, unknown>));
    } catch {
      // Span mirroring is best-effort; the packet write above already
      // succeeded and is what gets persisted.
    }
  }

  timing(stage: keyof TurnEvidencePacket["timings_ms"], ms: number): void {
    try {
      this.packet.timings_ms[stage] = ms;
    } catch (err) {
      this.safeError(`timing_failed:${String(stage)}`, err);
    }
  }

  error(stage: string, code: string): void {
    try {
      this.packet.errors.push({ stage, code });
    } catch {
      // If even pushing an error record fails, there is nothing left to do
      // that would not risk throwing back into the caller's turn.
    }
  }

  generationAttempt(a: GenerationAttempt): void {
    try {
      this.packet.generation.attempts.push(a);
      if (a.outcome === "served") {
        this.packet.generation.served_provider = a.provider;
        this.packet.generation.served_model = a.model;
      }
    } catch (err) {
      this.safeError("generation_attempt_failed", err);
    }
  }

  finish(opts?: { productionRouteVars?: string[]; anomalyChecks?: boolean }): {
    packet: TurnEvidencePacket;
    anomalies: Anomaly[];
  } {
    try {
      if (this.packet.timings_ms.total === null) {
        this.packet.timings_ms.total = Date.now() - this.startedAt;
      }
    } catch {
      // Leave total as-is (possibly null) — never block finish() on this.
    }

    let anomalies: Anomaly[] = [];
    if (opts?.anomalyChecks !== false) {
      try {
        anomalies = detectAnomalies(this.packet, { productionRouteVars: opts?.productionRouteVars });
      } catch {
        anomalies = [];
      }
    }

    return { packet: this.packet, anomalies };
  }

  /** Records a diagnostics-layer failure as a packet error rather than
   * throwing — `error()` itself is already safe, so this just routes into it. */
  private safeError(code: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    try {
      this.packet.errors.push({ stage: "recorder", code: `${code}:${message}`.slice(0, 200) });
    } catch {
      // Truly nothing more we can safely do.
    }
  }
}

export function startTurnRecorder(init: TurnRecorderInit): TurnRecorder {
  try {
    return new TurnRecorderImpl(init);
  } catch {
    // Even constructing the recorder must not be able to fail the turn.
    // Fall back to the emptiest possible valid recorder.
    return new TurnRecorderImpl({
      kind: init?.kind ?? "chat",
      tenantId: init?.tenantId ?? "unknown",
      notebookId: init?.notebookId ?? "unknown",
    });
  }
}

// Re-exported so callers that only import from turn-recorder.ts can still
// name the packet version without a second import.
export { TURN_EVIDENCE_PACKET_VERSION };
