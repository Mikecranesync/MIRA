import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

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
  kind: string;
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
            (
              (SELECT COUNT(*) FROM namespace_direct_uploads ndu WHERE ndu.node_id = e.id AND ndu.tenant_id = e.tenant_id) +
              (SELECT COUNT(*) FROM uploads u WHERE u.namespace_node_id = e.id AND u.tenant_id = e.tenant_id)
            )::text AS files_count,
            eq.status AS equipment_status
         FROM kg_entities e
         LEFT JOIN cmms_equipment eq
           ON e.entity_id IS NOT NULL
           AND e.entity_id ~ '^[0-9a-f-]{36}$'
           AND eq.entity_id = e.entity_id::uuid
           AND eq.tenant_id = e.tenant_id
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

    const tree = buildTree(result.entities, result.proposals);
    return NextResponse.json({ tree, total: result.entities.length });
  } catch (err) {
    console.error("[api/namespace/tree GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function buildTree(
  entities: KgEntityRow[],
  proposalCounts: ProposalCountRow[],
): NamespaceNode[] {
  const proposalsByPath = new Map<string, { pending: number; verified: number }>();
  for (const row of proposalCounts) {
    const path = row.uns_path ?? "";
    const slot = proposalsByPath.get(path) ?? { pending: 0, verified: 0 };
    const cnt = Number(row.cnt) || 0;
    if (row.status === "proposed") slot.pending += cnt;
    if (row.status === "verified") slot.verified += cnt;
    proposalsByPath.set(path, slot);
  }

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
