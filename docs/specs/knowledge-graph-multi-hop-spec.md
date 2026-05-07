# Knowledge Graph: Multi-Hop Reasoning Upgrade — Spec

**Status:** APPROVED 2026-05-07 — building begins
**Author:** MIRA agent (Charlie node)
**Date:** 2026-05-07
**Owner:** Mike Harper
**Related:** `mira-hub/src/lib/knowledge-graph/`, NeonDB tables `kg_entities`, `kg_relationships`, `kg_triples_log`
**Inspiration (NOT scope):** Threaded Manufacturing's value-stream graph

> **Read this first.** This is a spec, not an implementation. No code is written. No migrations are run. Mike reviews before any branch is cut for code.

---

## 1. Purpose

Today the MIRA knowledge graph is **storage**: it holds entities (49 rows across 4 types) and flat relationships (31 rows). Diagnostic answers still come almost entirely from a single vector search over manuals plus shallow KG context for a single anchor asset.

The goal is to make the KG a **reasoning layer**:

- The AI traverses the graph to follow chains of cause / effect / dependency.
- Diagnostic answers carry **structured facts** ("this bearing was replaced 6 months ago, MTBF is 45d but PM is 90d") alongside unstructured manual chunks.
- Every conversation makes the graph denser without any human curation.
- Operators can ask **multi-hop questions** ("if conveyor 3 dies, what stops?", "what usually causes F004 on a PowerFlex 525?") and get correct, evidence-cited answers.

This is the difference between MIRA being a chatbot with RAG and MIRA being a maintenance reasoning engine.

---

## 2. Scope

