# Knowledge Graph Flow

**One-line:** Entity/relationship creation → proposals → evidence → admin approval → verified graph → agent traversal tools.

**Cross-links:**
- `CONTEXT.md` — glossary discipline (AISuggestion vs RelationshipProposal; forbidden phrases)
- `.claude/CLAUDE.md` § "Knowledge graph proposals" — auto-verify is a bug
- `docs/adr/0017*` — ADR-0017: status transitions
- `mira-hub/db/migrations/001_knowledge_graph.sql` — live schema (authoritative)
- `mira-hub/db/migrations/018_relationship_proposals.sql` — `relationship_proposals` + `relationship_evidence`
- `mira-hub/db/migrations/027_ai_suggestions.sql` — `ai_suggestions` (the Hub-facing work queue)
- `mira-hub/db/migrations/029_kg_approval_state.sql` — `approval_state` column on `kg_entities`/`kg_relationships`
- `docs/workflows/connector-import-flow.md` — how connector-originated proposals enter this flow

---

## Summary

The knowledge graph is MIRA's structured memory of the plant: entities (equipment, locations, tags, fault codes, manuals) and typed relationships between them. Every new entity or edge starts as a **proposed** row. Human review (admin or technician) is the only path to **verified**. Once verified, the MCP traversal tools in `mira-mcp/server.py` can traverse, context-build, and reason over the graph.

**Glossary discipline (from `CONTEXT.md`, enforced by `.claude/CLAUDE.md`):**
- **`AISuggestion`** = a row in `ai_suggestions` (mig 027). This is what `/proposals` renders and what "N proposals pending" counts. Has six `suggestion_type` values: `kg_edge`, `kg_entity`, `tag_mapping`, `component_profile`, `uns_confirmation`, `namespace_move`.
- **`RelationshipProposal`** = a row in `relationship_proposals` (mig 018) + 1..N `relationship_evidence` rows. Backs an `AISuggestion` of type `kg_edge` only. Never read directly by user-facing surfaces.
- `proposed` is a STATUS ADJECTIVE on `kg_entities.approval_state` / `kg_relationships.approval_state`, not a noun. Say "an `AISuggestion` of type `kg_entity`", not "a proposed entity".
- **FORBIDDEN PHRASE:** "the proposal table". Always name `ai_suggestions` or `relationship_proposals` explicitly.

**Live schema vs. aspirational docs:**
`docs/migrations/004_kg_entities.sql` and `005_kg_relationships.sql` are PLANNED/aspirational (per memory `project_canonical_asset_graph_docs`). The LIVE schema is in `mira-hub/db/migrations/`. The `docs/migrations/` files describe a future unified schema that has not landed in prod. When in doubt, check `mira-hub/db/migrations/001_knowledge_graph.sql`.

---

## The Flow

### Step 1 — Entity creation path (ingest pipeline)

**Primary path:** `mira-crawler/ingest/kg_writer.py`
**Functions:** `upsert_entity()`, `upsert_relationship()`, `register_equipment_and_manual()`, `register_fault_code()`

Called from:
- `mira-crawler/tasks/full_ingest_pipeline.py` — Celery task after chunking + embedding
- `mira-crawler/ingest/store.py` — after chunk storage
- Admin tooling and backfill scripts

`upsert_entity(tenant_id, entity_type, name, uns_path, properties, source_chunk_id)`:
1. Validates `uns_path` via `ingest/uns.py:is_valid_path()` — rejects invalid paths with a warning, returns `None` without writing
2. Normalizes manufacturer via `ingest/manufacturer_normalize.py:normalize_manufacturer()` (canonicalizes OCR variants like "Allen-Bradly" → "Allen-Bradley")
3. Runs `INSERT INTO kg_entities ... ON CONFLICT (tenant_id, entity_type, name) DO UPDATE SET properties = COALESCE(existing, '{}') || EXCLUDED.properties RETURNING id`
4. Returns the entity UUID string, or `None` on failure

**Table:** `kg_entities` (`mira-hub/db/migrations/001_knowledge_graph.sql:3`)

Live columns:
```
id UUID PK, tenant_id UUID, entity_type TEXT, entity_id TEXT,
name TEXT, properties JSONB, created_at, updated_at
UNIQUE(tenant_id, entity_type, entity_id)   -- mig 001
```
Migration 025 (`025_kg_entities_natural_key.sql`) and 026 (`026_kg_entities_dedupe_and_constraint.sql`) altered the unique constraint. Check those migrations for the exact live constraint.

