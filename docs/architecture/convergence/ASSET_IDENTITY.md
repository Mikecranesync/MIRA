# Asset Identity Bifurcation: Findings

## Scheme 1: CMMS Equipment (cmms_equipment table)
**Canonical schema:** `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql:62-74`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key; permanent asset identity in cmms_equipment |
| `tenant_id` | UUID | Multi-tenancy scoping |
| `equipment_number` | TEXT | QR code payload; permanent per-tenant unique handle |
| `manufacturer`, `slug`, `path` | TEXT | CMMS metadata |
| `site_id`, `area_id` | UUID | ISA-95 hierarchy pointers |

**Writers:** Hub UI (`/api/assets`), mira-bots integrations  
**Readers:** Mobile app (asset detail), Hub (asset list), mission-critical paths  
**Bridge to other schemes:**
- QR code resolves tag → cmms_equipment.equipment_number → cmms_equipment.id (mobile app: `getAssetByTag()` → `getAsset(id)`)
- asset_agent_status.equipment_id FK (line 39, migration 046_asset_agent_status.sql)

---

## Scheme 2: Knowledge Graph Entities (kg_entities table)
**Canonical schema:** `mira-hub/db/migrations/001_knowledge_graph.sql:3-13`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key; entity identity in kg graph |
| `tenant_id` | UUID | Multi-tenancy scoping |
| `entity_type` | TEXT | Type marker: 'equipment', 'manual', 'fault_code', etc. |
| `entity_id` | TEXT | Slugified semantic identity (NOT UUID) |
| `name` | TEXT | Display label |
| `properties` | JSONB | Metadata (manufacturer, model, family) |
| CONSTRAINT | — | UNIQUE (tenant_id, entity_type, entity_id) |

**Schema:** `mira-hub/db/migrations/010_kg_uns_path.sql` adds `uns_path LTREE`  
**UNS path filled:** Migration `014_uns_path_backfill.sql` — builds `enterprise.knowledge_base.{mfr}.{family}.{model}`  
**Writers:** Crawler (backfill), Python orchestrator (tools/uns_backfill.py), mira-mcp  
**Readers:** mira-mcp (kg_maintenance_context, mira_get_equipment), retrieval RAG, UNS resolver  
**Bridge to other schemes:**
- knowledge_entries.equipment_entity_id (UUID FK, soft link) — links chunks to kg_entities (migration 045_knowledge_entries_chunk_anchors.sql comment)
- asset_agent_status.uns_path (ltree, soft link) — canonical UNS compliance key (migration 046_asset_agent_status.sql:24-26)

---

## Scheme 3: UNS Paths (ltree address space)
**Schema:** ltree data type (Postgres)  
**Path grammar:** `mira-crawler/ingest/uns.py:55-59`

### Knowledge base branch (manufacturer-organized, site-independent):
```
enterprise.knowledge_base.{manufacturer}.{family?}.{model}
enterprise.knowledge_base.{manufacturer}.{family?}.{model}.manuals[.{slug}]
enterprise.knowledge_base.{manufacturer}.{family?}.{model}.fault_codes.{code}
```

### Per-site hierarchy (ISA-95 + work_cell):
```
enterprise.{company}.site.{site}.area.{area}.line.{line}.work_cell.{cell}.equipment.{eq_id}
```
Equipment can skip line/cell segments (attach at area or line level).

**Writers:** UNS resolver (mira-bots/shared/uns_resolver.py), crawler, mobile app (inferred from QR scan)  
**Readers:** asset_agent_status queries (GIST index, tag_events subtree queries), deployment gate, Hub UNS browse API  
**Bridge to other schemes:**
- asset_agent_status.uns_path (ltree, indexed for deployment gate)
- tag_events.uns_path (ltree, indexed for historical telemetry queries) (migration 033_tag_events.sql:67)
- installed_component_instances.uns_path (ltree, indexed for component queries) (migration 017_installed_component_instances.sql:44)
- resolved by UNS resolver to UNSContext.uns_path (string)

---

## Scheme 4: Installed Component Instances (components within assets)
**Canonical schema:** `mira-hub/db/migrations/017_installed_component_instances.sql:14-56`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `asset_id` | UUID | Soft link to cmms_equipment.id (no hard FK — schema-separation pattern) |
| `uns_path` | ltree | UNS address of this component |
| `plc_tag` | TEXT | Live-data binding to telemetry |

**Schema note:** Line 22-23 — "NOT a hard FK because cmms_equipment may live in a different schema/db in some deployments. Validated at the application layer."  
**Writers:** Component Knowledge system, UI  
**Readers:** Telemetry ingestion, diagnostic context  

---

