import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Daily KB growth series for the cumulative-line chart on /knowledge.
// Returns daily counts for the last 30 days plus a running cumulative total.
// Universal corpus — no tenant filter (see /api/knowledge/route.ts comment).
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    // Daily counts for the last 30 days. Cumulative = total prior to that day
    // (snapshots before the 30-day window) plus the running sum within the
    // window — keeps the chart truthful without scanning the entire table.
    const [{ rows: dailyRows }, { rows: priorRows }] = await Promise.all([
      pool.query(
        `SELECT
           DATE(created_at AT TIME ZONE 'UTC') AS day,
           COUNT(*)::bigint AS count
         FROM knowledge_entries
         WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1
         ORDER BY 1 ASC`,
      ),
      pool.query(
        `SELECT COUNT(*)::bigint AS prior_count
           FROM knowledge_entries
          WHERE created_at <= NOW() - INTERVAL '30 days'`,
      ),
    ]);

    let cumulative = Number(priorRows[0]?.prior_count ?? 0);
    const series = dailyRows.map((r: Record<string, unknown>) => {
      const count = Number(r.count);
      cumulative += count;
      const day = r.day as Date | string;
      const iso =
        day instanceof Date
          ? day.toISOString().slice(0, 10)
          : String(day).slice(0, 10);
      return { date: iso, count, cumulative };
    });

    return NextResponse.json(
      {
        series,
        windowDays: 30,
        priorTotal: Number(priorRows[0]?.prior_count ?? 0),
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
    console.error("[api/knowledge/growth]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
