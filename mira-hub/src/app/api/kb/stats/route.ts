import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/kb/stats
 * KB ingest dashboard endpoint. See docs/specs/kb-ingest-hardening-spec.md §4.3.
 *
 * Returns growth, success rate, queue depth, and the most recent failure cluster
 * so the UI can show "stale" / "healthy" badges without fanning out queries.
 */
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const data = await withTenantContext(ctx.tenantId, async (c) => {
      // Total + recent KB rows (authoritative table)
      const totals = await c.query(
        `SELECT
           COUNT(*)                                         AS total_entries,
           COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')  AS entries_today,
           COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS entries_7d
         FROM knowledge_entries
         WHERE tenant_id = $1`,
        [ctx.tenantId],
      );

      // Pipeline run health (table created in 006_pipeline_runs.sql).
      // Wrap in a try so an old DB without the table still returns 0s.
      let runs = { rows: [{ total: 0, ok: 0, failed: 0, last_run_at: null }] } as {
        rows: Array<{ total: number; ok: number; failed: number; last_run_at: string | null }>;
      };
      try {
        runs = await c.query(
          `SELECT
             COUNT(*)::int                                                 AS total,
             COUNT(*) FILTER (WHERE status = 'ok')::int                    AS ok,
             COUNT(*) FILTER (WHERE status IN ('failed','partial'))::int   AS failed,
             MAX(started_at)                                               AS last_run_at
           FROM pipeline_runs
           WHERE tenant_id = $1
             AND started_at > now() - interval '7 days'`,
          [ctx.tenantId],
        );
      } catch {
        // pipeline_runs table not yet deployed — degrade gracefully.
      }

      let topFailures: Array<{ url_host: string; count: number; last_error: string | null }> = [];
      try {
        const fails = await c.query(
          `SELECT
             split_part(regexp_replace(pdf_url, '^https?://', ''), '/', 1) AS url_host,
             COUNT(*)::int                                                  AS count,
             (array_agg(error ORDER BY started_at DESC))[1]                AS last_error
           FROM pipeline_runs
           WHERE tenant_id = $1
             AND status IN ('failed','partial')
             AND started_at > now() - interval '7 days'
           GROUP BY url_host
           ORDER BY count DESC
           LIMIT 5`,
          [ctx.tenantId],
        );
        topFailures = fails.rows;
      } catch {
        // pipeline_runs not yet deployed
      }

      return { totals: totals.rows[0], runs: runs.rows[0], topFailures };
    });

    const t = data.totals as Record<string, unknown>;
    const r = data.runs as Record<string, unknown>;

    const total = Number(r.total ?? 0);
    const ok = Number(r.ok ?? 0);
    const successRate = total > 0 ? ok / total : null;

    const lastRunAt = r.last_run_at ? new Date(String(r.last_run_at)) : null;
    const stale = !lastRunAt
      ? true
      : Date.now() - lastRunAt.getTime() > 24 * 60 * 60 * 1000;

    return NextResponse.json({
      total_entries: Number(t.total_entries ?? 0),
      entries_today: Number(t.entries_today ?? 0),
      entries_7d: Number(t.entries_7d ?? 0),
      pipeline_runs_7d: total,
      success_rate_7d: successRate,
      queue_depth: null, // populated when manual_queue.json is exposed via API
      top_failures: data.topFailures,
      last_run_at: lastRunAt?.toISOString() ?? null,
      stale,
    });
  } catch (err) {
    console.error("[api/kb/stats]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
