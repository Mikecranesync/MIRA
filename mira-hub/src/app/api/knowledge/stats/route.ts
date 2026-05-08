import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Live KB growth metrics for the dashboard panel on /knowledge.
// Universal corpus — no tenant filter (see /api/knowledge/route.ts comment).
//
// Returns: totals, time-bucketed counts (today / week / month), 7-day average
// growth rate, ingest pipeline health (last ingest, hourly throughput, queue
// depth) and top-10 manufacturers. All counts come from knowledge_entries
// directly. Queue depth comes from manual_cache.pdf_stored = false (the
// crawler hydrates the queue from there; see kb_growth_cron.py).
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const [
      { rows: totalsRows },
      { rows: bucketRows },
      { rows: avgRows },
      { rows: hourlyRows },
      { rows: queueRows },
      { rows: mfrRows },
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::bigint AS total_entries,
           COUNT(DISTINCT source_url)::bigint AS total_docs,
           COUNT(DISTINCT manufacturer)
             FILTER (WHERE manufacturer IS NOT NULL AND TRIM(manufacturer) <> '')::bigint
             AS manufacturer_count,
           MAX(created_at) AS last_ingested
         FROM knowledge_entries`,
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::bigint AS today,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::bigint  AS week,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::bigint AS month
         FROM knowledge_entries`,
      ),
      pool.query(
        `SELECT COUNT(*)::bigint AS chunks_7d
           FROM knowledge_entries
          WHERE created_at > NOW() - INTERVAL '7 days'`,
      ),
      pool.query(
        `SELECT COUNT(*)::bigint AS chunks_1h
           FROM knowledge_entries
          WHERE created_at > NOW() - INTERVAL '1 hour'`,
      ),
      // manual_cache.pdf_stored = false ⇒ queued / not yet ingested.
      // Wrapped in a CTE that swallows missing-table errors to keep the
      // dashboard resilient if the cache hasn't been provisioned in this env.
      pool.query(
        `SELECT COUNT(*)::bigint AS queue_depth
           FROM manual_cache
          WHERE pdf_stored = false`,
      ).catch(() => ({ rows: [{ queue_depth: 0 }] })),
      pool.query(
        `SELECT
           CASE
             WHEN manufacturer IS NULL OR TRIM(manufacturer) = '' THEN 'Uncategorized'
             ELSE INITCAP(LOWER(TRIM(manufacturer)))
           END AS manufacturer,
           COUNT(*)::bigint AS chunk_count
         FROM knowledge_entries
         GROUP BY 1
         ORDER BY chunk_count DESC
         LIMIT 10`,
      ),
    ]);

    const totals = totalsRows[0] ?? {};
    const buckets = bucketRows[0] ?? {};
    const avg = avgRows[0] ?? {};
    const hourly = hourlyRows[0] ?? {};
    const queue = queueRows[0] ?? {};

    const lastIngested = totals.last_ingested
      ? new Date(totals.last_ingested as string | number | Date).toISOString()
      : null;

    // Worker is "running" if anything was indexed in the last 2 hours
    // (cron runs hourly; allow one missed beat before we alarm).
    const workerRunning =
      lastIngested !== null &&
      Date.now() - new Date(lastIngested).getTime() < 2 * 60 * 60 * 1000;

    const chunks7d = Number(avg.chunks_7d ?? 0);
    const dailyAvg7d = Math.round(chunks7d / 7);

    return NextResponse.json(
      {
        totals: {
          totalEntries: Number(totals.total_entries ?? 0),
          totalDocs: Number(totals.total_docs ?? 0),
          manufacturerCount: Number(totals.manufacturer_count ?? 0),
          lastIngested,
        },
        recent: {
          today: Number(buckets.today ?? 0),
          week: Number(buckets.week ?? 0),
          month: Number(buckets.month ?? 0),
          dailyAvg7d,
        },
        worker: {
          running: workerRunning,
          chunksLastHour: Number(hourly.chunks_1h ?? 0),
          lastIngested,
        },
        pipeline: {
          queueDepth: Number(queue.queue_depth ?? 0),
        },
        topManufacturers: mfrRows.map((r: Record<string, unknown>) => ({
          name: r.manufacturer as string,
          chunkCount: Number(r.chunk_count),
        })),
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      },
    );
  } catch (err) {
    console.error("[api/knowledge/stats]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
