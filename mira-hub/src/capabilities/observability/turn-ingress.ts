/**
 * Turn ingress — the counter that is NOT the recorder.
 *
 * WHY THIS EXISTS
 * ---------------
 * `lifecycleCoverage()` answers "of the turns that opened, how many closed?".
 * That question is computed from `decision_traces`, so it can only ever see
 * turns the recorder successfully wrote a start for. A turn whose start never
 * landed does not lower the score — it is absent from both numerator and
 * denominator, and coverage reads 100% while capture is broken.
 *
 *   "A missing start row cannot appear in a query of that ledger."  — #3939
 *
 * So arrival is counted HERE, in a different table, written before auth,
 * before validation, before the recorder exists for this turn. Reconciliation
 * is then a difference between two independent counts rather than the
 * recorder's opinion of itself.
 *
 * This is NOT a second evidence registry (materialized-evidence rule 15). It
 * stores no question, answer, citation, packet or content of any kind — only
 * "a request arrived" and "a response left, with this status". Putting it in
 * `decision_traces` would defeat its entire purpose by construction.
 *
 * APPEND-ONLY, two rows per attempt (the discipline 092 settled on):
 *   arrived   — earliest honest point
 *   responded — written in a `finally`, carrying the status that actually left
 *
 * FAIL-OPEN. A counter that can break a chat turn is worse than a counter that
 * misses one. Every failure increments a visible counter instead of throwing.
 *
 * Schema: `db/migrations/093_turn_ingress.sql`.
 */
import pool from "@/lib/db";

export type IngressPhase = "arrived" | "responded";

export type ArrivalInit = {
  /** Minted by the caller BEFORE anything else, and handed to `openTurn` so
   *  the ingress row and the ledger row share an exact join key. */
  attemptId: string;
  /** "hub_notebook_chat" | "hub_notebook_look" — mirrors the ledger platform. */
  route: string;
  tenantId?: string | null;
  notebookId?: string | null;
  clientRequestId?: string | null;
  environment?: string | null;
  gitSha?: string | null;
};

export type ResponseInit = ArrivalInit & { httpStatus: number };

/**
 * The per-request record the ingress wrapper threads into the handler.
 *
 * `tenantId` starts null — at arrival there is no tenant — and the handler
 * fills it once auth succeeds, so a lost start is still attributable.
 *
 * `closeOnUnhandled` is the handler's own escape hatch: a turn that throws
 * somewhere its `endRoot`/`finally` cannot reach would otherwise leave a start
 * record open until the reconciler swept it, reported as `abandoned` when it
 * was really an error. The handler installs this once a start exists.
 */
export type IngressRecord = ArrivalInit & {
  tenantId: string | null;
  closeOnUnhandled?: (outcome: "error") => void;
};

/**
 * Process-local failure counters. Deliberately process-local: a restart zeroing
 * them is itself reported via `since_process_start_ms`, and the DURABLE measure
 * is the reconciliation query, not these.
 */
const failures = { arrivalFailed: 0, responseFailed: 0, processStart: Date.now() };

export function ingressFailureCounters() {
  return {
    arrival_write_failed: failures.arrivalFailed,
    response_write_failed: failures.responseFailed,
    since_process_start_ms: Date.now() - failures.processStart,
  };
}

/**
 * Written on the OWNER pool, not `withTenantContext`, for two reasons that are
 * both requirements rather than shortcuts:
 *   1. an unauthenticated arrival has no tenant to set a context from, and a
 *      401 that cannot be counted is exactly the blind spot this closes;
 *   2. independence — a counter routed through the same tenant machinery the
 *      recorder uses would fail in the same conditions the recorder fails in,
 *      and would stop being a second opinion.
 * The table holds no tenant content, so there is nothing for RLS to protect
 * here; the tenant-scoped READ path applies its predicate explicitly.
 */
async function append(phase: IngressPhase, init: ResponseInit | ArrivalInit, httpStatus: number | null) {
  await pool.query(
    `INSERT INTO turn_ingress
       (attempt_id, phase, route, tenant_id, notebook_id, client_request_id,
        http_status, environment, git_sha)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9)
     ON CONFLICT (attempt_id, phase) DO NOTHING`,
    [
      init.attemptId,
      phase,
      init.route,
      init.tenantId ?? null,
      init.notebookId ?? null,
      init.clientRequestId ?? null,
      httpStatus,
      init.environment ?? null,
      init.gitSha ?? null,
    ],
  );
}

