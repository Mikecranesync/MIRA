import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Move or rename a namespace node.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Namespace tree"
 *
 * PUT /api/namespace/node/:id
 *   Body: { "newParentId"?: string, "newName"?: string, "reason"?: string }
 *
 * Update path:
 *   1. SELECT the target entity FOR UPDATE.
 *   2. Resolve new uns_path: parent.uns_path + slug(newName) (or current name).
 *   3. UPDATE kg_entities (name, uns_path).
 *   4. INSERT into namespace_versions with the before/after JSONB snapshot.
 *
 * Both updates run inside the same `withTenantContext` transaction so a
 * failure rolls back the audit row alongside the move.
 */

interface KgEntityRow {
  id: string;
  entity_type: string;
  name: string;
  uns_path: string | null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { newParentId?: string; newName?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const newParentId = body.newParentId?.trim();
  const newName = body.newName?.trim();
  const reason = (body.reason ?? "").slice(0, 1000);

  if (!newParentId && !newName) {
    return NextResponse.json(
      { error: "either newParentId or newName must be provided" },
      { status: 400 },
    );
  }
  if (newParentId && !/^[0-9a-f-]{36}$/i.test(newParentId)) {
    return NextResponse.json({ error: "invalid newParentId" }, { status: 400 });
  }

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const targetRes = await c.query<KgEntityRow>(
        `SELECT id, entity_type, name, uns_path::text AS uns_path
         FROM kg_entities
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [id, ctx.tenantId],
      );
      if (targetRes.rows.length === 0) {
        return { kind: "not_found" as const };
      }
      const target = targetRes.rows[0];

      let parentPath: string | null = parentOf(target.uns_path);
      let parentRow: KgEntityRow | null = null;

      if (newParentId) {
        const parentRes = await c.query<KgEntityRow>(
          `SELECT id, entity_type, name, uns_path::text AS uns_path
           FROM kg_entities
           WHERE id = $1 AND tenant_id = $2`,
          [newParentId, ctx.tenantId],
        );
        if (parentRes.rows.length === 0) {
          return { kind: "parent_not_found" as const };
        }
        parentRow = parentRes.rows[0];

        if (parentRow.id === target.id) {
          return { kind: "self_parent" as const };
        }
        if (
          parentRow.uns_path &&
          target.uns_path &&
          (parentRow.uns_path === target.uns_path ||
            parentRow.uns_path.startsWith(target.uns_path + "."))
        ) {
          return { kind: "descendant_parent" as const };
        }
        parentPath = parentRow.uns_path ?? null;
      }

      const finalName = newName && newName.length > 0 ? newName : target.name;
      const slug = slugify(finalName);
      const newPath = parentPath ? `${parentPath}.${slug}` : slug;

      await c.query(
        `UPDATE kg_entities
            SET name = $1,
                uns_path = $2::ltree,
                updated_at = now()
          WHERE id = $3`,
        [finalName, newPath, id],
      );

      // Cascade-update descendant uns_paths when the parent path changes.
      if (target.uns_path && newPath !== target.uns_path) {
        await c.query(
          `UPDATE kg_entities
              SET uns_path = ($2 || subpath(uns_path, nlevel($1::ltree)))::ltree,
                  updated_at = now()
            WHERE tenant_id = $3 AND uns_path <@ $1::ltree AND id != $4`,
          [target.uns_path, newPath, ctx.tenantId, id],
        );
      }

      const operation =
        newParentId && (newName === undefined || newName === target.name)
          ? "move"
          : newName && !newParentId
            ? "rename"
            : "move";

      await c.query(
        `INSERT INTO namespace_versions
            (tenant_id, operation, entity_id, entity_kind,
             from_state, to_state,
             actor_user_id, actor_kind, reason)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'human', $8)`,
        [
          ctx.tenantId,
          operation,
          id,
          target.entity_type,
          JSON.stringify({ uns_path: target.uns_path, name: target.name }),
          JSON.stringify({ uns_path: newPath, name: finalName }),
          ctx.userId,
          reason,
        ],
      );

      return {
        kind: "ok" as const,
        node: {
          id,
          name: finalName,
          unsPath: newPath,
          kind: target.entity_type,
          previousUnsPath: target.uns_path,
          previousName: target.name,
          operation,
        },
      };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "node not found" }, { status: 404 });
    }
    if (result.kind === "parent_not_found") {
      return NextResponse.json({ error: "newParentId not found" }, { status: 404 });
    }
    if (result.kind === "self_parent") {
      return NextResponse.json({ error: "cannot make a node its own parent" }, { status: 400 });
    }
    if (result.kind === "descendant_parent") {
      return NextResponse.json(
        { error: "cannot move a node under one of its descendants" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, ...result.node });
  } catch (err) {
    console.error("[api/namespace/node/:id PUT]", err);
    return NextResponse.json({ error: "Move failed" }, { status: 500 });
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
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const targetRes = await c.query<KgEntityRow>(
        `SELECT id, entity_type, name, uns_path::text AS uns_path
         FROM kg_entities
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [id, ctx.tenantId],
      );
      if (targetRes.rows.length === 0) {
        return { kind: "not_found" as const };
      }
      const target = targetRes.rows[0];

      // Block delete if any children exist (uns_path prefix match).
      if (target.uns_path) {
        const childRes = await c.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM kg_entities
           WHERE tenant_id = $1 AND id != $2
             AND uns_path::text LIKE $3`,
          [ctx.tenantId, id, `${target.uns_path}.%`],
        );
        if (Number(childRes.rows[0]?.cnt) > 0) {
          return { kind: "has_children" as const };
        }
      }

      // Null out FK references before deleting.
      await c.query(
        `UPDATE namespace_direct_uploads SET node_id = NULL WHERE node_id = $1`,
        [id],
      );

      // Audit tombstone.
      await c.query(
        `INSERT INTO namespace_versions
            (tenant_id, operation, entity_id, entity_kind,
             from_state, to_state, actor_user_id, actor_kind, reason)
         VALUES ($1, 'delete', $2, $3, $4::jsonb, NULL, $5, 'human', 'user deleted node')`,
        [
          ctx.tenantId,
          id,
          target.entity_type,
          JSON.stringify({ uns_path: target.uns_path, name: target.name }),
          ctx.userId,
        ],
      );

      await c.query(
        `DELETE FROM kg_entities WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );

      return { kind: "ok" as const };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "node not found" }, { status: 404 });
    }
    if (result.kind === "has_children") {
      return NextResponse.json(
        { error: "Cannot delete a node that has children" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/namespace/node/:id DELETE]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}

function parentOf(path: string | null): string | null {
  if (!path) return null;
  const i = path.lastIndexOf(".");
  return i < 0 ? null : path.slice(0, i);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "_";
}
