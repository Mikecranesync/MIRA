import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const { id } = await params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM work_orders WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const wo = rows[0];
    return NextResponse.json({
      id: wo.id,
      woNumber: wo.work_order_number,
      tech: wo.telegram_username ?? "Unknown",
      channel: wo.source ?? "Unknown",
      asset: wo.equipment_type,
      manufacturer: wo.manufacturer,
      modelNumber: wo.model_number,
      location: wo.location,
      title: wo.title,
      description: wo.description,
      faultCodes: wo.fault_codes ?? [],
      symptoms: wo.symptoms ?? [],
      safetyWarnings: wo.safety_warnings ?? [],
      suggestedActions: wo.suggested_actions ?? [],
      miraResponse: wo.answer_text,
      confidence: wo.confidence_score,
      status: wo.status,
      priority: wo.priority,
      routeTaken: wo.route_taken,
      createdAt: wo.created_at,
      updatedAt: wo.updated_at,
    });
  } catch (err) {
    console.error("[api/events/id]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
