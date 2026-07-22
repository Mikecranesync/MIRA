// mira-hub/src/app/api/visual/sessions/route.ts
//
// Visual Focus Workspace (PR V2) — session collection.
//   GET  → list the caller's visual sessions (newest activity first).
//   POST → create a session.
//
// Reuses the EXISTING migration-063 visual_session table (PRD §22: extend the
// existing visual ledger, never a second store). Pure-tenant UUID-family table
// → withTenantContext + belt-and-suspenders explicit tenant predicate.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const SESSION_COLUMNS =
  "session_id, asset_id, uns_path::text AS uns_path, title, status, created_by, created_at, updated_at, metadata";

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));

  try {
    const rows = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query(
        `SELECT ${SESSION_COLUMNS}
         FROM visual_session
         WHERE tenant_id = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [ctx.tenantId, limit],
      );
      return res.rows;
    });
    return NextResponse.json({ sessions: rows });
  } catch (err) {
    console.error("[api/visual/sessions GET]", err);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
}

interface CreateSessionPayload {
  title?: string;
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let payload: CreateSessionPayload;
  try {
    payload = (await req.json()) as CreateSessionPayload;
  } catch {
    payload = {};
  }
  const title =
    typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim().slice(0, 200)
      : null;

  try {
    const session = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO visual_session (tenant_id, title, created_by, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SESSION_COLUMNS}`,
        [ctx.tenantId, title, ctx.email || ctx.userId, JSON.stringify({ created_via: "hub" })],
      );
      return res.rows[0];
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    console.error("[api/visual/sessions POST]", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
