import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Namespace tree — read-only for Phase 2 slice 1.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Namespace tree"
 * Plan: docs/plans/2026-05-15-maintenance-namespace-builder.md §"Phase 2"
 *
 * Reads kg_entities for the current tenant, orders rows by uns_path (ltree),
 * and builds a tree keyed on the dot-separated path. Counts pending /
 * verified proposals per node (left-join on relationship_proposals).
 *
 * Mutation endpoints (PUT for drag-drop move, PATCH for rename) land in
 * Phase 2 slice 2 — they need the kg_approval_state migration (engine
 * lineage, docs/migrations/008_kg_approval_state.sql) that hasn't shipped.
 */

interface KgEntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  uns_path: string | null;
  created_at: string;
  files_count: string;
  equipment_status: string | null;
}

interface ProposalCountRow {
  uns_path: string | null;
  status: string;
  cnt: string;
}

export interface NamespaceNode {
  id: string;
  name: string;
  kind: string; // entity_type — 'site', 'area', 'line', 'asset', 'component', 'document', ...
                // or 'namespace' for a synthesized path segment that has no kg_entities row.
  unsPath: string | null;
  filesCount: number;
  status: string | null;
  counts: {
    children: number;
    proposalsPending: number;
    proposalsVerified: number;
  };
  children: NamespaceNode[];
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const entitiesRes = await c.query<KgEntityRow>(
        `SELECT
            e.id,
            e.entity_type,
            e.entity_id,
            e.name,
            e.uns_path::text AS uns_path,
            e.created_at,
            (SELECT COUNT(*) FROM namespace_direct_uploads ndu
             WHERE ndu.node_id = e.id AND ndu.tenant_id = e.tenant_id)::text AS files_count,
            NULL AS equipment_status
         FROM kg_entities e
         WHERE e.tenant_id = $1::uuid
         ORDER BY e.uns_path::text NULLS LAST, e.name`,
        [ctx.tenantId],
      );

      const proposalsRes = await c.query<ProposalCountRow>(
        `SELECT
            COALESCE(e.uns_path::text, '') AS uns_path,
            p.status,
            COUNT(*)::text AS cnt
         FROM relationship_proposals p
         LEFT JOIN kg_entities e ON e.id = p.source_entity_id
         WHERE p.tenant_id = $1::uuid
         GROUP BY e.uns_path::text, p.status`,
        [ctx.tenantId],
      );

      return { entities: entitiesRes.rows, proposals: proposalsRes.rows };
    });

    // #1900: a PDF uploaded via Knowledge / a folder is chunked into
    // knowledge_entries and attached to its node (hub_uploads.kg_entity_id) — it
    // is NOT a namespace_direct_uploads row, so files_count above counts 0 and the
    // node looks empty even though the manual is citable. Fold in the v2-attached
    // upload count. hub_uploads is an app-pool table with no RLS, so query it on
    // the owner pool (not the tenant RLS context); a failure here must never break
    // the tree, so it degrades to the direct-upload count alone.
    try {
      const { rows } = await pool.query<{ kg_entity_id: string; n: string }>(
        `SELECT kg_entity_id, COUNT(*)::text AS n
           FROM hub_uploads
          WHERE tenant_id = $1
            AND kg_entity_id IS NOT NULL
            AND status = 'parsed'
            AND kind = 'document'
          GROUP BY kg_entity_id`,
        [ctx.tenantId],
      );
      const v2Counts = new Map(rows.map((r) => [r.kg_entity_id, Number(r.n) || 0]));
      for (const e of result.entities) {
        const extra = v2Counts.get(e.id);
        if (extra) e.files_count = String((Number(e.files_count) || 0) + extra);
      }
    } catch (err) {
      console.warn("[api/namespace/tree] v2 upload count skipped", err);
    }

    const nodes = buildTree(result.entities, result.proposals);
    return NextResponse.json({ nodes, total: result.entities.length });
  } catch (err) {
    console.error("[api/namespace/tree GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export function buildTree(
  entities: KgEntityRow[],
  proposalCounts: ProposalCountRow[],
): NamespaceNode[] {
  // Index proposal counts by uns_path so we can attach without a per-node loop.
  const proposalsByPath = new Map<string, { pending: number; verified: number }>();
  for (const row of proposalCounts) {
    const path = row.uns_path ?? "";
    const slot = proposalsByPath.get(path) ?? { pending: 0, verified: 0 };
    const cnt = Number(row.cnt) || 0;
    if (row.status === "proposed") slot.pending += cnt;
    if (row.status === "verified") slot.verified += cnt;
    proposalsByPath.set(path, slot);
  }

  // Map every entity to a node, then wire children by uns_path prefix.
  const nodesByPath = new Map<string, NamespaceNode>();
  const roots: NamespaceNode[] = [];

  for (const e of entities) {
    const proposalSlot = proposalsByPath.get(e.uns_path ?? "") ?? { pending: 0, verified: 0 };
    const node: NamespaceNode = {
      id: e.id,
      name: e.name,
      kind: e.entity_type,
      unsPath: e.uns_path,
      filesCount: Number(e.files_count) || 0,
      status: e.equipment_status ?? null,
      counts: {
        children: 0,
        proposalsPending: proposalSlot.pending,
        proposalsVerified: proposalSlot.verified,
      },
      children: [],
    };
    nodesByPath.set(e.uns_path ?? `__orphan__:${e.id}`, node);
  }

  // Synthesize parent nodes for any ancestor path that lacks a kg_entities row.
  // Without this, a manual at `enterprise.knowledge_base.siemens.sinamics.manuals`
  // with no row at `enterprise.knowledge_base.siemens` would render as a top-level
  // root instead of nesting under "Siemens". See #1344.
  for (const e of entities) {
    if (!e.uns_path) continue;
    let cursor = parentOf(e.uns_path);
    while (cursor) {
      if (!nodesByPath.has(cursor)) {
        nodesByPath.set(cursor, synthesizeParent(cursor));
      }
      cursor = parentOf(cursor);
    }
  }

  for (const node of nodesByPath.values()) {
    if (!node.unsPath || node.unsPath.length === 0) {
      roots.push(node);
      continue;
    }
    const parentPath = parentOf(node.unsPath);
    const parent = parentPath ? nodesByPath.get(parentPath) : null;
    if (parent) {
      parent.children.push(node);
      parent.counts.children += 1;
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function parentOf(path: string): string | null {
  const i = path.lastIndexOf(".");
  if (i < 0) return null;
  return path.slice(0, i);
}

function synthesizeParent(path: string): NamespaceNode {
  const lastSegment = path.slice(path.lastIndexOf(".") + 1);
  // Display: replace underscores with spaces, title-case each word.
  const display = lastSegment
    .split("_")
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
  return {
    id: `synthetic:${path}`,
    name: display || lastSegment,
    kind: "namespace",
    unsPath: path,
    filesCount: 0,
    status: null,
    counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 },
    children: [],
  };
}