**Note:** `kg_writer.py` writes to `kg_entities` with `approval_state` not set (that column is added by mig 029). The UNIQUE constraint used by `kg_writer.py` is `(tenant_id, entity_type, name)` as established by mig 025/026.

### Step 2 — Relationship creation path (ingest pipeline)

**File:** `mira-crawler/ingest/kg_writer.py`
**Function:** `upsert_relationship(tenant_id, source_entity, target_entity, relation_type, confidence, properties, source_chunk_id)`

Runs:
```sql
INSERT INTO kg_relationships
    (tenant_id, source_id, target_id, relationship_type, properties, confidence, source_chunk_id)
VALUES ...
ON CONFLICT (tenant_id, source_id, target_id, relationship_type)
DO UPDATE SET confidence = GREATEST(kg_relationships.confidence, EXCLUDED.confidence)
RETURNING id
```

**Table:** `kg_relationships` (`mira-hub/db/migrations/001_knowledge_graph.sql:15`)

Live columns:
```
id UUID PK, tenant_id UUID,
source_id UUID FK → kg_entities(id),
target_id UUID FK → kg_entities(id),
relationship_type TEXT,
properties JSONB, confidence FLOAT, source_conversation_id UUID, created_at
CONSTRAINT no_self_loop CHECK (source_id != target_id)
```

**Critical:** Column names are `source_id`/`target_id`/`relationship_type`. The names `source_entity`/`target_entity`/`relation_type` in `docs/migrations/006_kg_bridge.sql` NEVER landed in prod (ADR-0013 follow-up; documented in `kg_writer.py:13`). PR #1443 fixed callers that used wrong column names.

### Step 3 — Proposal path (connector / inference worker)

When a connector or inference worker proposes a new entity or edge (rather than directly upserting from a verified manual), the flow goes through the proposal layer:

**Entity proposals** (`mira-connectors/mira_connectors/confirmation_gate.py`):
- `gate.propose()` inserts an `ai_suggestions` row with `suggestion_type='kg_entity'`, `status='pending'`
- `extracted_data.uns_path` holds the CANDIDATE path (not canonicalized yet)
- `proposed_by = "import:<provider>"`

**Relationship proposals** (`mira-connectors/mira_connectors/confirmation_gate.py`):
- `gate.propose()` inserts a `relationship_proposals` row with `status='proposed'` + 1..N `relationship_evidence` rows
- Then wraps with an `ai_suggestions` row with `suggestion_type='kg_edge'`, `status='pending'`
- `extracted_data.relationship_proposal_id` links the `AISuggestion` to its `RelationshipProposal`

**Inference worker** ⚠️ UNVERIFIED: The exact inference worker that computes KG proposals from conversation context was not read in this session. Check `mira-bots/shared/` for a KG proposal writer called from engine turns.

### Step 4 — Evidence recording

**Table:** `relationship_evidence` (`mira-hub/db/migrations/018_relationship_proposals.sql:70`)

Every `relationship_proposals` row should have 1..N evidence rows:
```
id UUID PK, proposal_id UUID FK → relationship_proposals(id),
evidence_type TEXT CHECK (... 'document_page', 'plc_rung', 'tag_list', 'work_order',
    'technician_note', 'live_data', 'manifest', 'oem_kb', 'human_observation'),
source_id UUID, source_description TEXT, page_or_location TEXT, excerpt TEXT,
confidence_contribution FLOAT CHECK (-1.0 ≤ x ≤ 1.0)
```

The ingest pipeline adds evidence via the kg_writer. The gate adds a `human_observation` evidence row when a technician confirms (`gate._confirm_edge()`), recording their confirmation as `confidence_contribution = 0.4`.

### Step 5 — Hub /proposals page (N proposals pending)

**What the UI reads:** `ai_suggestions` table with `status='pending'` for the tenant.

"N proposals pending" count = `SELECT count(*) FROM ai_suggestions WHERE tenant_id=? AND status='pending'`.

The `/proposals` page renders all six `suggestion_type` values. For `kg_edge` suggestions, it additionally fetches the linked `relationship_proposals` row via `extracted_data.relationship_proposal_id` to show source/target/type/evidence.

**Hub API route:** `mira-hub/src/app/api/proposals/[id]/decide/route.ts` — handles accept/reject/defer decisions. The listing route is `mira-hub/src/app/api/proposals/route.ts`. All Hub API routes must call `withTenantContext()` (from `mira-hub/src/lib/tenant-context.ts`) before any DB query or they bypass RLS.

### Step 6 — Admin approval (proposed → verified)

