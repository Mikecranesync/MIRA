# UNS + Knowledge Graph Unification Spec

**Status:** APPROVED 2026-05-07 by Mike Harper. Phases 1–3 in implementation on branch `claude/heuristic-einstein-922e75`.
**Author:** Claude (CHARLIE node) on behalf of Mike Harper
**Date:** 2026-05-07
**Targets:** MIRA v3.4.0 → v4.0.0 (foundational data-layer change)
**Companion:** [`docs/specs/uns-kg-standards-compliance.md`](./uns-kg-standards-compliance.md) — ISA-95 / ISO 14224 / MIMOSA / OPC UA / Sparkplug B / NAMUR NE 107 alignment analysis.
**Depends on:** `docs/plans/2026-04-19-mira-90-day-mvp.md` (Unit 5: assets/UNS), `docs/DATA_ENGINEERING_AUDIT.md` (2026-04-29)
**Supersedes (in part):** ad-hoc `kb_chunks` table, `cmms_equipment` flat-table approach
**Stack constraints:** Postgres (NeonDB) + pgvector + ltree extension. No new datastores. No graph DB introduced.

---

## 0. TL;DR

MIRA today has three disconnected representations of "what we know":

| System | Rows (2026-04-29) | Purpose | Connected to others? |
|---|---|---|---|
| `knowledge_entries` | **74,714** | Vector chunks of manuals/photos/transcripts | ❌ No FK to KG, no UNS path |
| `kg_entities` + `kg_relationships` | **41 + 27** (test data) | Structured graph nodes/edges | ❌ Schema exists, no production writer |
| `kb_chunks` | **0** (empty stub) | What the Hub UI reads for KB metrics | ❌ Hub shows `0` even with 74K rows in `knowledge_entries` |

The plan locks **all three under one address space (UNS path) and one identity space (KG entity ID)**. Every chunk gets an `equipment_entity_id`. Every entity gets a `uns_path`. The Hub stops reading `kb_chunks` and reads `knowledge_entries` instead. The Celery ingest worker — which already extracts manufacturer + model — starts upserting KG entities and relationships at ingest time.

This is the difference between a chatbot RAG and a maintenance intelligence platform.

---

## 1. Purpose

Make the **Unified Namespace + Knowledge Graph** the single representation layer for all maintenance data in FactoryLM. Every piece of equipment, every manual, every fault code, every work order, every conversation — addressable by UNS path, connected via KG relationships, searchable via vector embeddings.

**Why now (2026-05-07):**
- MVP Unit 4 (exports) and Unit 5 (assets) are about to land. Both are blocked by this gap. Exports query `knowledge_entries` directly (works); KB count queries `kb_chunks` (returns `0`) — visible bug today.
- Ingest is producing manufacturer + model strings that we throw away (line 376 of `mira-core/mira-ingest/db/neon.py` — they sit in chunk columns instead of becoming first-class entities).
- The flywheel argument: every manual ingested *should* densify the KG. Right now every manual ingested only thickens a flat vector index. The longer we wait, the more chunks we have to retro-link.

**What this spec is:**
- The architectural target for how data is shaped, addressed, and joined.
- A migration plan from the current 3-system state.
- An acceptance contract for what "unified" means.

**What this spec is NOT:**
- Not a UI spec. The Hub UNS browser is mentioned but designed elsewhere.
- Not an MQTT/Sparkplug B real-time streaming spec. Layer 4 below is forward-compatible only.
- Not a CMMS spec. Atlas (`mira-cmms`) consumes this layer; it does not define it.

---

## 2. Current State Audit

Every claim below is grounded in the code at commit `58bf50df` on branch `claude/charming-sammet-6ac0ca`.

### 2.1 `knowledge_entries` — the vector store (74,714 rows)

**Schema definition:** `docs/migrations/001_knowledge_entries.sql`

Columns of interest:
- `id UUID PRIMARY KEY`
- `tenant_id TEXT NOT NULL`
- `source_type TEXT` — values seen: `gdrive`, `manual`, `equipment_manual`, `youtube_transcript`, `equipment_photo`, `curriculum`, `reference`
- `manufacturer TEXT` (nullable)
- `model_number TEXT` (nullable)
- `equipment_type TEXT` (nullable)
- `content TEXT NOT NULL`
- `embedding vector(768)` — pgvector, ivfflat index, cosine ops
- `image_embedding vector(768)` (added by `mira-core/mira-ingest/db/neon.py:137`, idempotent)
- `isa95_path TEXT` (nullable) — partial UNS already in flight
- `equipment_id TEXT` (nullable) — text, not a UUID FK
- `data_type TEXT DEFAULT 'manual'`
- `source_url TEXT`
- `source_page INTEGER` — actually stores `chunk_index`, not PDF page (legacy naming)
- `metadata JSONB`
- `is_private BOOLEAN`, `verified BOOLEAN`, `chunk_type TEXT`
- `created_at TIMESTAMP DEFAULT now()`

**Indexes:** `ivfflat(embedding vector_cosine_ops)`, `tenant_id`, dedup uniq on `(tenant_id, source_url, chunk_index)`.

**Row distribution (2026-04-29 audit):**
- gdrive: 33,410 (extraction mostly NULL)
- manual: 32,584 (extraction succeeds when manual_cache has hint)
- equipment_manual: 4,718 (crawler-discovered)
- youtube_transcript: 2,522
- equipment_photo: 1,411
- other: ~1,500

**Writers (5 paths):**
1. `mira-core/mira-ingest/db/neon.py:345-404` — `insert_knowledge_entry()` (single)
2. `mira-core/mira-ingest/db/neon.py:407-451` — `insert_knowledge_entries_batch()` (batch)
3. `mira-crawler/ingest/store.py:63-128` — `insert_chunk()` (Celery worker, ON CONFLICT dedup)
4. `mira-crawler/ingest/store.py:131-175+` — `store_chunks()` (batch wrapper, called from `tasks/full_ingest_pipeline.py`)
5. `mira-bots/tools/learning_ingester.py` — raw INSERT SQL (legacy, low traffic)

