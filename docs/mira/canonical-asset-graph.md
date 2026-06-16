# MIRA — Canonical Industrial Asset Graph

**Status:** Phase 1 deliverable of the canonical-asset-graph initiative — **design + additive
schema proposals (docs-only)**
**Authored:** 2026-06-02
**Owner:** Lead architect (MIRA)
**Builds on:** `docs/mira/current-repo-inventory.md` · `docs/plans/2026-06-01-mira-master-architecture-plan.md` · `docs/specs/uns-kg-unification-spec.md` · `docs/specs/mira-component-intelligence-architecture.md`
**Pairs with:** `docs/mira/source-record-preservation.md` (the source-identity mechanism is defined there and referenced here)

---

## 0. Thesis and the one rule that shapes everything

MIRA's value is a **canonical industrial asset graph** that is simultaneously:

- the **memory** a grounded copilot reasons over, and
- the **translation layer** between plant-floor OT (PLC / Ignition / MQTT / OPC UA / historian)
  and enterprise maintenance systems (Maximo / SAP / MaintainX / Fiix / manuals / tribal knowledge).

**The rule:** build the canonical graph first, connectors around it. A connector never owns a
shape; it *maps into* the canonical shape and keeps its original record (Phase 2). So this
document does **not** invent a new store — it confirms `kg_entities` + `kg_relationships` as the
canonical spine and specifies the **minimal additive** changes that turn today's KG into the full
graph. Postgres-first; no Neo4j (master-plan Phase 13 trigger gate stands).

---

## 1. The model in one picture

```
                       ┌──────────────────────────────────────────────┐
   ENTERPRISE SYSTEMS  │            source_objects  (Phase 2)          │  OT SYSTEMS
   Maximo / SAP /      │  raw imported record + connector + version    │  Ignition / MQTT /
   MaintainX / Fiix    │  + mapping_status  (never destroyed)          │  OPC UA / historian / PLC
        │              └───────────────────┬──────────────────────────┘        │
        │  connector adapters              │ source_object_id FK                │  tag collector
        ▼                                  ▼                                    ▼
   ┌───────────────────────────────────────────────────────────────────────────────┐
   │  CANONICAL SPINE   kg_entities (node)  ──  kg_relationships (edge)             │
   │  • uns_path (ltree, ISA-95)     • approval_state (proposed→verified)          │
   │  • entity_type (discriminator)  • confidence    • source_object_id (NEW)      │
   └───────────────┬───────────────────────────────────────────────────────────────┘
                   │ FK / source_chunk_id / equipment_entity_id  (typed projections)
     ┌─────────────┼───────────────┬──────────────┬───────────────┬────────────────┐
     ▼             ▼               ▼              ▼               ▼                ▼
 tag_entities  knowledge_     cmms_equipment  component_    installed_       fault_codes /
 (signals/    entries        + work orders    templates     component_       tag_events
  tags)       (manuals/docs) (CMMS assets)    (per-model)   instances        (fault events)
```

**Spine + typed projections (hybrid).** `kg_entities` is the *addressed, approvable node*; the
specialized tables carry domain columns and link back. The graph is the index; the projections
are the detail. This is already how the repo is shaped — we are formalizing it, not rebuilding it.

---

## 2. Entity model — requested vocabulary → existing schema

`kg_entities.entity_type` is **free `TEXT` with no CHECK constraint** (Hub 001; verified). New
entity types therefore need **no migration** — only a governed vocabulary so writers agree.
"Spine row" = a `kg_entities` row carrying the canonical address. "Typed projection" = a
specialized table that holds the columns and links to the spine.

