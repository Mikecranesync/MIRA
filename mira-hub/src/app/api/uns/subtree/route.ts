import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/uns/subtree?path=enterprise.unassigned&max_depth=3
 *
 * Returns every entity under a UNS path, up to `max_depth` levels deep
 * (default 3, capped at 5 per spec §4.5). Use sparingly — for deep trees
 * prefer paginated `/api/uns/browse` lookups.
 *
 * Spec: docs/specs/uns-kg-unification-spec.md §4.5
 */

const VALID_PATH = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_ALLOWED_DEPTH = 5;

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const rawPath = (url.searchParams.get("path") ?? "enterprise").trim();
  const maxDepthRaw = Number(url.searchParams.get("max_depth") ?? "3");
  const maxDepth = Math.max(1, Math.min(MAX_ALLOWED_DEPTH, maxDepthRaw || 3));

  if (!VALID_PATH.test(rawPath)) {
    return NextResponse.json(
      { error: "Invalid path; must match [a-z0-9_]+(.[a-z0-9_]+)*" },
      { status: 400 },
    );
  }

  const rootDepth = rawPath.split(".").length;
  const maxSegments = rootDepth + maxDepth;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT id,
                  entity_type,
                  name,
                  uns_path::text AS uns_path,
                  nlevel(uns_path) AS depth,
                  properties,
                  created_at
             FROM kg_entities
            WHERE tenant_id = $1
              AND (uns_path = $2::ltree OR uns_path <@ $2::ltree)
              AND nlevel(uns_path) <= $3
            ORDER BY uns_path ASC`,
          [ctx.tenantId, rawPath, maxSegments],
        )
        .then((r) => r.rows),
    );

    return NextResponse.json({
      path: rawPath,
      max_depth: maxDepth,
      total: rows.length,
      entities: rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        entity_type: String(r.entity_type),
        name: String(r.name),
        uns_path: String(r.uns_path),
        depth: Number(r.depth),
        properties: r.properties ?? {},
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error("[api/uns/subtree]", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("ltree")) {
      return NextResponse.json(
        { error: "UNS layer not yet provisioned (ltree extension missing)" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Subtree query failed" }, { status: 500 });
  }
}
