import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { getCMMSDeepLink } from "@/lib/cmms/deep-link";
import type { DeepLinkKind } from "@/lib/cmms/provider";

export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<DeepLinkKind>(["work_order", "asset", "pm"]);

/**
 * GET /api/cmms/deep-link?kind=work_order&id=<uuid>
 *
 * Joins `id` against the appropriate table to fetch its `atlas_id` (the
 * external CMMS ID), then resolves the tenant's provider config to build
 * the deep-link URL.
 *
 * Spec: docs/specs/cmms-deep-link-multi-provider-spec.md §4.4
 */
export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = req.nextUrl;
  const kind = searchParams.get("kind") as DeepLinkKind | null;
  const id = searchParams.get("id");

  if (!kind || !VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: "kind must be one of: work_order, asset, pm" },
      { status: 400 },
    );
  }
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  try {
    const externalId = await fetchAtlasId(ctx.tenantId, kind, id);
    const result = await getCMMSDeepLink(ctx.tenantId, kind, externalId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/cmms/deep-link GET]", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}

/**
 * Map (kind, internal_uuid) → atlas_id by reading the appropriate table.
 * Returns null when the row is missing or atlas_id is unpopulated (the
 * sync worker hasn't pushed yet — UI renders "syncing" state).
 */
async function fetchAtlasId(
  tenantId: string,
  kind: DeepLinkKind,
  id: string,
): Promise<string | null> {
  const table = TABLE_FOR_KIND[kind];

  return withTenantContext<string | null>(tenantId, async (c) => {
    const result = await c.query<{ atlas_id: string | null }>(
      `SELECT atlas_id FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    const row = result.rows[0];
    return row?.atlas_id ?? null;
  });
}

// Hardcoded table allowlist — never derived from user input. Adding a new
// kind requires both an entry here and a column-presence check in the
// migration history.
const TABLE_FOR_KIND: Record<DeepLinkKind, string> = {
  work_order: "work_orders",
  asset:      "cmms_equipment",
  pm:         "pm_schedules",
};
