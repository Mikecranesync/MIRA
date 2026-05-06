# Knowledge Graph Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
A tenant-scoped graph of entities (equipment, components, fault codes, procedures, specifications) and the relationships between them, plus an append-only **triples log** that captures every (subject, predicate, object) extracted from a conversation. Powers GraphRAG-style retrieval (hop from "PowerFlex 40" → "DC bus capacitor" → procedure F-201) and structured equipment intelligence in the Hub.

## Scope
**IN scope**
- NeonDB tables `kg_entities`, `kg_relationships`, `kg_triples_log` (created by `mira-hub/db/migrations/001_knowledge_graph.sql`)
- Row-level security policies that enforce `tenant_id`
- Migration 004 in `docs/migrations/` (planned alternate schema with embedding column)
- Hub UI views under `/(hub)/knowledge` and `/(hub)/assets`

**OUT of scope**
- Triple **extraction** at runtime (planned; not yet wired into engine)
- Cross-tenant analytics (Knowledge Cooperative — separate spec)
- Free-text RAG retrieval (`rag-pipeline-spec.md`)

## Architecture

```
Conversation → triple-extractor (LLM JSON mode) → kg_triples_log
                                                       │
                                              upsert kg_entities
                                                       │
                                              link kg_relationships
                                                       │
                                       Hub /(hub)/assets  &  GraphRAG retrieval
```

- **Storage:** NeonDB (Postgres + pgvector); RLS enforced via `app.current_tenant_id` session setting
- **Indexes:** `(tenant_id, entity_type)`, `(tenant_id, entity_id)`, `(source_id)`, `(target_id)`, `(tenant_id, relationship_type)`, `(tenant_id)` on triples
- **Constraint:** `CHECK (source_id != target_id)` — no self-loops in `kg_relationships`

## API Contract

### Schema (canonical — `mira-hub/db/migrations/001_knowledge_graph.sql`)

```sql
kg_entities (
  id UUID PK,
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,        -- 'equipment' | 'component' | 'fault_code' | 'procedure' | 'specification'
  entity_id   TEXT NOT NULL,        -- stable external id (e.g. "PowerFlex 40")
  name        TEXT NOT NULL,
  properties  JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, entity_type, entity_id)
)

kg_relationships (
  id UUID PK,
  tenant_id UUID NOT NULL,
  source_id UUID FK kg_entities ON DELETE CASCADE,
  target_id UUID FK kg_entities ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,  -- 'has_component' | 'fault_of' | 'remedied_by' | ...
  properties JSONB DEFAULT '{}',
  confidence FLOAT DEFAULT 1.0,
  source_conversation_id UUID,
  created_at TIMESTAMPTZ,
  CHECK (source_id <> target_id)
)

kg_triples_log (
  id UUID PK,
  tenant_id UUID NOT NULL,
  conversation_id UUID,
  subject TEXT, predicate TEXT, object TEXT,
  confidence FLOAT, source TEXT,
  extracted_at TIMESTAMPTZ
)
```

### Planned schema variant (migration 004)
`docs/migrations/004_kg_entities.sql` adds an `embedding vector(768)` column on entities and replaces `entity_id`-based unique key with `(tenant_id, entity_type, name)` plus a `source_chunk_id` FK to `knowledge_entries.id`. Migrate once Phase 3C section-level metadata exists.

### Read paths
- Hub `/api/assets/{id}` joins `kg_entities` + `kg_relationships(has_component)` to render the asset's component tree.
- Engine retrieval (planned): hop from a query-resolved equipment entity to its connected fault codes and procedures, append to the RAG context window with a `kg:` source label.

## Configuration
| Var | Purpose |
|---|---|
| `NEON_DATABASE_URL` | DB |
| `MIRA_TENANT_ID` | Set on every connection via `SET app.current_tenant_id = …` |

No service-level env vars beyond shared NeonDB config.

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Migration applied (RLS on) | yes (#791) | maintain |
| Self-loop check | enforced via CHECK | maintain |
| Triple extractor unit tests | none | ≥ 10 (precision/recall) |
| Entity dedup precision | unmeasured | ≥ 95 % at ingest |
| Hop latency (Hub asset view) | unmeasured | ≤ 200 ms |
| Cross-tenant leakage | must be 0 | RLS regression test required |

## Acceptance Criteria
1. **RLS enforced:** A query without `app.current_tenant_id` set returns zero rows; with the wrong tenant returns zero rows.
2. **Self-loop rejected:** Inserting a row with `source_id = target_id` fails with the CHECK constraint.
3. **Cascade delete:** Deleting an entity removes all relationships referencing it.
4. **Idempotent upsert:** Re-extracting the same triple does not create a duplicate `kg_entities` row.
5. **Triple log append-only:** No update or delete path on `kg_triples_log`; ingest only appends.
6. **Hub view:** `/(hub)/assets/{id}` renders the component tree using only `kg_*` tables (no orphans).
7. **Schema migration safety:** Running migration 001 on a fresh DB and again is a no-op (`CREATE TABLE IF NOT EXISTS`).

## Known Issues
- Triple extractor at runtime is **not yet wired into the engine** — the schema exists and the Hub UI consumes it, but extraction is currently manual / via crawler tasks.
- Two parallel schema flavors exist (Hub `001_knowledge_graph.sql` vs. `docs/migrations/004_kg_entities.sql`) — pick one before GraphRAG launch.
- `kg_triples_log` has no retention policy; growth is unbounded.

## Change Log
- 2026-04 — Schema landed in mira-hub migrations (#791). RLS enabled.
- 2026-04 — Migration 004 drafted for embedding-aware variant; not yet applied.
