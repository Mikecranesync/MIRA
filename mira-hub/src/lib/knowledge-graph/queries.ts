import { withTenantContext } from "@/lib/tenant-context";
import type { KGEntity, KGRelationship, KGTriple } from "./types";

function rowToEntity(row: Record<string, unknown>): KGEntity {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    name: row.name as string,
    properties: (row.properties as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToRelationship(row: Record<string, unknown>): KGRelationship {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    relationshipType: row.relationship_type as string,
    properties: (row.properties as Record<string, unknown>) ?? {},
    confidence: row.confidence as number,
    sourceConversationId: (row.source_conversation_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export async function upsertEntity(
  tenantId: string,
  entity: Pick<KGEntity, "entityType" | "entityId" | "name" | "properties">,
): Promise<KGEntity> {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
         name       = EXCLUDED.name,
         properties = kg_entities.properties || EXCLUDED.properties,
         updated_at = now()
       RETURNING *`,
      [tenantId, entity.entityType, entity.entityId, entity.name, JSON.stringify(entity.properties ?? {})],
    );
    return rowToEntity(rows[0] as Record<string, unknown>);
  });
}

export async function createRelationship(
  tenantId: string,
  rel: Pick<KGRelationship, "sourceId" | "targetId" | "relationshipType" | "confidence" | "sourceConversationId" | "properties">,
): Promise<KGRelationship> {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO kg_relationships
         (tenant_id, source_id, target_id, relationship_type, properties, confidence, source_conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        rel.sourceId,
        rel.targetId,
        rel.relationshipType,
        JSON.stringify(rel.properties ?? {}),
        rel.confidence ?? 1.0,
        rel.sourceConversationId ?? null,
      ],
    );
    return rowToRelationship(rows[0] as Record<string, unknown>);
  });
}

export async function logTriple(
  tenantId: string,
  triple: Pick<KGTriple, "conversationId" | "subject" | "predicate" | "object" | "confidence" | "source">,
): Promise<KGTriple> {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO kg_triples_log
         (tenant_id, conversation_id, subject, predicate, object, confidence, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        triple.conversationId ?? null,
        triple.subject,
        triple.predicate,
        triple.object,
        triple.confidence ?? 1.0,
        triple.source,
      ],
    );
    const row = rows[0] as Record<string, unknown>;
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      conversationId: (row.conversation_id as string | null) ?? null,
      subject: row.subject as string,
      predicate: row.predicate as string,
      object: row.object as string,
      confidence: row.confidence as number,
      source: row.source as string,
      extractedAt: new Date(row.extracted_at as string),
    };
  });
}

export interface TraversalNode {
  entity: KGEntity;
  depth: number;
  path: string[];
}

export async function traverseGraph(
  tenantId: string,
  startEntityId: string,
  maxDepth = 2,
): Promise<TraversalNode[]> {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `WITH RECURSIVE graph(id, tenant_id, entity_type, entity_id, name, properties, created_at, updated_at, depth, path) AS (
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, 0, ARRAY[e.id::text]
         FROM kg_entities e
         WHERE e.id = $1 AND e.tenant_id = $2
         UNION ALL
         SELECT e.id, e.tenant_id, e.entity_type, e.entity_id, e.name, e.properties,
                e.created_at, e.updated_at, g.depth + 1, g.path || e.id::text
         FROM graph g
         JOIN kg_relationships r ON r.source_id = g.id AND r.tenant_id = g.tenant_id
         JOIN kg_entities e ON e.id = r.target_id AND e.tenant_id = g.tenant_id
         WHERE g.depth < $3
           AND NOT (e.id::text = ANY(g.path))
       )
       SELECT DISTINCT ON (id) * FROM graph ORDER BY id, depth`,
      [startEntityId, tenantId, maxDepth],
    );
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        entity: rowToEntity(r),
        depth: r.depth as number,
        path: r.path as string[],
      };
    });
  });
}

export interface EntityContext {
  entity: KGEntity;
  outgoing: KGRelationship[];
  incoming: KGRelationship[];
  recentTriples: KGTriple[];
}

export async function getEntityContext(
  tenantId: string,
  entityId: string,
): Promise<EntityContext | null> {
  return withTenantContext(tenantId, async (client) => {
    const { rows: entityRows } = await client.query(
      `SELECT * FROM kg_entities WHERE id = $1 AND tenant_id = $2`,
      [entityId, tenantId],
    );
    if (entityRows.length === 0) return null;

    const entity = rowToEntity(entityRows[0] as Record<string, unknown>);

    const { rows: outRows } = await client.query(
      `SELECT * FROM kg_relationships WHERE source_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [entityId, tenantId],
    );
    const { rows: inRows } = await client.query(
      `SELECT * FROM kg_relationships WHERE target_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [entityId, tenantId],
    );
    const { rows: tripleRows } = await client.query(
      `SELECT * FROM kg_triples_log
       WHERE tenant_id = $1
         AND (subject = $2 OR object = $2)
       ORDER BY extracted_at DESC LIMIT 20`,
      [tenantId, entity.name],
    );

    return {
      entity,
      outgoing: outRows.map((r) => rowToRelationship(r as Record<string, unknown>)),
      incoming: inRows.map((r) => rowToRelationship(r as Record<string, unknown>)),
      recentTriples: tripleRows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.id as string,
          tenantId: row.tenant_id as string,
          conversationId: (row.conversation_id as string | null) ?? null,
          subject: row.subject as string,
          predicate: row.predicate as string,
          object: row.object as string,
          confidence: row.confidence as number,
          source: row.source as string,
          extractedAt: new Date(row.extracted_at as string),
        };
      }),
    };
  });
}
