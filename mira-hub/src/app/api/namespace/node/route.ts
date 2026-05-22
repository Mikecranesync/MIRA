import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Create a child namespace node under an existing parent.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Namespace tree"
 * Goal: docs/superpowers/specs/2026-05-21-namespace-tree-inline-create-goal-prompt.md
 *
 * POST /api/namespace/node
 *   Body: { "parentId": uuid, "kind": string, "name": string, "uploadId"?: uuid }
 *
 * 1. SELECT the parent FOR UPDATE inside withTenantContext.
 * 2. Slugify the name; compute new uns_path = parent.uns_path + '.' + slug.
 * 3. INSERT kg_entities (tenant, type, name, uns_path).
 * 4. INSERT namespace_versions with operation='create'.
 * 5. (Optional) UPDATE hub_uploads SET uns_path = new path WHERE id = uploadId.
 *
 * All steps run in one transaction. Any failure rolls back.
 */

const ALLOWED_KINDS = new Set([
  "site",
  "plant",
  "area",
  "line",
  "production_line",
  "work_cell",
  "equipment",
  "asset",
  "component",
  "component_template",
  "document",
  "namespace",
]);

const KIND_LIMIT = 64;
const NAME_LIMIT = 200;

interface KgEntityRow {
  id: string;
  entity_type: string;
  name: string;
  uns_path: string | null;
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: { parentId?: string; kind?: string; name?: string; uploadId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parentId = body.parentId?.trim();
  const rawKind = body.kind?.trim().toLowerCase();
  const name = body.name?.trim();
  const uploadId = body.uploadId?.trim();

  if (!parentId || !/^[0-9a-f-]{36}$/i.test(parentId)) {
    return NextResponse.json({ error: "parentId required (uuid)" }, { status: 400 });
  }
  if (!rawKind || rawKind.length === 0 || rawKind.length > KIND_LIMIT) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }
  // Either an allowed kind, or a custom one matching slug shape so it can
  // still appear in the ltree-validated uns_path namespace.
  const kindIsAllowed = ALLOWED_KINDS.has(rawKind);
  const kindIsCustom = /^[a-z][a-z0-9_]{0,62}$/.test(rawKind);
  if (!kindIsAllowed && !kindIsCustom) {
    return NextResponse.json({ error: "kind invalid" }, { status: 400 });
  }
  if (!name || name.length === 0) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (name.length > NAME_LIMIT) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }
  if (uploadId && !/^[0-9a-f-]{36}$/i.test(uploadId)) {
    return NextResponse.json({ error: "uploadId invalid" }, { status: 400 });
  }

  const slug = slugify(name);
  if (slug.length === 0 || slug === "_") {
    return NextResponse.json({ error: "name produces empty slug" }, { status: 400 });
  }

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const parentRes = await c.query<KgEntityRow>(
        `SELECT id, entity_type, name, uns_path::text AS uns_path
           FROM kg_entities
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [parentId, ctx.tenantId],
      );
      if (parentRes.rows.length === 0) {
        return { kind: "parent_not_found" as const };
      }
      const parent = parentRes.rows[0];

      const newPath = parent.uns_path ? `${parent.uns_path}.${slug}` : slug;

      // Pre-check for path collision (sibling with same slug under same
      // parent). The kg_entities unique constraint (tenant, entity_type,
      // name) also catches collisions across the tree — we surface a
      // friendly error here for the common case.
      const collisionRes = await c.query<{ id: string; name: string }>(
        `SELECT id, name FROM kg_entities
          WHERE tenant_id = $1 AND uns_path = $2::ltree`,
        [ctx.tenantId, newPath],
      );
      if (collisionRes.rows.length > 0) {
        return {
          kind: "duplicate" as const,
          existing: collisionRes.rows[0].name,
        };
      }

      let inserted: KgEntityRow;
      try {
        const insertRes = await c.query<KgEntityRow>(
          `INSERT INTO kg_entities (tenant_id, entity_type, name, uns_path)
           VALUES ($1, $2, $3, $4::ltree)
           RETURNING id, entity_type, name, uns_path::text AS uns_path`,
          [ctx.tenantId, rawKind, name, newPath],
        );
        inserted = insertRes.rows[0];
      } catch (e) {
        // Unique-violation (tenant, entity_type, name) — broader than path
        // collision but the same friendly message applies.
        if (isUniqueViolation(e)) {
          return { kind: "duplicate" as const, existing: name };
        }
        throw e;
      }

      await c.query(
        `INSERT INTO namespace_versions
           (tenant_id, operation, entity_id, entity_kind,
            from_state, to_state,
            actor_user_id, actor_kind, reason)
         VALUES ($1, 'create', $2, $3, NULL, $4::jsonb, $5, 'human', $6)`,
        [
          ctx.tenantId,
          inserted.id,
          inserted.entity_type,
          JSON.stringify({ uns_path: newPath, name }),
          ctx.userId,
          `inline-create under ${parent.name}`,
        ],
      );

      // Optional: bind a prior upload's uns_path to the new node.
      if (uploadId) {
        await c.query(
          `UPDATE hub_uploads
              SET uns_path = $1,
                  updated_at = now()
            WHERE id = $2 AND tenant_id = $3`,
          [newPath, uploadId, ctx.tenantId],
        );
      }

      return {
        kind: "ok" as const,
        node: {
          id: inserted.id,
          name: inserted.name,
          unsPath: newPath,
          entityType: inserted.entity_type,
          parentId,
        },
      };
    });

    if (result.kind === "parent_not_found") {
      return NextResponse.json({ error: "parent not found" }, { status: 404 });
    }
    if (result.kind === "duplicate") {
      return NextResponse.json(
        {
          error: "duplicate_name",
          message: `A subsystem named "${result.existing}" already exists here.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, ...result.node }, { status: 201 });
  } catch (err) {
    console.error("[api/namespace/node POST]", err);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "_";
}
