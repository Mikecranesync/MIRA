import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { ensureSchema } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  await ensureSchema();
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, status, created_at
       FROM hub_users
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [ctx.tenantId],
    );
    return NextResponse.json(
      rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name ?? r.email,
        email: r.email,
        role: r.role,
        status: r.status,
        joinedAt: r.created_at,
      })),
    );
  } catch (err) {
    console.error("[api/team]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