**Readers:**
- `mira-bots/shared/neon_recall.py:58-104` — `recall_knowledge(embedding, tenant_id, limit=5)` — pgvector cosine + ISA95 prefix + data_type filter; this is the bot RAG call.
- `mira-bots/shared/neon_recall.py:107-134` — `recall_by_image()`.
- `mira-hub/src/app/api/export/route.ts:60-63` — CSV export.
- `mira-hub/src/lib/agents/asset-intelligence.ts` — full-text search by manufacturer/model.

### 2.2 `kg_entities` — the planned graph nodes (41 rows, all test data)

**Schema definition:** `docs/migrations/004_kg_entities.sql`

```
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id TEXT NOT NULL
entity_type TEXT NOT NULL   -- equipment | component | fault_code | procedure | specification
name TEXT NOT NULL
properties JSONB
source_chunk_id UUID        -- FK back to knowledge_entries.id
embedding vector(768)
created_at TIMESTAMP DEFAULT now()
UNIQUE (tenant_id, entity_type, name)
```

**Indexes:** `(tenant_id, entity_type)`, `ivfflat(embedding)`.

**Important finding:** `uns_path` is NOT currently a column on `kg_entities`. The brief described it as "exists on kg_entities, zero rows populated" — that's not what the code shows. `uns_path` lives only in `docs/plans/2026-04-19-mira-90-day-mvp.md:5,87-88` as a planned `ltree` column on a future `assets` table. **This spec resolves that ambiguity by declaring `uns_path ltree` belongs on `kg_entities` directly** (see §3.1 and §9 Q1).

**Writers:** none in production. The 41 rows are pre-migration test data from a developer scratchpad.

**Readers:** none in production. No application code reads `kg_entities`.

### 2.3 `kg_relationships` — the planned graph edges (27 rows, all test data)

**Schema definition:** `docs/migrations/005_kg_relationships.sql`

```
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id TEXT NOT NULL
source_entity UUID NOT NULL  -- FK kg_entities.id
target_entity UUID NOT NULL  -- FK kg_entities.id
relation_type TEXT NOT NULL  -- has_component | causes_fault | resolves | requires_tool | ...
properties JSONB
confidence REAL DEFAULT 1.0
source_chunk_id UUID         -- FK knowledge_entries.id, the chunk that justifies the edge
created_at TIMESTAMP DEFAULT now()
UNIQUE (tenant_id, source_entity, target_entity, relation_type)
```

**Writers / Readers:** none in production.

### 2.4 `kb_chunks` — the empty stub the Hub still reads (0 rows)

**Schema definition:** never versioned in a migration; created ad-hoc in NeonDB. Touched by `mira-core/mira-ingest/db/migrations/009_tenant_id_on_hub_read_tables.sql:27` (which only adds `tenant_id` to whatever already existed).

Inferred columns from query usage: `id, tenant_id, content_hash, system_category, subcategory, manufacturer, product_family, doc_type, source, title, quality_score, created_at`.

**Readers (active, in production today):**
- `mira-hub/src/app/api/usage/route.ts:59-62` —
  `SELECT COUNT(*) as total_chunks FROM kb_chunks WHERE tenant_id = $1`
  This is the "Total KB Chunks" tile on the Hub. **It always returns 0** because the table is empty. Users see 0 even though `knowledge_entries` has 74,714 rows. This is a live UX bug tied to the unification gap.
- `mira-hub/src/app/api/knowledge/route.ts:14-27` — group-by metadata for the Knowledge tab. Returns empty.

**Writers:** none anywhere in the repo. The table is a vestige.

### 2.5 `/opt/master_of_puppets/`

Referenced in `tests/eval/README.md` and `tests/eval/active_learning_tasks.py:18-20`. Per `wiki/nodes/vps.md` it was retired 2026-04-03. Not a current ingest path. **Ignore for unification purposes.**

### 2.6 `uns_path` — what actually exists today

A grep across the entire repo shows zero references to `uns_path` in code. It exists only in:
- `docs/plans/2026-04-19-mira-90-day-mvp.md` (planned `ltree` column on a planned `assets` table)
- This spec
- A handful of references in `wiki/`

There is no `CREATE EXTENSION ltree` in any executed migration. The `ltree` extension itself is unverified to be installed on Neon — this is **§9 Q2**.

### 2.7 Current entity extraction

`mira-core/scripts/ingest_manuals.py:228-298` extracts manufacturer and model with three URL-based heuristics:

- `_catalog_lookup(filename)` (269-275) — Rockwell catalog prefix map (e.g. `1756 → ControlLogix`, `20a → PowerFlex 70`).
- `_extract_mfr_from_url(url, hint)` (278-285) — hint lookup, fallback to domain parse.
- `_extract_model_from_url(url, hint)` (288-298) — filename-based, 3–60 char validation.

The extracted strings land as **string columns on the chunk row** (`manufacturer`, `model_number` on `knowledge_entries`). They are not promoted to KG entities. No relationship edges are created. **The flywheel does not turn.**

### 2.8 Summary diagram of the gap

```
                  ┌──────────────────────────────────┐
                  │   knowledge_entries (74,714)     │
                  │   manufacturer="Allen-Bradley"    │ ◀── strings, no FK
                  │   model_number="PowerFlex 525"    │
                  └──────────────────────────────────┘
                         │ no foreign key
                         │ no shared identity
                         ▼
                  ┌──────────────────────────────────┐
                  │   kg_entities (41 test rows)     │ ◀── empty in prod
                  │   kg_relationships (27 test)     │
                  └──────────────────────────────────┘

                  ┌──────────────────────────────────┐
                  │   kb_chunks (0 rows)             │ ◀── Hub reads this,
                  │                                  │     always shows 0
                  └──────────────────────────────────┘
```

