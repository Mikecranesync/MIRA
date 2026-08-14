import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";
import { addInterval } from "@/lib/pm-interval";

export const dynamic = "force-dynamic";

// PM status derived from next_due_at vs now
function pmStatus(
  nextDueAt: string | null,
  lastCompletedAt: string | null,
): "scheduled" | "overdue" | "completed" {
  if (lastCompletedAt) {
    const completed = new Date(lastCompletedAt);
    const now = new Date();
    // If completed in the last 7 days, show completed
    if (now.getTime() - completed.getTime() < 7 * 24 * 60 * 60 * 1000) {
      return "completed";
    }
  }
  if (!nextDueAt) return "scheduled";
  const due = new Date(nextDueAt);
  return due < new Date() ? "overdue" : "scheduled";
}

function intervalToRecur(value: number, unit: string): string {
  const unitMap: Record<string, string> = {
    hours: "hr",
    days: value === 1 ? "Daily" : `${value}d`,
    weeks: value === 1 ? "Weekly" : `${value}w`,
    months:
      value === 1
        ? "Monthly"
        : value === 3
          ? "Quarterly"
          : value === 6
            ? "Semi-annual"
            : `${value}mo`,
    years: value === 1 ? "Annual" : `${value}yr`,
    cycles: `${value} cycles`,
  };
  return unitMap[unit] ?? `${value} ${unit}`;
}

