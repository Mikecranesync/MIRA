import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    trigger_type,
    meter_type,
    meter_threshold,
    meter_current,
    interval_value,
    interval_unit,
    next_due_at,
  } = body as {
    trigger_type?: string;
    meter_type?: string;
    meter_threshold?: number;
    meter_current?: number;
    interval_value?: number;
    interval_unit?: string;
    next_due_at?: string;
  };

  const validTriggerTypes = ["calendar", "meter", "calendar_or_meter"];
  if (trigger_type !== undefined && !validTriggerTypes.includes(trigger_type)) {
    return NextResponse.json(
      { error: `trigger_type must be one of: ${validTriggerTypes.join(", ")}` },
      { status: 400 },
    );
  }

  if ((trigger_type === "meter" || trigger_type === "calendar_or_meter") && meter_threshold === undefined) {
    return NextResponse.json(
      { error: "meter_threshold is required when trigger_type includes 'meter'" },
      { status: 400 },
    );
  }

  const setParts: string[] = [];
  const values: unknown[] = [id, ctx.tenantId];

  function param(v: unknown) {
    values.push(v);
    return `$${values.length}`;
  }

  if (trigger_type !== undefined) setParts.push(`trigger_type = ${param(trigger_type)}`);
  if (meter_type !== undefined)    setParts.push(`meter_type = ${param(meter_type)}`);
  if (meter_threshold !== undefined) setParts.push(`meter_threshold = ${param(meter_threshold)}`);
  if (meter_current !== undefined)  setParts.push(`meter_current = ${param(meter_current)}`);
  if (interval_value !== undefined) setParts.push(`interval_value = ${param(interval_value)}`);
  if (interval_unit !== undefined)  setParts.push(`interval_unit = ${param(interval_unit)}`);
  if (next_due_at !== undefined)    setParts.push(`next_due_at = ${param(next_due_at)}`);

  if (setParts.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `UPDATE pm_schedules
           SET ${setParts.join(", ")}
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, trigger_type, meter_type, meter_threshold, meter_current,
                     interval_value, interval_unit, next_due_at, task`,
          values,
        )
        .then((r) => r.rows[0] ?? null),
    );

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ schedule: updated });
  } catch (err) {
    console.error("[api/pm-schedules/[id] PATCH]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
