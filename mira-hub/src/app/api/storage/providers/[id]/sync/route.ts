import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { storageSyncJob } from "@/lib/storage/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5-minute timeout for sync operations

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  if (!process.env.INGEST_URL) {
    return NextResponse.json({ error: "INGEST_URL not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Verify ownership before sync
  const owns = await withTenantContext(ctx.tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT id, sync_status FROM connected_storage_providers
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ?? null;
  });

  if (!owns) {
    return NextResponse.json({ error: "provider not found" }, { status: 404 });
  }
  if (owns.sync_status === "syncing") {
    return NextResponse.json({ error: "sync already in progress" }, { status: 409 });
  }

  try {
    const result = await storageSyncJob(id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/storage/providers/:id/sync POST]", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "sync failed" },
      { status: 500 },
    );
  }
}
