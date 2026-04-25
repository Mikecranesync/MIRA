import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

function rowToAsset(r: Record<string, unknown>) {
  return {
    id: r.id,
    tag: r.equipment_number ?? r.id,
    name: (r.description as string) || [r.manufacturer, r.model_number, r.equipment_type].filter(Boolean).join(" "),
    manufacturer: r.manufacturer ?? null,
    model: r.model_number ?? null,
    serialNumber: r.serial_number ?? null,
    type: r.equipment_type ?? null,
    location: r.location ?? null,
    department: r.department ?? null,
    criticality: r.criticality ?? "medium",
    workOrderCount: r.work_order_count ?? 0,
    downtimeHours: r.total_downtime_hours ?? 0,
    lastMaintenance: r.last_maintenance_date ?? null,
    lastWorkOrder: r.last_work_order_at ?? null,
    lastFault: r.last_reported_fault ?? null,
    description: r.description ?? null,
    createdAt: r.created_at ?? null,
  };
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
        id, equipment_number, manufacturer, model_number, serial_number,
        equipment_type, location, department, criticality,
        work_order_count, total_downtime_hours,
        last_maintenance_date, last_work_order_at,
        last_reported_fault, description, created_at
      FROM cmms_equipment
      WHERE tenant_id = $1
      ORDER BY last_work_order_at DESC NULLS LAST, created_at DESC`,
      [ctx.tenantId],
    );
    return NextResponse.json(rows.map(rowToAsset));
  } catch (err) {
    console.error("[api/assets GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await req.json();
    const { name, tag, manufacturer, model, serialNumber, location, criticality, installDate } = body;

    if (!manufacturer?.trim()) {
      return NextResponse.json({ error: "manufacturer is required" }, { status: 400 });
    }

    const safeLevel = ["low", "medium", "high", "critical"].includes((criticality ?? "").toLowerCase())
      ? (criticality as string).toLowerCase()
      : "medium";

    const { rows } = await pool.query(
      `INSERT INTO cmms_equipment
         (tenant_id, equipment_number, manufacturer, model_number, serial_number,
          location, criticality, installation_date, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7::criticalitylevel, $8, $9)
       RETURNING
         id, equipment_number, manufacturer, model_number, serial_number,
         equipment_type, location, criticality, description, created_at`,
      [
        ctx.tenantId,
        tag?.trim() || null,
        manufacturer.trim(),
        model?.trim() || null,
        serialNumber?.trim() || null,
        location?.trim() || null,
        safeLevel,
        installDate || null,
        name?.trim() || null,
      ],
    );

    return NextResponse.json(rowToAsset(rows[0]), { status: 201 });
  } catch (err) {
    console.error("[api/assets POST]", err);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
