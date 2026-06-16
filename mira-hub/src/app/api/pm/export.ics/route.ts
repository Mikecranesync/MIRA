import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { buildICS, type PMTask } from "@/lib/ics-export";

export const dynamic = "force-dynamic";

function pmStatus(
  nextDueAt: string | null,
  lastCompletedAt: string | null,
): "scheduled" | "overdue" | "completed" {
  if (lastCompletedAt) {
    const completed = new Date(lastCompletedAt);
    const now = new Date();
    if (now.getTime() - completed.getTime() < 7 * 24 * 60 * 60 * 1000) {
      return "completed";
    }
  }
  if (!nextDueAt) return "scheduled";
  return new Date(nextDueAt) < new Date() ? "overdue" : "scheduled";
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

function rowToPMTask(r: Record<string, unknown>): PMTask {
  const nextDueAt = r.next_due_at ? String(r.next_due_at) : null;
  const lastCompletedAt = r.last_completed_at ? String(r.last_completed_at) : null;
  const durationMin =
    typeof r.estimated_duration_minutes === "number" ? r.estimated_duration_minutes : null;
  const dueDate = nextDueAt ? nextDueAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const assetLabel =
    [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown asset";

  return {
    id: String(r.id),
    title: String(r.task),
    asset: assetLabel,
    date: dueDate,
    tech: "—",
    recur: intervalToRecur(Number(r.interval_value), String(r.interval_unit)),
    durationH: durationMin ? Math.max(1, Math.round(durationMin / 60)) : 1,
    status: pmStatus(nextDueAt, lastCompletedAt),
    criticality: r.criticality ? String(r.criticality) : "medium",
    parts_needed: Array.isArray(r.parts_needed) ? (r.parts_needed as string[]) : [],
    tools_needed: Array.isArray(r.tools_needed) ? (r.tools_needed as string[]) : [],
    safety_requirements: Array.isArray(r.safety_requirements)
      ? (r.safety_requirements as string[])
      : [],
    source_citation: r.source_citation ? String(r.source_citation) : null,
  };
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT
            id, manufacturer, model_number,
            task, interval_value, interval_unit,
            parts_needed, tools_needed, estimated_duration_minutes,
            safety_requirements, criticality, source_citation,
            next_due_at, last_completed_at
          FROM pm_schedules
          WHERE tenant_id = $1
          ORDER BY next_due_at ASC NULLS LAST
          LIMIT 500`,
          [ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    const tasks: PMTask[] = rows.map(rowToPMTask);
    const icsContent = buildICS(tasks, "MIRA PM Schedule");

    return new Response(icsContent, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pm-schedule.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("pm_schedules") && msg.includes("does not exist")) {
      // Return an empty-but-valid calendar when the table hasn't been created yet
      const emptyIcs = buildICS([], "MIRA PM Schedule");
      return new Response(emptyIcs, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="pm-schedule.ics"',
          "Cache-Control": "no-store",
        },
      });
    }
    console.error("[api/pm/export.ics GET]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
