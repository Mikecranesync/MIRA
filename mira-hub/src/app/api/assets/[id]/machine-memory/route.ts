import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { fetchMachineMemory, fetchLiveSignals } from "@/lib/machine-memory";
import { classifyTagFreshness, rollupFreshness, tagStatuses } from "@/lib/command-center-freshness";
import { deriveCurrentState, type WindowRow } from "@/lib/machine-current-state";
import { formatTagValue } from "@/lib/gs10-display";

export const dynamic = "force-dynamic";

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
 * The queries live in the shared helper `@/lib/machine-memory`
 * (fetchMachineMemory), reused by the asset context + chat routes (T2).
 * Tables read: machine_run (038), machine_state_window (040 — may not be
 * applied in every env, tolerated inside the helper), run_diff (038 + 040
 * typed-anomaly columns, same tolerance).
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
          live_tags: [],
          current_state: null,
        };
      }

      const memory = await fetchMachineMemory(c, ctx.tenantId, unsPath);

      // Per-tag live signals + the freshness-aware CURRENT state. The newest
      // window may be closed/stale — deriveCurrentState downgrades to
      // comm_down/unknown when the signal stream dried up.
      const signals = await fetchLiveSignals(c, ctx.tenantId, unsPath);
      const nowMs = Date.now();
      const liveTags = signals.map((s) => {
        const raw = s.last_value_text ?? s.last_value_numeric ?? s.last_value_bool ?? null;
        const formatted = formatTagValue(s.plc_tag, raw);
        return {
          tag_path: s.plc_tag,
          value: raw,
          display: formatted.display,
          numeric: formatted.numeric,
          unit: formatted.unit,
          last_seen_at: s.last_seen_at,
          last_changed_at: s.last_changed_at,
          freshness: classifyTagFreshness(s, nowMs),
        };
      });
      const freshness = rollupFreshness(unsPath, tagStatuses(signals, nowMs));
      const currentState = deriveCurrentState(
        memory.latest_window as WindowRow | null,
        freshness,
      );

      const evidenceWindow = memory.latest_run
        ? { started_at: memory.latest_run.started_at, stopped_at: memory.latest_run.stopped_at, uns_path: unsPath }
        : memory.latest_window
          ? { started_at: memory.latest_window.started_at, stopped_at: memory.latest_window.ended_at, uns_path: unsPath }
          : null;

      return {
        uns_path: unsPath,
        latest_run: memory.latest_run,
        latest_window: memory.latest_window,
        windows_available: memory.windows_available,
        latest_diffs: memory.latest_diffs,
        evidence_window: evidenceWindow,
        live_tags: liveTags,
        current_state: currentState,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/machine-memory GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