**Gate method:** `ConnectorConfirmationGate.confirm(tenant_id, suggestion_id, *, reviewed_by, note)` (`mira-connectors/mira_connectors/confirmation_gate.py:293`)

**Hub API route equivalent:** mirrors the Hub `POST /api/proposals/[id]/decide` route (`mira-connectors/mira_connectors/confirmation_gate.py:25` documents this).

**Transition helpers:** ADR-0017 specifies `mira-hub/lib/proposal-transition.ts` and `mira_bots/shared/proposal_transition.py`. Per `confirmation_gate.py:36`, these DO NOT EXIST YET. The gate's transitions are local. When they land, `PostgresProposalStore` must delegate status writes to those helpers. A direct `UPDATE … SET status = …` without going through the helper will be a bug at that point.

For `kg_entity` confirmation:
1. Calls `_materialize_entity()` → `store.create_entity()` → upserts `kg_entities` row with `approval_state='verified'`
2. Updates `ai_suggestions.status = 'accepted'`, sets `reviewed_by`, `reviewed_at`, `review_note`

For `kg_edge` confirmation:
1. Resolves `relationship_proposal_id` (or creates one if endpoints were unresolved at propose time)
2. Updates `relationship_proposals.status = 'verified'`
3. Inserts `relationship_evidence` row of type `human_observation`
4. Calls `store.upsert_relationship()` → upserts `kg_relationships` with `approval_state='verified'`
5. Updates `ai_suggestions.status = 'accepted'`

**INVARIANT:** Auto-promoting `proposed → verified` without an explicit human `confirm()` call is a bug. No code path may set `kg_relationships.approval_state = 'verified'` or `relationship_proposals.status = 'verified'` via raw `UPDATE` without going through the gate or the future transition helper.

### Step 7 — Agent traversal (MCP tools)

**File:** `mira-mcp/server.py`

KG traversal functions available to the diagnostic engine:

| Function | Line (approx) | What it does |
|----------|---------------|--------------|
| `kg_maintenance_context(tenant_id, entity_id)` | `server.py:625` | Returns entity + direct relationships for context building |
| `kg_impact_analysis(tenant_id, entity_id)` | `server.py:665` | Finds what else would be affected if this entity fails |
| `kg_root_cause_chain(tenant_id, fault_entity_id)` | `server.py:679` | Walks `CAUSES`/`OCCURS_ON` edges to find root cause |
| `kg_traverse_chain(tenant_id, start_id, ...)` | `server.py:693` | Generic multi-hop traversal |
| `kg_flag_pm_mismatches(tenant_id, ...)` | `server.py:723` | Finds PM schedule gaps vs. installed components |
| `mira_browse_namespace(tenant_id, uns_path, limit)` | `server.py:748` | Browse the UNS tree at a given path |
| `mira_get_equipment(tenant_id, ...)` | `server.py:777` | Fetch equipment entity + linked manuals + fault codes |
| `kg_extract_schematic(tenant_id, ...)` | `server.py:812` | Build a schematic view of wiring relationships |

All traversal tools read `kg_entities` and `kg_relationships` via NeonDB with `withTenantContext()`-equivalent tenant scoping.

---

## ASCII Flow Diagram

```
INGEST PATH (direct, verified source):
  OEM Manual / PDF → mira-crawler ingest pipeline
       |
       v
  kg_writer.upsert_entity()                    [kg_writer.py:79]
  kg_writer.upsert_relationship()              [kg_writer.py:145]
  (validates uns_path via uns.is_valid_path)
       |
       v
  kg_entities (INSERT ON CONFLICT DO UPDATE)   [mig 001]
  kg_relationships (INSERT ON CONFLICT ...)    [mig 001]

PROPOSAL PATH (connector / inference worker):
  External system / LLM inference
       |
       v
  gate.propose(entities, relationships)        [confirmation_gate.py:113]
       |
       |---> ai_suggestions (status=pending)   [mig 027]
       |       suggestion_type=kg_entity OR kg_edge
       |
       |---> relationship_proposals (status=proposed)  [mig 018]
       |---> relationship_evidence (1..N rows)         [mig 018]
       |
       v
  Hub /proposals page
  (reads ai_suggestions WHERE status='pending')
       |
  Admin / Technician reviews
       |
       +-- reject  --> ai_suggestions(rejected)
       |              relationship_proposals(rejected)
       |
       +-- correct --> original(superseded) + new suggestion + immediate confirm
       |
       +-- confirm --> ai_suggestions(accepted)             [mig 027]
                       relationship_proposals(verified)     [mig 018]
                       relationship_evidence(human_obs)     [mig 018]
                       kg_entities (upsert, approved)       [mig 001]
                       kg_relationships (upsert, approved)  [mig 001]
                       |
                       v
              VERIFIED GRAPH

TRAVERSAL:
  Diagnostic engine / Engine FSM
       |
       v
  mira-mcp/server.py — kg_* functions
       |
  NeonDB kg_entities + kg_relationships (verified rows)
```

