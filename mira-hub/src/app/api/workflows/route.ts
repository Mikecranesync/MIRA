import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows?workflow_name=&status=&limit=
 *
 * The durability dashboard's data source (audit criterion #9 — "Status view").
 * Returns recent `workflow_runs` rows (migration 044) across every wrapped
 * surface — the single SELECT that the run-record primitive makes nearly free.
 *
 * Filters (all optional):
 *   - workflow_name: exact match ('document_ingest', 'cmms_sync', …)
 *   - status:        running | ok | degraded | failed
 *   - limit:         default 50, max 200
 *
 * Tenant scope (#4574): every session — any role, and every demo session — sees
 * ONLY its own tenant's runs, in both `runs` and the 24h `summary`. A
 * caller-supplied tenant_id is ignored. workflow_runs has no RLS (migration 044),
 * so this predicate is the only thing standing between tenants. There is no
 * cross-tenant view here on purpose: the only platform-admin signal in the Hub is
 * an email allowlist, and registration does not verify email ownership, so it is
 * not a safe gate for cross-tenant data. Ops reads across tenants go through
 * db-inspect, not this route.
 */
export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const workflowName = (url.searchParams.get("workflow_name") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const tenantId = ctx.tenantId;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  const where: string[] = [];
  const params: unknown[] = [];
  if (workflowName) {
    params.push(workflowName);
    where.push(`workflow_name = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  params.push(tenantId);
  where.push(`tenant_id = $${params.length}`);

  try {
    const runsSql = `
      SELECT run_id, workflow_name, workflow_version, tenant_id, status,
             error_detail, step_artifacts, output,
             started_at, finished_at, retry_count,
             EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at)) * 1000 AS duration_ms
        FROM workflow_runs
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY started_at DESC
       LIMIT ${limit}`;
    const rows = await pool
      .query(runsSql, params)
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    // Per-workflow rollup of the last 24h so the page can show "X ok / Y failed".
    const summary = await pool
      .query(
        `SELECT workflow_name, status, COUNT(*)::int AS n
           FROM workflow_runs
          WHERE started_at > NOW() - INTERVAL '24 hours'
            AND tenant_id = $1
          GROUP BY workflow_name, status
          ORDER BY workflow_name`,
        [tenantId],
      )
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    return NextResponse.json({
      runs: rows.map((r) => ({
        runId: r.run_id,
        workflowName: r.workflow_name,
        workflowVersion: r.workflow_version,
        tenantId: r.tenant_id,
        status: r.status,
        errorDetail: r.error_detail,
        stepArtifacts: r.step_artifacts ?? [],
        output: r.output ?? null,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        retryCount: r.retry_count,
        durationMs: r.duration_ms != null ? Math.round(Number(r.duration_ms)) : null,
      })),
      summary: summary.map((r) => ({
        workflowName: r.workflow_name,
        status: r.status,
        count: r.n,
      })),
    });
  } catch (err) {
    console.error("[api/workflows GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