/** Never throws. A failed arrival write is counted, not raised. */
export async function recordArrival(init: ArrivalInit): Promise<boolean> {
  try {
    await append("arrived", init, null);
    return true;
  } catch (err) {
    failures.arrivalFailed += 1;
    console.error(
      "[turn-ingress] arrival write failed (turn continues, reconciliation degraded):",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** Never throws. */
export async function recordResponse(init: ResponseInit): Promise<boolean> {
  try {
    await append("responded", init, init.httpStatus);
    return true;
  } catch (err) {
    failures.responseFailed += 1;
    console.error(
      "[turn-ingress] response write failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export type IngressReconciliation = {
  window_ms: number;
  /** Every request that reached the handler. THE denominator for "did we see it". */
  arrived: number;
  /** Arrivals whose response never got written (process death mid-request, or a
   *  failed response append). Not a capture defect by itself — reported so it
   *  cannot be quietly folded into either of the buckets below. */
  no_response_recorded: number;
  /** Arrived, responded 4xx/5xx, never opened a turn. EXPECTED — a malformed
   *  body or a 401 is not a lost turn. Its own population, its own denominator. */
  pre_accept_rejections: number;
  /** Arrived, responded 2xx, and the ledger has NO start row. THE capture
   *  defect this whole table exists to make visible. */
  lost_starts: number;
  /** Arrivals that reached the ledger. The denominator for lifecycle coverage. */
  accepted: number;
  /** Of `accepted`, how many reached a terminal outcome. */
  accepted_closed: number;
  /** Accepted, unclosed, and older than the stale threshold. */
  accepted_unfinished: number;
  /** accepted_closed / accepted, or null when there is nothing to divide. */
  close_rate: number | null;
  /** lost_starts / (arrived - pre_accept_rejections - no_response_recorded). */
  start_capture_rate: number | null;
  /**
   * THE MIRROR. Ledger starts in the window with no arrival row behind them.
   *
   * Everything above detects the ledger failing while ingress works. This
   * detects the opposite, and without it the pair is not mutually checking: if
   * `recordArrival` fails systematically — owner-pool exhaustion, a bad deploy,
   * the table missing — then `arrived` is 0, every derived bucket is 0, and the
   * whole block reads PERFECTLY HEALTHY while counting nothing at all.
   *
   * `arrival_write_failed` notices that too, but it is process-local and dies on
   * restart, which is exactly the weakness that disqualified process counters
   * from measuring starts. This number is durable.
   */
  starts_without_arrival: number;
};

/**
 * Reconcile arrivals against the ledger. Runs on the owner pool with an
 * explicit tenant predicate when scoped: an operator's loss count is worthless
 * if RLS can hide exactly the rows that went wrong.
 */
export async function ingressReconciliation(opts: {
  tenantId?: string | null;
  windowMs?: number;
  staleAfterMs?: number;
}): Promise<IngressReconciliation> {
  const windowMs = opts.windowMs ?? 60 * 60_000;
  const stale = opts.staleAfterMs ?? 5 * 60_000;
  // The arrival row is written BEFORE auth, so it has no tenant. The response
  // row does (the handler sets it the moment `sessionOr401` succeeds), so the
  // attempt's tenant is whichever of the two knows it. An attempt that never
  // authenticated has neither, and is visible only in the unscoped operator
  // view — which is correct: it belongs to no tenant.
  const res = await pool.query(
    `WITH arrivals AS (
       SELECT a.attempt_id,
              r.http_status,
              COALESCE(a.tenant_id, r.tenant_id) AS tenant_id,
              EXISTS (SELECT 1 FROM decision_traces d
                       WHERE d.attempt_id = a.attempt_id AND d.lifecycle = 'started') AS started,
              EXISTS (SELECT 1 FROM decision_traces d
                       WHERE d.attempt_id = a.attempt_id AND d.lifecycle = 'closed')  AS closed,
              a.at
         FROM turn_ingress a
         LEFT JOIN turn_ingress r
           ON r.attempt_id = a.attempt_id AND r.phase = 'responded'
        WHERE a.phase = 'arrived'
          AND a.at > now() - ($1 || ' seconds')::interval
     )
     SELECT
       COUNT(*)                                                             AS arrived,
       COUNT(*) FILTER (WHERE http_status IS NULL AND NOT started)          AS no_response_recorded,
       COUNT(*) FILTER (WHERE http_status >= 400 AND NOT started)           AS pre_accept_rejections,
       COUNT(*) FILTER (WHERE http_status IS NOT NULL
                          AND http_status < 400 AND NOT started)            AS lost_starts,
       COUNT(*) FILTER (WHERE started)                                      AS accepted,
       COUNT(*) FILTER (WHERE started AND closed)                           AS accepted_closed,
       COUNT(*) FILTER (WHERE started AND NOT closed
                          AND at < now() - ($2 || ' seconds')::interval)    AS accepted_unfinished
       FROM arrivals
      WHERE $3::text IS NULL OR tenant_id = $3::text`,
    [windowMs / 1000, stale / 1000, opts.tenantId ?? null],
  );
  // Asked of the OTHER ledger, so a total ingress failure cannot hide behind
  // its own zero. Scoped by decision_traces.tenant_id, which a started row
  // always has.
  const mirror = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM decision_traces d
      WHERE d.lifecycle = 'started'
        AND d.attempt_id IS NOT NULL
        AND d.started_at > now() - ($1 || ' seconds')::interval
        AND ($2::text IS NULL OR d.tenant_id = $2::text)
        AND NOT EXISTS (SELECT 1 FROM turn_ingress a
                         WHERE a.attempt_id = d.attempt_id AND a.phase = 'arrived')`,
    [windowMs / 1000, opts.tenantId ?? null],
  );
  const r = (res.rows[0] ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(r[k] ?? 0);
  const arrived = n("arrived");
  const accepted = n("accepted");
  const acceptedClosed = n("accepted_closed");
  const lost = n("lost_starts");
  const rejected = n("pre_accept_rejections");
  const noResponse = n("no_response_recorded");
  // The start-capture denominator is arrivals that SHOULD have opened a turn:
  // a 4xx never should have, and an arrival with no recorded response cannot be
  // judged either way. Folding either into the denominator would flatter the
  // number, which is the failure mode this whole module exists to prevent.
  const startable = arrived - rejected - noResponse;
  return {
    window_ms: windowMs,
    arrived,
    no_response_recorded: noResponse,
    pre_accept_rejections: rejected,
    lost_starts: lost,
    accepted,
    accepted_closed: acceptedClosed,
    accepted_unfinished: n("accepted_unfinished"),
    close_rate: accepted > 0 ? acceptedClosed / accepted : null,
    start_capture_rate: startable > 0 ? (startable - lost) / startable : null,
    starts_without_arrival: Number((mirror.rows[0] as Record<string, unknown>)?.n ?? 0),
  };
}
