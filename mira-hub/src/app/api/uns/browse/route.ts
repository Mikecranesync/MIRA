import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/uns/browse?path=enterprise.unassigned
 *
 * Returns the immediate children of a UNS path — one ltree level deep.
 * The Hub UNS browser uses this to render an expandable tree.
 *
 * Query params:
 *   path  (optional) — ltree path to browse. Defaults to `enterprise`.
 *
 * Response shape:
 *   {
 *     path: "enterprise.unassigned",
 *     children: [
 *       { label: "allen_bradley", uns_path: "...", entity_count: 12, entity_types: ["equipment"] },
 *       ...
 *     ]
 *   }
 *
 * Spec: docs/specs/uns-kg-unification-spec.md §4.5
 */

const VALID_PATH = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const rawPath = (url.searchParams.get("path") ?? "enterprise").trim();

  if (!VALID_PATH.test(rawPath)) {
    return NextResponse.json(
      { error: "Invalid path; must match [a-z0-9_]+(.[a-z0-9_]+)*" },
      { status: 400 },
    );
  }

  // Depth of the queried path (0-indexed segments). Children live at
  // depth+1, so we use the ltree query operator `~` with `*{depth+1}`.
  const depth = rawPath.split(".").length;
  const childMatch = `${rawPath}.*{1}`;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `WITH descendants AS (
             SELECT uns_path,
                    entity_type,
                    id
               FROM kg_entities
              WHERE tenant_id = $1
                AND uns_path ~ $2::lquery
           )
           SELECT
             subpath(uns_path, 0, $3 + 1)        AS child_path,
             ltree2text(subpath(uns_path, $3, 1)) AS label,
             COUNT(*)                             AS entity_count,
             array_agg(DISTINCT entity_type)      AS entity_types
           FROM descendants
           GROUP BY child_path, label
           ORDER BY label ASC`,
          [ctx.tenantId, childMatch, depth],
        )
        .then((r) => r.rows),
    );

    return NextResponse.json({
      path: rawPath,
      children: rows.map((r: Record<string, unknown>) => ({
        label: String(r.label),
        uns_path: String(r.child_path),
        entity_count: Number(r.entity_count),
        entity_types: (r.entity_types as string[] | null) ?? [],
      })),
    });
  } catch (err) {
    console.error("[api/uns/browse]", err);
    // Most likely failure mode: ltree extension not installed yet.
    // Surface a 503 rather than a generic 500 so the Hub UI can show
    // a "UNS not yet available" empty state.
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("ltree")) {
      return NextResponse.json(
        { error: "UNS layer not yet provisioned (ltree extension missing)" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Browse failed" }, { status: 500 });
  }
}
