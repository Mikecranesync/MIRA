import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { isUndefinedRelationOrColumn } from "@/lib/machine-memory";
import { formatTagValue } from "@/lib/gs10-display";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/signal-history
 *
 * Recent numeric tag history for the asset's UNS subtree — feeds the Machine
 * Memory card's per-tag sparklines. Read-only, last 5 minutes, downsampled to
 * ≤ MAX_POINTS per tag, values scaled to engineering units (gs10-display).
 * Time axis is ingested_at (server receipt) — the client event_timestamp
 * freezes under Ignition report-by-exception (see #2429 / the historian fix).
 */
const WINDOW_MINUTES = 5;
const MAX_POINTS = 60;
const MAX_ROWS = 3000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // Same kg_entities asset→uns_path bridge as the machine-memory route.
      const unsPath = await c
        .query(
          `SELECT uns_path::text AS uns_path
             FROM kg_entities
            WHERE tenant_id = $1
              AND entity_type = 'equipment'
              AND (id::text = $2 OR entity_id = $2)
            LIMIT 1`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows[0]?.uns_path ?? null);

      if (!unsPath) return { uns_path: null, series: {} };

      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = await c
          .query(
            `SELECT tag_path,
                    extract(epoch FROM ingested_at) AS t,
                    value::float8 AS v
               FROM tag_events
              WHERE tenant_id = $1::uuid
                AND uns_path IS NOT NULL
                AND uns_path <@ $2::ltree
                AND value_type IN ('int', 'float')
                AND value IS NOT NULL
                AND ingested_at > NOW() - interval '${WINDOW_MINUTES} minutes'
              ORDER BY tag_path, ingested_at ASC
              LIMIT ${MAX_ROWS}`,
            [ctx.tenantId, unsPath],
          )
          .then((r) => r.rows);
      } catch (err) {
        if (!isUndefinedRelationOrColumn(err)) throw err;
        console.error("[api/signal-history] tag_events unavailable (033 not applied?)", err);
        return { uns_path: unsPath, series: {} };
      }

      // Group per tag, scale to engineering units, downsample to MAX_POINTS.
      const byTag = new Map<string, Array<{ t: number; v: number }>>();
      for (const row of rows) {
        const tag = String(row.tag_path);
        const v = Number(row.v);
        if (!Number.isFinite(v)) continue;
        const scaled = formatTagValue(tag, v).numeric;
        if (scaled === null) continue;
        let arr = byTag.get(tag);
        if (!arr) {
          arr = [];
          byTag.set(tag, arr);
        }
        arr.push({ t: Number(row.t), v: scaled });
      }
      const series: Record<string, Array<{ t: number; v: number }>> = {};
      for (const [tag, points] of byTag) {
        if (points.length <= MAX_POINTS) {
          series[tag] = points;
          continue;
        }
        const step = points.length / MAX_POINTS;
        const sampled: Array<{ t: number; v: number }> = [];
        for (let i = 0; i < MAX_POINTS; i++) {
          sampled.push(points[Math.floor(i * step)]);
        }
        sampled[sampled.length - 1] = points[points.length - 1]; // keep the freshest point
        series[tag] = sampled;
      }
      return { uns_path: unsPath, series };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/signal-history GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
