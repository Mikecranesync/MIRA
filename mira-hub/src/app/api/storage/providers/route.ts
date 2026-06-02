import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import type { StorageProviderKind } from "@/lib/storage/types";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set<StorageProviderKind>([
  "google_drive",
  "sharepoint",
  "dropbox",
]);

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, provider, root_path, display_name,
                last_synced_at, sync_status, sync_error, file_count, created_at
           FROM connected_storage_providers
          WHERE tenant_id = $1
          ORDER BY created_at`,
        [ctx.tenantId],
      );
      return rows;
    });
    return NextResponse.json({ providers: rows });
  } catch (err) {
    console.error("[api/storage/providers GET]", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: { provider?: string; rootPath?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = body.provider as StorageProviderKind;
  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${[...VALID_PROVIDERS].join(", ")}` },
      { status: 422 },
    );
  }

  const displayName = body.displayName?.trim();
  if (!displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 422 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO connected_storage_providers
           (tenant_id, provider, root_path, display_name, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, provider) DO UPDATE SET
           root_path    = EXCLUDED.root_path,
           display_name = EXCLUDED.display_name
         RETURNING id, provider, root_path, display_name, sync_status, file_count`,
        [ctx.tenantId, provider, body.rootPath ?? null, displayName, ctx.userId],
      );
      return rows[0];
    });
    return NextResponse.json({ provider: row }, { status: 201 });
  } catch (err) {
    console.error("[api/storage/providers POST]", err);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}
