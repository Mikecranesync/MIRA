/**
 * POST /api/pm-schedules/[id]/complete
 *
 * Mark a PM schedule complete. Persists the completion and rolls the schedule
 * forward:
 *   - last_completed_at = NOW()   (drives the "completed" status for 7 days)
 *   - next_due_at       = NOW() + interval_value/interval_unit
 *   - updated_at        = NOW()   (cmms-sync worker keys off this to push to Atlas)
 * For meter-based PMs the meter cycle is also reset (meter_current = 0,
 * meter_last_reset_at = NOW()) so a completion starts a fresh meter window —
 * mirroring the reset the /[id]/meter endpoint does when a threshold trips.
 *
 * Completion is intentionally kept to schedule roll-forward (the "or recalculate
 * the next due date" branch of #1950). A separate completion-history table /
 * work-order spawn is a distinct feature, not required by the acceptance
 * criteria.
 */

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";
import { addInterval } from "@/lib/pm-interval";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireCapability(ctx, "pm_schedules.complete");
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const schedule = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<{
          id: string;
          trigger_type: string;
          interval_value: number;
          interval_unit: string;
        }>(
          `SELECT id, COALESCE(trigger_type, 'calendar') AS trigger_type,
                  interval_value, interval_unit
           FROM pm_schedules
           WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r) => r.rows[0] ?? null),
    );

    if (!schedule) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const nextDue = addInterval(
      new Date(),
      Number(schedule.interval_value) || 0,
      String(schedule.interval_unit),
    );

    const isMeter =
      schedule.trigger_type === "meter" ||
      schedule.trigger_type === "calendar_or_meter";

    const meterSet = isMeter
      ? ", meter_current = 0, meter_last_reset_at = NOW()"
      : "";

    const updated = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `UPDATE pm_schedules
           SET last_completed_at = NOW(),
               next_due_at       = $3,
               updated_at        = NOW()${meterSet}
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, next_due_at, last_completed_at,
                     COALESCE(trigger_type, 'calendar') AS trigger_type,
                     meter_current, meter_threshold, meter_last_reset_at`,
          [id, ctx.tenantId, nextDue.toISOString()],
        )
        .then((r) => r.rows[0] ?? null),
    );

    if (!updated) {
      // Row vanished between SELECT and UPDATE (cross-tenant / concurrent delete).
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ schedule: updated });
  } catch (err) {
    console.error("[api/pm-schedules/[id]/complete POST]", err);
    return NextResponse.json({ error: "Completion failed" }, { status: 500 });
  }
}
