import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

function classifyAction(wo: Record<string, unknown>): string {
  const safetyWarnings = wo.safety_warnings as string[] | null;
  if (safetyWarnings && safetyWarnings.length > 0) return "safety_alert";
  const faultCodes = wo.fault_codes as string[] | null;
  if (faultCodes && faultCodes.length > 0) return "diagnostic";
  const routeTaken = (wo.route_taken as string) ?? "";
  if (routeTaken === "work_order_creation") return "wo_created";
  const priority = (wo.priority as string) ?? "";
  if (priority === "critical" || priority === "high") return "diagnostic";
  return "lookup";
}

function platformFromSource(source: string): string {
  if (source === "telegram") return "Telegram";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "email") return "Email";
  if (source === "voice") return "Voice";
  return source ?? "Unknown";
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { rows } = await pool.query(
      `SELECT
        id, work_order_number, telegram_username, source,
        equipment_type, manufacturer, model_number, location,
        title, description, fault_codes, symptoms,
        safety_warnings, suggested_actions, answer_text,
        confidence_score, status, priority, route_taken,
        created_at
      FROM work_orders
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
      [ctx.tenantId],
    );

    const events = rows.map((wo) => ({
      id: wo.id,
      time: wo.created_at,
      tech: wo.telegram_username ?? "Unknown Tech",
      channel: platformFromSource(wo.source),
      asset: wo.equipment_type
        ? `${wo.manufacturer ?? ""} ${wo.model_number ?? ""} ${wo.equipment_type}`.trim()
        : null,
      location: wo.location ?? null,
      actionType: classifyAction(wo),
      woNumber: wo.work_order_number,
      title: wo.title ?? "",
      description: wo.description ?? "",
      faultCodes: wo.fault_codes ?? [],
      symptoms: wo.symptoms ?? [],
      safetyWarnings: wo.safety_warnings ?? [],
      suggestedActions: wo.suggested_actions ?? [],
      miraResponse: wo.answer_text ?? null,
      confidence: wo.confidence_score ?? null,
      status: wo.status,
      priority: wo.priority,
      syncStatus: wo.status === "open" || wo.status === "in_progress" ? "synced" : "pending",
    }));

    return NextResponse.json(events);
  } catch (err) {
    console.error("[api/events]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