### In scope
- New entity types: `plant`, `area`, `line`, `component`, `resolution`, `technician` (some `part`-like types already exist as runtime additions).
- New relationship types: `feeds`, `caused_by`, `resolved_by`, `requires_part`, `located_at`, `maintained_by`, `has_component`, `parent_of` (hierarchical), `has_pm`, `triggered_pm`.
- Hierarchical asset tree (Plant → Area → Line → Equipment → Component) with recursive rollup queries.
- Multi-hop traversal API: `traverseChain`, `impactAnalysis`, `rootCauseChain`, `maintenanceContext`.
- KG-augmented RAG: graph context injected into LLM system prompt **before** vector search runs (extends today's `context-builder.ts`).
- LLM-based relationship extraction (Groq 8b classifier) on top of the existing regex entity extractor.
- Plan-vs-actual comparison: PM intervals as graph properties; failure history as graph triples; query that flags interval mismatches.
- Migration `006_kg_multi_hop.sql` — additive only, no destructive changes.
- Eval gate: 57-fixture suite must not regress; new 5-scenario multi-hop suite must pass.

### Out of scope
- Value-stream mapping, OEE, throughput / capacity analysis (Threaded's domain — not MIRA's).
- Process-engineering simulation, takt-time modeling.
- Replacing the vector store. RAG over manuals stays.
- Cross-tenant graph queries (tenant isolation is preserved as a hard rule).
- Hand-curated ontologies. The graph builds itself from conversations and CMMS imports.

### Explicit non-goals
- We are **not** introducing a graph database (Neo4j, Memgraph). NeonDB Postgres + recursive CTEs is sufficient at our data scale (target: <100k entities per tenant for the next 12 months).
- We are **not** building a query DSL. The traversal API is a small set of fixed shapes.

---

## 3. Current State (verified 2026-05-07)

| Component | Status | Notes |
|---|---|---|
| `kg_entities` | 49 rows, 4 types | `equipment`, `work_order`, `manual`, `fault_code`. Plus runtime types `equipment_tag`, `part` from regex extractor. |
| `kg_relationships` | 31 rows | Types in use: `mentioned_tag`, `exhibited_fault`, `requires_part`, `has_work_order`, `has_pm`, `located_at`. |
| `kg_triples_log` | active | Append-only audit trail; populated by `extractAndStore`. |
| `extractor.ts` | regex-only (#793) | Extracts equipment tags, fault codes, parts, action verbs. No causal links. |
| `queries.ts` | basic | `upsertEntity`, `createRelationship`, `traverseGraph` (recursive CTE, 2-hop default), `getEntityContext`. |
| `context-builder.ts` | shipped (#794) | Already injects formatted KG context into system prompt. **This is the foundation we extend, not replace.** |
| RLS | enabled | All 3 tables have `app.current_tenant_id` policies. |
| Schema flexibility | high | `entity_type` and `relationship_type` are `TEXT` — adding types is data-only, no DDL. |

**Implication:** The schema is already general. Most of the work is in (a) populating new entity / relationship types, (b) adding traversal queries, (c) upgrading extraction from regex to LLM, and (d) adding indexes for hierarchical performance.

---

## 4. Schema Upgrade

### 4.1 Migration `006_kg_multi_hop.sql`

Additive only. No drops, no type changes, no data backfill in the migration itself (backfill is a separate idempotent script).

```sql
BEGIN;

-- Hierarchical traversal performance: composite index on (tenant_id, source_id, relationship_type)
-- targets the common pattern "find all parent_of/feeds/has_component out of node X".
CREATE INDEX IF NOT EXISTS idx_kg_rel_tenant_source_type
  ON kg_relationships(tenant_id, source_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_kg_rel_tenant_target_type
  ON kg_relationships(tenant_id, target_id, relationship_type);

-- Temporal queries on triples (e.g. "faults in last 90 days")
CREATE INDEX IF NOT EXISTS idx_kg_triples_tenant_predicate_time
  ON kg_triples_log(tenant_id, predicate, extracted_at DESC);

-- Optional supporting view: hierarchical asset tree as a materialized rollup.
-- NOT materialized in v1 — start with a regular view, measure, materialize only if needed.
CREATE OR REPLACE VIEW kg_asset_hierarchy AS
  WITH RECURSIVE tree(root_id, descendant_id, depth, path) AS (
    SELECT e.id, e.id, 0, ARRAY[e.id::text]
      FROM kg_entities e
      WHERE e.entity_type IN ('plant','area','line','equipment','component')
    UNION ALL
    SELECT t.root_id, e.id, t.depth + 1, t.path || e.id::text
      FROM tree t
      JOIN kg_relationships r
        ON r.source_id = t.descendant_id
       AND r.relationship_type IN ('parent_of','has_component')
       AND r.tenant_id = (SELECT tenant_id FROM kg_entities WHERE id = t.root_id)
      JOIN kg_entities e ON e.id = r.target_id
      WHERE NOT (e.id::text = ANY(t.path))
        AND t.depth < 10
  )
  SELECT * FROM tree;

COMMIT;
```

**Reversibility:** drop the indexes and view. No data is touched.

### 4.2 New entity types

| Type | Example `entity_id` | Key properties |
|---|---|---|
| `plant` | `STARDUST_RACERS` | `address`, `timezone` |
| `area` | `ZONE_A` | `parent_plant_id` |
| `line` | `LINE_3` | `parent_area_id`, `cycle_time_target` |
| `equipment` (existing) | `VFD-07` | `manufacturer`, `model_number`, `criticality`, `parent_line_id` |
| `component` | `BEARING_NDE_VFD-07` | `position`, `part_number`, `parent_equipment_id` |
| `part` (existing, runtime) | `SKF-6205-2RS` | `manufacturer`, `category`, `cost`, `lead_time_days` |
| `fault_code` (existing) | `F004`, `OC` | `equipment_type_scope`, `severity` |
| `resolution` | `REPLACE_BEARING` | `procedure_ref`, `typical_duration_min` |
| `technician` | `tech_mike` | `skills`, `cert_level` |
| `pm_task` | `PM-VFD-07-90D` | `interval_days`, `task_description`, `last_run`, `next_due` |
| `work_order` (existing) | `WO-2024-0451` | `status`, `opened_at`, `closed_at`, `priority` |
| `manual` (existing) | `manual_powerflex_525` | `oem`, `pages`, `chunk_count` |

**Property convention:** parent IDs stored both as a property (for fast reads when the entity is loaded standalone) AND as a `parent_of` / `has_component` relationship (for traversal). The relationship is authoritative; the property is a denormalized cache that the writer keeps in sync.

### 4.3 New relationship types

| Type | Direction | Meaning | Properties |
|---|---|---|---|
| `parent_of` | parent → child | Hierarchical containment for plant/area/line/equipment | — |
| `has_component` | equipment → component | Component is part of equipment | `position`, `qty` |
| `feeds` | upstream → downstream | Material / process flow (e.g. Conveyor_3 feeds Packer_1) | `direction`, `criticality` |
| `caused_by` | effect → cause | Causal link extracted from diagnostic conversations | `confidence`, `source_conversation_id` |
| `resolved_by` | fault/wo → resolution | The action that resolved a fault | `success`, `duration_min` |
| `requires_part` (existing) | equipment/component → part | Part needed for maintenance | `qty`, `replace_interval_days` |
| `has_pm` (existing) | equipment → pm_task | A PM task is scheduled against this equipment | `created_by`, `last_modified` |
| `triggered_pm` | fault → pm_task | A fault occurrence that should bump a PM frequency | — |
| `located_at` (existing) | equipment → area/line | Physical location | — |
| `maintained_by` | equipment → technician | Primary tech / team owner | `role` |
| `had_fault` | equipment → fault_code | Historical fault occurrence (timestamped) | `occurred_at`, `resolved_at`, `wo_id`, `severity` |
| `similar_to` | equipment → equipment | Cross-plant analogues for the Knowledge Cooperative | `similarity_score`, `derived_from` |

**Note:** `had_fault` is a relationship rather than a triple because it carries enough properties to want indexed queries ("all VFD overcurrent faults in the last 90 days").

### 4.4 Tenant isolation

All new relationships are subject to existing RLS. The `kg_asset_hierarchy` view inherits RLS through `kg_entities` and `kg_relationships`. Cross-tenant `similar_to` relationships are forbidden — the Knowledge Cooperative is implemented via a separate, opt-in shared schema, not by punching holes in RLS.

---

## 5. Multi-Hop Traversal API

Located at `mira-hub/src/lib/knowledge-graph/traversal.ts` (new file). Pure TypeScript over `pg`, uses recursive CTEs.

### 5.1 `traverseChain(tenantId, startEntityId, relationshipChain, maxDepth)`

Follow a specific chain of relationship types. Different from today's `traverseGraph` which follows ALL outgoing edges.

```ts
traverseChain(
  tenantId: string,
  startEntityId: string,
  relationshipChain: string[],   // e.g. ["parent_of", "parent_of", "has_component"]
  maxDepth?: number,
): Promise<TraversalNode[]>
```

Use case: "starting from PLANT_A, follow parent_of → parent_of → has_component to enumerate all components in the plant".

### 5.2 `impactAnalysis(tenantId, entityId)`

Given a piece of equipment that just failed, return all downstream entities affected via `feeds` relationships.

```ts
impactAnalysis(tenantId: string, entityId: string): Promise<{
  downstream: TraversalNode[];   // ordered by hop distance
  blockedLines: string[];        // lines that lose feed entirely
  partialImpact: string[];       // entities with alternate feeds
}>
```

Use case: "Conveyor 3 is down — what else stops?"

### 5.3 `rootCauseChain(tenantId, faultId)`

Walk `caused_by` relationships backward to surface the most likely root cause for a fault.

```ts
rootCauseChain(tenantId: string, faultId: string): Promise<{
  chain: { entity: KGEntity; confidence: number }[];
  alternates: KGEntity[];   // sibling causes seen in past conversations
}>
```

### 5.4 `maintenanceContext(tenantId, equipmentId, opts)`

The single function the diagnostic engine calls before answering a question about a piece of equipment. Aggregates everything we know.

```ts
maintenanceContext(tenantId: string, equipmentId: string, opts?: {
  faultWindow?: number;       // days, default 90
  maxWorkOrders?: number;     // default 5
  includeSimilar?: boolean;   // pull similar_to peers for cross-plant context
}): Promise<{
  equipment: KGEntity;
  hierarchy: { plant: KGEntity; area: KGEntity; line: KGEntity };
  components: KGEntity[];
  recentFaults: { code: string; count: number; lastSeen: Date }[];
  recentWorkOrders: KGEntity[];
  knownParts: KGEntity[];
  manuals: KGEntity[];
  pmSchedule: { task: string; intervalDays: number; lastRun?: Date; nextDue?: Date }[];
  similarEquipment: KGEntity[]; // when includeSimilar
}>
```

This is a **superset** of today's `getEntityContext`. It replaces ad-hoc joins with one structured payload.

### 5.5 Performance budget

| API | Target p95 | Notes |
|---|---|---|
| `traverseChain` | < 80 ms | Recursive CTE, depth-bounded. |
| `impactAnalysis` | < 120 ms | Two recursive CTEs (forward feeds + alt-paths). |
| `rootCauseChain` | < 60 ms | Backward walk on `caused_by`. |
| `maintenanceContext` | < 150 ms | One transaction, parallel sub-queries. |

If we miss budgets we materialize the `kg_asset_hierarchy` view; that's the only optimization permitted in v1.

---

## 6. KG-Augmented RAG

### 6.1 Today

`buildGraphContext()` runs once per chat turn:
1. Regex-extract entities from question.
2. Look up entities in `kg_entities`.
3. For each found entity, fetch outgoing/incoming relationships + recent triples.
4. Format into a single `[GRAPH CONTEXT for X]` block prepended to the system prompt.

This works but it's **single-anchor and shallow**. It doesn't follow chains.

### 6.2 Upgrade

Replace the per-entity fetch with `maintenanceContext` for equipment anchors, and add an explicit **multi-hop expansion step** when the question contains multiple entities or causal language.

```
1. Extract entities from question (existing regex + new LLM pass when ambiguous).
2. Determine query intent (existing classifier — extend with "causal", "impact", "history").
3. For each anchor entity, call maintenanceContext.
4. If intent = "causal":         also call rootCauseChain on any fault_code mentioned.
5. If intent = "impact":         also call impactAnalysis on any equipment mentioned.
6. If 2+ equipment mentioned:    pull shortest path between them via traverseChain.
7. Format into structured GRAPH CONTEXT block.
8. Pass as system prompt to LLM, alongside vector results.
```

The output stays human-readable text in the prompt — we are not switching to function-calling for v1. The LLM sees facts like:

```
[GRAPH CONTEXT for VFD-07]
Hierarchy: Plant Stardust → Area North → Line 3
Components: bearing NDE, bearing DE, motor coupling
Recent faults (90d): F004 ×3, OC ×1 (last: 2026-04-22)
PM schedule: 90d bearing inspection (last: 2026-02-15, next: 2026-05-15)
Plan vs actual: F004 frequency = 30d, PM interval = 90d → INTERVAL TOO LONG
Recent work orders: WO-2024-0451 (closed 2026-04-23, replaced bearing NDE)
Parts on record: SKF-6205-2RS, SKF-6306-2RS
Similar equipment: VFD-12 (Plant Atlanta) — same model, same fault history
```

### 6.3 Eval gate

The 57-fixture eval suite (`tests/eval/`) must run **before and after** the upgrade. Acceptance: composite score does not regress. Stretch: ≥ 5pp improvement on diagnostic-reasoning subset.

---

## 7. Relationship Extraction from Conversations

### 7.1 Today

`extractEntitiesFromText` in `extractor.ts` is regex-only. It captures equipment tags, fault codes, parts, and action verbs. It does **not** capture causal or resolution relationships.

### 7.2 Upgrade — two-pass extraction

**Pass 1 (existing):** regex extraction → entities.

**Pass 2 (new):** LLM relationship classifier on the same conversation chunk. Same pattern as the existing dialogue-act classifier (Groq 8B, fallback to Cerebras then Gemini per the global cascade rule).

Prompt shape (illustrative):

```
You are extracting maintenance relationships. Given the conversation text and
the entities already extracted, return JSON of the form:
{
  "relationships": [
    {"source": "VFD-07", "predicate": "caused_by", "target": "BEARING_NDE_VFD-07", "confidence": 0.0–1.0},
    {"source": "BEARING_NDE_VFD-07", "predicate": "resolved_by", "target": "REPLACE_BEARING", "confidence": ...}
  ]
}
Only emit relationships from this allowlist: caused_by, resolved_by, feeds,
has_component, requires_part, triggered_pm. Do NOT invent entities — only use
ones from the provided list.
```

Storage:
- Relationships go to `kg_relationships` with `source_conversation_id` set for traceability.
- Triple form also written to `kg_triples_log` so the audit trail survives even if the relationship is later deleted by a curator.
- Confidence < 0.6 → write to `kg_triples_log` only, do NOT promote to `kg_relationships`. This gives us a low-risk way to bootstrap without polluting the structured graph.

### 7.3 Where it runs

Fire-and-forget after each diagnostic conversation closes (same hook point as `extractAndStore`). Adds <300ms per conversation, off the user's response path.

### 7.4 Acceptance

On a 50-conversation labeled sample (Mike's Stardust Racers history):

- ≥ 80% recall of human-labeled causal links.
- ≤ 10% false-positive rate on causal links (`caused_by` precision).
- Zero relationships above 0.6 confidence that point to entities not in the entity list (no hallucinated nodes).

---

## 8. Plan-vs-Actual Comparison

### 8.1 Inputs

- **Plan side:** `equipment --has_pm--> pm_task` with `interval_days`.
- **Actual side:** `equipment --had_fault--> fault_code` events, plus closed work orders with `closed_at`.

### 8.2 Computation

Per equipment + fault code pair:
- Compute MTBF from `had_fault` events in the last 365d.
- Compute scheduled cadence from related `pm_task.interval_days`.
- Mismatch flag if `MTBF * 1.5 < interval_days` (real failures happen ~50% faster than the PM cycle).

Materialized as a function `flagPmMismatches(tenantId)` returning rows `{ equipment, fault_code, mtbf_days, pm_interval_days, severity }`.

### 8.3 Surface

- Available via API for the dashboard.
- Also exposed through `maintenanceContext` so the LLM sees the mismatch in the prompt.

### 8.4 Acceptance

`flagPmMismatches` returns at least one true-positive on Mike's Stardust Racers data, validated by Mike during review.

---

## 9. Phased Implementation

> Each phase is a separately-mergeable PR with its own eval gate.

### Phase 1 — Schema + types (1–2 days)
- Migration `006_kg_multi_hop.sql` (indexes + view).
- New TypeScript types in `types.ts` (no enum lock-in, just documented allowlists).
- Backfill script: derive `parent_of` relationships for any equipment whose `properties.location` matches an existing area/line entity.
- **Done when:** migration runs clean on a Neon dev branch + 49 existing entities still resolve through `getEntityContext`.

### Phase 2 — Traversal API + KG-RAG upgrade (3–4 days)
- Implement `traverseChain`, `impactAnalysis`, `rootCauseChain`, `maintenanceContext`.
- Extend `context-builder.ts` to call `maintenanceContext` instead of ad-hoc joins.
- Run 57-fixture eval before / after.
- **Done when:** eval composite ≥ baseline, 5 multi-hop scenarios pass, p95 latency budgets met.

### Phase 3 — LLM relationship extraction (2–3 days)
- New module `relationship-extractor.ts`.
- Wired into the same hook as `extractAndStore` in the diagnostic engine.
- 50-conversation labeled sample for the recall/precision evaluation.
- **Done when:** ≥80% recall, ≤10% FP, zero hallucinated entities.

### Phase 4 — Plan-vs-actual + alerting (2 days)
- `flagPmMismatches` function.
- Surface in `maintenanceContext` payload.
- Dashboard tile (mira-web) — separate ticket.
- **Done when:** Mike confirms ≥1 true-positive on real data.

### Phase 5 — Schematic Intelligence (3–5 days)

**Purpose.** MIRA reads European (IEC 60617) and American (ANSI / NFPA 79) electrical schematics, extracts circuit topology, and stores it in the KG. The graph then knows: "K1 controls M1", "OL1 protects M1", "Q0.0 drives K1 coil" — making electrical-fault reasoning multi-hop traversable just like mechanical assets.

**Components:**

1. **Schematic Type Classifier.** Single GPT-4o-vision call that classifies an uploaded image as one of: `iec_ladder`, `ansi_one_line`, `p_and_id`, `wiring_diagram`, `panel_layout`, `unknown`. Builds on the partial classification already in `mira-mcp` `PrintWorker`. Output drives which extraction prompt is used downstream.

2. **Symbol Detection.** GPT-4o vision (NOT a YOLOv8 fine-tune — fine-tuning needs labeled training data we don't have at the v1 timeline). Prompt: identify each electrical symbol with `{type, reference_designator, approx_position, terminals}`. Returns structured JSON, validated against a fixed type allowlist (contactor, overload, fuse, motor, plc_io, sensor, transformer, breaker, etc.). Anything off-allowlist is dropped. Reference designator regex follows IEC 81346 (`K1`, `M1`, `Q1`, `OL1`, `KM2`) for IEC and the looser ANSI conventions (`CR1`, `MTR-1`, `TD-1`, `Q0.0`).

3. **Connection / Wire Tracing.** Second GPT-4o vision pass over the same image, given the symbol list as context: trace electrical connections, return adjacency list `{from: "K1:A1", to: "Q0.0:24V", wire_number: "100"}`. Validation: each endpoint must reference a known symbol + terminal.

4. **KG integration.** New entity type `electrical_component` (subtype property: `contactor` / `overload` / `motor` / `plc_io` / etc.). New relationship types:
   - `electrically_connected` (component ↔ component, undirected, stored as two directed edges).
   - `controls` (e.g. `K1 --controls--> M1` when K1's main contacts feed M1).
   - `protects` (e.g. `OL1 --protects--> M1`).
   - `feeds` (reuse existing — power flows from upstream to downstream).
   - `references_drawing` (component → manual entity for drawing page citation).

   Each schematic component is also linked to its parent equipment entity via `has_component` if a parent is known (e.g. all components from "VFD-07 schematic page 12" become children of VFD-07).

5. **IEC vs ANSI handling.**
   - **IEC 60617:** vertical layout, coil/contact cross-references (`K1:A1-A2` coil, `K1:13-14` aux contact), explicit wire numbers per IEC 60445.
   - **ANSI / NFPA 79:** horizontal rung layout, alphanumeric line numbers (`L1` left rail, `L2` right rail), different motor symbol shape.
   - The classifier output gates which extraction prompt is used; no shared "universal" prompt — the standards diverge enough that mixing them increases hallucination.

6. **FastMCP exposure.** Phase 5 also wires the multi-hop traversal API to mira-mcp as FastMCP tools (deferred from Phase 1–4 per the resolved open question). Tools: `kg_traverse_chain`, `kg_impact_analysis`, `kg_root_cause_chain`, `kg_maintenance_context`, `kg_extract_schematic`. External agents and Open WebUI can then query the graph directly.

**Open-source references — STUDY ONLY, do NOT import as dependencies:**
- **FlowExtract** — YOLOv8 + EasyOCR pipeline turning maintenance flowcharts into directed graphs. Steal: their adjacency-list intermediate representation.
- **kicad-tools** — schematic parsing + LLM reasoning + MCP server. Steal: prompt patterns for connection tracing.
- **Schematika** — IEC 60617 symbol library. Steal: the canonical symbol→type mapping.
- **CircuitSchematicImageInterpreter** — wire-tracing into a network graph. Steal: their two-pass detect-then-trace approach (we're already doing this).

**Acceptance criteria:**
- Classifier correctly identifies schematic type for ≥4 of 5 test images (mixed IEC/ANSI).
- Symbol extraction captures ≥ 80% of components on a hand-labeled test schematic.
- Connection tracing produces a valid adjacency graph (every endpoint references a known symbol+terminal).
- Extracted components appear as KG entities with correct `controls` / `protects` / `feeds` relationships.
- End-to-end test on Stardust Racers electrical prints (3,742 pages in Mike's Google Drive): ≥ 1 multi-page schematic processed cleanly with components correctly linked back to a parent equipment entity.
- FastMCP tools callable from Open WebUI and return identical results to direct TypeScript calls.

### Total: 11–16 working days across 5 phases.

---

## 10. Acceptance Criteria (Composite)

The upgrade is **done** when ALL of these are true:

1. **Multi-hop scenarios.** All 5 reference scenarios below return correct results in <500ms.
2. **Eval no-regress.** 57-fixture suite composite score ≥ baseline measured pre-upgrade.
3. **Eval improvement.** Diagnostic-reasoning subset improves by ≥ 5pp (stretch — not a blocker).
4. **Relationship extraction quality.** ≥ 80% recall and ≤ 10% FP on the 50-conversation labeled sample for `caused_by` links.
5. **Plan-vs-actual flag.** ≥ 1 true-positive surfaced from Mike's Stardust Racers data, confirmed by Mike.
6. **Zero regressions on entity extraction.** Existing `extractor.ts` tests still pass; no behavior change to the regex pass.
7. **Tenant isolation.** No cross-tenant leakage in any new query — verified by RLS test fixtures.
8. **Latency.** All API targets in §5.5 met at p95.

### Reference scenarios

1. *"What usually causes F004 on PowerFlex 525?"* → traverse `PowerFlex_525 --has_fault--> F004 --caused_by--> [...]` returning at least the top 3 causes seen in conversations.
2. *"What parts do I need for VFD-07 maintenance?"* → traverse `VFD-07 --has_component--> [...] --requires_part--> [...]` returning the deduplicated part list.
3. *"If conveyor 3 goes down, what else stops?"* → `impactAnalysis(CONVEYOR_3)` returning the chain `Packer_1 → Palletizer_1` with criticality flags.
4. *"Show me all VFDs that had overcurrent faults this quarter."* → query `had_fault` relationships with `equipment_type=VFD`, `code IN (overcurrent codes)`, `occurred_at > now() - 90d`.
5. *"Why did VFD-07 fail and how was it fixed?"* → `rootCauseChain(VFD-07_last_fault)` plus the matched `resolved_by` chain.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Recursive CTEs slow on dense graphs | Med | High | Depth caps in every API; index pair on `(tenant, source/target, type)`; materialize view if budgets miss. |
| LLM relationship extractor hallucinates entities | Med | Med | Hard allowlist in prompt + post-validation against `kg_entities`; reject output that references unknown entities. |
| Eval regresses on simple questions due to noisier prompt | Med | High | A/B the prompt: only inject expanded multi-hop context when intent classifier flags causal/impact/history. Default = today's behavior. |
| Plan-vs-actual flags noisy when data is sparse | High | Low | Require ≥3 fault occurrences before flagging; surface as advisory not alert. |
| Migration accidentally drops data | Low | Critical | Migration is additive only — indexes + view. No `ALTER TABLE ... DROP` or data rewrites. Reversible with `DROP INDEX`/`DROP VIEW`. |
| Cross-tenant leakage via new joins | Low | Critical | Every new query goes through `withTenantContext`. RLS test fixture added in Phase 1 covers all new APIs. |
| Scope creep into Threaded's domain (value-stream / OEE) | High | Med | Anything that smells like throughput, takt time, or capacity is rejected at PR review. We track maintenance state, not process state. |

---

## 12. Resolved Decisions (Mike, 2026-05-07)

| # | Question | Decision |
|---|---|---|
| 1 | Hierarchy seed data | **Hand-author** the Stardust Racers Plant→Area→Line tree once. mira-cmms takes over keeping it in sync. |
| 2 | `similar_to` / Knowledge Cooperative | **Within-tenant only** in v1. Cross-tenant deferred to a separate spec. |
| 3 | Confidence threshold | **0.6** for triple-to-structured-relationship promotion. Tenant-tunable deferred. |
| 4 | Historical fault storage | Use the **relationship form (`had_fault` with timestamps)** — no separate `kg_events` table. |
| 5 | LLM extractor cadence | **Per-conversation** (fire-and-forget on conversation close). Cost accepted. |
| 6 | mira-mcp / FastMCP exposure | **Phase 5** — wired alongside schematic intelligence. |

---

## 13. What This Spec Does NOT Promise

- A frontend visualization of the graph. (Separate ticket if Mike wants one.)
- Real-time graph updates. Conversations write asynchronously; expect seconds of lag between conversation close and KG availability.
- Automatic ontology curation. The graph will accumulate junk types if we don't periodically prune. A janitor job is **out of scope** for v1.
- Backwards-incompatible changes. Everything additive; existing `traverseGraph` and `getEntityContext` continue to work unchanged for the duration of this upgrade.

---

## 14. Build Plan

Approved 2026-05-07. One branch per phase, each pushed on completion.

| Phase | Branch | Status |
|---|---|---|
| 1 | `feat/kg-multi-hop-phase-1` | in progress |
| 2 | `feat/kg-multi-hop-phase-2` | pending Phase 1 |
| 3 | `feat/kg-multi-hop-phase-3` | pending Phase 2 |
| 4 | `feat/kg-multi-hop-phase-4` | pending Phase 3 |
| 5 | `feat/kg-multi-hop-phase-5` | pending Phase 4 |
