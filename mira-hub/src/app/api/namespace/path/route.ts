import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const PATH_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_DEPTH = 10;

const VALID_KINDS = new Set([
  "site", "plant", "area", "line", "production_line",
  "asset", "component", "component_template", "document", "system", "namespace",
]);

function deslugify(slug: string): string {
  return slug.replace(/_+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * POST /api/namespace/path
 *
 * Ignition-style "create by path" — mkdir -p semantics.
 * Missing ancestors are auto-created as namespace-kind nodes.
 * Idempotent: an existing path returns the existing node (HTTP 200).
 *
 * Body:
 *   { path: "chicago.warehouse.line1.motor_a", kind?: "asset", name?: "Motor A" }
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: { path?: string; kind?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const path = body.path?.trim();
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 422 });
  }
  if (path.length > 256) {
    return NextResponse.json({ error: "path too long (max 256 chars)" }, { status: 422 });
  }
  if (!PATH_RE.test(path)) {
    return NextResponse.json(
      { error: "path must be lowercase dot-separated segments using a-z, 0-9, underscore only" },
      { status: 422 },
    );
  }

  const segments = path.split(".");
  if (segments.length > MAX_DEPTH) {
    return NextResponse.json(
      { error: `path too deep (max ${MAX_DEPTH} levels)` },
      { status: 422 },
    );
  }

  const leafKind = body.kind?.trim() || "asset";
  if (!VALID_KINDS.has(leafKind)) {
    return NextResponse.json(
      { error: `invalid kind '${leafKind}'; must be one of ${[...VALID_KINDS].join(", ")}` },
      { status: 422 },
    );
  }

  const leafName = body.name?.trim() || deslugify(segments[segments.length - 1]);

  try {
    const leaf = await withTenantContext(ctx.tenantId, async (c) => {
      type NodeRow = { id: string; name: string; entity_type: string };

      let leafResult: { id: string; name: string; kind: string; existed: boolean } | null = null;

      for (let i = 0; i < segments.length; i++) {
        const segPath = segments.slice(0, i + 1).join(".");
        const isLeaf = i === segments.length - 1;
        const segKind = isLeaf ? leafKind : "namespace";
        const segName = isLeaf ? leafName : deslugify(segments[i]);

        // Check if anything already exists at this uns_path (path is the primary lookup key).
        const existsRes = await c.query<NodeRow>(
          `SELECT id, name, entity_type
           FROM kg_entities
           WHERE tenant_id = $1 AND uns_path = $2::ltree
           LIMIT 1`,
          [ctx.tenantId, segPath],
        );

        if (existsRes.rows.length > 0) {
          const r = existsRes.rows[0];
          if (isLeaf) {
            leafResult = { id: r.id, name: r.name, kind: r.entity_type, existed: true };
          }
          continue;
        }

        // Insert. On concurrent INSERT race, fall back to SELECT.
        let nodeId: string;
        try {
          const ins = await c.query<{ id: string }>(
            `INSERT INTO kg_entities (entity_type, name, uns_path, tenant_id)
             VALUES ($1, $2, $3::ltree, $4::uuid)
             RETURNING id`,
            [segKind, segName, segPath, ctx.tenantId],
          );
          nodeId = ins.rows[0].id;
        } catch {
          const retry = await c.query<{ id: string }>(
            `SELECT id FROM kg_entities
             WHERE tenant_id = $1 AND uns_path = $2::ltree
             LIMIT 1`,
            [ctx.tenantId, segPath],
          );
          if (!retry.rows[0]) throw new Error(`Failed to create node at path: ${segPath}`);
          nodeId = retry.rows[0].id;
        }

        if (isLeaf) {
          leafResult = { id: nodeId, name: segName, kind: segKind, existed: false };

          await c.query(
            `INSERT INTO namespace_versions
                (tenant_id, operation, entity_id, entity_kind,
                 from_state, to_state, actor_user_id, actor_kind, reason)
             VALUES ($1, 'create', $2, $3, NULL, $4::jsonb, $5, 'human', 'path-first create')`,
            [
              ctx.tenantId,
              nodeId,
              leafKind,
              JSON.stringify({ uns_path: path, name: leafName }),
              ctx.userId,
            ],
          );
        }
      }

      return leafResult;
    });

    if (!leaf) {
      return NextResponse.json({ error: "Create failed" }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, created: !leaf.existed, node: { id: leaf.id, name: leaf.name, kind: leaf.kind, unsPath: path } },
      { status: leaf.existed ? 200 : 201 },
    );
  } catch (err) {
    console.error("[api/namespace/path POST]", err);
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }
}
