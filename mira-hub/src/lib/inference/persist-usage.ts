/**
 * Persist a canonical per-turn usage record into `decision_traces`.
 *
 * PR #3359 produced the record and emitted it as an SSE frame plus a log line.
 * Logs rotate and cannot be queried, so "what did this tenant spend last week"
 * had no answer. ADR-0037 gates Cloud Gold on per-turn spend telemetry, which
 * means queryable — this is that step.
 *
 * WHY decision_traces AND NOT equipment_notebook_turns
 * `decision_traces` is the canonical per-turn ledger (P0004 map §9 lists it
 * under "do NOT rebuild"); the Python runtime already writes there. Adding spend
 * columns to `equipment_notebook_turns` instead would fork the ledger in two, so
 * that a future "spend by tenant" query would have to UNION two tables with
 * different tenant types. One ledger.
 *
 * FAILURE POSTURE: NON-FATAL, BUT NEVER SILENT.
 * The answer has already been streamed to the technician and persisted as
 * conversation history by the time this runs. Losing the spend row must not
 * retroactively destroy a correct, cited answer — the architecture nowhere
 * requires fail-closed for telemetry, and failing closed here would mean a
 * ledger outage becomes a chat outage. So this swallows the error and logs a
 * distinct, greppable event instead. That is a deliberate trade: spend rows can
 * be under-counted during an incident, and the log is what tells you so.
 */
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import type { TurnUsage } from "@/lib/inference/canonical-cascade";

export type PersistUsageScope = {
  tenantId: string;
  notebookId: string;
  question: string;
  /** Grounded answer text, or null when the turn refused/errored. */
  answerText: string | null;
  /** Whether the shipped answer carried citations (feeds the uncited index). */
  citationsPresent: boolean;
  /** Wall time for the whole turn, if measured. */
  latencyMs?: number | null;
};

/** Result is returned (not thrown) so callers can assert without try/catch. */
export type PersistUsageResult =
  | { persisted: true; traceId: string }
  | { persisted: false; reason: string };

/**
 * `decision_traces.tenant_id` is TEXT since migration 070 — NOT uuid. The RLS
 * policy compares in-type with no cast and its WITH CHECK applies to INSERT, so
 * the parameter must be passed as text. Casting to ::uuid here would throw on
 * any legacy slug tenant and, worse, would not match the policy.
 */
export async function persistTurnUsage(
  scope: PersistUsageScope,
  usage: TurnUsage,
): Promise<PersistUsageResult> {
  try {
    return await withTenantContext(scope.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO decision_traces
           (tenant_id, platform, user_question, recommendation, citations_present,
            model_used, latency_ms,
            provider, route_reason, principal,
            input_tokens, cached_input_tokens, output_tokens,
            cost_usd_estimate, status)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $7,
                 $8, $9, $10,
                 $11, $12, $13,
                 $14, $15)
         RETURNING trace_id`,
        [
          scope.tenantId, // TEXT — see note above
          "hub_notebook_chat",
          scope.question,
          scope.answerText,
          scope.citationsPresent,
          usage.model,
          scope.latencyMs ?? null,
          usage.provider,
          usage.routeReason,
          // Which notebook this spend belongs to. `principal` is the free-text
          // actor/scope column on 078/080; the notebook id is the unit an
          // operator actually asks about ("what did this machine cost me").
          `notebook:${scope.notebookId}`,
          usage.inputTokens,
          usage.cachedInputTokens,
          usage.outputTokens,
          // NULL flows straight through. Never coalesce to 0 — an unpriced or
          // unreported turn is UNKNOWN cost, and 0 would silently understate
          // every spend rollup built on this column.
          usage.costUsdEstimate,
          usage.status,
        ],
      );
      const traceId = res.rows[0]?.trace_id as string | undefined;
      return traceId
        ? ({ persisted: true, traceId } as const)
        : ({ persisted: false, reason: "no_row_returned" } as const);
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : String(err);
    // Distinct, greppable event: a spend gap must be diagnosable after the fact,
    // and it must not look like a chat error.
    console.error(
      JSON.stringify({
        service: "mira-hub",
        component: "notebook-chat",
        event: "turn.usage.persist_failed",
        tenantId: scope.tenantId,
        notebookId: scope.notebookId,
        provider: usage.provider,
        // 42P01 = table missing, 42703 = column missing -> migration 080 not applied.
        // 42501 = privilege -> grant drift. Both are operator-actionable.
        code: code ?? null,
        error: message,
      }),
    );
    return { persisted: false, reason: code ?? "error" };
  }
}

/**
 * Spend rollup — the query ADR-0037 actually needs, kept next to the writer so
 * the two cannot drift apart.
 *
 * Runs on the RAW pool with an explicit tenant predicate rather than
 * withTenantContext: an operator/rollup read is per-tenant by argument, and
 * keeping it explicit makes the scope visible at the call site.
 */
export async function tenantSpendSince(
  tenantId: string,
  since: Date,
): Promise<{ provider: string | null; turns: number; costUsd: number | null }[]> {
  const res = await pool.query(
    `SELECT provider,
            count(*)                AS turns,
            -- SUM ignores NULLs, so unpriced turns neither inflate nor zero the
            -- total; unpriced_turns is what tells you the total is partial.
            sum(cost_usd_estimate)  AS cost_usd,
            count(*) FILTER (WHERE cost_usd_estimate IS NULL) AS unpriced_turns
       FROM decision_traces
      WHERE tenant_id = $1 AND ts >= $2
      GROUP BY provider
      ORDER BY cost_usd DESC NULLS LAST`,
    [tenantId, since.toISOString()],
  );
  return res.rows.map((r) => ({
    provider: r.provider as string | null,
    turns: Number(r.turns),
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
  }));
}