---

## 3. Target Architecture

Four logical layers, all backed by Postgres.

### 3.1 Layer 1 — UNS Tree (the address system)

> **Schema broadened 2026-05-08 per Mike directive.** The original spec
> proposed an `enterprise.unassigned.*` subtree for kb-only equipment
> and a flat `enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}`
> for placed assets. Mike's direction: define the BROADEST possible
> ISA-95-shaped tree now, with literal type-marker labels at every
> level, even when most branches are empty. The tree below is the new
> canonical structure; older paths are migrated forward in
> `docs/migrations/007_uns_path.sql`.

Stored as a Postgres `ltree`. The full canonical tree:

```
enterprise/
├── {company}/                               ← per-customer branch
│   ├── site/{site_name}/
│   │   ├── area/{area_name}/
│   │   │   ├── line/{line_name}/
│   │   │   │   ├── work_cell/{cell_name}/
│   │   │   │   │   └── equipment/{equipment_id}/   ← assigned instance
│   │   │   │   │       ├── component/{component_name}
│   │   │   │   │       ├── datapoint/{tag_name}            ← Layer 4 (future)
│   │   │   │   │       ├── maintenance/
│   │   │   │   │       │   ├── pm_schedule/{slug}
│   │   │   │   │       │   ├── fault_history/{event_id}
│   │   │   │   │       │   ├── work_orders/{wo_number}
│   │   │   │   │       │   └── parts_inventory/{sku}
│   │   │   │   │       └── documentation/
│   │   │   │   │           ├── manuals/{slug}
│   │   │   │   │           ├── schematics/{slug}
│   │   │   │   │           └── procedures/{slug}
│   │   │   │   └── equipment/{equipment_id}        ← directly on line (no cell)
│   │   │   └── equipment/{equipment_id}            ← directly in area (no line)
│   │   ├── utilities/
│   │   ├── safety_systems/
│   │   └── environmental/
│   ├── fleet/                               ← mobile / field equipment
│   └── shared_services/
├── knowledge_base/                          ← manufacturer-organized catalog
│   ├── {manufacturer}/
│   │   └── {family?}/                       ← optional; collapses if unknown
│   │       └── {model}/
│   │           ├── manuals/
│   │           ├── fault_codes/
│   │           ├── pm_schedules/
│   │           └── parts_lists/
│   └── community/                           ← Knowledge Cooperative shared data
│       └── {equipment_class}/
│           ├── common_faults/
│           ├── mtbf_benchmarks/
│           └── resolution_patterns/
└── operations/
    ├── work_orders/
    ├── technicians/
    ├── inventory/
    └── compliance/
```

**Equipment that hasn't been assigned to a site lives in
`enterprise.knowledge_base.{manufacturer}.{family?}.{model}`** — the
manufacturer-organized catalog. Manuals, fault codes, PM schedules and
parts lists are children of the model node. There is no
`enterprise.unassigned.*` subtree anymore; the catalog is not a "to be
placed" list, it's the durable model registry.

**When a customer assigns a model to a site, the catalog node is NOT
moved.** A new `equipment` instance is created at the site path (e.g.
`enterprise.factorylm.site.orlando_plant.area.pump_station.line.line_3.equipment.vfd_07`)
and linked to the catalog model via an `INSTANCE_OF` relationship.
Same model, multiple sites — no duplication.

