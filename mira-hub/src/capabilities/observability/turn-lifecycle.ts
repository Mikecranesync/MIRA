/**
 * Turn lifecycle — a durable START record and an eventual OUTCOME for every
 * accepted turn.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Turn Evidence Packet was written exactly once, at the end, by
 * `persistTurnUsage` — a *usage* persist on the successful generation path. A
 * turn that timed out, was cancelled by the client, exhausted the provider
 * cascade, or died before generation left NO ROW AT ALL. So the ledger could
 * not distinguish "never happened" from "happened and vanished", and every
 * coverage number computed from it was self-confirming: it counted the turns
 * that survived to be counted.
 *
 * `openTurn` writes the start the moment a turn is ACCEPTED — after auth and
 * validation, before any retrieval or provider work. Every exit path calls
 * `closeTurn`. A row still `started` well past any plausible turn duration is
 * an ORPHAN, and orphans are the honest measure of capture loss.
 *
 * NO SECOND REGISTRY (materialized-evidence rule 15): this writes into the same
 * `decision_traces` ledger `persistTurnUsage` writes.
 *
 * APPEND-ONLY. Migration 032 grants the app role SELECT + INSERT and no more —
 * "the app role may read + insert, never mutate or delete" — because trace
 * history must not be rewritable from the request path. So a lifecycle is TWO
 * APPENDED ROWS sharing an `attempt_id`: one `started`, one `closed`. Closing
 * appends the outcome; it never mutates the start. The first cut of this module
 * closed by UPDATE and the live window measured `started=7, closed=0` — the
 * grant was doing exactly its job.
 *
 * WHAT IT NEVER STORES: no credentials, no cookies, no prompt text, no answer
 * text, no model chain-of-thought. The start record is tenant + notebook + ids
 * + timing. Content lives behind the existing columns and the protected
 * references described in the capture design; this module adds no new content
 * surface.
 *
 * FAIL-OPEN, ALWAYS. A recorder that can break a chat turn is worse than a
 * recorder that misses one — but a failure must be VISIBLE, so every failure
 * increments a counter the coverage endpoint reports rather than being
 * swallowed. Schema: `db/migrations/091_decision_traces_turn_lifecycle.sql`.
 */
import { randomUUID } from "node:crypto";
import { withTenantContext } from "@/lib/tenant-context";
import pool from "@/lib/db";

/** How a turn ended. `superseded` is a duplicate/retry the server discarded. */
export type TurnOutcome =
  | "answered"
  | "refused"
  | "abstained"
  | "safety_stop"
  | "error"
  | "timeout"
  | "cancelled"
  | "superseded";

export type OpenTurnInit = {
  tenantId: string;
  notebookId: string;
  /** "chat" | "look" — mirrors the packet's `kind`. */
  platform: string;
  clientRequestId?: string | null;
  otelTraceId?: string | null;
  environment?: string | null;
  gitSha?: string | null;
};

export type OpenTurn = {
  /** Server-minted id for THIS attempt; the key the close updates on. */
  attemptId: string;
  /** false when the start could not be written — the turn still proceeds. */
  durable: boolean;
  reason?: string;
};

/**
 * Counters for failures that would otherwise be invisible. Read by the coverage
 * endpoint so the recorder is measured by something other than its own success
 * reports. Process-local and deliberately so: a restart zeroing them is itself
 * reported (`sinceProcessStartMs`), and the DURABLE measure is the orphan query.
 */
const failures = {
  openFailed: 0,
  closeFailed: 0,
  closeMissedNoStart: 0,
  processStart: Date.now(),
};

export function lifecycleFailureCounters() {
  return {
    open_failed: failures.openFailed,
    close_failed: failures.closeFailed,
    close_missed_no_start: failures.closeMissedNoStart,
    since_process_start_ms: Date.now() - failures.processStart,
  };
}

