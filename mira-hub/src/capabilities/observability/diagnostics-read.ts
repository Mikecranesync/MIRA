/**
 * Read side of the Turn Flight Recorder: pull a persisted Turn Evidence
 * Packet (+ its deterministic anomalies) back out of `decision_traces`.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §4 "Read surface". Feeds the two diagnostics routes
 * (`app/api/equipment-notebooks/[id]/turns/[turnId]/diagnostics` and
 * `.../turns/diagnostics`) — kept in its own file rather than inline in the
 * route so both a single-turn read and the notebook listing share one query
 * shape and one tenant-scoping discipline.
 *
 * TENANT SCOPING: `decision_traces.tenant_id` is TEXT since migration 070;
 * compared here as text with no cast (mira-hub-migrations.md §1/§2) against
 * `tenantId`, which is always a UUID string by the time it reaches here
 * (session.ts rejects non-UUID session tenants before any route runs). Reads
 * run `withTenantContext` (same helper `persistTurnUsage` writes through) so
 * RLS enforces the same boundary the explicit `tenant_id = $1 AND
 * notebook_id = $2` predicate states — belt and suspenders, not either/or.
 */
import { withTenantContext } from "@/lib/tenant-context";
import type { Anomaly } from "./anomalies";
import type { TurnEvidencePacket } from "./turn-evidence-packet";

export type TurnDiagnostics = {
  traceId: string | null;
  turnId: string;
  notebookId: string;
  packet: TurnEvidencePacket;
  anomalies: Anomaly[];
  ts: string;
};

export type TurnDiagnosticsListItem = {
  turnId: string;
  traceId: string | null;
  ts: string;
  decision: string | null;
  anomalyCodes: string[];
};

const MAX_LIST_LIMIT = 100;

function anomalyCodesOf(anomalies: unknown): string[] {
  if (!Array.isArray(anomalies)) return [];
  return anomalies
    .filter((a): a is { code: unknown } => !!a && typeof a === "object" && "code" in a)
    .map((a) => String((a as { code: unknown }).code));
}

/**
 * One turn's packet, or null when nothing was ever recorded for it (an old
 * turn from before this instrumentation, a non-notebook platform row, or a
 * turn that genuinely doesn't belong to this tenant/notebook).
 */
export async function loadTurnDiagnostics(
  tenantId: string,
  notebookId: string,
  turnId: string,
): Promise<TurnDiagnostics | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT otel_trace_id, turn_id, notebook_id, evidence_packet, anomalies, ts
         FROM decision_traces
        WHERE tenant_id = $1
          AND notebook_id = $2::uuid
          AND turn_id = $3::uuid
        ORDER BY ts DESC
        LIMIT 1`,
      [tenantId, notebookId, turnId],
    );
    const row = res.rows[0];
    if (!row || !row.evidence_packet) return null;
    return {
      traceId: (row.otel_trace_id as string | null) ?? null,
      turnId: row.turn_id as string,
      notebookId: row.notebook_id as string,
      packet: row.evidence_packet as TurnEvidencePacket,
      anomalies: (row.anomalies as Anomaly[] | null) ?? [],
      ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
    };
  });
}

/**
 * Recent packets for a notebook — ids + decision + anomaly codes only, never
 * the packet body (that's `loadTurnDiagnostics` for one turn at a time).
 */
export async function listTurnDiagnostics(
  tenantId: string,
  notebookId: string,
  limit: number,
): Promise<TurnDiagnosticsListItem[]> {
  const cappedLimit = Math.max(1, Math.min(limit, MAX_LIST_LIMIT));
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT turn_id, otel_trace_id, evidence_packet, anomalies, ts
         FROM decision_traces
        WHERE tenant_id = $1
          AND notebook_id = $2::uuid
          AND turn_id IS NOT NULL
          AND evidence_packet IS NOT NULL
        ORDER BY ts DESC
        LIMIT $3`,
      [tenantId, notebookId, cappedLimit],
    );
    return res.rows.map((row) => {
      const packet = row.evidence_packet as TurnEvidencePacket | null;
      return {
        turnId: row.turn_id as string,
        traceId: (row.otel_trace_id as string | null) ?? null,
        ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
        decision: packet?.answer_gate?.decision ?? null,
        anomalyCodes: anomalyCodesOf(row.anomalies),
      };
    });
  });
}