| Requested entity | `entity_type` | Spine row? | Typed projection (detail) | Status |
|---|---|---|---|---|
| Enterprise | `enterprise` | ✅ | — (root of `uns_path`) | ✅ exists |
| Site | `site` | ✅ | `cmms_equipment` (site rows) | ✅ |
| Area | `area` | ✅ | — | ✅ |
| Line | `line` | ✅ | — | ✅ |
| Cell | `cell` | ✅ | — | ⚠️ supported, rarely populated |
| Asset | `asset` / `equipment` | ✅ | `cmms_equipment` (`equipment_entity_id`) | ✅ |
| Component | `component` | ✅ | `installed_component_instances` (per-instance) | ✅ |
| (Component model) | `component_template` | reference | `component_templates` (per-model) | ✅ |
| Signal / feedback signal | `signal` | ✅ | `tag_entities` | ✅ |
| PLC tag | `tag` (`tag_kind=plc`) | ✅ | `tag_entities` | ✅ |
| SCADA tag | `tag` (`tag_kind=scada`) | ✅ | `tag_entities` | ✅ |
| Historian signal | `tag` (`tag_kind=historian`) | ✅ | `tag_entities` + `live_signal_cache` | ✅ |
| Alarm | `alarm` | ✅ | `tag_events` (alarm windows) | ⚠️ new entity_type + edge (§3) |
| Fault event | `fault_event` | ✅ | `tag_events` (`fault_window_open/close`, DT branch) | ✅ stream; node optional |
| (Fault code catalog) | `fault_code` | ✅ | `fault_codes` (engine 002) | ✅ |
| Work order | `work_order` | ✅ | CMMS work-order rows (`cmms_*`) | ⚠️ node not always materialized |
| PM task | `pm_task` | ✅ | `pm_schedules` | ✅ |
| Failure mode | `failure_mode` | ✅ | `properties` JSONB | ✅ |
| Root cause | `root_cause` | ✅ | `properties` JSONB | ✅ |
| Remedy / fix | `remedy` | ✅ | `properties` JSONB | ✅ |
| Part / spare | `part` | ✅ | `properties` JSONB + `manufacturer_part_number` | ✅ |
| Manual / document | `document` | ✅ | `knowledge_entries` (`source_chunk_id`) | ✅ |
| Wiring diagram | `wiring_diagram` | ✅ | `knowledge_entries` + `wiring_connections` (Hub 026) | ✅ |
| Procedure | `procedure` | ✅ | `knowledge_entries` | ✅ |
| Technician confirmation | — | ✗ | `approval_state` transition + `CONFIRMED_BY` edge | ✅ not a node |
| External system | `external_system` | ✅ (registry) | `source_systems` (Phase 2) | ⚠️ Phase 2 |
| External object | — | ✗ | `source_objects` (Phase 2) — **raw record, not a graph node** | ⚠️ Phase 2 |
| Relationship | — | edge | `kg_relationships` / `relationship_proposals` | ✅ |
| Confidence score | — | column | `confidence` on entity/edge/suggestion | ✅ |

**Takeaway:** of 25 requested entity kinds, **all are expressible today** on the spine + existing
projections. Only `alarm` and a materialized `work_order` node need new `entity_type` *values*
(free-text, no migration) plus the edges in §3. `external_system` / `external_object` are
deliberately **not** graph nodes — they live in the Phase 2 source layer and attach via FK.

### 2.1 Governance: an `entity_type` registry (no schema change)

