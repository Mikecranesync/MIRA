import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  try {
    const { rows } = await pool.query(`
      SELECT
        id, equipment_number, manufacturer, model_number, serial_number,
        equipment_type, location, department, criticality,
        work_order_count, total_downtime_hours,
        last_maintenance_date, last_work_order_at,
        last_reported_fault, description, created_at
      FROM cmms_equipment
      ORDER BY last_work_order_at DESC NULLS LAST, work_order_count DESC
    `);

    const assets = rows.map((r) => ({
      id: r.id,
      tag: r.equipment_number ?? r.id,
      name: [r.manufacturer, r.model_number, r.equipment_type].filter(Boolean).join(" "),
      manufacturer: r.manufacturer ?? null,
      model: r.model_number ?? null,
      serialNumber: r.serial_number ?? null,
      type: r.equipment_type ?? null,
      location: r.location ?? null,
      department: r.department ?? null,
      criticality: r.criticality ?? "low",
      workOrderCount: r.work_order_count ?? 0,
      downtimeHours: r.total_downtime_hours ?? 0,
      lastMaintenance: r.last_maintenance_date ?? null,
      lastWorkOrder: r.last_work_order_at ?? null,
      lastFault: r.last_reported_fault ?? null,
      description: r.description ?? null,
    }));

    return NextResponse.json(assets);
  } catch (err) {
    console.error("[api/assets]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
