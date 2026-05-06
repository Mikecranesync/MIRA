/**
 * PATCH /api/pm-schedules/[id]/meter
 *
 * Update the current meter reading for a PM schedule. If the reading meets or
 * exceeds meter_threshold (for 'meter' or 'calendar_or_meter' trigger types),
 * the PM is triggered: meter_current resets to 0, meter_last_reset_at is
 * stamped, and next_due_at recalculates from now using interval_value/interval_unit.
 *
 * This endpoint is the integration point for IoT/Ignition runtime-hours feeds.
 * Expected body: { reading: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function addInterval(base: Date, value: number, unit: string): Date {
  const d = new Date(base);
  switch (unit) {
    case "hours":  d.setHours(d.getHours() + value); break;
    case "days":   d.setDate(d.getDate() + value); break;
    case "weeks":  d.setDate(d.getDate() + value * 7); break;
    case "months": d.setMonth(d.getMonth() + value); break;
    case "years":  d.setFullYear(d.getFullYear() + value); break;
    default:       d.setDate(d.getDate() + value); break;
  }
  return d;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  let body: { reading?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reading = Number(body.reading);
  if (isNaN(reading) || reading < 0) {
    return NextResponse.json({ error: "reading must be a non-negative number" }, { status: 400 });
  }

  try {
    const schedule = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<{
          id: string;
          trigger_type: string;
          meter_threshold: number | null;
          interval_value: number;
          interval_unit: string;
        }>(
          `SELECT id, trigger_type, meter_threshold, interval_value, interval_unit
           FROM pm_schedules
           WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r) => r.rows[0] ?? null),
    );

    if (!schedule) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isMeterEnabled =
      schedule.trigger_type === "meter" ||
      schedule.trigger_type === "calendar_or_meter";

    if (!isMeterEnabled) {
      return NextResponse.json(
        { error: "This PM schedule does not use meter triggers. Set trigger_type to 'meter' or 'calendar_or_meter' first." },
        { status: 400 },
      );
    }

    const threshold = schedule.meter_threshold ?? 0;
    const triggered = reading >= threshold && threshold > 0;

    let updated: Record<string, unknown>;

    if (triggered) {
      const nextDue = addInterval(new Date(), schedule.interval_value, schedule.interval_unit);
      updated = await withTenantContext(ctx.tenantId, (c) =>
        c
          .query(
            `UPDATE pm_schedules
             SET meter_current      = 0,
                 meter_last_reset_at = NOW(),
                 last_completed_at   = NOW(),
                 next_due_at         = $3
             WHERE id = $1 AND tenant_id = $2
             RETURNING id, meter_current, meter_threshold, meter_last_reset_at, next_due_at, trigger_type`,
            [id, ctx.tenantId, nextDue.toISOString()],
          )
          .then((r) => r.rows[0]),
      );
    } else {
      updated = await withTenantContext(ctx.tenantId, (c) =>
        c
          .query(
            `UPDATE pm_schedules
             SET meter_current = $3
             WHERE id = $1 AND tenant_id = $2
             RETURNING id, meter_current, meter_threshold, meter_last_reset_at, next_due_at, trigger_type`,
            [id, ctx.tenantId, reading],
          )
          .then((r) => r.rows[0]),
      );
    }

    return NextResponse.json({
      schedule: updated,
      triggered,
      reading,
      message: triggered
        ? `PM triggered at ${reading} ${schedule.interval_unit}. Meter reset to 0. Next due recalculated.`
        : `Meter updated to ${reading}. Threshold is ${threshold}.`,
    });
  } catch (err) {
    console.error("[api/pm-schedules/[id]/meter PATCH]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
