import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { generateApiKey } from "@/lib/i3x/key";

export const dynamic = "force-dynamic";

// POST /api/i3x-keys — mint a new API key for the caller's tenant.
// The plaintext is returned exactly once and never stored. Only the hash is
// persisted. Uses owner pool.query (no RLS on i3x_api_keys by design).
export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => ({})) as { label?: unknown };
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;

  const { plaintext, hash } = generateApiKey();

  try {
    const { rows } = await pool.query<{ id: string; label: string | null; created_at: string }>(
      `INSERT INTO i3x_api_keys (tenant_id, key_hash, label, enabled)
       VALUES ($1, $2, $3, true)
       RETURNING id, label, created_at`,
      [ctx.tenantId, hash, label],
    );
    const row = rows[0];
    // Return plaintext ONCE — never log it.
    return NextResponse.json(
      { key: plaintext, id: row.id, label: row.label, created_at: row.created_at },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/i3x-keys POST]", err);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}

// GET /api/i3x-keys — list all API keys for the caller's tenant.
// NEVER returns key_hash.
export async function GET(_req: Request): Promise<NextResponse> {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { rows } = await pool.query(
      `SELECT id, label, enabled, created_at, last_used_at
       FROM i3x_api_keys
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [ctx.tenantId],
    );
    return NextResponse.json({ keys: rows });
  } catch (err) {
    console.error("[api/i3x-keys GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
