// Per-tenant "Inbox" node for un-addressed blind uploads (#1806).
//
// The blind upload doors (/api/uploads/local, /api/uploads/folder) have a PDF
// buffer but no target namespace node. To make those uploads citable in chat —
// instead of landing OW-KB-only and never reaching knowledge_entries — they are
// routed through the SAME v2 writer (writePdfChunksForNode) into a well-known
// per-tenant "Inbox" node. The Inbox node is a plain kg_entities row at
// uns_path='inbox'; no schema/migration is required.
//
// Resolution is idempotent: the first blind upload per tenant creates the node,
// every subsequent one reuses it. A concurrent create race is caught and
// resolved by re-selecting.

import { withTenantContext } from "@/lib/tenant-context";

/** ltree label for the per-tenant Inbox node. Not in RESERVED_LABELS, lowercase,
 *  matches the slug grammar [a-z0-9_]+. */
export const INBOX_UNS_PATH = "inbox";

export interface InboxNode {
  nodeId: string;
  unsPath: string;
}

/**
 * Resolve (or idempotently create) the per-tenant Inbox node. Returns its
 * kg_entities id + uns_path. Runs inside the tenant RLS context so the row is
 * owned by the tenant, exactly like a user-created node.
 */
export async function resolveOrCreateInboxNode(tenantId: string): Promise<InboxNode> {
  return withTenantContext(tenantId, async (c) => {
    const existing = await c.query<{ id: string }>(
      `SELECT id::text AS id
         FROM kg_entities
        WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
        LIMIT 1`,
      [tenantId, INBOX_UNS_PATH],
    );
    if (existing.rows[0]) {
      return { nodeId: existing.rows[0].id, unsPath: INBOX_UNS_PATH };
    }

    try {
      const inserted = await c.query<{ id: string }>(
        `INSERT INTO kg_entities (entity_type, name, uns_path, tenant_id)
         VALUES ('area', 'Inbox', $2::ltree, $1::uuid)
         RETURNING id::text AS id`,
        [tenantId, INBOX_UNS_PATH],
      );
      return { nodeId: inserted.rows[0].id, unsPath: INBOX_UNS_PATH };
    } catch (err) {
      // A concurrent blind upload may have created it between SELECT and INSERT.
      // Re-select before giving up.
      const raced = await c.query<{ id: string }>(
        `SELECT id::text AS id
           FROM kg_entities
          WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
          LIMIT 1`,
        [tenantId, INBOX_UNS_PATH],
      );
      if (raced.rows[0]) {
        return { nodeId: raced.rows[0].id, unsPath: INBOX_UNS_PATH };
      }
      throw err;
    }
  });
}
