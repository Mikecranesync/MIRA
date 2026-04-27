import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";

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
    const { rows } = await pool.query(
      `SELECT
        id, tenant_id, manufacturer, model_number, equipment_id,
        task, interval_value, interval_unit, interval_type,
        parts_needed, tools_needed, estimated_duration_minutes,
        safety_requirements, criticality, source_citation, confidence,
        next_due_at, last_completed_at, auto_extracted, created_at
      FROM pm_schedules
      WHERE ${where}
      ORDER BY
        CASE criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        next_due_at ASC NULLS LAST
      LIMIT 200`,
      params,
    );

    return NextResponse.json({
      count: rows.length,
      schedules: rows.map(rowToPM),
    });
  } catch (err) {
    // If table doesn't exist yet, return empty rather than 500
    const msg = String(err);
    if (msg.includes("pm_schedules") && msg.includes("does not exist")) {
      return NextResponse.json({ count: 0, schedules: [] });
    }
    console.error("[api/pm-schedules GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
