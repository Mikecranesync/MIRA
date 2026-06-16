BEGIN;

CREATE TABLE IF NOT EXISTS kg_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS kg_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  confidence FLOAT DEFAULT 1.0,
  source_conversation_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT no_self_loop CHECK (source_id != target_id)
);

CREATE TABLE IF NOT EXISTS kg_triples_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  conversation_id UUID,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  source TEXT NOT NULL,
  extracted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kg_ent_tenant_type ON kg_entities(tenant_id, entity_type);
CREATE INDEX idx_kg_ent_tenant_id ON kg_entities(tenant_id, entity_id);
CREATE INDEX idx_kg_rel_source ON kg_relationships(source_id);
CREATE INDEX idx_kg_rel_target ON kg_relationships(target_id);
CREATE INDEX idx_kg_rel_type ON kg_relationships(tenant_id, relationship_type);
CREATE INDEX idx_kg_triples_tenant ON kg_triples_log(tenant_id);
CREATE INDEX idx_kg_triples_conv ON kg_triples_log(conversation_id);

ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_triples_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY kg_entities_tenant ON kg_entities
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY kg_relationships_tenant ON kg_relationships
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY kg_triples_log_tenant ON kg_triples_log
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Issue: #791
COMMIT;
