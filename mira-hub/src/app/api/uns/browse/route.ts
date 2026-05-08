import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  expectsDynamicChildren,
  getNodeDescription,
  getSkeletonChildren,
} from "@/lib/uns/skeleton";

export const dynamic = "force-dynamic";

/**
 * GET /api/uns/browse?path=enterprise.knowledge_base
 *
 * Returns the immediate children of a UNS path — one ltree level deep.
 * The Hub UNS browser uses this to render an expandable tree.
 *
 * The response merges TWO sources of children:
 *   1. The static SKELETON (literal ISA-95 / kb / operations type
 *      markers), so empty branches still show structure.
 *   2. Dynamic instance labels found in `kg_entities` for the tenant.
 *
 * Each child is tagged `kind: "literal" | "dynamic" | "both"` so the
 * Hub UI can distinguish a type-marker placeholder ("site") from an
 * actual data node ("orlando_plant") from a marker that has data
 * directly under it.
 *
 * Query params:
 *   path  (optional) — ltree path to browse. Defaults to `enterprise`.
 *
 * Spec: docs/specs/uns-kg-unification-spec.md §4.5 (broadened 2026-05-08)
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

  // Skeleton lookup happens regardless of DB state — empty branches
  // still need to render their literal sub-markers.
  const { literalChildren } = getSkeletonChildren(rawPath);
  const description = getNodeDescription(rawPath);
  const dynamicExpected = expectsDynamicChildren(rawPath);

  const depth = rawPath.split(".").length;
  const childMatch = `${rawPath}.*{1}`;

  type DbChild = {
    label: string;
    uns_path: string;
    entity_count: number;
    entity_types: string[];
  };

  let dbChildren: DbChild[] = [];
  let dbAvailable = true;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `WITH descendants AS (
             SELECT uns_path, entity_type, id
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
    dbChildren = rows.map((r: Record<string, unknown>) => ({
      label: String(r.label),
      uns_path: String(r.child_path),
      entity_count: Number(r.entity_count),
      entity_types: (r.entity_types as string[] | null) ?? [],
    }));
  } catch (err) {
    console.error("[api/uns/browse] DB query failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("ltree")) {
      // ltree extension not yet provisioned — degrade to skeleton-only.
      dbAvailable = false;
    } else {
      return NextResponse.json({ error: "Browse failed" }, { status: 500 });
    }
  }

  // Merge skeleton + DB. Literal markers are returned even when no
  // entities live under them (Mike: "Most branches will be empty/
  // theoretical — that's intentional"). Dynamic labels from the DB
  // come through as-is. If a literal marker also has data underneath,
  // it shows up in both lists — we collapse to a single entry tagged
  // `kind: "both"`.
  const dbByLabel = new Map(dbChildren.map((c) => [c.label, c]));
  const merged: Array<{
    label: string;
    uns_path: string;
    kind: "literal" | "dynamic" | "both";
    description: string;
    entity_count: number;
    entity_types: string[];
  }> = [];
  const seen = new Set<string>();

  for (const lit of literalChildren) {
    seen.add(lit.label);
    const dbHit = dbByLabel.get(lit.label);
    merged.push({
      label: lit.label,
      uns_path: dbHit ? dbHit.uns_path : `${rawPath}.${lit.label}`,
      kind: dbHit ? "both" : "literal",
      description: lit.description,
      entity_count: dbHit?.entity_count ?? 0,
      entity_types: dbHit?.entity_types ?? [],
    });
  }

  for (const child of dbChildren) {
    if (seen.has(child.label)) continue;
    merged.push({
      label: child.label,
      uns_path: child.uns_path,
      kind: "dynamic",
      description: "",
      entity_count: child.entity_count,
      entity_types: child.entity_types,
    });
  }

  merged.sort((a, b) => {
    // Keep literal markers first so the type-skeleton reads top-down.
    const aLit = a.kind === "literal" ? 0 : a.kind === "both" ? 1 : 2;
    const bLit = b.kind === "literal" ? 0 : b.kind === "both" ? 1 : 2;
    if (aLit !== bLit) return aLit - bLit;
    return a.label.localeCompare(b.label);
  });

  return NextResponse.json({
    path: rawPath,
    description,
    accepts_dynamic_children: dynamicExpected,
    db_available: dbAvailable,
    children: merged,
  });
}
