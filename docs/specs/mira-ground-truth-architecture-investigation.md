# MIRA Ground-Truth Architecture Investigation

**Status:** RESEARCH / DESIGN — not a build doc, not a spec replacement
**Authored:** 2026-05-18
**Owner:** Mike Harper
**Scope:** End-to-end audit of MIRA's data model, ingestion, and namespace layers, plus a forward-looking proposal grounded in industrial-data-exchange standards (ISA-95, AAS, IEC 61360, ECLASS, AutomationML, OPC UA, Sparkplug B, EDS/GSDML/IODD, EPLAN, PLCopen XML, B2MML).

**Reading order:** Sections 1–3 are *what we have today and where it fails*. Sections 4–11 are *what to build*. Section 12 is the standards backbone. Sections 13–16 are sequencing, open questions, and the single-page final proposal.

---

## Document parentage

This is an *investigation*, not a contract. The contracts of record remain:

- `docs/THEORY_OF_OPERATIONS.md` — North Star.
- `docs/specs/maintenance-namespace-builder-spec.md` — product-surface contract.
- `docs/specs/mira-component-intelligence-architecture.md` — implementation-level architecture for templates + KG.
- `docs/specs/uns-kg-unification-spec.md` — UNS authority.
- `docs/plans/2026-05-15-maintenance-namespace-builder.md` — phased execution.
- `ADR-0013` — Hub `mira-hub/db/migrations/` owns product-surface schema; engine `docs/migrations/` owns kg_entities / kg_relationships.

Where this doc and a contract disagree, the contract wins. This doc proposes *additive* extensions; it does not redefine the existing primitives.

---

## 1. Current-state codebase findings

### 1.1 What is shipped and verified on `origin/main`

**Memory layer (NeonDB).** Two schema families coexist:

- **Hub family** (`mira-hub/db/migrations/`, 001–024). Owns `kg_entities`, `kg_relationships`, `kg_triples_log`, the recursive `kg_asset_hierarchy` view, `component_templates`, `installed_component_instances`, `relationship_proposals`, `relationship_evidence`, `health_scores`, `wizard_progress`, `namespace_versions`, `troubleshooting_sessions`, `live_signal_events`, `live_signal_cache`, `diagnostic_trend_sessions`/`signals`, plus the Atlas-synced `cmms_equipment` / `work_orders` / `pm_schedules`. Tenant_id is `UUID NOT NULL` on every new table; RLS uses `current_setting('app.current_tenant_id'|'app.tenant_id')`.
- **Engine-family** (`docs/migrations/`, 001–008). Owns `knowledge_entries` (chunks + pgvector embeddings), `fault_codes`, `kg_entities` (parallel definition), `kg_relationships` (parallel definition), `kg_bridge`, `uns_path` add-on, `kg_approval_state` (the `approval_state` / `proposed_by` / `evidence_summary` enum bolt-on). Tenant_id is `TEXT`; no RLS.

The two `kg_entities` definitions differ materially: Hub keys on `(tenant_id, entity_type, entity_id)` and Hub's `tenant_id` is `UUID`; engine keys on `(tenant_id, entity_type, name)`, `tenant_id` is `TEXT`, and engine carries an `embedding vector(768)` column. Migration `024_kg_source_chunk_id.sql` exists *specifically because* the engine schema had `source_chunk_id` and the Hub schema didn't — silent upsert failures in `kg_writer.py` motivated the hotfix.

**Component intelligence (Hub 016/017/018).**

- `component_templates` is **not tenant-scoped** (shared catalog), keyed on `(manufacturer, model, version)`. Holds the dense JSONB blobs: `power_specs`, `input_output_specs`, `signal_behavior`, `pinout`, `environmental_limits`, `diagnostic_indicators`, `expected_signals`, `common_failure_modes`, `troubleshooting_steps`, `pm_checks`, `safety_notes`. Carries `verification_status` (`proposed` / `verified` / `rejected`) and `recommended_uns_template` + `uns_path` ltree.
- `component_template_sources` carries provenance: `source_type` (`manual`/`datasheet`/`print`/`technician_note`/`oem_kb`/`other`), `source_document_id` (soft FK to `knowledge_entries`), `page_numbers`, `excerpt`, `extraction_confidence`, `extracted_by` (`llm`/`human`/`import`/`rule`).
- `installed_component_instances` is tenant-scoped, references the template, and adds the deployment-side fields (`installed_location`, `panel`, `terminal`, `wire_number`, `plc_tag`, `mqtt_topic`, `uns_path`, `human_confirmed`, `confidence`, `aliases TEXT[]` GIN-indexed). The FK to `cmms_equipment.id` is **soft** (no DB constraint).
- `relationship_proposals` carries the controlled vocabulary (26 relationship types in the CHECK constraint) plus `confidence`, `status` (`proposed`/`reviewed`/`verified`/`rejected`/`deprecated`/`contradicted`), `created_by`, `risk_level` (`low`/`medium`/`high`/`safety_critical`), `requires_human_review`. `tenant_id` is nullable — catalog-level proposals are tenant-agnostic.
- `relationship_evidence` carries 1..N rows per proposal with `evidence_type` (`document_page`/`plc_rung`/`tag_list`/`work_order`/`technician_note`/`live_data`/`manifest`/`oem_kb`/`human_observation`) and `confidence_contribution` in `[-1, 1]` (negatives = contradictory).

**Namespace-builder surfaces (Hub 021).**

- `health_scores` keyed on `(tenant_id, scope, scope_path)`, holds `level` (0–6), `next_step`, and a `counts` JSONB with assets/components/docs/proposals/uns_paths/wizard_completed.
- `wizard_progress` keyed on `(tenant_id, wizard_kind)`, status enum, `step_payloads` JSONB.
- `namespace_versions` is an append-only audit (`operation` ∈ {move,rename,create,delete}, `from_state`/`to_state` JSONB, actor + actor_kind).
- `equipment_guest_reports` (022) — unauthenticated guest report path for QR scans.

**Live nervous system.**

- `mira-relay/relay_server.py` accepts Ignition JSON tag streams (`POST /ingest` + `WebSocket /ws`); writes only to local SQLite (`equipment_status`, `faults`); no NeonDB writes.
- `live_signal_cache` + `live_signal_events` in NeonDB are populated by the demo simulator, not by the relay.

**Resolver + engine.**

- `mira-bots/shared/uns_resolver.py` (~900 lines). `UNSContext` dataclass holds `uns_path`, `manufacturer`, `manufacturer_alias`, `product_family`, `model`, `fault_code`, `fault_code_raw`, `category`, `site_path`, `matched_entities`, `matched_kb_count`, `confidence`. `resolve_uns_path()` runs a 4-stage pipeline: fault-code regex → vendor alias → model token → DB enrichment. `resolve_uns_path_multi()` filters chimeric vendor/model pairs via `kb_has_pair_coverage`.
- `mira-bots/shared/engine.py` (`Supervisor`, ~4600 lines). Fires the **UNS Confirmation Gate** at line 1316 when all four conditions hold: gate enabled, `router_intent='diagnose_equipment'`, no `asset_identified`, FSM in IDLE. Enters `AWAITING_UNS_CONFIRMATION` side state.
- `mira-bots/shared/neon_recall.py`. Four-stream RRF recall (vector, BM25, fault-code structured, product-name-reranked). Reads `knowledge_entries`, `fault_codes`. PR #1385 ungated BM25 from the embedding-availability gate.
- `mira-bots/shared/citation_compliance.py`. Currently observational only — emits `CITATION_COMPLIANCE_MISS`/`_OK` log lines; never blocks.
- `mira-bots/shared/uns_paths.py` is a manually-duplicated copy of `mira-crawler/ingest/uns.py` because `mira-bots` cannot import `mira-crawler` (architecture wall enforced by `tests/test_architecture.py`).