Because `entity_type` is unconstrained TEXT, the failure mode is writer drift (`asset` vs
`equipment` vs `machine`). Fix is documentation + a shared constant, not a CHECK (a CHECK would
make the cooperative's open-vocabulary growth a migration every time). Canonical list lives here;
writers import it. (If we later want enforcement, a `kg_entity_types` reference table + soft FK is
the additive path — deferred until drift is observed.)

---

## 3. Relationship model — requested vocabulary → existing 28-type set

`relationship_proposals.relationship_type` **has a CHECK** (Hub 028, 28 values; verified).
`kg_relationships.relationship_type` is free TEXT. To keep the proposal path authoritative
(master-plan Phase 3), new edge types are added by **extending the Hub 028 CHECK**.

| Requested edge | Existing type (Hub 028) | Action |
|---|---|---|
| `is_located_at` | `LOCATED_IN` | ✅ use as-is |
| `belongs_to` | `LOCATED_IN` / `INSTANCE_OF` (by context) | ✅ |
| `contains` | `HAS_COMPONENT` (inverse) | ✅ store canonical direction parent→child |
| `is_part_of` | `HAS_PART` (inverse) | ✅ store HAS_PART parent→child |
| `is_controlled_by` | `DRIVES` / `IS_DRIVEN_BY` / `USED_IN_LOGIC` | ✅ |
| `has_feedback_signal` | `HAS_SIGNAL` | ✅ |
| `has_manual` | `HAS_DOCUMENT` | ✅ |
| `has_failure_mode` | `HAS_FAILURE_MODE` | ✅ |
| `caused_by` | `CAUSES` (inverse) | ✅ |
| `fixed_by` | `RESOLVED_BY` | ✅ |
| `uses_part` | `HAS_PART` (containment) | ⚠️ propose **`USES_PART`** for *consumption* semantics (a WO consumes a spare ≠ an asset contains a part) |
| `maps_to_external_object` | `MAPS_TO` | ✅ — but the **canonical** mechanism is `source_object_id` FK (§4), MAPS_TO is the graph-visible mirror |
| `proposed_match` | (status, not type) | ✅ a `MAPS_TO` edge with `approval_state='proposed'` |
| `technician_confirmed` | `CONFIRMED_BY` | ✅ + `approval_state='verified'` |
| `supersedes` | `REPLACES` | ✅ |
| `conflicts_with` | `CONTRADICTED_BY` | ✅ (or propose symmetric `CONFLICTS_WITH`) |
| `has_alarm` | — | ⚠️ propose **`HAS_ALARM`** |
| `has_work_order` | — | ⚠️ propose **`HAS_WORK_ORDER`** |
| (`has_pm_task`) | — | ⚠️ propose **`HAS_PM_TASK`** (implied by PM-task entity) |

**16 of 18 requested edges map onto the existing 28-type vocabulary as-is.** Only four genuinely
new types are needed: `HAS_ALARM`, `HAS_WORK_ORDER`, `HAS_PM_TASK`, `USES_PART` (+ optional
`CONFLICTS_WITH`). Direction convention: store the **canonical** direction (parent→child,
asset→signal, fault→cause-of) and let queries traverse inverses; don't store both directions.

---

## 4. The seven requirements — how each is met

| # | Requirement | Mechanism | Today | Proposal |
|---|---|---|---|---|
| 1 | Preserve **source-system identity** on every node | `kg_entities.source_object_id` FK → `source_objects` (Phase 2) | ⚠️ only `source_chunk_id`/`source_conversation_id` | **add `source_object_id`** (mig 039) |
| 2 | Reference **≥1 external record** per normalized node | many-to-one via `source_objects` (a node ← N source rows) + `cmms_equipment` external-ID columns (Hub 013) + `ai_suggestions.source_*` | ⚠️ ID columns only, no payload | Phase 2 layer + §4.1 |
| 3 | **Confidence scoring** | `confidence FLOAT` on `kg_relationships`, `ai_suggestions`; `extraction_confidence` on template sources | ✅ | none |
| 4 | **Technician confirmation** | `approval_state` (proposed→verified) + `CONFIRMED_BY` edge + `relationship_evidence` | ✅ | enforce `proposed` default (Phase 3 / G4) |
| 5 | **Uncertain / proposed** relationships | `ai_suggestions` (6 types) + `relationship_proposals` + `approval_state='proposed'` | ✅ | make proposal path the *only* writer (Phase 3) |
| 6 | **ISA-95 hierarchy without rigid structure** | `uns_path ltree` as a *cached projection* over the `LOCATED_IN`/`parent_of` edge graph (Hub 010) | ✅ | none — graph is source of truth, path is the index |
| 7 | **Future UNS/MQTT topic generation** | `uns_path` + `cmms_equipment.uns_topic_path` + `uns.py` builders + Sparkplug mapping (`.claude/rules/...`) | ⚠️ column-only | topic generator (post-MVP) |

### 4.1 Source-identity is ONE mechanism (not a parallel scheme)

Requirement 1 (node-level) and the Phase 2 `source_objects` table are **the same thing**. A node
does not get its own provenance columns; it gets **one FK** (`source_object_id`) into the Phase 2
raw-record store, plus the graph-visible `MAPS_TO` mirror edge for traversal. The existing
`cmms_equipment` external-ID columns (Hub 013) and `ai_suggestions.source_kind/source_id` are
*compatible* with this — they become *derived* views of the source layer, not competing stores.
The authoritative definition lives in `source-record-preservation.md`; this doc only consumes it.

---

## 5. Additive schema proposals (docs-only — do NOT write migration files)

Slots 032–037 are consumed by the DT branch (`feat/dt2026-gap-closure`). New work starts at
**038**. These are **proposals for review**, not files to apply — applying crosses the
dev→staging→prod migration discipline and `apply-migrations.yml` flow. Author the real files only
after sign-off and after re-checking the live tail of `mira-hub/db/migrations/`.

```sql
-- 038_relationship_type_asset_graph.sql  (PROPOSAL)
-- Extend the Hub-028 relationship_type CHECK with the 4 genuinely-new edge types.
-- Keeps the proposal path (relationship_proposals) authoritative per master-plan Phase 3.
ALTER TABLE relationship_proposals
  DROP CONSTRAINT IF EXISTS relationship_proposals_relationship_type_check;
ALTER TABLE relationship_proposals
  ADD CONSTRAINT relationship_proposals_relationship_type_check
  CHECK (relationship_type IN (
    -- existing 28 (Hub 028) ...
    'HAS_COMPONENT','INSTANCE_OF','LOCATED_IN','HAS_PART','HAS_DOCUMENT','HAS_CHUNK',
    'REFERENCES','HAS_PROCEDURE','WIRED_TO','POWERED_BY','MAPS_TO','PUBLISHED_AS',
    'USED_IN_LOGIC','TRIGGERS','CAUSES','DRIVES','IS_DRIVEN_BY','OCCURS_ON','RESOLVED_BY',
    'HAS_FAILURE_MODE','HAS_SIGNAL','HAS_ALIAS','DEPENDS_ON','UPSTREAM_OF','DOWNSTREAM_OF',
    'REPLACES','CONFIRMED_BY','CONTRADICTED_BY',
    -- NEW for the asset-graph vision:
    'HAS_ALARM','HAS_WORK_ORDER','HAS_PM_TASK','USES_PART'
  ));
-- kg_relationships.relationship_type stays free TEXT (no CHECK); the gate is the proposal table.

-- 039_kg_entities_source_object.sql  (PROPOSAL)
-- Canonical source-system identity on a node = one FK into the Phase 2 source layer.
-- Nullable: organic (chat/photo) nodes have no external source object; that's normal.
ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS source_object_id UUID;   -- FK-by-convention -> source_objects(id), Phase 2
CREATE INDEX IF NOT EXISTS idx_kg_entities_source_object
  ON kg_entities (tenant_id, source_object_id)
  WHERE source_object_id IS NOT NULL;
-- A node may derive from N source rows (manual + CMMS + nameplate). source_object_id holds the
-- PRIMARY/origin row; the full N is the set of source_objects rows whose mapped_entity_id = this
-- node (reverse FK, defined in Phase 2). One-to-one column + one-to-many reverse index = both.
```

No other DDL. `entity_type` additions (`alarm`, `work_order` node, etc.) are free-text and need
no migration. The `entity_type` vocabulary registry (§2.1) is documentation, not schema.

---

## 6. What this explicitly does NOT change

- ❌ No new node/edge store. `kg_entities`/`kg_relationships` remain canonical (no Neo4j —
  Phase 13 triggers unchanged).
- ❌ No rename of `source_id`/`target_id`/`relationship_type` (the PR #1443 trap).
- ❌ No CHECK on `entity_type` (would tax the open cooperative vocabulary).
- ❌ No second provenance scheme — source identity is the single Phase 2 FK.
- ❌ No migration files written from this doc — proposals only, slots 038+.

---

## 7. Acceptance (when this model is "real")

1. Every requested entity kind resolves to a documented `entity_type` + projection (§2). ✅ by design.
2. Every requested edge resolves to an existing or proposed `relationship_type` (§3). ✅ by design.
3. A node carries `source_object_id` when it originated from a connector import (after mig 039 +
   Phase 2) — verified by: import a MaintainX asset → `kg_entities` row has `source_object_id`
   pointing at the preserved raw record.
4. `uns_path` remains a projection over the edge graph, not a parallel hierarchy (no writer sets
   `uns_path` without a corresponding `LOCATED_IN` edge).
5. New edge types only enter via `relationship_proposals` (proposal path authoritative).

---

## 8. Cross-references

- `docs/mira/current-repo-inventory.md` — verified baseline this builds on
- `docs/mira/source-record-preservation.md` — the source-identity FK target (Phase 2)
- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — Phase 3 (proposal path), Phase 6
  (hierarchy gate), Phase 11 (`get_asset_context` bundle), Phase 13 (graph-DB trigger gate)
- `docs/specs/uns-kg-unification-spec.md` — UNS authority
- `docs/specs/mira-component-intelligence-architecture.md` — template/instance mechanics
- `.claude/rules/uns-compliance.md` — path builders, lowercase, reserved labels
- ADR-0013 (Hub-canonical schema), ADR-0014 (`ai_suggestions` broad queue), ADR-0017 (status
  transitions through helpers)
