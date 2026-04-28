export interface KGEntity {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  name: string;
  properties: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface KGRelationship {
  id: string;
  tenantId: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  properties: Record<string, unknown>;
  confidence: number;
  sourceConversationId: string | null;
  createdAt: Date;
}

export interface KGTriple {
  id: string;
  tenantId: string;
  conversationId: string | null;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  extractedAt: Date;
}