**Ingestion.**

- `mira-crawler/ingest/full_ingest_pipeline.py` is the canonical PDF→KG path: download → Docling → chunk → embed (Ollama `nomic-embed-text`) → `knowledge_entries` → `kg_writer.register_equipment_and_manual()` + `register_fault_code()` + `link_chunk_to_equipment()`.
- `mira-core/mira-ingest/main.py` is the REST gateway (`/ingest/photo`, `/ingest/document-kb`, `/ingest/scrape-trigger`). Photo path writes to local SQLite `equipment_photos` only — **no KG write**.
- `mira-bots/shared/workers/nameplate_worker.py` extracts `{manufacturer, model, serial, voltage, fla, hp, frequency, rpm}` from photos via cloud cascade. Writes to session state only — **no KG entity created**.
- `tools/load_manifest_to_kg.py` reads `research/variable-manifest.json` (the conveyor demo data) and writes `kg_entities` + `relationship_proposals` + `relationship_evidence` with safety-critical flagging for E-stop / interlock mappings.
- `tools/build_component_template.py` selects `knowledge_entries` chunks for a (manufacturer, model) pair, runs structured extraction via the cascade, and produces a `component_templates` row.

**Existing UNS path grammar** (canonical, both `mira-bots/shared/uns_paths.py` and `mira-crawler/ingest/uns.py`):

- KB pole: `enterprise.knowledge_base.<mfr>[.<family>].<model>.{manuals,fault_codes,pm_schedule,parts_list}`
- Site pole: `enterprise.<tenant>.site.<s>.area.<a>.line.<l>.work_cell.<c>.equipment.<eq>` (Hub 015 extension)

### 1.2 The conveyor reality (research/variable-manifest.json)

The demo asset is a Micro820-driven conveyor with a GS10 VFD, 4 DIs in use (E-stop NC+NO, direction selector FWD/REV, fault reset, sensors 1+2), 4 DOs in use (Green/Red LEDs, safety contactor Q1, PB Run LED), and ~50 named program variables. Modbus map: HR:101 motor_speed, HR:102 motor_current, HR:103 temp, HR:104 pressure, HR:105 conveyor_speed, HR:106 error_code, HR:107–110 VFD output (freq/current/voltage/dc_bus), HR:111 item_count, HR:112 uptime, HR:113 speed_cmd, HR:114 conv_state, HR:115 vfd_cmd_word, HR:116 freq_setpoint. 16 documented gaps — mostly unassigned I/O bits and absent terminal labels (no wiring diagram in the repo). E-stop is dual-wired NC+NO with wiring-fault detection; direction selector has a both-active fault path. **These are exactly the relationships the design must express.**

---

## 2. Existing relevant models / tables / services / routes / jobs

| Domain | Asset | Purpose | Layer |
|---|---|---|---|
| Hierarchy + identity | `kg_entities` (Hub + engine, dual) | All nodes — site, asset, component, tag, fault | Memory |
| Hierarchy + identity | `kg_relationships` (Hub + engine, dual) | All typed edges, with `approval_state` | Memory |
| Hierarchy + identity | `cmms_equipment` | Top-level assets, Atlas-synced | Memory |
| Hierarchy + identity | `installed_component_instances` | Component deployments | Memory |
| Catalog | `component_templates` + `component_template_sources` | Per-model knowledge | Memory |
| Evidence | `knowledge_entries` (pgvector) | Document chunks | Evidence |
| Evidence | `fault_codes` | Structured fault catalogue | Evidence |
| Evidence | `equipment_photos` (SQLite, local) | Photo blobs | Evidence — local only |
| Proposal layer | `relationship_proposals` + `relationship_evidence` | Pre-verification edges | Memory (queue) |
| Proposal layer | `ai_suggestions` (spec'd 021, columns evolved) | Hub-facing proposal queue | Memory (queue) |
| Confirmation gate | `troubleshooting_sessions` (019) | Per-conversation context | Engine |
| Confirmation gate | `mira-bots/shared/uns_resolver.py` | Extraction + UNS path | Engine |
| Live data | `mira-relay/relay_server.py` | Ignition tag stream → SQLite | Live |
| Live data | `live_signal_cache` + `live_signal_events` (020) | Demo-simulator only | Live |
| Live data | `diagnostic_trend_sessions/signals` (020) | Watched-tags during diagnosis | Live |
| Readiness | `health_scores` (021) | L0–L6 + next-step | Readiness |
| Readiness | `wizard_progress` (021) | Onboarding state | Readiness |
| Audit | `namespace_versions` (021) | Append-only edits | Audit |
| Audit | `kg_triples_log` | Append-only LLM extractions | Audit |
| Audit | `cmms_sync_state` / `cmms_sync_conflicts` | Atlas sync ledger | Audit |
| QR / mobile | `cmms_equipment.qr_generated_at` + `parent_asset_id` (012) | QR binding, permanent | UX |
| QR / mobile | `equipment_guest_reports` (022) | Unauthenticated guest reports | UX |
| Tools | `tools/load_manifest_to_kg.py` | Conveyor variable manifest → KG + proposals | Build |
| Tools | `tools/build_component_template.py` | KB chunks → component template | Build |

**Routes/jobs (Hub + MCP):**

- Hub: `/api/v1/namespace/tree`, `/proposals`, `/proposals/:id/decide`, `/readiness`, `/wizard`, `/qr`, `/m/[assetTag]` family — per spec, partially shipped.
- MCP: `kg_search_entities`, `kg_propose_edge`, `kg_approve_suggestion`, `namespace_resolve` (per spec); existing CMMS tool surface fully shipped.
- Ingest (mira-core/mira-ingest): `/ingest/photo` (no KG write), `/ingest/document-kb` (writes `knowledge_entries`), `/ingest/scrape-trigger`.
- Relay: `/ingest` + `/ws` (Ignition tag stream; SQLite only).

---

## 3. Gaps and risks

Ordered by what blocks the May 21 conveyor demo first.

### 3.1 Demo-blocking gaps

1. **Photo → KG is broken.** `mira-core/mira-ingest /ingest/photo` and `nameplate_worker.py` both write to local SQLite / session state, not to `kg_entities` or `installed_component_instances`. A technician's photo of the GS10 nameplate does not produce a proposal. This is the single biggest demo gap — the headline loop ("photo → component profile → grounded answer") doesn't close yet.
2. **No `ai_suggestions` queue.** Spec'd in 021; in the actual migration the work-queue table is partially merged (`relationship_proposals` is the catalog-side queue; the spec's `ai_suggestions` carrying `suggestion_type` ∈ {`kg_edge`,`kg_entity`,`tag_mapping`,`component_profile`,`uns_confirmation`,`namespace_move`} is not landed). The Hub `/proposals` page has nothing to render.
3. **No PLC-tag CSV ingestion path.** `load_manifest_to_kg.py` accepts the JSON manifest format, not a raw Rockwell L5X tag export or an Ignition CSV. The spec lists `POST /api/v1/ingestion/tag-import`; no MCP route exists.
4. **`installed_component_instances.asset_id` is a soft FK.** Deletion of a `cmms_equipment` row leaves orphan instances.
5. **Wiring isn't represented as a first-class shape.** Today wiring is `kg_relationships` with `relationship_type='WIRED_TO'` and free-text properties; there is no schema for `(source_device, source_terminal, dest_device, dest_terminal, wire_number, gauge, color)` — which is exactly what the EPLAN / AML model gives for free.
6. **UNS resolver Stage-3 enrichment is a no-op in production.** Code path is skipped when called from inside an asyncio loop (which the engine always is); `matched_entities` and `matched_kb_count` are therefore always empty. Confidence scoring suffers silently.

