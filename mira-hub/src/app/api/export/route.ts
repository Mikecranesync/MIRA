import { NextResponse } from "next/server";
import { PassThrough } from "stream";
import archiver from "archiver";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const date = new Date().toISOString().split("T")[0];

  try {
    const tables = await withTenantContext(ctx.tenantId, async (client) => {
      const [workOrders, equipment, pmSchedules, knowledge, users] = await Promise.all([
        client
          .query(
            `SELECT id, title, description, status, priority, asset_id, created_at, updated_at
             FROM work_orders
             ORDER BY created_at DESC`,
          )
          .then((r) => r.rows),
        client
          .query(
            `SELECT id, name, asset_tag, category, location, manufacturer, model, serial_number, status, created_at
             FROM cmms_equipment
             ORDER BY name ASC`,
          )
          .then((r) => r.rows),
        client
          .query(
            `SELECT id, equipment_id, task_name, frequency_days, last_completed_at, next_due_at, created_at
             FROM pm_schedules
             ORDER BY next_due_at ASC`,
          )
          .then((r) => r.rows),
        client
          .query(
            `SELECT id, title, source_filename, created_at
             FROM knowledge_entries
             ORDER BY created_at DESC`,
          )
          .then((r) => r.rows),
        client
          .query(
            `SELECT id, name, email, role, status, created_at
             FROM hub_users
             ORDER BY created_at ASC`,
          )
          .then((r) => r.rows),
      ]);
      return { workOrders, equipment, pmSchedules, knowledge, users };
    });

    const passThrough = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("error", (err) => {
      passThrough.destroy(err);
    });

    archive.pipe(passThrough);

    archive.append(toCsv(tables.workOrders), { name: "work_orders.csv" });
    archive.append(toCsv(tables.equipment), { name: "equipment.csv" });
    archive.append(toCsv(tables.pmSchedules), { name: "pm_schedules.csv" });
    archive.append(toCsv(tables.knowledge), { name: "knowledge_entries.csv" });
    archive.append(toCsv(tables.users), { name: "team.csv" });

    archive.finalize();

    const readableStream = new ReadableStream({
      start(controller) {
        passThrough.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        passThrough.on("end", () => controller.close());
        passThrough.on("error", (err: Error) => controller.error(err));
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="factorylm-export-${date}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/export]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
