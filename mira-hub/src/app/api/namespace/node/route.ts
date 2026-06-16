import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { slugify } from "@/lib/uns";

export const dynamic = "force-dynamic";

const ENTITY_TYPES = new Set([
  "site", "plant", "area", "line", "production_line",
  "asset", "component", "component_template", "document", "system",
]);

// Structural labels that may not be used as user-created node names.
const RESERVED_LABELS = new Set([
  "enterprise", "knowledge_base", "site", "area", "equipment",
  "fault_codes", "manuals", "parts", "schedules",
]);

interface KgEntityRow {
  id: string;
  entity_type: string;
  name: string;
  uns_path: string | null;
}

/** Compute the ltree uns_path for a new node.
 *  Root nodes (no parent) are anchored under 'enterprise' per UNS spec.
 *  Fixes the regression introduced by #1983: the tree filter excludes any path
 *  not rooted at 'enterprise', so un-rooted root nodes were invisible after create. */
export function buildNodeUnsPath(parentPath: string | null, slug: string): string {
  return parentPath ? `${parentPath}.${slug}` : `enterprise.${slug}`;
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: { parentId?: string; name?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name || name.length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 422 });
  }
  if (name.length > 128) {
    return NextResponse.json({ error: "name too long (max 128)" }, { status: 422 });
  }

  const kind = (body.kind?.trim() || "area");
  if (!ENTITY_TYPES.has(kind)) {
    return NextResponse.json(
      { error: `invalid kind '${kind}'; must be one of ${[...ENTITY_TYPES].join(", ")}` },
      { status: 422 },
    );
  }

  const slug = slugify(name);
  if (!slug) {
    return NextResponse.json({ error: "name produces empty slug" }, { status: 422 });
  }
  if (RESERVED_LABELS.has(slug)) {
    return NextResponse.json(
      { error: `'${slug}' is a reserved label and cannot be used as a node name` },
      { status: 422 },
    );
  }

  const parentId = body.parentId?.trim() || null;
  if (parentId && !/^[0-9a-f-]{36}$/i.test(parentId)) {
    return NextResponse.json({ error: "invalid parentId" }, { status: 400 });
  }

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      let parentPath: string | null = null;

      if (parentId) {
        const parentRes = await c.query<KgEntityRow>(
          `SELECT id, uns_path::text AS uns_path
           FROM kg_entities
           WHERE id = $1 AND tenant_id = $2`,
          [parentId, ctx.tenantId],
        );
        if (parentRes.rows.length === 0) {
          return { kind: "parent_not_found" as const };
        }
        parentPath = parentRes.rows[0].uns_path;
      }

      const unsPath = buildNodeUnsPath(parentPath, slug);

      const insertRes = await c.query<{ id: string }>(
        `INSERT INTO kg_entities (entity_type, name, uns_path, tenant_id)
         VALUES ($1, $2, $3::ltree, $4::uuid)
         RETURNING id`,
        [kind, name, unsPath, ctx.tenantId],
      );
      const newId = insertRes.rows[0].id;

      await c.query(
        `INSERT INTO namespace_versions
            (tenant_id, operation, entity_id, entity_kind,
             from_state, to_state, actor_user_id, actor_kind, reason)
         VALUES ($1, 'create', $2, $3, NULL, $4::jsonb, $5, 'human', 'user created node')`,
        [
          ctx.tenantId,
          newId,
          kind,
          JSON.stringify({ uns_path: unsPath, name }),
          ctx.userId,
        ],
      );

      return { kind: "ok" as const, node: { id: newId, name, kind, unsPath } };
    });

    if (result.kind === "parent_not_found") {
      return NextResponse.json({ error: "parentId not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, node: result.node }, { status: 201 });
  } catch (err) {
    console.error("[api/namespace/node POST]", err);
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }
}