function rowToPM(r: Record<string, unknown>) {
  const nextDueAt = r.next_due_at ? String(r.next_due_at) : null;
  const lastCompletedAt = r.last_completed_at ? String(r.last_completed_at) : null;
  const durationMin = typeof r.estimated_duration_minutes === "number"
    ? r.estimated_duration_minutes
    : null;

  // Format next_due date as YYYY-MM-DD for the calendar
  const dueDate = nextDueAt ? nextDueAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const assetLabel = [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown asset";

  return {
    id: String(r.id),
    title: String(r.task),
    asset: assetLabel,
    date: dueDate,
    tech: "—",
    recur: intervalToRecur(Number(r.interval_value), String(r.interval_unit)),
    durationH: durationMin ? Math.max(1, Math.round(durationMin / 60)) : 1,
    status: pmStatus(nextDueAt, lastCompletedAt),
    // Extended fields for detail view
    manufacturer: r.manufacturer ?? null,
    model_number: r.model_number ?? null,
    criticality: r.criticality ?? "medium",
    confidence: r.confidence ?? null,
    source_citation: r.source_citation ?? null,
    parts_needed: r.parts_needed ?? [],
    tools_needed: r.tools_needed ?? [],
    safety_requirements: r.safety_requirements ?? [],
    interval_value: r.interval_value,
    interval_unit: r.interval_unit,
    auto_extracted: r.auto_extracted ?? true,
    // Multi-trigger fields (#898)
    trigger_type: String(r.trigger_type ?? "calendar"),
    meter_type: r.meter_type ? String(r.meter_type) : null,
    meter_threshold: r.meter_threshold != null ? Number(r.meter_threshold) : null,
    meter_current: r.meter_current != null ? Number(r.meter_current) : 0,
  };
}

export async function GET(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = req.nextUrl;
  const manufacturer = searchParams.get("manufacturer") ?? "";
  const modelNumber = searchParams.get("model_number") ?? "";
  const equipmentId = searchParams.get("equipment_id") ?? "";

  const params: unknown[] = [ctx.tenantId];
  const filters: string[] = ["tenant_id = $1"];

  if (manufacturer) {
    params.push(`%${manufacturer}%`);
    filters.push(`LOWER(manufacturer) LIKE LOWER($${params.length})`);
  }
  if (modelNumber) {
    params.push(`%${modelNumber}%`);
    filters.push(`LOWER(model_number) LIKE LOWER($${params.length})`);
  }
  if (equipmentId) {
    params.push(equipmentId);
    filters.push(`equipment_id = $${params.length}`);
  }

  const where = filters.join(" AND ");

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          id, tenant_id, manufacturer, model_number, equipment_id,
          task, interval_value, interval_unit, interval_type,
          parts_needed, tools_needed, estimated_duration_minutes,
          safety_requirements, criticality, source_citation, confidence,
          next_due_at, last_completed_at, auto_extracted, created_at,
          COALESCE(trigger_type, 'calendar') AS trigger_type,
          meter_type, meter_threshold, COALESCE(meter_current, 0) AS meter_current
        FROM pm_schedules
        WHERE ${where}
        ORDER BY
          CASE criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          next_due_at ASC NULLS LAST
        LIMIT 200`,
        params,
      ).then((r) => r.rows),
    );

    return NextResponse.json({
      count: rows.length,
      schedules: rows.map(rowToPM),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("pm_schedules") && msg.includes("does not exist")) {
      return NextResponse.json({ count: 0, schedules: [] });
    }
    console.error("[api/pm-schedules GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

/**
 * POST /api/pm-schedules — create a PM schedule by hand (SCH-04, #3226).
 *
 * Until now pm_schedules rows came ONLY from the manual auto-extractor
 * (mira-bots/shared/pm_extractor.py) — there was no human-create door, so the
 * mobile Schedule tab was read/complete-only. This is that door, kept to the
 * canonical model: same columns as the extractor's insert, same interval
 * units, same rowToPM response shape as GET, next_due_at defaulted via the
 * SHARED addInterval math the complete/meter endpoints use. Calendar-trigger
 * only — meter PMs need a threshold and belong to the meter endpoint's flow.
 *
 * Contract: 201 {schedule} · 400 {error: field-specific token} · 401 · 403
 * (pm_schedules.write) · 404 {error:"asset_not_found"} (tenant-scoped, does
 * not leak cross-tenant existence).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_UNITS = new Set(["hours", "days", "weeks", "months", "years"]);
const CRITICALITIES = new Set(["low", "medium", "high", "critical"]);

function cleanStringArray(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return null;
  return (v as string[]).map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireCapability(ctx, "pm_schedules.write");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const equipmentId = typeof body.equipment_id === "string" ? body.equipment_id.trim() : "";
  if (!equipmentId) {
    return NextResponse.json({ error: "equipment_id_required" }, { status: 400 });
  }
  if (!UUID_RE.test(equipmentId)) {
    return NextResponse.json({ error: "invalid_equipment_id" }, { status: 400 });
  }

  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!task) {
    return NextResponse.json({ error: "task_required" }, { status: 400 });
  }

  const intervalValue = body.interval_value;
  const intervalUnit =
    typeof body.interval_unit === "string" ? body.interval_unit.toLowerCase() : "";
  if (
    typeof intervalValue !== "number" ||
    !Number.isInteger(intervalValue) ||
    intervalValue < 1 ||
    !CREATE_UNITS.has(intervalUnit)
  ) {
    return NextResponse.json({ error: "invalid_interval" }, { status: 400 });
  }

  let nextDueAt: Date;
  if (body.next_due_at !== undefined && body.next_due_at !== null) {
    const parsed = new Date(String(body.next_due_at));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "invalid_next_due_at" }, { status: 400 });
    }
    nextDueAt = parsed;
  } else {
    nextDueAt = addInterval(new Date(), intervalValue, intervalUnit);
  }

  const criticality =
    body.criticality === undefined || body.criticality === null
      ? "medium"
      : String(body.criticality).toLowerCase();
  if (!CRITICALITIES.has(criticality)) {
    return NextResponse.json({ error: "invalid_criticality" }, { status: 400 });
  }

  let durationMin: number | null = null;
  if (body.estimated_duration_minutes !== undefined && body.estimated_duration_minutes !== null) {
    const d = body.estimated_duration_minutes;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1) {
      return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
    }
    durationMin = d;
  }

  const parts = cleanStringArray(body.parts_needed);
  const tools = cleanStringArray(body.tools_needed);
  const safety = cleanStringArray(body.safety_requirements);
  if (parts === null || tools === null || safety === null) {
    return NextResponse.json({ error: "invalid_string_array" }, { status: 400 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      // IDOR guard: the asset must exist in THIS tenant; cross-tenant ids 404
      // without leaking existence. Also the source of manufacturer/model the
      // schedule row denormalizes (same shape the extractor writes).
      const asset = await c.query(
        `SELECT id, manufacturer, model_number
           FROM cmms_equipment
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [equipmentId, ctx.tenantId],
      );
      if (asset.rows.length === 0) return null;
      const a = asset.rows[0] as { manufacturer: string | null; model_number: string | null };

      const inserted = await c.query(
        `INSERT INTO pm_schedules
           (id, tenant_id, manufacturer, model_number, equipment_id,
            task, interval_value, interval_unit, interval_type,
            parts_needed, tools_needed, estimated_duration_minutes,
            safety_requirements, criticality, source_citation, confidence,
            next_due_at, auto_extracted, trigger_type)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4,
            $5, $6, $7, 'time',
            $8::jsonb, $9::jsonb, $10,
            $11::jsonb, $12, NULL, NULL,
            $13, FALSE, 'calendar')
         RETURNING
           id, tenant_id, manufacturer, model_number, equipment_id,
           task, interval_value, interval_unit, interval_type,
           parts_needed, tools_needed, estimated_duration_minutes,
           safety_requirements, criticality, source_citation, confidence,
           next_due_at, last_completed_at, auto_extracted, created_at,
           COALESCE(trigger_type, 'calendar') AS trigger_type,
           meter_type, meter_threshold, COALESCE(meter_current, 0) AS meter_current`,
        [
          ctx.tenantId,
          a.manufacturer,
          a.model_number,
          equipmentId,
          task,
          intervalValue,
          intervalUnit,
          JSON.stringify(parts),
          JSON.stringify(tools),
          durationMin,
          JSON.stringify(safety),
          criticality,
          nextDueAt.toISOString(),
        ],
      );
      return inserted.rows[0] as Record<string, unknown>;
    });

    if (row === null) {
      return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
    }
    return NextResponse.json({ schedule: rowToPM(row) }, { status: 201 });
  } catch (err) {
    console.error("[api/pm-schedules POST]", err);
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }
}