## Scheme 5: Knowledge Entries (chunks, legacy + v2 dual-route)
**Canonical schema:** `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql:26-41`, augmented by `mira-hub/db/migrations/045_knowledge_entries_chunk_anchors.sql`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Chunk identity |
| `tenant_id` | UUID | Multi-tenancy |
| `doc_id` | UUID | Document grouping (v2 ingest route) |
| `equipment_entity_id` | UUID | Soft FK to kg_entities.id; populated by backfill (tools/migrations/backfill_equipment_entities.py) |
| `ingest_route` | TEXT | 'ow' (OpenWebUI legacy) or 'v2' (hub folder=brain) |
| `manufacturer`, `model_number` | TEXT | Metadata for backfill matching |

**Bridge to other schemes:**
- Equipment_entity_id → kg_entities.id → kg_entities.uns_path (chain for node-subtree retrieval per migration 045 comment)
- Backfill creates kg_entities rows from distinct (mfr, model) pairs in knowledge_entries

---

## Scheme 6: Mobile Asset Identity (QR + API)
**Source:** `mira-mobile/src/screens/ScanView.tsx`, `AssetsTab.tsx`, `api/resources.ts`

**QR payload:** String extracted by `extractAssetTag(text)` → resolves via `getAssetByTag(tag)` at `/api/assets/by-tag/{tag}/`  
**Asset interface:** (line 199-210)
- `id` (string) — the primary asset identity returned by API
- `tag` (string | null) — permanent QR identity (comment: "from equipment_number")
- `uns_path` (string | null) — displayed in detail view (line 127)

**API contract:** Asset `id` from Hub is opaque to mobile; mobile always uses `tag` for QR resolution, then uses returned `id` for detail.

---

## Scheme 7: UNS Resolver Context (mira-bots)
**Canonical:** `mira-bots/shared/uns_resolver.py:210-249`

**UNSContext dataclass fields:**
- `uns_path` (str | None) — the resolver's primary output (UNS string path)
- `manufacturer`, `product_family`, `model`, `fault_code` — extracted components
- `matched_entities` (list[dict]) — potential kg_entities matches
- `site_path` (str | None) — site-side UNS prefix

**Writers:** uns_resolver.resolve() (message context extraction)  
**Readers:** Diagnostic engine, DST, workers (persisted under `state["context"]["uns_context"]`)  
**Bridge to other schemes:** UNS path string used to query asset_agent_status, tag_events subtree

---

## Cross-Scheme Bridges

### Canonical asset identity vs equipment identity divergence:
1. **cmms_equipment.id (UUID)** — asset CMMS identity, mobile/UI primary key
2. **cmms_equipment.equipment_number (TEXT)** — QR code permanent handle, tenant-unique
3. **kg_entities.id (UUID, entity_type='equipment')** — knowledge graph node, supplier-agnostic
4. **kg_entities.uns_path (ltree)** — canonical ISA-95 address space, deployment gate key
5. **asset_agent_status.equipment_id (UUID)** — soft link to cmms_equipment.id
6. **asset_agent_status.uns_path (ltree)** — soft link to resolved UNS, indexed for gate queries

### Problematic dual-truth patterns:
- **No hard FK cmms_equipment ↔ kg_entities** — both tables exist independently; backfill (tools/migrations/backfill_equipment_entities.py) creates kg_entities nodes from knowledge_entries pairs, NOT from cmms_equipment
- **equipment_entity_id soft links** (migration 033, 046) signal the schema boundary — different databases in some deployments (installed_component_instances:22-23)
- **UNS path nullable in asset_agent_status** — asset may not have resolved UNS yet; gate must handle both equipment_id + uns_path lookups

### Single points of failure:
- QR binding: cmms_equipment.equipment_number → tag → mobile asset lookup (unique per tenant, not global)
- UNS compliance gate: asset_agent_status.uns_path GIST queries assume path is populated (nullable — potential gap)
- Deployment gate can fall back to equipment_id if uns_path missing (migration 046:25-26 comment)

---

## Verdict

**There are NOT ONE canonical asset identity, but FIVE distinct schemes:**

1. **cmms_equipment.id (UUID)** — CMMS system of record (mission-critical for site operations)
2. **cmms_equipment.equipment_number (TEXT)** — QR/mobile handle (permanent, tenant-unique)
3. **kg_entities.id + kg_entities.entity_id (UUID + TEXT)** — Knowledge graph node (supplier/model-centric)
4. **kg_entities.uns_path (ltree)** — ISA-95 canonical address (deployment gate key)
5. **UNSContext.uns_path (string)** — Message-context resolver output (ephemeral, per turn)

Each scheme serves a different architectural layer (CMMS, mobile, KG, telemetry, diagnostic). **None is canonical to all others.** Bridges are soft links (nullable, no hard FK) and dual-truth (independent creation, ad-hoc backfill). The deployment gate currently requires BOTH equipment_id and uns_path due to the nullable path and the schema-separation pattern.
