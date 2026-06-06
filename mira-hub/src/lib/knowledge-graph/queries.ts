import { withTenantContext } from "@/lib/tenant-context";
import { upsertInferredProposal } from "./proposals-writer";
import type { KGEntity, KGRelationship, KGTriple } from "./types";

function rowToEntity(row: Record<string, unknown>): KGEntity {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    name: row.name as string,
    properties: (row.properties as Record<string, unknown>) ?? {},
    unsPath: (row.uns_path as string | null) ?? null,
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

export interface SchematicEntityInput {
  entity_type: string;
  entity_id: string;
  name: string;
  properties?: Record<string, unknown>;
}

export interface SchematicRelationshipInput {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  properties?: Record<string, unknown>;
}

export interface SchematicUpsertPayload {
  schematic_type?: string;
  parent_equipment_id?: string | null;
  entities: SchematicEntityInput[];
  relationships: SchematicRelationshipInput[];
}

export interface SchematicUpsertResult {
  entities_upserted: number;
  /** Kept for API back-compat. Schematic edges are now proposed, not verified — always 0. See relationships_proposed. */
  relationships_inserted: number;
  /** Number of inferred relationship_proposals created (pending human review). */
  relationships_proposed: number;
  parent_equipment_id: string | null;
  schematic_type: string;
}

/**
 * Bulk-upsert the entities produced by the schematic intelligence pipeline
 * (mira-mcp/schematic_intelligence.py), and PROPOSE its relationships.
 *
 * Per the Iron Rule (.claude/skills/managing-the-knowledge-graph, ADR-0017),
 * a schematic-extracted edge is INFERRED by MIRA — it is never written
 * straight to kg_relationships as a verified fact. Each edge lands as a
 * `relationship_proposals` row (via upsertInferredProposal) for human review;
 * the verified edge is written only on admin approval (proposals/[id]/decide).
 * Entity upserts are unchanged (nodes), and proposal writes are idempotent.
 */
export async function upsertSchematicComponents(
  tenantId: string,
  payload: SchematicUpsertPayload,
): Promise<SchematicUpsertResult> {
  return withTenantContext(tenantId, async (client) => {
    const idByEntityId = new Map<string, string>();
    const typeByEntityId = new Map<string, string>();
    let entitiesUpserted = 0;

    for (const ent of payload.entities) {
      const properties = {
        ...(ent.properties ?? {}),
        ...(payload.parent_equipment_id
          ? { parent_equipment_id: payload.parent_equipment_id }
          : {}),
        ...(payload.schematic_type ? { schematic_type: payload.schematic_type } : {}),
      };
      const { rows } = await client.query(
        `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
           name       = EXCLUDED.name,
           properties = kg_entities.properties || EXCLUDED.properties,
           updated_at = now()
         RETURNING id`,
        [tenantId, ent.entity_type, ent.entity_id, ent.name, JSON.stringify(properties)],
      );
      const internalId = (rows[0] as Record<string, unknown>).id as string;
      idByEntityId.set(ent.entity_id, internalId);
      typeByEntityId.set(ent.entity_id, ent.entity_type);
      entitiesUpserted++;
    }

    const schematicLabel = payload.schematic_type ?? "schematic";
    let relationshipsProposed = 0;
    for (const rel of payload.relationships) {
      const sourceInternalId = idByEntityId.get(rel.source_entity_id);
      const targetInternalId = idByEntityId.get(rel.target_entity_id);
      if (!sourceInternalId || !targetInternalId) continue;

      const rawConfidence = Number((rel.properties as Record<string, unknown>)?.confidence);
      const confidence =
        Number.isFinite(rawConfidence) && rawConfidence > 0 && rawConfidence <= 1
          ? rawConfidence
          : 0.8;

      const proposalId = await upsertInferredProposal(client, tenantId, {
        sourceEntityId: sourceInternalId,
        sourceEntityType: typeByEntityId.get(rel.source_entity_id) ?? "entity",
        targetEntityId: targetInternalId,
        targetEntityType: typeByEntityId.get(rel.target_entity_id) ?? "entity",
        relationshipType: rel.relationship_type,
        confidence,
        reasoning: `Inferred from ${schematicLabel} (schematic intelligence pipeline).`,
        evidence: [
          {
            evidenceType: "document_page",
            sourceDescription: `${schematicLabel} schematic`,
            confidenceContribution: confidence,
          },
        ],
      });
      if (proposalId) relationshipsProposed++;
    }

    return {
      entities_upserted: entitiesUpserted,
      relationships_inserted: 0,
      relationships_proposed: relationshipsProposed,
      parent_equipment_id: payload.parent_equipment_id ?? null,
      schematic_type: payload.schematic_type ?? "unknown",
    };
  });
}
