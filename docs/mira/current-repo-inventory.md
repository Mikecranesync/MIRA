# MIRA — Current Repo Inventory (Asset-Graph Lens)

**Status:** Phase 0 deliverable of the canonical-asset-graph initiative
**Authored:** 2026-06-02
**Owner:** Lead architect (MIRA)
**Companion to:** `docs/plans/2026-06-01-mira-master-architecture-plan.md` §1 ("What already exists")

---

## 0. What this document is (and is not)

The master plan's §1 already enumerates the engine, MCP tools, schema, ingestion, tag
collector, Ignition and Hub surfaces. **This inventory does not restate that.** It adds the
three things §1 does not carry, framed through the question that now governs the build:
*does MIRA hold a **canonical industrial asset graph** that is the translation layer between
plant-floor OT data (PLC / Ignition / MQTT / OPC UA / historian) and enterprise maintenance
systems (Maximo / SAP / MaintainX / Fiix / manuals / tribal knowledge)?*

The three deltas:

1. **The OT↔enterprise asset-graph lens** over each existing piece — what role it plays in a
   canonical graph, and where it stops short.
2. **As-built reconciliation of the DT gap-closure branch** (`feat/dt2026-gap-closure`), which
   shipped Hub migrations 032–037 and the tag-event layer — and **diverged from the master
   plan's proposed 036/037**. The record below matches the branch, not the plan's intent.
3. **The two architectural gaps** for the full vision: (a) no canonical *source-system identity*
   on a graph node, (b) no *raw imported-record preservation* layer. These are the subjects of
   the two sibling docs (`canonical-asset-graph.md`, `source-record-preservation.md`).

Everything below was verified against the working tree on 2026-06-02, not inherited from §1.

---

## 1. Verification preflight (2026-06-02)

```
branch:        feat/hub-command-center
origin/main:   ahead — includes #1634 (master plan → North Star), #1593 umbrella
               (Command Center + Ignition secure edge), #1641 (garage-conveyor KB seed)
DT branch:     feat/dt2026-gap-closure present locally AND on origin
               (24 files, +3736 / −204 vs feat/hub-command-center)
```

Verified code anchors (CodeGraph + grep, not inherited):

| Claim (master plan §1) | Verified |
|---|---|
| `Supervisor` class | ✅ `mira-bots/shared/engine.py:467` |
| `_should_fire_uns_gate` | ✅ `engine.py:4541` |
| `Supervisor.process` / `process_full` | ✅ `engine.py:838` / `engine.py:1103` |
| `resolve_uns_path` / `_multi` | ✅ `mira-bots/shared/uns_resolver.py:717` / `:808` |
| "26 MCP tools" | ✅ exactly 26 `@mcp.tool` in `mira-mcp/server.py` |

---

## 2. The canonical-graph spine — what exists

### 2.1 `kg_entities` / `kg_relationships` (the node + edge tables)

**Authoritative DDL is the Hub line, not the engine line.** `docs/migrations/004_kg_entities.sql`
and `005_kg_relationships.sql` are headed *"PLANNED — do not run / NOT YET CREATED"* and are
**not** the live schema (ADR-0013). The live tables are created by Hub
`001_knowledge_graph.sql` and mutated by 010/024/025/026/028/029 (+ engine 007/008 add the same
columns idempotently). **True column set as of 2026-06-02:**

`kg_entities`
| Column | Source migration | Notes |
|---|---|---|
| `id UUID PK` | Hub 001 | |
| `tenant_id UUID` | Hub 001 | RLS policy `app.current_tenant_id` |
| `entity_type TEXT` | Hub 001 | the type discriminator — see §canonical doc |
| `entity_id TEXT` (nullable) | Hub 001 → 025 | legacy aux; natural key moved off it |
| `name TEXT` | Hub 001 | |
| `properties JSONB` | Hub 001 | |
| `uns_path ltree` | Hub 010 | GIST + compound `(tenant_id, uns_path)` GIST |
| `source_chunk_id UUID` | Hub 024 | FK-by-convention → `knowledge_entries.id` |
| `approval_state TEXT` | Hub 029 | `proposed`\|`verified`\|`rejected`\|`needs_review`\|`deprecated` |
| `proposed_by`, `evidence_summary` | engine 008 / Hub 029 | |
| `created_at`, `updated_at` | Hub 001 | |
| natural key | Hub 025 | `UNIQUE (tenant_id, entity_type, name)` |

