import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { validate } from "../route";

export const dynamic = "force-dynamic";

/**
 * Command Center display registry — update + delete one row (Phase 2 CRUD).
 * RLS-scoped to the session tenant. See ../route.ts for the contract + the
 * allowlist-regeneration note. Read-only product constraint still applies.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // For update, a key is not required (the row already has one); validate the rest.
  const v = validate(body, { requireKey: false });
  if (v.error) return NextResponse.json({ error: v.error }, { status: 422 });

  try {
    const updated = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<{ id: string }>(
        `UPDATE display_endpoints
            SET uns_path = $2::ltree, equipment_id = $3, display_type = $4,
                scheme = $5, host = $6, port = $7, path = $8, label = $9,
                enabled = $10, updated_at = now()
          WHERE id = $1::uuid
        RETURNING id`,
        [id, v.uns_path, v.equipment_id, v.display_type, v.scheme, v.host, v.port, v.path, v.label, v.enabled],
      );
      return res.rows[0] ?? null;
    });
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[api/command-center/displays/[id] PATCH]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  try {
    const deleted = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<{ id: string }>(
        `DELETE FROM display_endpoints WHERE id = $1::uuid RETURNING id`,
        [id],
      );
      return res.rows[0] ?? null;
    });
    if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[api/command-center/displays/[id] DELETE]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
