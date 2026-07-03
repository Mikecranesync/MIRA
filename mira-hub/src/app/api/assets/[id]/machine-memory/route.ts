import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

// Postgres error codes for "relation does not exist" / "column does not
// exist" — the only cases that legitimately mean "040 not applied in this
// env yet". Any other error (permission, syntax, connection, etc.) must
// rethrow and hit the route's outer 500 handler, not be swallowed as a
// silent empty/fallback state.
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

function isUndefinedRelationOrColumn(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN;
}

/**
 * GET /api/assets/[id]/machine-memory
 *
 * The minimal Hub surface for persisted machine memory (docs/discovery/
 * 2026-07-03-machine-memory-buildout.md D7): the latest machine run, the
 * latest state window, and the latest diffs/anomalies (with next-check +
 * evidence pointers) for one asset. Read-only.
 *
 * Empty state is first-class — most assets have no machine_run/window/diff
 * rows yet, and that is not an error.
 *
 * Tables read: machine_run (038), machine_state_window (040 — may not be
 * applied in every env, tolerated via try/catch), run_diff (038 + 040 typed-
 * anomaly columns, same tolerance).
 */
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
      // Resolve uns_path from kg_entities — the same bridge context/route.ts
      // uses. Do NOT join machine_run/run_diff to cmms_equipment directly:
      // cmms_equipment.tenant_id is TEXT, kg_entities/machine_run tenant_id is
      // UUID (uuid = text errors). This is a separate lookup, not a join.
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

      if (!unsPath) {
        return {
          uns_path: null,
          latest_run: null,
          latest_window: null,
          latest_diffs: [],
          evidence_window: null,
        };
      }

      const latestRun = await c
        .query(
          `SELECT run_id, status, started_at, stopped_at, duration_seconds, run_trigger_tag
             FROM machine_run
            WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
            ORDER BY started_at DESC
            LIMIT 1`,
          [ctx.tenantId, unsPath],
        )
        .then((r) => r.rows[0] ?? null);

      // machine_state_window is 040 — may not exist yet in every env.
      let latestWindow: Record<string, unknown> | null = null;
      let windowsAvailable = true;
      try {
        latestWindow = await c
          .query(
            `SELECT window_id, state, started_at, ended_at
               FROM machine_state_window
              WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
              ORDER BY started_at DESC
              LIMIT 1`,
            [ctx.tenantId, unsPath],
          )
          .then((r) => r.rows[0] ?? null);
      } catch (err) {
        if (!isUndefinedRelationOrColumn(err)) throw err;
        console.error("[api/assets/[id]/machine-memory GET] machine_state_window unavailable (040 not applied?)", err);
        windowsAvailable = false;
      }

      // run_diff 040 columns (window_id, from_event_id, to_event_id) may not
      // exist yet either. Fall back to the 038-only column set.
      let latestDiffs: Array<Record<string, unknown>> = [];
      try {
        latestDiffs = await c
          .query(
            `SELECT diff_id, run_id, window_id, tag_path, severity, diff_type,
                    observed, baseline, delta_percent, from_event_id, to_event_id,
                    event_timestamp, metadata
               FROM run_diff
              WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
              ORDER BY event_timestamp DESC NULLS LAST
              LIMIT 5`,
            [ctx.tenantId, unsPath],
          )
          .then((r) => r.rows);
      } catch (err) {
        if (!isUndefinedRelationOrColumn(err)) throw err;
        console.error("[api/assets/[id]/machine-memory GET] run_diff 040 columns unavailable, falling back to 038 columns", err);
        latestDiffs = await c
          .query(
            `SELECT diff_id, run_id, tag_path, severity,
                    observed, baseline, delta_percent, event_timestamp, metadata
               FROM run_diff
              WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
              ORDER BY event_timestamp DESC NULLS LAST
              LIMIT 5`,
            [ctx.tenantId, unsPath],
          )
          .then((r) => r.rows);
      }

      const evidenceWindow = latestRun
        ? { started_at: latestRun.started_at, stopped_at: latestRun.stopped_at, uns_path: unsPath }
        : latestWindow
          ? { started_at: latestWindow.started_at, stopped_at: latestWindow.ended_at, uns_path: unsPath }
          : null;

      return {
        uns_path: unsPath,
        latest_run: latestRun,
        latest_window: latestWindow,
        windows_available: windowsAvailable,
        latest_diffs: latestDiffs.map((d) => ({
          ...d,
          next_check: (d.metadata as { next_check?: string } | null)?.next_check ?? null,
        })),
        evidence_window: evidenceWindow,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/machine-memory GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