### 3.2 Structural risks

7. **Dual KG schema.** ADR-0013 names Hub authoritative for product-surface; engine for kg_entities/relationships. But the two `kg_entities` definitions disagree on dedup key (`entity_id` vs `name`) and tenant_id type (`UUID` vs `TEXT`). Until one is *demonstrably* read by all writers, every cross-table reasoning is fragile.
8. **Citation compliance is observational.** Spec calls for enforcing mode once the UNS gate succeeds. Today the citation check never blocks.
9. **No source-of-record for component_template per-instance overrides.** A customer's GS10 may have a non-standard parameter set (different motor poles, custom fault threshold). There's no "delta" structure to hold per-instance variation that still inherits from the template.
10. **No standardized property dictionary.** Field names like `voltage_v`, `current_a`, `horsepower_hp` are coined inline. IEC 61360 / IEC CDD provides IRDIs for these (every property has a globally-unique identifier). Without that, two customers' "voltage" fields can drift apart in meaning.
11. **No fault-code → manual section anchoring.** `fault_codes` table has the code + description; manuals chunked in `knowledge_entries` are not deep-linked by page number for each fault code. A "what does F0004 mean on a PowerFlex 525" query relies on RAG retrieval, not a structural edge.
12. **Tenant_id type drift.** Hub UUID, engine TEXT, guest reports TEXT. Joins across these need casts and can silently miss rows. Has bitten production at least once (migration 024).
13. **No live-data ↔ template binding.** A Sparkplug metric path could be canonical (`spBv1.0/orlando/DDATA/edge1/conveyor_b16`) but there's no schema linking that path to either a `component_template`'s expected signals or to a tag entity.
14. **No "expected" knowledge for proactive checks.** A component template lists `expected_signals`, but there's no way to evaluate "is the live signal within expectation?" against `live_signal_cache`. Diagnostic logic is purely after-the-fact.
15. **`installed_component_instances.plc_tag` is a string, not a typed reference.** A renamed tag breaks the join silently.

### 3.3 Process risks (caught only by audit)

16. **Reserved-label and slug bugs.** `uns.RESERVED_LABELS` exists; tests are sparse. A misconfigured importer can land an entity at `enterprise.harper.site.site` and not be caught until query time.
17. **Approval-state default `verified` on backfill.** Correct historically, dangerous going forward — a new bot writer that forgets `approval_state='proposed'` silently lands as verified.
18. **No "this evidence retracted" path.** `relationship_evidence.confidence_contribution` is `[-1, 1]` but there's no flow that decreases an entity's confidence when its underlying chunk is deleted.

---

## 4. Recommended architecture

### 4.1 Operating principle