/** Write the start record. Never throws; a failed write returns durable:false. */
export async function openTurn(init: OpenTurnInit): Promise<OpenTurn> {
  const attemptId = randomUUID();
  try {
    await withTenantContext(init.tenantId, async (c) => {
      await c.query(
        `INSERT INTO decision_traces
           (tenant_id, platform, user_question, recommendation, citations_present,
            attempt_id, lifecycle, started_at,
            otel_trace_id, client_request_id, notebook_id, environment, git_sha, anomalies)
         VALUES ($1, $2, '', '', false,
                 $3::uuid, 'started', now(),
                 $4, $5, $6::uuid, $7, $8, '[]'::jsonb)
         ON CONFLICT (attempt_id, lifecycle) WHERE attempt_id IS NOT NULL DO NOTHING`,
        [
          init.tenantId, // TEXT — decision_traces.tenant_id is TEXT since 070
          init.platform,
          attemptId,
          init.otelTraceId ?? null,
          init.clientRequestId ?? null,
          init.notebookId,
          init.environment ?? null,
          init.gitSha ?? null,
        ],
      );
    });
    return { attemptId, durable: true };
  } catch (err) {
    failures.openFailed += 1;
    console.error(
      "[turn-lifecycle] start record failed (turn continues, capture degraded):",
      err instanceof Error ? err.message : err,
    );
    return { attemptId, durable: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export type CloseTurnInit = {
  tenantId: string;
  attemptId: string;
  outcome: TurnOutcome;
  /** Everything the packet-bearing close already carries; all optional so an
   *  early exit (a 4xx, a cancel before generation) can still close cleanly. */
  turnRowId?: string | null;
  evidencePacket?: unknown;
  anomalies?: unknown[];
  latencyMs?: number | null;
  question?: string | null;
  answerText?: string | null;
  citationsPresent?: boolean;
};

/**
 * Close the start record. Returns whether a started row was actually found —
 * `matched:false` means the outcome arrived with no start behind it, which is a
 * capture defect worth counting, not a silent no-op.
 */
export async function closeTurn(init: CloseTurnInit): Promise<{ closed: boolean; matched: boolean }> {
  try {
    return await withTenantContext(init.tenantId, async (c) => {
      // APPEND the outcome. `SELECT ... FROM decision_traces` pulls the start
      // row's identity forward so the outcome carries the same correlation keys
      // without the caller having to re-supply them; if the start never landed
      // (a capture defect the counters already recorded) the insert selects
      // nothing and `matched` is false — a fact worth reporting, not a silent
      // no-op. ON CONFLICT absorbs a double-close.
      const res = await c.query(
        `INSERT INTO decision_traces
           (tenant_id, platform, user_question, recommendation, citations_present,
            attempt_id, lifecycle, outcome, started_at, finished_at,
            otel_trace_id, client_request_id, notebook_id, environment, git_sha,
            turn_id, evidence_packet, anomalies, latency_ms)
         SELECT tenant_id, platform, COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, false),
                attempt_id, 'closed', $2, started_at, now(),
                otel_trace_id, client_request_id, notebook_id, environment, git_sha,
                COALESCE($6::uuid, turn_id),
                COALESCE($7::jsonb, evidence_packet),
                COALESCE($8::jsonb, anomalies),
                $9
           FROM decision_traces
          WHERE attempt_id = $1::uuid AND lifecycle = 'started'
         ON CONFLICT (attempt_id, lifecycle) WHERE attempt_id IS NOT NULL DO NOTHING
         RETURNING trace_id`,
        [
          init.attemptId,
          init.outcome,
          init.question ?? null,
          init.answerText ?? null,
          init.citationsPresent ?? null,
          init.turnRowId ?? null,
          init.evidencePacket === undefined ? null : JSON.stringify(init.evidencePacket),
          init.anomalies === undefined ? null : JSON.stringify(init.anomalies),
          init.latencyMs ?? null,
        ],
      );
      const matched = (res.rowCount ?? 0) > 0;
      if (!matched) failures.closeMissedNoStart += 1;
      return { closed: true, matched };
    });
  } catch (err) {
    failures.closeFailed += 1;
    console.error(
      "[turn-lifecycle] outcome write failed (turn already served):",
      err instanceof Error ? err.message : err,
    );
    return { closed: false, matched: false };
  }
}

export type UnfinishedTurn = {
  attemptId: string;
  traceId: string | null;
  notebookId: string | null;
  platform: string;
  startedAt: string;
  ageMs: number;
  environment: string | null;
  gitSha: string | null;
};

/**
 * Turns accepted and never closed, older than `staleAfterMs`. THE honest
 * capture measure: it counts what the recorder failed to finish, from the
 * database, rather than from anything the recorder reports about itself.
 *
 * Runs on the raw owner pool with an EXPLICIT tenant predicate when scoped, or
 * across tenants when `tenantId` is null (operator view) — the orphan count is
 * meaningless if RLS can hide the rows that went wrong.
 */
export async function listUnfinishedTurns(opts: {
  tenantId?: string | null;
  staleAfterMs?: number;
  limit?: number;
}): Promise<UnfinishedTurn[]> {
  const stale = opts.staleAfterMs ?? 5 * 60_000;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const params: unknown[] = [stale / 1000, limit];
  let where = `d.lifecycle = 'started'
                 AND d.started_at < now() - ($1 || ' seconds')::interval
                 AND NOT EXISTS (SELECT 1 FROM decision_traces c
                                  WHERE c.attempt_id = d.attempt_id AND c.lifecycle = 'closed')`;
  if (opts.tenantId) {
    params.push(opts.tenantId);
    where += ` AND d.tenant_id = $3`;
  }
  const res = await pool.query(
    `SELECT d.attempt_id, d.otel_trace_id, d.notebook_id, d.platform, d.started_at,
            d.environment, d.git_sha,
            EXTRACT(EPOCH FROM (now() - d.started_at)) * 1000 AS age_ms
       FROM decision_traces d
      WHERE ${where}
      ORDER BY d.started_at ASC
      LIMIT $2`,
    params,
  );
  return res.rows.map((r: Record<string, unknown>) => ({
    attemptId: String(r.attempt_id),
    traceId: (r.otel_trace_id as string) ?? null,
    notebookId: (r.notebook_id as string) ?? null,
    platform: String(r.platform),
    startedAt: new Date(r.started_at as string).toISOString(),
    ageMs: Math.round(Number(r.age_ms)),
    environment: (r.environment as string) ?? null,
    gitSha: (r.git_sha as string) ?? null,
  }));
}

/**
 * Coverage over a window, computed from the ledger itself.
 *
 * `started` is every accepted turn; `closed` is every one that reached an
 * outcome; `orphaned` is the difference that is old enough to be a real loss.
 * `packets` counts rows that actually carry an evidence packet, so a turn that
 * closed WITHOUT one is visible rather than counted as covered.
 */
export async function lifecycleCoverage(opts: {
  tenantId?: string | null;
  windowMs?: number;
  staleAfterMs?: number;
}): Promise<{
  window_ms: number;
  started: number;
  closed: number;
  orphaned: number;
  with_packet: number;
  by_outcome: Record<string, number>;
}> {
  const windowMs = opts.windowMs ?? 60 * 60_000;
  const stale = opts.staleAfterMs ?? 5 * 60_000;
  const params: unknown[] = [windowMs / 1000, stale / 1000];
  const outcomeParams: unknown[] = [windowMs / 1000];
  let scope = "";
  let outcomeScope = "";
  if (opts.tenantId) {
    params.push(opts.tenantId);
    outcomeParams.push(opts.tenantId);
    scope = " AND d.tenant_id = $3";
    outcomeScope = " AND tenant_id = $2";
  }
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE d.lifecycle = 'started')                AS started,
       COUNT(*) FILTER (WHERE d.lifecycle = 'closed')                 AS closed,
       COUNT(*) FILTER (WHERE d.lifecycle = 'started'
                          AND d.started_at < now() - ($2 || ' seconds')::interval
                          AND NOT EXISTS (SELECT 1 FROM decision_traces c
                                           WHERE c.attempt_id = d.attempt_id
                                             AND c.lifecycle = 'closed'))  AS orphaned,
       COUNT(*) FILTER (WHERE d.lifecycle = 'closed'
                          AND d.evidence_packet IS NOT NULL)          AS with_packet
     FROM decision_traces d
     WHERE d.started_at IS NOT NULL
       AND d.started_at > now() - ($1 || ' seconds')::interval${scope}`,
    params,
  );
  const outcomes = await pool.query(
    `SELECT outcome, COUNT(*) AS n
       FROM decision_traces
      WHERE started_at IS NOT NULL
        AND started_at > now() - ($1 || ' seconds')::interval${outcomeScope}
        AND outcome IS NOT NULL
      GROUP BY outcome`,
    outcomeParams,
  );
  const row = res.rows[0] ?? {};
  return {
    window_ms: windowMs,
    started: Number(row.started ?? 0),
    closed: Number(row.closed ?? 0),
    orphaned: Number(row.orphaned ?? 0),
    with_packet: Number(row.with_packet ?? 0),
    by_outcome: Object.fromEntries(
      (outcomes.rows as Record<string, unknown>[]).map((r) => [String(r.outcome), Number(r.n)]),
    ),
  };
}