`kg_relationships`
| Column | Source migration | Notes |
|---|---|---|
| `id UUID PK` | Hub 001 | |
| `tenant_id UUID` | Hub 001 | RLS |
| `source_id UUID` FK→`kg_entities(id)` | Hub 001 | **`source_id` / `target_id`, NOT `source_entity`** |
| `target_id UUID` FK→`kg_entities(id)` | Hub 001 | `no_self_loop` CHECK |
| `relationship_type TEXT` | Hub 001 | |
| `properties JSONB`, `confidence FLOAT` | Hub 001 | confidence already present |
| `source_conversation_id UUID` | Hub 001 | |
| `source_chunk_id UUID` | Hub 024 | |
| `approval_state TEXT` | Hub 029 | `proposed`\|`verified`\|`rejected`\|`needs_review` |

> ⚠️ **Naming trap (do not re-introduce):** the engine `005` file names columns
> `source_entity / target_entity / relation_type`. The **live** columns are
> `source_id / target_id / relationship_type`. `kg_writer.py` once wrote the wrong names →
> fixed in PR #1443. Any new code or schema doc **must** use the live names.

> ⚠️ **approval_state default drift:** Hub 029 defaults new rows to **`proposed`**
> (human-in-the-loop, correct per TOO Invariant #4). Engine 008 defaults to **`verified`**
> (legacy auto-insert). Where both ran, last-writer-wins on the column default. The flywheel
> requires `proposed` to be the default; treat any `verified`-default path as a bug to close
> (master-plan Phase 3).

**Asset-graph lens:** this *is* the canonical node+edge spine. `entity_type` + `uns_path` +
`approval_state` + `confidence` already deliver requirements 3 (confidence), 4 (technician
confirmation via approval_state), 5 (proposed/uncertain), and 6 (ISA-95 ltree). **What it lacks
for the OT↔enterprise vision:** a *source-system identity* on the node (today provenance is only
`source_chunk_id` → a manual chunk, or `source_conversation_id` → a chat turn; there is no pointer
to "row 4471 of the customer's Maximo asset export"). That is the Phase 1/2 gap.

`kg_triples_log` (Hub 001) is the raw extraction log (subject/predicate/object + source) — a
provenance breadcrumb, not the graph itself.

### 2.2 The proposal / confirmation layer (the "MIRA proposes, human confirms" wedge)

| Surface | Where | Role in the graph |
|---|---|---|
| `relationship_proposals` + `relationship_evidence` | Hub 018 | edge-with-evidence staging before `kg_relationships` |
| **28-value `relationship_type` vocabulary** | Hub 028 (CHECK on `relationship_proposals`) | see §canonical doc — already covers most of the requested edge types |
| `ai_suggestions` | Hub 027 | 6-type Hub work queue; `kg_edge` rows header onto a proposal; carries `source_kind`/`source_id`/`source_document_id`/`source_page` provenance + `confidence` |
| `approval_state` on `kg_*` | Hub 029 | `proposed → verified` is the human gate |

**Asset-graph lens:** the uncertain/proposed-match machinery the vision calls for (req 4/5) is
**already built** — `ai_suggestions` even has a polymorphic source-provenance pointer. The gap is
that the proposal path is not yet the *only* write path (`kg_writer` still inserts directly;
master-plan Phase 3 closes this).

### 2.3 Component intelligence (reusable per-model vs per-instance)

| Table | Migration | Layer |
|---|---|---|
| `component_templates` | Hub 016 | per-model reusable asset (the Knowledge Cooperative unit) |
| `component_template_sources` | Hub 016 | template provenance (doc id, page, excerpt, `extracted_by`) — **pointer, not raw payload** |
| `installed_component_instances` | Hub 017 | per-tenant per-instance, `uns_path`-addressed |

---

## 3. UNS address layer

| Piece | Where | Status |
|---|---|---|
| Path builders (`slug`, `*_path`, `RESERVED_LABELS`, `is_valid_path`) | `mira-crawler/ingest/uns.py` | ✅ canonical builders (UNS-001) |
| Message → UNS resolver (`resolve_uns_path`, `_multi`, `UNSContext`) | `mira-bots/shared/uns_resolver.py:717/808` | ✅ vendor/model/fault scope; hierarchy (site→component) is the master-plan Phase 6 extension |
| Location-confirmation gate (`_should_fire_uns_gate`) | `engine.py:4541` | ✅ chat scope; direct-connection `source="direct_connection"` wiring is the Phase 6 gap |
| `uns_path` storage | `kg_entities.uns_path` (Hub 010), engine 007 format CHECK | ✅ ltree, GIST-indexed, lowercase CHECK |
| MQTT/UNS topic projection | `cmms_equipment.uns_topic_path` (Hub 013) + `uns.py` | ⚠️ column exists; generation path is post-MVP |

**Asset-graph lens:** the ISA-95 address space (req 6) and future UNS/MQTT topic generation
(req 7) are in place at the column + builder level. Requirement 6's "without rigid structure" is
satisfied: `uns_path` is a *cached projection* over the `parent_of`/`LOCATED_IN` edge graph (Hub
010 comment), so the hierarchy is graph-driven, not a fixed-depth column scheme.

---

## 4. Tag / signal / OT-live layer

| Piece | Where | Status |
|---|---|---|
| `tag_entities` (first-class PLC/Sparkplug/OPC UA tag) | Hub 025 | ✅ |
| `live_signal_cache` + diagnostic trend tables | Hub 020 | ✅ latest-value snapshot |
| `live_signal_events` (per-session) | Hub 019 | ✅ session-bound |
| Read-only Modbus poller + diff pattern | `tools/demo_plc_poller.py` (`detect_events`) | 🟦 bench reference |
| Mock Modbus server | `tools/demo_plc_simulator.py` | 🟦 bench |
| Relay cloud ingest (HMAC `/ingest`, WS) | `mira-relay/relay_server.py` | ✅ |

**DT gap-closure branch (`feat/dt2026-gap-closure`) — as-built, NOT yet on main:**

| Shipped on the branch | File | Reconciliation note |
|---|---|---|
| `032_decision_traces.sql` | Hub migrations | matches plan |
| `033_tag_events.sql` | Hub migrations | append-only meaningful-change stream |
| `034_flaky_input_signals.sql` | Hub migrations | matches plan |
| `035_approved_tags.sql` | Hub migrations | allowlist as a table |
| **`036_current_tag_state_freshness.sql`** | Hub migrations | ⚠️ **supersedes** plan's proposed `036_decision_trace_session_link` |
| **`037_tag_event_diffs.sql`** | Hub migrations | ⚠️ **supersedes** plan's proposed `037_kg_relationships_evidence_ref` |
| `tag_ingest.py`, `tag_diff_logger.py` (+ tests) | `mira-relay/` | Phase 5 diff-logger, already built here |
| `POST /api/v1/tags/ingest` | `mira-relay/relay_server.py` | |
| Ignition HMAC collector | `ignition/webdev/FactoryLM/api/tags/collector.py`, `ignition/gateway-scripts/tag-stream.py` | |
| Command Center freshness | `mira-hub/src/lib/command-center-freshness.ts` (+ test) | |
| ADR-0022 (decision-trace + tag-stream storage) | `docs/adr/0022-decision-trace-and-tag-stream-storage.md` | |

> **Numbering reality:** migration slots **032–037 are consumed** by the DT branch. Any new
> schema (including the proposals in the two sibling docs) must start at **038+**, and the
> master plan's §3.D2 first-pass 036/037 are now historical.

---

## 5. Enterprise-system connectors (the "OT↔enterprise" half)

| Connector | Where | Preserves original fields? |
|---|---|---|
| Atlas CMMS (sync) | `mira-mcp/cmms/atlas.py` + `cmms_sync_state`/`cmms_sync_conflicts` (Hub 007) | ⚠️ **only on conflict** — `cmms_sync_conflicts.atlas_payload JSONB`. Happy path normalizes into `cmms_equipment` and discards the raw record. |
| MaintainX | `mira-mcp/cmms/maintainx.py` | via factory; same normalize-and-discard shape |
| Limble | `mira-mcp/cmms/limble.py` | same |
| Fiix | `mira-mcp/cmms/fiix.py` | same |
| Adapter base + factory | `mira-mcp/cmms/base.py`, `factory.py` | unified interface |
| External-ID cross-reference | `cmms_equipment` columns (Hub 013): `cmms_id`, `plc_tag`, `scada_path`, `manufacturer_part_number`, `uns_topic_path`, `erp_asset_id`, `drawing_reference` | ✅ **ID mapping** (req 2, partial) — but flat TEXT columns on one table, no payload, CMMS-asset-shaped only |

**Asset-graph lens:** the connector *adapters* exist and the i3X external-ID columns (Hub 013)
give a real "this MIRA asset = that Maximo asset" mapping. **The gap is structural:** there is no
connector-agnostic place that stores the *original imported record* (Maximo asset row, SAP
functional location, MaintainX work order, OPC UA browse node) with its raw payload, the
connector version that produced it, and a remappable mapping status. Today raw payload survives
**only** in `cmms_sync_conflicts.atlas_payload`, **only on conflict, only for Atlas.** This is the
single sharpest gap for the vision — addressed in `source-record-preservation.md`.

---

## 6. Knowledge / evidence layer

| Piece | Where | Status |
|---|---|---|
| `knowledge_entries` (text + `embedding` + `metadata` JSONB + `equipment_entity_id` FK) | engine 001 + 006_kg_bridge | ✅ ~25K+ chunks; **chunk-level** source metadata only |
| PDF → chunk → embed → dedup → store + KG side-effect | `mira-crawler/ingest/` (`converter`/`chunker`/`embedder`/`dedup`/`store`/`kg_writer`) | ✅ works; first-class ingest API is master-plan Phase 2 |
| `fault_codes` | engine 002 | ✅ |
| `namespace_direct_uploads` | Hub 027 | ✅ upload metadata (filename/mime/size), no payload preservation |
| Open WebUI (chunk/embed/retrieve backend) | container `mira-core` | ✅ service-sunset, still the embed/retrieve engine |
| MiraDrop watcher | `tools/mira-drop-watcher/` | ✅ drop-folder → Hub → OW path |

---

## 7. MCP tool surface (26 verified)

26 `@mcp.tool` across 7 domains (equipment/live-signal, diagnostic-case, CMMS, asset/nameplate,
agent-control, knowledge-graph, namespace/UNS, schematic-vision) — full list in master plan §1.2.
**Asset-graph lens:** there is no single `get_asset_context(uns_path)` that returns the unified
asset+component+tag+document+WO+edge bundle an agent needs — the graph is queryable in pieces, not
as one node-centric view. Master-plan Phase 11 adds it; the canonical-graph doc specifies the
bundle shape that tool should return.

---

## 8. The gap list for the full asset-graph vision

| # | Gap | Severity | Where it's solved |
|---|---|---|---|
| G1 | No canonical **source-system identity** on a graph node (provenance is chunk/chat only) | High | `canonical-asset-graph.md` §node-identity → FK into G2 |
| G2 | No **raw imported-record preservation** layer; raw payload survives only in `cmms_sync_conflicts` (conflict-only, Atlas-only) | **Highest** | `source-record-preservation.md` |
| G3 | Proposal path is not the *only* KG write path (`kg_writer` still direct-inserts) | Medium | master-plan Phase 3 |
| G4 | `approval_state` default drift (`proposed` vs `verified`) | Medium | master-plan Phase 3 |
| G5 | No node-centric `get_asset_context` agent bundle | Medium | master-plan Phase 11 + `canonical-asset-graph.md` |
| G6 | Hierarchy resolution (site→component) + direct-connection gate wiring | Medium | master-plan Phase 6 |
| G7 | UNS/MQTT topic generation from `uns_path` is column-only, no generator | Low | post-MVP |

**Not gaps (already built, do not rebuild):** the node/edge spine, the 28-type relationship
vocabulary, confidence scoring, approval-state machine, `ai_suggestions` work queue with
polymorphic provenance, component template/instance split, ltree addressing, tag_entities, the
tag-event stream (DT branch), CMMS adapters, external-ID mapping columns, KB ingest.

---

## 9. Cross-references

- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — phase 0–13 execution (this doc is the
  asset-graph lens over its §1)
- `docs/mira/canonical-asset-graph.md` — the canonical node/edge model + additive schema proposals
- `docs/mira/source-record-preservation.md` — the raw-record preservation layer (G2)
- `docs/THEORY_OF_OPERATIONS.md` — primary doctrine
- `docs/adr/0013-...` — Hub-canonical schema lineage
- `docs/adr/0017-...` — status transitions through helpers
- `docs/adr/0022-decision-trace-and-tag-stream-storage.md` — DT branch ADR
- `.claude/rules/uns-compliance.md`, `.claude/rules/direct-connection-uns-certified.md`