---

## Tables Touched

| Table | DB | Migration | When |
|-------|----|-----------|------|
| `kg_entities` | NeonDB | `mira-hub/db/migrations/001_knowledge_graph.sql` | Direct ingest (step 1) + confirmed proposals (step 6) |
| `kg_relationships` | NeonDB | `mira-hub/db/migrations/001_knowledge_graph.sql` | Direct ingest (step 2) + confirmed edges (step 6) |
| `ai_suggestions` | NeonDB | `mira-hub/db/migrations/027_ai_suggestions.sql` | Proposal creation (step 3), status updates (steps 5–6) |
| `relationship_proposals` | NeonDB | `mira-hub/db/migrations/018_relationship_proposals.sql` | Edge proposal creation (step 3), status on confirm/reject (step 6) |
| `relationship_evidence` | NeonDB | `mira-hub/db/migrations/018_relationship_proposals.sql` | Evidence rows at proposal time + `human_observation` on confirm |
| `knowledge_entries` | NeonDB | `docs/migrations/001_knowledge_entries.sql` | Source chunks linked to entities via `equipment_entity_id` |

---

## What Can Go Wrong

### 1. Auto-verify bug
Any code that sets `kg_relationships.approval_state = 'verified'` or `relationship_proposals.status = 'verified'` via a direct `UPDATE` without going through `gate.confirm()` or the future `proposal_transition` helper is a **bug**. This contaminates the verified set with unreviewed data. The `mira-run-hallucination-audit` command checks for such paths.

### 2. Wrong column names (historical: PR #1443)
`docs/migrations/006_kg_bridge.sql` defined `source_entity`/`target_entity`/`relation_type` but these never landed in prod. Prod uses `source_id`/`target_id`/`relationship_type`. Code that uses the aspirational names will silently write nothing (column-not-found error). Use `mira-hub/db/migrations/001_knowledge_graph.sql` as ground truth.

### 3. Direct `UPDATE` bypassing the transition helper
Once `mira-hub/lib/proposal-transition.ts` and `mira_bots/shared/proposal_transition.py` exist (ADR-0017, Phase 3), all status transitions on `ai_suggestions`, `relationship_proposals`, `kg_entities.approval_state`, and `kg_relationships.approval_state` MUST go through those helpers. A raw `UPDATE … SET status = …` will be a bug from that point forward. Check `confirmation_gate.py:36` for current status of those helpers.

### 4. `docs/migrations/` vs. Hub migrations confusion
`docs/migrations/004_kg_entities.sql` and `005_kg_relationships.sql` are ASPIRATIONAL — they describe a planned unified schema. `apply-migrations.yml` only runs `mira-hub/db/migrations/` files. Any migration in `docs/migrations/` has NOT been applied to prod unless explicitly confirmed. Always verify against `mira-hub/db/migrations/`.

### 5. Invalid UNS path rejected silently
`kg_writer.upsert_entity()` calls `is_valid_path(uns_path)` and returns `None` (no write) if the path is invalid. Callers that don't check the return value will silently lose the entity. All UNS paths must be built via `mira-crawler/ingest/uns.py` builders — never hand-formatted.

### 6. Conflicting proposals not resolved
When two connectors propose conflicting `uns_path` values for the same physical device (same serial number), the gate's `_mark_conflicts()` flags them but does NOT auto-reject either. They remain in `ai_suggestions` with `status='pending'` until a human resolves them. If a human confirms one without seeing the conflict badge, the graph gets a duplicate.

### 7. `relationship_proposals` status vocabulary is different from `ai_suggestions` status vocabulary
`relationship_proposals.status` CHECK: `proposed`, `reviewed`, `verified`, `rejected`, `deprecated`, `contradicted`
`ai_suggestions.status` CHECK (from `mira-hub/db/migrations/027_ai_suggestions.sql`): `pending`, `accepted`, `rejected`, `deferred`, `superseded`
- `deferred` = "ask me later" — surfaces in the Hub UI as a separate "deferred" tab; the suggestion still exists and can be revisited
- `superseded` = a newer suggestion contradicts this one; this one is closed
Writing `"pending"` to `relationship_proposals.status` or `"proposed"` to `ai_suggestions.status` will fail the CHECK constraint.