**Universal component knowledge (what a thing IS) lives in a shared catalog; site-specific knowledge (where a thing IS, how it's wired, and what tag publishes it) lives tenant-scoped.** Every fact carries provenance to a source document, page, work order, or technician confirmation. The proposal layer is the only path from "LLM said so" to "verified in graph." Confirmation by a human is the only path from `proposed` to `verified`.

This is what the existing schema already encodes structurally. The work is hardening it.

### 4.2 Six layers, top-down

```
┌───────────────────────────────────────────────────────────────────────┐
│  Layer 1 — Front Doors        Slack · Hub · /m/[assetTag] · Telegram  │
├───────────────────────────────────────────────────────────────────────┤
│  Layer 2 — Engine             UNS Gate · FSM · Cascade · Citations    │
├───────────────────────────────────────────────────────────────────────┤
│  Layer 3 — Live Context       Sparkplug B / Ignition relay · MQTT     │
│  (read-only)                  live_signal_cache  diagnostic_trend_*    │
├───────────────────────────────────────────────────────────────────────┤
│  Layer 4 — Memory             kg_entities · kg_relationships          │
│  (verified facts)             cmms_equipment · pm_schedules           │
│                               installed_component_instances           │
├───────────────────────────────────────────────────────────────────────┤
│  Layer 5 — Catalog            component_templates · _sources          │
│  (universal knowledge)        fault_codes · ECLASS class map          │
├───────────────────────────────────────────────────────────────────────┤
│  Layer 6 — Evidence + Queue   knowledge_entries (pgvector)            │
│                               relationship_proposals · _evidence      │
│                               ai_suggestions (work queue)             │
│                               kg_triples_log · namespace_versions     │
└───────────────────────────────────────────────────────────────────────┘
```

Layer 5 (Catalog) is **not tenant-scoped**. Layer 4 (Memory) IS tenant-scoped. The clean separation is the most important architectural commitment in this doc — see §8 and §9.

### 4.3 The three name-spaces

MIRA already mixes three naming systems. Make them explicit:

- **UNS ltree path** — addressable structural location in the plant (site / area / line / asset / component) and in the knowledge base (mfr / family / model). Authoritative *address*. Existing.
- **Global asset id (UUIDv7)** — content-free identity for every node, stable across renames/moves. Already on `kg_entities.id`. Authoritative *identity*.
- **External ids** — opaque foreign keys (Atlas equipment_number, Ignition tag path, ECLASS IRDI, ECCMA IRDI, OPC UA NodeId, Sparkplug metric name, MaintainX assetId). Already partially shipped (`external_ids` migration 013, `atlas_id` column). Authoritative *interop*.

A node has one `id`, one `uns_path`, and zero-or-more `external_ids`. The UNS path can change (a line is renumbered, a machine is moved). The id never changes. The external ids can multiply over time as more systems are integrated.

### 4.4 Five canonical entity flavors

Today `kg_entities.entity_type` is free-text. Tighten to five canonical flavors and let `properties` JSONB carry the rest. The constraints aren't enforced at the DB layer — they're enforced by the writers (`kg_writer.py`, the new ingestion workers, and the proposal-approval job).

| Flavor | Examples | Tenancy | Key shape |
|---|---|---|---|
| **Location** | enterprise, site, area, line, work_cell, equipment_position | Tenant | `uns_path` + name |
| **Asset** | machine, conveyor, panel, cabinet | Tenant | `uns_path` + cmms_equipment FK |
| **Component instance** | this GS10 mounted in panel A1 at terminal X3 | Tenant | `uns_path` + `template_id` (FK) + `installed_component_instances` FK |
| **Component template** | "AutomationDirect GS10 — 1HP / 230V class" | **None** (global) | `(manufacturer, model, version)` |
| **Reference** | fault code, document, parts list, PM rule, tag, terminal | Mixed (catalog if mfr-bound, tenant if customer-bound) | per type |

This isn't new — it's drawing a hard line where the existing schema is fuzzy.

### 4.5 Two write paths

Today there are at least four writers (engine, crawler, ingest API, manifest tool). Consolidate to two:

- **Catalog writer** — only writes Layer 5 + Layer 6 (Evidence). Tenant-agnostic. Source: structured manufacturer files, OEM manuals, datasheets. Tools: `tools/build_component_template.py`, manual ingest workers.
- **Tenant writer** — only writes Layer 3 (Live, read-only side-table caches) and Layer 4 (Memory). Tenant-scoped. Source: technician input, CMMS sync, scan binding, tag import, manifest import. Tools: nameplate worker (new KG write), tag importer, scan handler, the Hub editor.

Both write through `ai_suggestions` if the input has any ambiguity (LLM-derived, low-confidence, or safety-critical). Catalog promotion is a separate admin gesture.

---

## 5. Recommended database / schema changes

Migrations slot into the existing numbering. None of these are required for the May 21 demo; they're for the next 90 days.

### 5.1 Tenant-id canonicalization (one-time)

Decide: `tenant_id` is `UUID NOT NULL` everywhere, period. Two prerequisites: `equipment_guest_reports.tenant_id` (TEXT → UUID) and the engine-side `docs/004` schema (TEXT → UUID). Engine writes must `::uuid` cast at the boundary. Pre-cast at the application layer to surface the bad cases. This is one migration; cheap, important.

### 5.2 Hard FKs where soft FKs leave orphans

- `installed_component_instances.asset_id` → `cmms_equipment.id ON DELETE SET NULL`.
- `relationship_evidence.source_id` is intentionally polymorphic (manual, WO, tag, photo) and can stay soft, but add a `source_kind` column (`knowledge_entry`/`work_order`/`tag_entity`/`photo`/`session`) so soft-FK semantics are inspectable from a SQL query.

### 5.3 New tables

**`ai_suggestions`** (per `maintenance-namespace-builder-spec.md` §Data Model). Add now — it's the missing Hub work-queue. Spec's column shape is correct; tighten `suggestion_type` to a CHECK constraint and partial index on `(tenant_id, status, created_at DESC) WHERE status='pending'`.

**`wiring_connections`** (new). Wiring is too important to live in `kg_relationships.properties` JSONB. Promote to:

```sql
CREATE TABLE wiring_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_entity_id UUID NOT NULL,            -- kg_entities, type='component_instance' or 'terminal'
  source_terminal TEXT NOT NULL,             -- 'X1:3', 'TB2-14', 'COIL:6'
  dest_entity_id UUID NOT NULL,
  dest_terminal TEXT NOT NULL,
  wire_number TEXT,
  gauge_awg INTEGER,
  color TEXT,
  function_class TEXT,                       -- 'power' | 'signal' | 'safety' | 'comm' | 'ground'
  drawing_reference TEXT,                    -- 'ENG-PL-4472, Sheet 12'
  approval_state TEXT NOT NULL DEFAULT 'proposed',
  proposed_by TEXT,
  evidence_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON wiring_connections (tenant_id, source_entity_id);
CREATE INDEX ON wiring_connections (tenant_id, dest_entity_id);
CREATE INDEX ON wiring_connections (tenant_id, wire_number);
ALTER TABLE wiring_connections ENABLE ROW LEVEL SECURITY;
-- RLS: tenant_id = current_setting('app.current_tenant_id')::UUID
```

Aligns with AML `InternalLink` and EPLAN connection model. `kg_relationships` keeps the `WIRED_TO` summary edge for graph traversal; the wire metadata lives here.

**`tag_entities`** (new). Lift PLC / Sparkplug tags out of `kg_entities` properties into a typed table so renames, type checks, and live-value joins are deterministic:

```sql
CREATE TABLE tag_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  uns_path LTREE NOT NULL,
  sparkplug_topic TEXT,                      -- 'spBv1.0/.../conveyor_b16/sensor_1'
  opcua_node_id TEXT,
  symbolic_name TEXT NOT NULL,               -- 'sensor_1_active'
  data_type TEXT NOT NULL,                   -- 'BOOL'|'INT16'|'INT32'|'REAL'|'STRING'
  units TEXT,                                -- 'rpm'|'A'|'V'|'°C'|'psi'|'0.1Hz'
  scaling JSONB,                             -- {raw_min, raw_max, eng_min, eng_max}
  source_kind TEXT NOT NULL,                 -- 'plc_address'|'modbus_register'|'sparkplug_metric'|'opcua_variable'
  source_address TEXT NOT NULL,              -- '%IX0.5' or 'HR:101' or NodeId string
  component_instance_id UUID REFERENCES installed_component_instances(id) ON DELETE SET NULL,
  expected_envelope JSONB,                   -- {min, max, normal_range, fault_states[]}
  approval_state TEXT NOT NULL DEFAULT 'proposed',
  proposed_by TEXT,
  evidence_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, uns_path)
);
CREATE INDEX ON tag_entities USING GIST (uns_path);
CREATE INDEX ON tag_entities (tenant_id, source_address);
ALTER TABLE tag_entities ENABLE ROW LEVEL SECURITY;
```

**`property_dictionary`** (new, catalog-shared). Holds the IEC-61360 / IRDI-backed standard property names so component template fields aren't free-text:

```sql
CREATE TABLE property_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  irdi TEXT,                                 -- '0173-1#02-AAR996#001' (ECLASS rated voltage)
  preferred_name TEXT NOT NULL,              -- 'rated_voltage'
  data_type TEXT NOT NULL,                   -- 'REAL'|'INTEGER'|'STRING'|'BOOLEAN'|'ENUM'
  unit TEXT,                                 -- 'V'|'A'|'Hz'|'rpm'
  source TEXT NOT NULL,                      -- 'eclass_16'|'iec_cdd'|'idta_nameplate'|'mira_internal'
  description TEXT,
  value_list JSONB,                          -- for ENUM
  UNIQUE (irdi)
);
```

`component_templates.power_specs` etc keep their JSONB shape, but each key inside JSONB should be a `preferred_name` from this table. Add an application-layer linter, not a DB constraint.

**`component_template_overrides`** (new, tenant-scoped). The "this customer's GS10 is special" delta:

```sql
CREATE TABLE component_template_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  installed_instance_id UUID NOT NULL REFERENCES installed_component_instances(id) ON DELETE CASCADE,
  property_name TEXT NOT NULL,               -- from property_dictionary.preferred_name
  value JSONB NOT NULL,
  reason TEXT,
  evidence_summary JSONB,
  approval_state TEXT NOT NULL DEFAULT 'proposed',
  UNIQUE (tenant_id, installed_instance_id, property_name)
);
```

### 5.4 Light schema enhancements

- Add `external_ids JSONB DEFAULT '{}'` to `installed_component_instances` for ECLASS class, IRDI, OPC UA NodeId, Sparkplug metric (mirror the pattern used on `cmms_equipment`).
- Add a partial index `WHERE approval_state='proposed'` on `kg_entities` and `kg_relationships` to make the proposal feed fast.
- Add a `lifecycle TEXT NOT NULL DEFAULT 'active' CHECK IN ('active','retired','replaced','planned')` to `installed_component_instances` for the "I just swapped the photoeye" flow.

---

## 6. Recommended ingestion pipeline changes

Close the photo-loop first. Sequence everything else after.

### 6.1 Photo → KG (the demo gap)

Today: `POST /ingest/photo` writes `equipment_photos` SQLite; nameplate worker writes session state. Neither writes KG.

Proposal: a single new worker `mira-bots/shared/workers/photo_ingest_worker.py` that runs after `nameplate_worker.extract()` and:

1. Resolves the candidate `(manufacturer, model)` against `component_templates`. If a template exists, propose an `installed_component_instances` row (`approval_state='proposed'`). If not, propose a new `component_templates` row (also proposed).
2. Resolves the candidate asset context from the technician's session (UNS gate output) or the QR scan (`/m/[assetTag]`).
3. Writes one `ai_suggestions` row per proposed entity + one per proposed edge.
4. Writes the photo blob to NeonDB-attached object storage (S3-compatible; not local SQLite) with a `relationship_evidence` row pointing back at it.

This is the loop that closes the May 21 demo. Wire it before anything else.

### 6.2 PDF → catalog + KG

Already shipped. Hardening:

- Surface manual chunks that successfully extract a fault code as `relationship_evidence` for the corresponding `fault_codes` row, with `evidence_type='document_page'` and `page_or_location` = page number. Today the link is on `knowledge_entries.equipment_entity_id` only.
- When `build_component_template.py` runs, write a proposed `component_template` *and* a proposed edge to each fault code mentioned by the manual.

### 6.3 PLC tag CSV / L5X / GSDML ingestion (new)

Add `POST /api/v1/ingestion/tag-import` (per spec) with three accepted shapes:

- **Ignition CSV** — columns `tag_path,description,data_type,units`. Most common.
- **Rockwell L5X** — extract `<Tags>` + `<DataTypes>`. Each `<Tag>` → proposed `tag_entities` row + proposed UNS path + proposed `belongs_to` edge to the inferred asset.
- **Variable manifest** (today's `research/variable-manifest.json` shape) — already supported by `load_manifest_to_kg.py`. Keep as a third accepted shape.

For each row, an LLM cascade classifier proposes `category` (signal_input/signal_output/fault/alarm/command/status/setpoint/process_value/diagnostic), candidate component type, and a suggested UNS path. Every row → one `ai_suggestions` of type `tag_mapping`.

### 6.4 Structured manufacturer files (new, per §13)

`mira-crawler/ingest/extractors/` gets three new modules: `eds_parser.py`, `gsdml_parser.py`, `iodd_parser.py`. Each maps the manufacturer file directly to a `component_templates` row plus per-parameter `tag_entities` (for I/O assemblies, slot-subslot maps, process data). Confidence = 0.95 (multi-source, verifiable) — these are the high-quality sources.

### 6.5 EPLAN macro → wiring (new, post-MVP)

`mira-crawler/ingest/extractors/eplan_parser.py`. Reads EPLAN AML or `<EPLANArticle>` XML. Each terminal connection → proposed `wiring_connections` row. Each article master → proposed `component_template`. This is where the May 21 conveyor's wiring diagram will land when committed.

### 6.6 Live data (relay → NeonDB)

`mira-relay` currently writes SQLite. Add a NeonDB-backed write path for `live_signal_events` so the trend-diagnostic flow has real data. Already speculative in `live_signal_events` (migration 019); the worker just needs to be wired to publish.

---

## 7. Recommended document evidence model

The current evidence model is sound but under-used. Three changes harden it:

1. **`relationship_evidence.source_kind` (new column).** Today the polymorphic `source_id` UUID has no inspectable type — you have to know which table it refers to. A `source_kind` enum (`knowledge_entry`/`work_order`/`tag_entity`/`photo`/`session`/`manifest_row`/`technician_note`/`live_event`) lets a generic UI render evidence without joining ten tables.
2. **Page-level anchoring.** Every chunk extracted from a manual should carry its page number in `knowledge_entries.metadata` (it already does in some cases — make it required and indexed). Evidence rows quote a chunk *plus* a page; today they sometimes quote a chunk only.
3. **Retraction propagation.** When a `knowledge_entries` row is deleted (manual re-ingested, dedup conflict resolved), every `relationship_evidence.source_id` pointing at it must be soft-marked `retracted`. The associated `relationship_proposals` confidence should be recomputed downward. Add a `retraction_job` that runs after every dedup operation.

The evidence model already supports `confidence_contribution ∈ [-1, 1]` — negative-contribution rows are *contradictions*. The proposal-approval job should sum contributions to compute total confidence, surface contradictions on the Hub `/proposals` review card, and never auto-verify in the presence of unresolved negative evidence.

---

## 8. Recommended component profile model (universal knowledge)

**Shape:** the existing `component_templates` schema is correct. Three additions:

- **`semantic_id`** — IRDI to ECLASS class or IDTA submodel template. Lets two customers' "GS10 VFD" templates merge without manual reconciliation.
- **`expected_signals` is already JSONB[]; add a schema.** Each entry: `{property_name (from property_dictionary), envelope: {nominal, min, max}, fault_states: [...]}`. Today the array is free-shape.
- **Component-type taxonomy alignment.** Today `component_type` is free text ("proximity_sensor", "vfd"). Add a mapping to ECLASS class IRDIs and OPC UA Companion Spec object types in a side table; gate new component_type values through it.

**Granularity rule:** A template is *per-model*, not per-part-number. PowerFlex 525 with a different keypad option is still one template. Per-instance variation (different motor wiring, different parameter set) goes in `component_template_overrides`. Per-version variation (firmware revision) becomes a new template version (existing `version` column).

**Inheritance:** A "PowerFlex" base template can be referenced by "PowerFlex 525" and "PowerFlex 755" via a `parent_template_id` self-FK. Properties inherit unless overridden. This is how the catalog scales — base behavior shared, model-specific overrides cleanly separated. Add the column; defer the resolution code until 5 templates exist that would benefit.

**Promotion path:** templates are born `proposed`. A `verified` template requires either (a) two independent sources (manual + datasheet, OR manual + EDS/GSDML) confirming ≥80% of fields, or (b) admin override with reason. The `confidence` of every property is independently tracked via `component_template_sources`.

---

## 9. Recommended site-specific component instance model

**Shape:** `installed_component_instances` is correct in structure. Five hardening edits:

1. **Promote `plc_tag` (string) to `plc_tag_id` (FK to `tag_entities`).** Eliminate the rename-breaks-join risk.
2. **`mqtt_topic` becomes `sparkplug_topic` + `sparkplug_metric_name` (two columns).** Sparkplug structure (`spBv1.0/<group>/<msg_type>/<edge>/<device>` + metric name) is structurally distinct from raw MQTT.
3. **Add `lifecycle` (per §5.4)** — `active`/`retired`/`replaced`/`planned`. "Photoeye PE-B16-2 replaced 2026-05-12, was-S/N 4471, new-S/N 4523" is a `lifecycle='replaced'` event with an edge to the new instance. This is how the namespace tracks reality over time.
4. **Add `replaced_by_id UUID REFERENCES installed_component_instances(id)`.** Same row.
5. **`asset_id` becomes a hard FK** (with `ON DELETE SET NULL`).

**UNS path for instance:** follows the existing site grammar. Example for the conveyor demo:

```
enterprise.harper.orlando.site.main.area.packaging.line.5.work_cell.sorting.equipment.conveyor_b16.component.photoeye_b16_2
```

**Per-instance external ids:**

- `external_ids.cmms_equipment_id` (Atlas)
- `external_ids.qr_asset_tag` (matches `cmms_equipment.asset_tag`)
- `external_ids.opcua_node_id`
- `external_ids.sparkplug_metric`

**Joining live data:** `tag_entities.component_instance_id` → `installed_component_instances.id` → `live_signal_cache.plc_tag` is the chain. The chain works today by string match on the tag name; with the new schema it works by UUID. Faster, lossless.

---

## 10. Recommended conveyor modeling approach

Apply the architecture to the May 21 demo target (Micro820 + GS10 conveyor) so the design has a concrete shape.

### 10.1 Hierarchy

```
enterprise.harper.orlando.site.main.area.packaging.line.5.work_cell.sorting.equipment.conveyor_b16
```

Children of `conveyor_b16`:

```
component.motor.m1                 (3-phase induction, 1HP, 4-pole)
component.vfd.gs10                 (AutomationDirect GS10)
component.plc.micro820             (Allen-Bradley/Rockwell Micro820)
component.contactor.q1             (safety contactor)
component.estop.es1                (NC+NO 2-channel)
component.photoeye.pe_1            (DI_05 / Sensor 1)
component.photoeye.pe_2            (DI_06 / Sensor 2 / SensorEnd)
component.selector.dir_sw          (FWD/REV selector switch)
component.pushbutton.fault_reset
component.indicator.led_green
component.indicator.led_red
component.indicator.led_pb_run
panel.a1                            (the cabinet)
panel.a1.terminal_strip.tb1
panel.a1.terminal_strip.tb2
```

### 10.2 Component templates (catalog rows)

One per model. Initial set for the demo: `AutomationDirect/GS10`, `Rockwell/Micro820`, generic `proximity_sensor`, generic `photoeye`, generic `safety_contactor`, generic `estop_2ch_nc_no`, generic `2-position_selector`. Each carries `expected_signals` keyed against `property_dictionary` entries.

### 10.3 Tag entities (typed)

The conveyor manifest produces, per the recommended schema:

- ~12 `tag_entities` for the DI/DO bits (each with `source_kind='plc_address'`, `source_address='%IX0.5'` etc).
- ~16 `tag_entities` for the modbus holding registers (each with `source_kind='modbus_register'`, `source_address='HR:101'` etc).
- ~20 `tag_entities` for the program variables exposed over Modbus (E-stop status, dir flags, fault alarm, motor running, conveyor state, error code).
- 4 `tag_entities` for the Ignition-written setpoints (`vfd_cmd_word`, `vfd_freq_setpoint`, `conveyor_speed_cmd`, `fault_reset_cmd`).

Each typed tag has `component_instance_id` pointing to the right component, e.g., `vfd_frequency` (HR:107) → `installed_component_instances` row for the GS10.

### 10.4 Wiring connections

From the manifest's wiring notes + ladder logic, the demo populates ~20 `wiring_connections` rows. Highlight ones:

- `(estop_es1, "T1")` ↔ `(panel_a1.tb2, "14")`, wire `W-014`, function_class=`safety` (NC contact)
- `(estop_es1, "T2")` ↔ `(panel_a1.tb2, "15")`, wire `W-015`, function_class=`safety` (NO contact)
- `(panel_a1.tb2, "14")` ↔ `(micro820, "I-02")`, wire `W-014` (same wire continued)
- `(panel_a1.tb2, "15")` ↔ `(micro820, "I-03")`, wire `W-015`
- `(micro820, "O-02")` ↔ `(contactor_q1, "A1")`, wire `W-Q1-A1`, function_class=`safety`
- `(contactor_q1, "L1/T1")` ↔ `(vfd_gs10, "L1/R")`, function_class=`power`
- `(vfd_gs10, "T1/U")` ↔ `(motor_m1, "U")`, function_class=`power`
- `(photoeye_pe_1, "OUT")` ↔ `(micro820, "I-05")`, wire `W-PE1`, function_class=`signal`

Until the wiring diagram lands, every row is `approval_state='proposed'`, `proposed_by='llm:manifest'`, `requires_human_review=true` for safety_critical edges (E-stop + contactor + interlocks).

### 10.5 Fault associations

`error_code` (HR:106) is the LLM-readable fault code register: 7=estop, 8=dir_fault, 9=vfd_comm. Map each to a `fault_codes` row:

- `("conveyor", "7", "E-stop active")` → `OCCURS_ON` `conveyor_b16` → `RESOLVED_BY` work-order template "Verify E-stop wiring + reset"
- `("conveyor", "8", "Direction fault: both FWD/REV active")` → `OCCURS_ON` `dir_sw`
- `("conveyor", "9", "VFD comms timeout")` → `OCCURS_ON` `vfd_gs10` → `WIRED_TO` `micro820` (Modbus RS-485)

The VFD itself has its own fault catalogue (GS10 manual). Those F-codes (F0001..) are `fault_codes` rows linked to the GS10 *template*, not to this specific instance — they're universal.

### 10.6 Live binding

Once the Ignition relay is wired to NeonDB writes, `live_signal_cache` rows arrive keyed on `plc_tag` (string today, `tag_entities.id` after schema change). The diagnostic engine can then ask "what's the current value of `vfd_frequency` on `conveyor_b16`?" with one join: `tag_entities` (by id) → `live_signal_cache` (by tag_path). Today that join is fragile because `plc_tag` strings can drift.

---

## 11. Recommended PLC / tag / bit mapping approach

### 11.1 The model

Every PLC tag, every bit, every Modbus register, every Sparkplug metric, every OPC UA Variable is a single `tag_entities` row. The row carries:

- A UNS path (one location in the namespace, immutable per-row — renames create a new row + replace edge)
- A `source_kind` + `source_address` (the canonical native address — `%IX0.5`, `HR:101`, `Line5.B16.PE2_Occupied`, `ns=4;s=Conveyor.B16.PE2`)
- Optional alternate addresses in `external_ids` (Sparkplug metric, MQTT topic, OPC UA NodeId)
- An `expected_envelope` for proactive checks (when live data exceeds the envelope, surface a flag — *not* a write)
- A FK to `installed_component_instances` (which physical component this tag represents)
- An `approval_state`

### 11.2 The address grammar

Three address kinds, recognized by `source_kind` + a parser:

- **PLC native** — `%IX0.5` (IEC 61131-3), `B3:0/4` (Rockwell), `M100.0` (Siemens). Stored as the original literal.
- **Modbus** — `HR:101` (holding register), `COIL:6`, `IR:12` (input register), `DI:0`. Stored as `<KIND>:<NUMBER>`.
- **Symbolic** — `Line5.B16.PE2_Occupied` (Ignition / OPC UA path). Stored as the dot-path.

The native address is the source of truth. The UNS path is a *derived* canonical name that the human-facing UI uses ("Photoeye PE-B16-2 — currently Occupied"). The Sparkplug metric is what the live broker publishes. These three are linked but not identical.

### 11.3 Mapping pipeline

Per the §6 ingestion changes, three pipelines feed `tag_entities`:

- **L5X / GSDML / IODD** — high-confidence, structured, idempotent.
- **Ignition CSV** — medium-confidence, structured, lots of fields blank.
- **Manifest JSON / OCR of ladder docs** — low-confidence, free-text, every row a proposal.

For each tag a per-row classifier proposes its component-instance binding. The binding is what makes the tag useful — without it, a tag is just a string. The proposal is reviewed in the Hub `/proposals` queue.

### 11.4 Live data flow

```
Ignition broker
   │ Sparkplug B (NBIRTH, DBIRTH, DDATA)
   ▼
mira-relay (HTTP/WS)
   │ parses payload → resolves to tag_entities.id by source_address
   │ writes live_signal_events (append) + live_signal_cache (upsert)
   ▼
diagnostic engine
   │ joins tag_entities → installed_component_instances → kg_entities
   │ checks against expected_envelope
   │ surfaces flag if out-of-envelope
```

No PLC writes, ever. The relay is a one-way pipe. The expected-envelope check produces an `ai_suggestions` flag (`suggestion_type='envelope_violation'`), never a control action.

---

## 12. Recommended standards alignment

Detailed standards research is summarized here; the per-entity recommendation block is what the design freezes against. The full per-standard reference (ISA-95, ISA-88, AAS, IEC 61360, ECLASS, AutomationML, OPC UA companion specs, Sparkplug B, EDS, GSDML, EPLAN, PLCopen XML, IODD, B2MML, MTConnect) is in the research notes attached to this investigation.

### 12.1 Entity → standard mapping

| MIRA entity | Primary standard | Concrete shape |
|---|---|---|
| Factory hierarchy node (site / area / line / cell) | ISA-95 (IEC 62264) levels 4–0 + UNS | Existing ltree path; map each level to ISA-95 level number for export. |
| Asset | AAS Submodels: Digital Nameplate (IDTA-02006 v3.0.1) + Technical Data (IDTA-02003 v2.0) + Handover Documentation (IDTA-02004 v2.0); ECLASS class IRDI | `cmms_equipment` rows get `external_ids.eclass_irdi` and `external_ids.aas_global_asset_id`. |
| Component template | AAS Type instance + ECLASS Advanced (v16.0) + IEC 61360 properties | `component_templates.semantic_id` = ECLASS class IRDI. Each property keyed by `property_dictionary.irdi`. |
| Component instance | AAS Instance (`assetKind=Instance`) + UNS path | Existing schema + `external_ids.aas_global_asset_id`. |
| Wiring relationship | AutomationML InternalLink (IEC 62714) + EPLAN terminal model | New `wiring_connections` table (§5.3). |
| PLC tag | Sparkplug B Metric + OPC UA Variable Node + PLCopen XML / L5X `<Tag>` | New `tag_entities` table (§5.3) with `sparkplug_topic` + `opcua_node_id` + `source_kind/address`. |
| Fault code | Custom AAS submodel pending IDTA-02101; IEC 61360 ConceptDescription; MTConnect Condition | Existing `fault_codes` table; add `irdi` column for IEC CDD references, `severity` aligned to MTConnect (`fault`/`warning`/`normal`/`unavailable`). |
| Manual / datasheet | AAS Handover Documentation (IDTA-02004 v2.0) + VDI 2770 classification | `knowledge_entries.metadata.vdi2770_class`; export to AASX bundle. |
| Work order | ISA-95 Part 4 / B2MML `WorkOrder` + OAGIS | `work_orders` rows already align structurally; add `external_ids.b2mml_work_order_id`. |

### 12.2 Design implications

- **ECLASS v16.0 (current) is the classification of record.** Every `component_templates` row carries a class IRDI. Two templates with the same IRDI are merge candidates.
- **IDTA-02006 v3.0.1 Digital Nameplate is the source of truth for nameplate fields.** `nameplate_worker.py`'s extracted field set must align (manufacturer name + product designation + serial + year of construction + hardware version + AssetID).
- **No IDTA "MaintenanceData" template is published yet (IDTA-02101 in development).** Fault codes + PM schedules stay in MIRA-native tables; carry `external_ids.aas_submodel_id` once IDTA-02101 ships.
- **AML InternalLink semantics drive the wiring schema** (§5.3). Source/dest terminals are first-class; the wire is the edge.
- **Sparkplug B + OPC UA are complementary**, not alternatives. The MIRA tag entity stores both addresses.
- **L5X / GSDML / IODD / EDS are inputs to the catalog**, not data formats MIRA stores natively. Parse → extract → propose `component_templates` rows + `tag_entities` rows.

---

## 13. Recommended first structured manufacturer data formats

Order by demo-blocking value × engineering effort. Each format becomes a parser module in `mira-crawler/ingest/extractors/`.

| Order | Format | Why this one first | What it produces |
|---|---|---|---|
| 1 | **Rockwell L5X** | Demo plant uses Micro820 + Studio 5000–style tooling; tag exports are the highest-value, most-immediate ingestion source. | `tag_entities` rows + UDT/Program decomposition + tag descriptions. |
| 2 | **AutomationDirect EDS / GS-series manuals** | GS10 is on the conveyor; need its parameter list + fault catalogue. AD publishes EDS for EtherNet/IP variants. | `component_templates` rows (full TechnicalData submodel shape) + `fault_codes` rows. |
| 3 | **Siemens GSDML** | First PROFINET customer triggers this — has come up in onboarding conversations. | `component_templates` rows + `tag_entities` rows for slot/subslot process data. |
| 4 | **IO-Link IODD** | The "smart sensor" category; most photoeyes and prox switches with diagnostics ship IODD. | `component_templates` rows (Parameters + ProcessDataIn/Out) + tag entities. |
| 5 | **EPLAN macros / AML export** | Closes the wiring loop. Customers with EPLAN can hand us a panel layout that maps directly to `wiring_connections`. | `wiring_connections` rows + `installed_component_instances` + terminal entities. |
| 6 | **OPC UA NodeSet XML** | When customer has an OPC UA server, the NodeSet export is the catalogue. Lower priority because UA discovery is also possible at runtime. | `tag_entities` rows (NodeId + DataType + Description). |
| 7 | **AASX bundle (IDTA submodels)** | Importing an OEM-shipped digital twin gives us the template + nameplate + manual in one file. Aspirational. | `component_templates` + `component_template_sources` + `knowledge_entries`. |
| 8 | **PLCopen XML** | Vendor-neutral PLC export. Useful when L5X isn't available. | `tag_entities` rows + POU descriptions. |
| 9 | **B2MML WorkOrder XML** | Lets enterprise CMMS integrations flow without a custom adapter per system. | `work_orders` rows + asset references. |
| 10 | **MTConnect XML** | Machine-tool subvertical. Defer until we touch a CNC customer. | `tag_entities` + `live_signal_events`. |

Stop at the first few for the demo; everything past #5 is post-MVP.

---

## 14. Recommended implementation phases

Mapped onto the existing 90-day plan and the namespace-builder spec. Each phase is independently shippable.

### Phase 0 — Demo-blocking (next 14 days, before May 21)

- **P0.1** Photo → KG. Wire `nameplate_worker.py` output into a new `photo_ingest_worker.py` that writes proposed `installed_component_instances` + `ai_suggestions`. Closes the headline loop.
- **P0.2** `ai_suggestions` table. Land the migration so `/proposals` has something to render. Tighten `suggestion_type` CHECK.
- **P0.3** Hub `/proposals` page renders the photo-derived proposals end-to-end. One-click confirm writes the `installed_component_instances` row.
- **P0.4** Conveyor demo data populated. Run `tools/load_manifest_to_kg.py --commit` against a demo tenant. Result: ~80 KG entities + ~30 proposals visible in `/proposals`.

### Phase 1 — Hardening (Days 14–45)

- **P1.1** `wiring_connections` table + AML-shaped writer. Migrate existing `WIRED_TO` properties into typed rows where possible (lossless; old rows stay as edge summaries).
- **P1.2** `tag_entities` table + L5X / Ignition CSV ingestion route. Lift `installed_component_instances.plc_tag` (string) to FK.
- **P1.3** Tenant_id UUID canonicalization migration. Cast the engine-side TEXT columns. Ship behind a flag; flip after all writers migrated.
- **P1.4** UNS resolver Stage-3 enrichment. Fix the asyncio-loop branch so `matched_entities` actually populates in production.
- **P1.5** Citation compliance: flip to enforcing for confirmed-asset path only.

### Phase 2 — Catalog scale-out (Days 45–75)

- **P2.1** EDS / GSDML / IODD parsers + `component_templates` writers. Seed catalog from public OEM data portals.
- **P2.2** `property_dictionary` table + ECLASS IRDI seeding. Lint `component_templates.power_specs` etc against the dictionary; surface mismatches in `/proposals`.
- **P2.3** `component_template_overrides` for per-instance variation.
- **P2.4** Template versioning + parent_template_id inheritance. Defer until 5 templates show benefit.

### Phase 3 — Live + verification (Days 75–120)

- **P3.1** Ignition relay → NeonDB `live_signal_events`. `tag_entities.expected_envelope` checks produce `ai_suggestions(envelope_violation)`.
- **P3.2** EPLAN AML import for `wiring_connections`. First customer milestone.
- **P3.3** AAS export (selected submodels). Lets a customer download an AASX of one line for compliance / handover.
- **P3.4** Retraction propagation job for `relationship_evidence`. Closes the consistency loop.

---

## 15. Open questions and assumptions

### Assumptions (explicit)

- ADR-0013 is final: Hub `mira-hub/db/migrations/` owns product-surface schema; engine `docs/migrations/` owns the diagnostic kg_entities/relationships. This investigation assumes that separation continues; if it changes, several recommendations collapse into one writer.
- The demo on May 21 uses a single tenant on staging. No multi-tenant proposal queues to design around for P0.
- Photo blob storage will land in S3-compatible storage (not NeonDB bytea, not local SQLite). The exact provider doesn't matter for the schema design.
- The cascade remains Groq → Cerebras → Gemini. No Anthropic. Per PR #610.

### Open questions

- **Is the engine-side `kg_entities` ever going to be deprecated, or is it a permanent read replica?** Affects whether tenant-id canonicalization is a real migration or a permanent shim.
- **`tag_entities` vs. extending `kg_entities` with a `tag_kind` flavor.** New table is cleaner; flavor extension is faster. Decision needed before P1.2.
- **Per-property IRDI gating.** Should an `ai_suggestions` row referencing a `component_templates` property be auto-rejected if the property name isn't in `property_dictionary`? Or just flagged? Suggest: flag, never block.
- **Catalog tenancy.** Is *anything* in `component_templates` ever tenant-private (e.g., a customer's proprietary fixture)? If yes, the catalog needs a `visibility` column. Suggest: no — proprietary components go in `installed_component_instances` with `template_id=NULL` and full specs inline.
- **Live-data audit retention.** `live_signal_events` could grow fast. Need a TimescaleDB-style retention policy or a manual compaction strategy. Not in scope here.
- **Sparkplug topic ↔ UNS path mapping.** Sparkplug topic structure (`group/edge/device/metric`) doesn't perfectly mirror ISA-95 (`enterprise/site/area/line/cell/asset/component`). Need an explicit translation table per customer.
- **Wiring proposal review UX.** A wiring connection touches two terminals on two devices; the `/proposals` card needs a two-side visual. Spec out separately.
- **CMMS work-order template promotion.** When a fault repeats N times with the same resolution, should MIRA propose creating a PM rule? Probably yes; out of scope for this doc.
- **External integration test plan.** How does the team validate L5X / GSDML / IODD parsers without each manufacturer's tooling? Suggest: ship golden fixture files in `tests/fixtures/manufacturer-files/` (publicly available samples are OK).

---

## 16. Final "source of truth" architecture proposal

One-page summary. If you remember nothing else from this doc, remember this.

### The contract

> **A factory becomes AI-readable when every node, edge, signal, and fault has a UNS address, a global id, an approval state, and a chain of evidence. MIRA's job is to build that structure through normal maintenance work — photo by photo, tag by tag, manual by manual — and never to claim something is true without naming the evidence.**

### The six layers

1. **Front doors** — Slack, Hub, /m/[assetTag], Telegram. Never bypass the engine.
2. **Engine** — UNS Confirmation Gate, FSM, citation enforcement, inference cascade.
3. **Live context** — Sparkplug B / Ignition relay / MQTT. Read-only. No PLC writes, period.
4. **Memory** — `kg_entities`, `kg_relationships`, `cmms_equipment`, `installed_component_instances`. Tenant-scoped. Approval state on every row.
5. **Catalog** — `component_templates`, `component_template_sources`, `fault_codes`, `property_dictionary`. **Not** tenant-scoped. Shared across plants.
6. **Evidence + Queue** — `knowledge_entries` (pgvector), `relationship_proposals` + `_evidence`, `ai_suggestions`, `kg_triples_log`, `namespace_versions`. Provenance + work queue + audit, end to end.

### The three name-spaces, kept separate

- **UNS ltree path** — location, mutable but versioned.
- **UUIDv7 id** — identity, immutable.
- **External ids** — interop (ECLASS, IRDI, Atlas, OPC UA, Sparkplug, MaintainX).

### The two write paths

- **Catalog writer** — `tools/build_component_template.py`, OEM-file parsers (EDS/GSDML/IODD/EPLAN). Writes Layer 5 + Layer 6 Evidence. Tenant-agnostic.
- **Tenant writer** — `photo_ingest_worker`, tag importer, QR scan handler, Hub editor, CMMS sync. Writes Layers 3 (cache only), 4, and 6 (Queue). Tenant-scoped.

Both gate through `ai_suggestions`. Human confirmation is the only path from `proposed` to `verified`.

### The five entity flavors (Layer 4)

Location · Asset · Component instance · Component template (Layer 5) · Reference (tag, terminal, fault, document, PM rule, parts list, work order).

### The new schema commitments

- `ai_suggestions` (queue) — land this first.
- `wiring_connections` (AML-shaped) — promotes wiring from JSONB to first-class.
- `tag_entities` (Sparkplug + OPC UA + native PLC) — promotes tags from properties to first-class.
- `property_dictionary` (IEC 61360 / ECLASS IRDI registry) — standardizes property naming.
- `component_template_overrides` — per-instance variation.

### The standards alignment in one sentence

ISA-95 + UNS for hierarchy; AAS submodels (Nameplate, TechnicalData, Handover) + ECLASS Advanced for components; AutomationML InternalLink for wiring; Sparkplug B + OPC UA Variable for tags; B2MML for work orders; IEC 61360 IRDIs for property names; structured manufacturer files (L5X, EDS, GSDML, IODD, EPLAN) as the highest-confidence ingestion sources, parsed once and stored as MIRA-native rows — never as raw vendor files.

### What ships for May 21

P0 only:

1. Photo → `installed_component_instances` proposal (closes the headline loop).
2. `ai_suggestions` queue + Hub `/proposals` render.
3. One-click confirm writes the verified row + recomputes `health_scores`.
4. Conveyor demo data loaded from the existing variable manifest, surfacing ~30 proposals.

Everything else is post-demo. The architecture above is for the next 90 days — but P0 unblocks the demo, and every later phase fits the same shape without rework.

---

## Change log

- **2026-05-18** — Initial investigation. Produced from a codebase audit of `origin/main` (commit `20e22c9a`, Hub migrations 001–024, engine migrations 001–008, the conveyor variable manifest, the engine + resolver + ingestion modules) plus a focused industrial-standards research pass (ISA-95, AAS / IDTA, IEC 61360, ECLASS v16, AutomationML, OPC UA companion specs, Sparkplug B, EDS / GSDML / IODD, EPLAN, PLCopen XML, B2MML, MTConnect). Not a spec change; an evidence-based proposal for the next 90 days.