**Type markers vs instance labels.** ISA-95 segment names like `site`,
`area`, `line`, `work_cell`, `equipment`, `component`, `datapoint`,
`maintenance`, `documentation`, `manuals`, `fault_codes` appear
LITERALLY in the path as type markers, alternated with dynamic
instance labels. This makes the tree explorable: walk one level deep
and the segment alone tells you what kind of children to expect. It
also lets the Hub UI render the full skeleton even when no entities
exist under a branch (Mike: "Most branches will be empty/theoretical
— that's intentional").

**Skippable middle segments (site side).** Equipment can attach at
three depths: in a `work_cell`, on a `line` (no cell), or directly in
an `area` (no line). The `line.{l}.work_cell.{c}` segments are
optional. ltree path depth is variable and that's fine.

**Reserved labels.** The literal type-marker words are reserved — a
manufacturer / site / equipment slug must never collide with one. The
list is enforced by `mira-crawler/ingest/uns.py:RESERVED_LABELS`.

**Path normalization rules:**
- Lowercase only.
- Spaces → `_`. Hyphens → `_`. Slashes → `_`.
- Strip non-`[a-z0-9_]` after normalization.
- `.` is a path separator, never appears inside a label.
- Validation: `uns_path ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'` (Postgres
  CHECK constraint, in addition to ltree's own validation).

**Storage:**
- `uns_path ltree NOT NULL DEFAULT 'enterprise.knowledge_base'` on `kg_entities`.
- GiST index on `uns_path` for ancestor/descendant queries.
- Btree index on `uns_path` for exact lookup.
- `CREATE EXTENSION IF NOT EXISTS ltree` — pre-flight check during
  migration that Neon supports it (§9 Q2).

**Skeleton-aware browse API.** `GET /api/uns/browse?path=...` merges
two sources of children: (1) the static SKELETON of literal type
markers (defined in `mira-hub/src/lib/uns/skeleton.ts`) so empty
branches still show structure, and (2) dynamic instance labels from
`kg_entities` for the tenant. Each child is tagged
`kind: "literal" | "dynamic" | "both"` so the UI can distinguish a
type-marker placeholder ("site") from an actual data node
("orlando_plant") from a marker that has data directly under it.

### 3.2 Layer 2 — Knowledge Graph (the relationship system)

Entities are typed nodes. Relationships are typed edges. `kg_entities` and `kg_relationships` schemas as already defined (§2.2, §2.3) plus the additions in §3.1 and §3.3.

**Required entity types (initial set):**
- `equipment` — a unit of equipment (a VFD, a pump, a controller). Can nest.
- `component` — a sub-part of equipment (bearing, fan, capacitor). PARENT_OF a piece of equipment.
- `manual` — a document. One manual per (manufacturer, model, doc_type) is the dedup key.
- `fault_code` — a diagnostic code on a specific equipment model (e.g. `PowerFlex 525 / F004`).
- `pm_task` — a scheduled preventive maintenance task with an interval.
- `procedure` — a how-to (step list).
- `part` — a SKU / spare.
- `specification` — a numeric spec (e.g. "DC bus voltage 750V").

**Required relationship types (initial set):**
- `equipment HAS_MANUAL manual`
- `equipment HAS_FAULT fault_code`
- `fault_code CAUSED_BY root_cause` (root_cause is a `specification` or free-text node)
- `fault_code RESOLVED_BY procedure`
- `equipment HAS_COMPONENT component`
- `component REQUIRES_PART part`
- `equipment PARENT_OF equipment` (UNS hierarchy mirror — same info as `uns_path`, but as edges, for graph traversal)
- `equipment FEEDS equipment` (process flow — pump feeds sump tank, etc.)
- `equipment HAS_PM pm_task`

**Constraint:** every relationship row has `source_chunk_id` pointing to the `knowledge_entries` row that justified it. No edge is "created from nowhere." This makes the KG fully auditable and allows us to remove edges if the source chunk is later marked low-quality.

### 3.3 Layer 3 — Vector Store (the search system)

`knowledge_entries` is the canonical vector store. The change:

**Add column:** `equipment_entity_id UUID REFERENCES kg_entities(id) ON DELETE SET NULL`

**Add index:** `CREATE INDEX knowledge_entries_equipment_entity_id ON knowledge_entries (equipment_entity_id);`

This is the bridge. Every chunk that came from a manual about a known piece of equipment now has a typed pointer to the KG node for that equipment. The bot RAG path (`neon_recall.recall_knowledge`) gets a one-line addition: when filtering by equipment, join through `equipment_entity_id` instead of fuzzy-matching `manufacturer ILIKE '...' AND model_number ILIKE '...'`.

**`isa95_path TEXT` column on `knowledge_entries`:**
- Migrate to `uns_path ltree` to align with §3.1.
- The current text-based ISA-95 path values are valid ltree literals after normalization.
- Backfill: copy `isa95_path` → `uns_path` per row, normalize via SQL function.

### 3.4 Layer 4 — UNS Event Stream (forward-compat, NOT in MVP)

Real-time data points flowing through the UNS tree:
`enterprise.stardust_racers.pump_station.sump.vfd_07.motor_current = 12.4A @ 2026-05-07T14:22:01Z`

**Not built. Not in this spec's implementation phases.** The point of mentioning it: the UNS path structure in §3.1 must be designed such that a future MQTT/Sparkplug B broker can use the *same* paths as topic names. This means:
- `.` separator is compatible with Sparkplug B `group/edge_node/device/metric` after a re-segmentation.
- `enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}` is exactly 7 segments, which maps cleanly to typical broker conventions.
- Tag values will live in a future `uns_observations` table or external TSDB. They do **not** belong in `kg_entities`.

This spec only requires that we don't paint ourselves into a corner. It does not require us to build the broker.

### 3.5 Per-tenant isolation

Every table already has `tenant_id`. RLS policies exist but the application connects as `neondb_owner` (superuser, bypasses RLS) — see `docs/DATA_ENGINEERING_AUDIT.md`. This spec does not solve RLS enforcement (separate workstream), but **every join across tables in this spec MUST include `tenant_id` equality** in WHERE clauses. The migration scripts will add CHECK constraints to prevent cross-tenant FK references.

---

## 4. Unification Plan

### 4.1 Bridge `knowledge_entries ↔ kg_entities`

**Schema change:**
```
ALTER TABLE knowledge_entries
  ADD COLUMN equipment_entity_id UUID REFERENCES kg_entities(id) ON DELETE SET NULL;
CREATE INDEX knowledge_entries_equipment_entity_id_idx
  ON knowledge_entries (equipment_entity_id);
```

**Ingest-time behavior change** — when the Celery worker (`mira-crawler/ingest/store.py:63-128`) ingests a chunk for a manual whose URL extraction yields `manufacturer="Allen-Bradley"`, `model="PowerFlex 525"`:

1. Upsert `kg_entities` row: `(entity_type='equipment', name='PowerFlex 525', properties.manufacturer='Allen-Bradley')` — UNIQUE on `(tenant_id, entity_type, name)` makes this idempotent.
2. Compute and set `uns_path = 'enterprise.unassigned.allen_bradley.powerflex_525'` if the entity is brand new.
3. Upsert `kg_entities` row: `(entity_type='manual', name='PowerFlex 525 User Manual')`.
4. Upsert `kg_relationships` row: `(source=equipment_id, target=manual_id, relation_type='has_manual', source_chunk_id=<this chunk>)`.
5. Set `equipment_entity_id` on the chunk row to the equipment entity ID.

**Idempotency:** all 5 steps use ON CONFLICT DO NOTHING / UPDATE patterns. Re-ingesting the same manual produces the same graph. No drift.

### 4.2 Backfill the existing 74,714 chunks

A one-shot script (`tools/migrations/backfill_equipment_entities.py`) walks `knowledge_entries` rows where `equipment_entity_id IS NULL` AND `manufacturer IS NOT NULL` AND `model_number IS NOT NULL`, and runs the 5-step upsert above for each unique `(manufacturer, model_number)` pair.

**Expected outcome (back-of-envelope):**
- 74,714 chunks scanned.
- ~33,000 chunks (gdrive) skipped (no manufacturer extracted).
- ~37,000 chunks linked to ~500–2,000 unique equipment entities (TBD; depends on how clean the existing extraction is — see §9 Q4).
- ~4,718 equipment_manual chunks linked with high confidence.

**Run mode:** dry-run first, log how many entities would be created, present count to Mike, then commit.

### 4.3 Retire `kb_chunks`

**Recommendation: Option A — drop `kb_chunks`, repoint Hub to `knowledge_entries`.**

Rationale:
- `kb_chunks` is empty (0 rows).
- It was an ad-hoc table; it was never versioned or written to.
- The Hub queries it for two reasons: a count tile and a group-by-metadata grid. Both can be satisfied by `knowledge_entries` with one new SQL view:

```
CREATE VIEW kb_chunks_compat AS
SELECT
  ke.id,
  ke.tenant_id,
  -- system_category derived from kg_entities.properties JSONB if available, else NULL
  COALESCE(eq.properties->>'system_category', NULL) AS system_category,
  COALESCE(eq.properties->>'subcategory', NULL) AS subcategory,
  ke.manufacturer,
  -- product_family from kg_entities.name when equipment_entity_id is set
  COALESCE(eq.name, ke.model_number) AS product_family,
  ke.data_type AS doc_type,
  ke.source_type AS source,
  ke.metadata->>'title' AS title,
  NULL::float AS quality_score,
  ke.created_at
FROM knowledge_entries ke
LEFT JOIN kg_entities eq ON eq.id = ke.equipment_entity_id;
```

Update `mira-hub/src/app/api/usage/route.ts` and `mira-hub/src/app/api/knowledge/route.ts` to query the view (or `knowledge_entries` directly).

After Hub PR merges and is verified in prod for ≥7 days: `DROP TABLE kb_chunks`.

**Why not Option B (UNION view):** the table is empty. There is nothing to preserve. UNION adds complexity for zero data. Reject.

### 4.4 Ingest-time entity extraction (the flywheel)

The existing extraction in `mira-core/scripts/ingest_manuals.py:228-298` becomes one of three extractors. Move all three into `mira-crawler/ingest/extractors/`:

1. **URL-based** (already exists) — manufacturer + model from URL/filename. Ship as-is, just promote to entities.
2. **Text-based fault-code extraction** (NEW) — regex over chunk content for fault code patterns (`F\d{3,4}`, `E\d{2,3}`, `Fault \d+`, etc.) → create `fault_code` entities tied to the equipment entity.
3. **Text-based PM-schedule extraction** (NEW) — regex/LLM over chunk content for "every N hours/days/months" patterns → create `pm_task` entities with `properties.interval_days = N`.

**Confidence scoring:**
- URL-based extraction: confidence = 0.95.
- Regex-based fault code: confidence = 0.85.
- LLM-based PM extraction: confidence = LLM-reported.

Confidence stored on `kg_relationships.confidence`. Below 0.5 → flag for human review (§9 Q5).

**This is the flywheel.** Every manual ingested → more equipment entities, more fault codes, more PM tasks, more relationships. The KG densifies passively as content grows.

### 4.5 UNS path enforcement

**Hard constraints on `kg_entities`:**

```
ALTER TABLE kg_entities
  ADD COLUMN uns_path ltree NOT NULL DEFAULT 'enterprise.unassigned';

ALTER TABLE kg_entities
  ADD CONSTRAINT uns_path_format
  CHECK (uns_path::text ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');

CREATE INDEX kg_entities_uns_path_gist ON kg_entities USING gist (uns_path);
CREATE INDEX kg_entities_uns_path_btree ON kg_entities (uns_path);
```

**Default function** (used by the Celery worker on insert):
```
def default_uns_path(entity_type: str, manufacturer: str | None, model: str | None) -> str:
    if entity_type == "equipment" and manufacturer and model:
        return f"enterprise.unassigned.{slug(manufacturer)}.{slug(model)}"
    return "enterprise.unassigned"
```

**Browse API:**
- `GET /api/uns/browse?path=enterprise.stardust_racers` → returns immediate children (one level deep) using `uns_path ~ 'enterprise.stardust_racers.*{1}'` ltree query.
- `GET /api/uns/subtree?path=...` → returns full subtree (use sparingly; cap depth at 5).
- `POST /api/uns/move` → move an equipment entity from `enterprise.unassigned.foo.bar` to `enterprise.{site}.{area}.{line}.foo`. Cascades: update the moved entity's `uns_path`, and emit a `PARENT_OF` edge to the new parent. Do not re-path siblings — the same model can be installed in multiple sites.

**Validation:**
- ltree extension must be present (§9 Q2).
- Rejection of invalid paths happens at the API layer AND at the DB CHECK constraint.

---

## 5. What MIRA Does With Unified Data — Worked Example

A tech texts the Telegram bot: *"My PowerFlex 525 is showing F004"*

### Step 1: DST identifies entities (existing code path, no change)
`mira-bots/shared/engine.py` runs the diagnostic state machine. It identifies:
- vendor = "Allen-Bradley"
- model = "PowerFlex 525"
- fault_code = "F004"

### Step 2: KG lookup (NEW capability via this spec)
The bot calls a new MCP tool `maintenanceContext("powerflex_525", "f004")`:

```sql
WITH eq AS (
  SELECT id, uns_path, properties FROM kg_entities
  WHERE tenant_id = $1 AND entity_type = 'equipment' AND name ILIKE 'PowerFlex 525'
),
fault AS (
  SELECT f.id, f.name, f.properties FROM kg_entities f
  JOIN kg_relationships r ON r.target_entity = f.id
  WHERE r.source_entity = (SELECT id FROM eq)
    AND r.relation_type = 'has_fault'
    AND f.name ILIKE 'F004'
),
recent_faults AS (
  SELECT created_at FROM cmms_fault_history
  WHERE equipment_entity_id = (SELECT id FROM eq)
    AND fault_code = 'F004'
    AND created_at > now() - interval '90 days'
),
pm_due AS (
  SELECT pm.name, pm.properties->>'interval_days' AS interval_days,
         (pm.properties->>'last_completed_at')::timestamptz AS last_completed
  FROM kg_entities pm
  JOIN kg_relationships r ON r.target_entity = pm.id
  WHERE r.source_entity = (SELECT id FROM eq) AND r.relation_type = 'has_pm'
)
SELECT
  (SELECT uns_path FROM eq)                                        AS uns_path,
  (SELECT count(*) FROM recent_faults)                             AS faults_90d,
  (SELECT properties FROM eq)                                      AS equipment_props,
  (SELECT array_agg(row_to_json(pm_due)) FROM pm_due)              AS pm_schedule;
```

Returns:
- `uns_path = enterprise.stardust_racers.line_3.vfd_07`
- `faults_90d = 3`
- `pm_schedule = [{name: "Bearing inspection", interval_days: 90, last_completed: 45_days_ago}]`

### Step 3: Vector search filtered through the KG bridge
```sql
SELECT content, source_url, metadata->>'page_num' AS page
FROM knowledge_entries
WHERE tenant_id = $1
  AND equipment_entity_id = $eq_id   -- THE BRIDGE
  AND embedding <=> $query_embedding < 0.3
ORDER BY embedding <=> $query_embedding
LIMIT 15;
```

Returns 15 chunks from the PowerFlex 525 manual specifically — no cross-contamination from PowerFlex 700, 753, 4M, etc.

### Step 4: LLM receives a unified context payload

```json
{
  "user_query": "My PowerFlex 525 is showing F004",
  "kg_context": {
    "equipment": "PowerFlex 525 @ enterprise.stardust_racers.line_3.vfd_07",
    "fault_history_90d": [{"date": "2026-04-22"}, {"date": "2026-03-29"}, {"date": "2026-03-01"}],
    "pm_schedule": {
      "task": "Bearing inspection",
      "interval_days": 90,
      "last_completed": "2026-03-22 (45 days ago)"
    },
    "plan_vs_actual_signal": "F004 frequency ~30 days; PM interval 90 days → INTERVAL TOO LONG"
  },
  "manual_chunks": [/* 15 chunks with source_url + page_num */]
}
```

### Step 5: LLM generates the diagnostic answer

> *F004 on your PowerFlex 525 is undervoltage on the DC bus. Looking at VFD-07's history: this is the third F004 in 90 days, but your bearing inspection is on a 90-day cadence — that interval is too long for how often this fault is recurring. Recommended action: drop bearing inspection to 30 days for this unit until faults stop, and check input voltage and DC bus capacitors today (Citation: PowerFlex 525 User Manual, Ch. 7, p. 142).*

**This is the difference.** Without the KG bridge, the bot retrieves 15 chunks about F004 and parrots the manual. With the bridge, it knows the fault is recurring, knows the PM is on the wrong interval, and proposes a maintenance plan change. That is maintenance intelligence.

---

## 6. Readiness Assessment

Grades reflect "can this support a paying customer today" — not "is the code clean."

| Subsystem | Current | Target | Gap |
|---|---|---|---|
| **UNS tree** | F (column does not exist; `isa95_path` is a string, no ltree) | A (ltree column on `kg_entities`, validated paths, browse API, default path on every entity) | Add column, install extension, write default-path function, build browse API |
| **Knowledge graph** | F (schema exists, 0 production rows, no writers, no readers) | B (auto-populated by ingest for `equipment` + `manual` + `fault_code` + `pm_task`; queryable by bots; weekly stat report on density) | Wire ingest extractors, build `maintenanceContext` MCP tool, add `equipment_entity_id` FK |
| **Vector store** | B (74K rows, indexed, sanitization in place, but no FK to KG; ISA95 partial) | A (every linkable chunk has `equipment_entity_id`; `isa95_path` migrated to `uns_path`; query speed unchanged) | Add FK column, run backfill, update reader to optionally join through it |
| **Ingest pipeline** | C (extracts mfr+model but throws them away as strings) | A (extracts → upserts entities + relationships idempotently; pluggable extractors; confidence scoring) | Refactor `ingest/store.py` to call extractor pipeline; add fault_code + PM extractors |
| **Bot reasoning** | C (RAG works; no graph context; relies on fuzzy mfr/model matches) | B (calls `maintenanceContext` first, falls back to vector if no KG hit; combines both in prompt) | Build MCP tool; update `mira-bots/shared/engine.py` to consume it |
| **Hub display** | F (KB count reads empty `kb_chunks`, shows 0) | B (reads `knowledge_entries` via view; UNS browser shows assigned + unassigned tree) | Repoint API routes; build UNS browser component (out-of-spec) |

Overall: **D today, target B+ after Phase 5.** No A grade target until Layer 4 (event stream) ships, which is post-MVP.

---

## 7. Implementation Phases

Each phase is independently shippable and reversible. **No phase begins until the previous one is verified in prod.**

### Phase 1 — Bridge `knowledge_entries ↔ kg_entities`
**Migration:** add `equipment_entity_id UUID` FK + index.
**Code:** none required (column nullable, defaults NULL).
**Acceptance:**
- `\d knowledge_entries` shows the new column.
- Existing INSERT paths still succeed (column accepts NULL).
- Bot RAG path still returns identical results to a baseline of 5 fixed queries.

### Phase 2 — Ingest-time entity creation (the flywheel ON)
**Code:** refactor `mira-crawler/ingest/store.py` and `ingest_manuals.py` to call new `extractors/` package. URL-based equipment extraction promotes to entities. Fault-code regex extraction added. PM-schedule extraction added (LLM-assisted).
**Acceptance:**
- A new manual ingested produces ≥1 `equipment` entity.
- Re-ingesting the same manual is a no-op (idempotency check via `kg_entities` UNIQUE).
- ≥80% of new chunks have `equipment_entity_id` populated when manufacturer + model are extractable.
- Backfill script run; ≥30,000 of the existing 74,714 chunks now have `equipment_entity_id`.

### Phase 3 — UNS path enforcement
**Migration:** `CREATE EXTENSION ltree`; add `uns_path ltree NOT NULL DEFAULT 'enterprise.unassigned'` to `kg_entities`; backfill default values; add CHECK constraint and indexes.
**Code:** `default_uns_path()` helper used by ingest; `isa95_path` migration on `knowledge_entries`.
**Acceptance:**
- 100% of `kg_entities` rows have a non-NULL `uns_path`.
- A new equipment entity for "Xylem Flygt MultiSmart" gets `enterprise.unassigned.xylem_flygt.multismart`.
- ltree path queries return correct subtrees on synthetic test data.

### Phase 4 — Hub UNS browser + KB count fix
**Code:**
- New `GET /api/uns/browse` and `GET /api/uns/subtree` endpoints in `mira-hub/`.
- Update `api/usage/route.ts` and `api/knowledge/route.ts` to read `knowledge_entries` (or `kb_chunks_compat` view).
- Hub UI: tree component for the UNS browser.
**Acceptance:**
- Hub "Total KB Chunks" shows 74,714+ (real data), not 0.
- Hub UNS browser renders an "Unassigned" subtree containing every equipment we've learned about.
- After 7 days of stable Hub reads from `knowledge_entries`: `DROP TABLE kb_chunks`.

### Phase 5 — Unified search (vector + graph combined)
**Code:** new MCP tool `maintenanceContext(equipment_name, fault_code?)` returns the JSON payload from §5 step 4. Update `mira-bots/shared/engine.py` to call it before vector search and merge results.
**Acceptance:**
- Bot answer to "My PowerFlex 525 is showing F004" includes recurrence count + PM mismatch when test data exists.
- Bot answer to "Hello" still works (no KG lookup, no regression).
- 39 golden eval cases pass at ≥77% (no regression from current).
- 5 new golden cases added that specifically test KG-augmented answers; ≥4/5 pass.

### Phase ordering rationale
1 → 2: bridge column must exist before writers populate it.
2 → 3: entities must exist before they get UNS paths (or default+backfill needs care).
3 → 4: UNS browser needs `uns_path` populated to render.
4 → 5: optional reordering — Phase 5 can ship parallel to Phase 4 if Mike prioritizes bot quality over Hub fix.

**Total estimate (excluding spec discussion):** 3 weeks of focused work. ~70% migration + backfill, ~30% reasoning code.

---

## 8. Acceptance Criteria

The unification is "done" when ALL of the following are true in production:

1. ✅ Every `knowledge_entries` row that has `manufacturer IS NOT NULL AND model_number IS NOT NULL` also has `equipment_entity_id IS NOT NULL` (or has been audited and explicitly marked unmappable).
2. ✅ Every `kg_entities` row has a non-NULL `uns_path` that passes the format CHECK constraint.
3. ✅ Ingesting a brand-new manual via the Celery worker creates ≥1 KG entity (verified by integration test).
4. ✅ Ingesting the *same* manual twice is a no-op at the entity level (no duplicate entities; same `kg_entities.id` returned).
5. ✅ Hub "Total KB Chunks" tile reads from `knowledge_entries` and shows the true count.
6. ✅ Hub UNS browser renders both an "Unassigned" subtree and any user-assigned subtrees.
7. ✅ Bot diagnostic answer includes KG context (fault history, PM schedule, plan-vs-actual signal) when `maintenanceContext` returns data.
8. ✅ `GET /api/uns/browse?path=enterprise` returns at least the "unassigned" branch.
9. ✅ `kb_chunks` table is dropped (or, if kept, is documented as a compat view only).
10. ✅ All 39 existing golden eval cases pass at ≥77% (no regression). 5 new KG-augmented golden cases added; ≥4/5 pass.

**Definition of NOT done:** any one of the above failing. No partial credit. This is foundational; the foundation either holds the building or it doesn't.

---

## 9. Open Questions for Mike

These must be answered before any code is written. None have a default — Mike's call.

### Q1. `uns_path` lives on `kg_entities`, or on a new `assets` table?
The 90-day MVP plan describes `uns_path` as a column on a future `assets` table. This spec puts it on `kg_entities` directly. Tradeoff:

- **`kg_entities`:** simpler. Every entity (equipment, fault_code, manual, pm_task) gets a path. The path of a fault_code is the path of its parent equipment plus `.faults.f004`. One table to query.
- **Separate `assets` table:** matches the MVP plan literally. Only physical things get UNS paths. Faults and manuals don't. Cleaner conceptually, but doubles the join work for every UNS query.

**Recommendation: `kg_entities`.** But Mike's call.

### Q2. Is `ltree` extension installed on Neon?
Need to verify. If not, the entire UNS layer falls back to TEXT with self-validated path format. Acceptable, but loses GiST subtree query performance.

### Q3. What's the seeding strategy for known equipment?
Three options for the initial KG population beyond what ingest produces automatically:

- **A. Pure passive:** wait for ingest to discover equipment from manuals. Slowest densification.
- **B. Catalog seed:** preload a curated list of common Allen-Bradley / Xylem / SKF / etc. models as `kg_entities` rows up-front (~500 entries). Fastest path to a useful KG.
- **C. CMMS sync:** read `cmms_equipment` / `mira-cmms/atlas-db` on first run, create one `kg_entities` row per existing CMMS asset.

**Recommendation: B + C.** B for breadth (common equipment), C for precision (the user's actual floor). A is what naturally happens regardless.

### Q4. What's the de-duplication strategy for fuzzy equipment names?
"PowerFlex 525", "Powerflex 525", "PF 525", "PF525" should all be the same entity. The current UNIQUE constraint is exact-string. Options:

- **A. Strict:** keep UNIQUE exact-match. Tolerate duplicates in the short term, run a reconciliation job nightly.
- **B. Normalized:** add a generated column `normalized_name = lower(regexp_replace(name, '[^a-z0-9]', '', 'g'))` and put UNIQUE on that.
- **C. LLM-assisted:** at ingest time, ask the cascade LLM "is this the same equipment as X?" before inserting.

**Recommendation: B (cheap, deterministic, fast).** C is too expensive at ingest scale (74K chunks).

### Q5. How is low-confidence KG data surfaced for review?
Confidence thresholds — what happens when an extractor returns confidence < 0.5?

- **A. Reject:** don't write the entity/edge. Tightest, but loses signal.
- **B. Write + flag:** write with `confidence < 0.5` and a Hub queue surfaces these for human approval.
- **C. Quarantine table:** write to `kg_entities_pending` instead, separate review pipeline.

**Recommendation: B.** The Hub already has surface area for review queues; reuse it.

### Q6. Backfill gating: how big a chunk batch is safe on Neon?
Neon free-tier has compute caps. Backfill of 74K chunks could spike. Need to confirm:
- Run in batches of 1,000 with a sleep?
- Run on a dedicated Neon branch and merge?
- Run during a manual maintenance window?

**Recommendation: dedicated branch + merge.** Safest, no prod impact.

### Q7. Multi-tenancy + the "shared catalog" question
If two tenants both have a PowerFlex 525, should they share the same `kg_entities` row or each get their own?

- **Shared catalog:** `entity_type='equipment_model'` rows are global (no tenant_id), and per-tenant `equipment_instance` rows reference them. Reduces duplication massively as we onboard more tenants. Big architectural shift.
- **Per-tenant duplicates:** simpler, current schema. Each tenant's PowerFlex 525 is its own row. Wastes space but isolates risk.

**Recommendation: defer.** Ship per-tenant duplicates for MVP; revisit for v5.0 once we have ≥3 paying tenants and can measure the duplication cost.

### Q8. `cmms_fault_history` table
The §5 worked example assumes a table that records every observed fault in the field with timestamps. Does this exist? Search of the repo suggests `cmms_*` tables exist for work orders but I did not confirm a fault history table. **If it doesn't exist, §5 step 2's "faults_90d" lookup fails open with `0`, which means the plan-vs-actual signal degrades to "we don't know yet."** Acceptable, but flag.

### Q9. Ordering: should Phase 4 (Hub fix) jump the line?
The Hub showing `0` KB chunks is a live UX bug today. Phase 4 in §7 depends on Phase 1+2+3 to be fully useful (UNS browser), but the "fix the count" piece is independent. Should we:

- **A. Strict ordering:** ship phases 1→5 in order; Hub bug stays for ~2 weeks.
- **B. Hotfix first:** repoint `kb_chunks` reads to `knowledge_entries` immediately as a 1-PR fix, then proceed with phases 1–5 normally.

**Recommendation: B.** It's a 30-line change, ships in a day, removes a visible bug. Then proceed with the rest of the plan.

---

## 10. Out of Scope (for clarity)

- **Real-time MQTT/Sparkplug B broker** — Layer 4 is forward-compat only. No broker stood up in this spec.
- **CMMS work-order schema changes** — Atlas (`mira-cmms`) consumes this layer. It is not redefined here.
- **RLS enforcement** — separate workstream; this spec only requires that all queries include `tenant_id` predicates.
- **Hub UI design** — UNS browser is mentioned but designed elsewhere.
- **Photo / image embedding KG bridge** — `image_embedding` exists on `knowledge_entries`. Future work to also tie image hits to equipment entities. Not blocking.
- **Cross-tenant catalog sharing** — see §9 Q7. Deferred.
- **Renaming `source_page` → `chunk_index`** — useful cleanup but not blocking unification. Deferred.

---

## 11. References

- `docs/migrations/001_knowledge_entries.sql` — vector store schema
- `docs/migrations/004_kg_entities.sql` — KG nodes schema
- `docs/migrations/005_kg_relationships.sql` — KG edges schema
- `docs/DATA_ENGINEERING_AUDIT.md` (2026-04-29) — current row counts and dedup status
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — Unit 5 (assets/UNS plan)
- `mira-core/scripts/ingest_manuals.py:228-298` — current entity extraction (URL-based)
- `mira-core/mira-ingest/db/neon.py:345-451` — `knowledge_entries` writers
- `mira-crawler/ingest/store.py:63-175` — Celery worker writers
- `mira-bots/shared/neon_recall.py:58-134` — bot RAG readers
- `mira-hub/src/app/api/usage/route.ts:59-62` — the kb_chunks bug
- `mira-hub/src/app/api/knowledge/route.ts:14-27` — Hub knowledge tab
- `mira-hub/src/app/api/export/route.ts:60-63` — the working knowledge_entries reader
- `NORTH_STAR.md` — flywheel argument that this spec operationalizes

---

## 12. Approval

This spec is DRAFT until Mike answers §9. Once §9 is locked, the spec moves to APPROVED and Phases 1–5 become Linear tickets under MIRA MVP.

**Reviewers:** Mike Harper (founder, sole approver for foundational architecture changes per CLUSTER law: 300-line orchestrator limit applies to code, not specs).
