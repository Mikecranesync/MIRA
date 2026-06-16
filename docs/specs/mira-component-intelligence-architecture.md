# MIRA Component Intelligence Architecture

**Status:** North Star — active build on `feat/component-intelligence`
**Created:** 2026-05-13
**Owner:** Mike Harper
**Supersedes:** `docs/competitors/issue-bodies/03-component-templates.md` (closed catalog approach)

---

## Why this exists

Diagnostic accuracy lives or dies on *how well the system knows the component*. A motor isn't a label — it's a power profile, a connector pinout, a signal envelope, a list of common failure modes, a wiring relationship to the panel terminal, and a chain of evidence connecting all of that to PLC tags, faults, and historical fixes.

Factory AI ships a closed catalog of component templates. We ship an **open, evidence-tracked, multi-source** component intelligence layer that:

1. **Templates** capture what a component *is* — extracted from manuals, datasheets, prints, technician notes.
2. **Instances** capture what's actually *deployed* at a customer site, bound to a template plus location/wiring/PLC tag/MQTT topic.
3. **Relationships** are *proposed* with evidence and *verified* by humans before they harden into the knowledge graph.

The first proof-of-concept chain — and the heart of the product — is the **garage conveyor**:

```
Component (PE-B16-2) → Wire/Terminal (TB2-14) → PLC Tag (Line5.B16.PE2_Occupied)
  → Logic Rung (Rung 42) → Fault (1.SOC B16.2) → Asset (Conveyor B16)
  → Historical Fix → Recommendation
```

Every edge in that chain is a typed relationship with evidence pointing back to the source document (manual page, ladder rung, work order, technician note).

---

## Hard architectural constraints

1. **PostgreSQL only.** No Neo4j. NeonDB is the system of record. JSONB for flexible specs.
2. **ISA-95 / UNS-compliant paths** (`ltree`) on every new entity that lives in a plant hierarchy.
3. **LLM extraction goes through the Groq cascade** (`mira-bots/shared/inference/router.py`). No Anthropic. No single-provider.
4. **Tenant-scoped tables enforce RLS** with `current_setting('app.current_tenant_id')`.
5. **Every relationship has provenance.** No bare edges — every `relationship_proposal` has ≥1 `relationship_evidence` row.

---

## The four core tables

### 1. `component_templates` (catalog)

Shared across tenants. Templates are the canonical description of a component family/model. Built once, used everywhere.

| Field | Purpose |
|---|---|
| `component_category` | sensor, vfd, motor, contactor, plc, hmi, … |
| `component_type` | proximity_sensor, variable_frequency_drive, … |
| `manufacturer` + `model` | e.g. AutomationDirect / GS10 |
| `power_specs` (JSONB) | input voltage, phase, amperage, frequency range |
| `input_output_specs` (JSONB) | analog/digital I/O, signal types, ranges |
| `signal_behavior` (JSONB) | expected envelope, normal/fault states, response time |
| `connector_type` + `pinout` (JSONB) | physical interface |
| `environmental_limits` (JSONB) | temp, humidity, IP rating, vibration |
| `diagnostic_indicators` (JSONB[]) | what LEDs/displays mean |
| `expected_signals` (JSONB[]) | what should be seen under normal operation |
| `common_failure_modes` (JSONB[]) | each with cause, symptom, severity |
| `troubleshooting_steps` (JSONB[]) | ordered procedure |
| `pm_checks` (JSONB[]) | preventive maintenance items |
| `safety_notes` (JSONB[]) | LOTO, arc-flash, hazards |
| `recommended_uns_template` | e.g. `enterprise.kb.automationdirect.gs.gs10` |
| `verification_status` | proposed / verified / rejected |
| `version` | integer, bumped on edit |

Companion table: `component_template_sources` — links each template to the manuals/datasheets it was extracted from, with page numbers and extraction confidence.

### 2. `installed_component_instances` (deployment)

Tenant-scoped. One row per physical component at a site. References a template (the "what is this") and adds location/wiring/PLC-binding (the "where is it and how is it wired").

| Field | Purpose |
|---|---|
| `tenant_id` | RLS isolation |
| `template_id` | FK to `component_templates` |
| `asset_id` | FK to CMMS equipment (parent asset) |
| `component_name` + `canonical_name` + `aliases[]` | name resolution |
| `installed_location`, `panel`, `terminal`, `wire_number` | physical placement |
| `plc_tag`, `mqtt_topic` | live data binding |
| `uns_path` (ltree) | full hierarchy address |
| `human_confirmed` (bool) + `confidence` | trust signal |

### 3. `relationship_proposals` (the proposal layer)

Every edge in the knowledge graph starts here, with confidence, status, and risk level. Safety-critical edges (LOTO, arc-flash, electrical interlock) require human review before promotion.

Controlled vocabulary (relationship_type CHECK constraint):

| Group | Types |
|---|---|
| Hierarchy | `HAS_COMPONENT`, `INSTANCE_OF`, `LOCATED_IN`, `HAS_PART` |
| Documentation | `HAS_DOCUMENT`, `HAS_CHUNK`, `REFERENCES`, `HAS_PROCEDURE` |
| Wiring & power | `WIRED_TO`, `POWERED_BY`, `MAPS_TO`, `PUBLISHED_AS` |
| Logic & control | `USED_IN_LOGIC`, `TRIGGERS`, `CAUSES` |
| Faults & resolution | `OCCURS_ON`, `RESOLVED_BY`, `HAS_FAILURE_MODE` |
| Signals | `HAS_SIGNAL`, `HAS_ALIAS` |
| Topology | `DEPENDS_ON`, `UPSTREAM_OF`, `DOWNSTREAM_OF`, `REPLACES` |
| Evidence meta | `CONFIRMED_BY`, `CONTRADICTED_BY` |

Status lifecycle: `proposed → reviewed → verified` (or `rejected`, `deprecated`, `contradicted`).

`created_by`: `llm | human | import | rule`.
`risk_level`: `low | medium | high | safety_critical` — drives `requires_human_review`.

### 4. `relationship_evidence` (provenance)

Each proposal has 1..N evidence rows pointing back to the source — document page, PLC rung, tag list, work order, technician note, or live data sample. Without evidence, a proposal stays at low confidence and is never auto-verified.

---

## Confidence scoring rules

| Source of edge | Confidence |
|---|---|
| Multi-source confirmed (manual + tag list + technician note) | 0.95 |
| Single primary source (manual or print) | 0.80 |
| LLM-extracted from single chunk, no cross-check | 0.55 |
| Inferred by rule (e.g. naming convention) | 0.40 |
| LLM-proposed without any source | 0.25 (flagged for review) |

Safety-critical edges below 0.80 require human review regardless of source count.

---

## Build sequence (this PR)

| Step | Deliverable | File |
|---|---|---|
| 1 | Schema for templates + sources | `mira-hub/db/migrations/016_component_templates.sql` |
| 2 | Schema for installed instances | `mira-hub/db/migrations/017_installed_component_instances.sql` |
| 3 | Schema for proposals + evidence | `mira-hub/db/migrations/018_relationship_proposals.sql` |
| 4 | Template Builder agent (LLM extraction → JSON → DB) | `tools/build_component_template.py` |
| 5 | Manifest → KG entities + WIRED_TO/MAPS_TO proposals | `tools/load_manifest_to_kg.py` |

Follow-ups (separate PRs, tracked as GitHub issues):

- Relationship Proposer + Evidence Collector + Confidence Scorer pipeline.
- Build the full garage-conveyor chain end-to-end (sensor → fix recommendation).
- UI for human verification of proposals.
- Promotion path from `relationship_proposals` (verified) → `kg_relationships`.

---

## Why proposals are separate from `kg_relationships`

`kg_relationships` already exists in `mira-hub/db/migrations/001_knowledge_graph.sql`. The proposal layer is upstream: nothing lands in `kg_relationships` until a human (or a high-confidence rule) verifies it. This protects the diagnostic engine from LLM-hallucinated wiring claims while still letting us harvest the LLM's pattern-matching at scale.

Once a proposal reaches `verified`, a downstream job mirrors it into `kg_relationships` (or, equivalently, we update the engine to query `relationship_proposals` directly with `status='verified'`). That cutover is a follow-up.

---

## First proof: garage conveyor

Data already on disk: `research/variable-manifest.json` (78 PLC variables, 10 wiring notes, 16 gaps) describing a Micro820-driven conveyor with a GS10 VFD.

`tools/load_manifest_to_kg.py` will:

1. Create `kg_entities` for each I/O point, sensor, actuator, terminal, and modbus register.
2. Create `relationship_proposals` for the chain:
   - `_IO_EM_DI_05` `MAPS_TO` `Sensor 1` (alias) — evidence: manifest entry
   - `Sensor 1` `WIRED_TO` `%IX0.5` — evidence: address field
   - GS10 VFD `POWERED_BY` motor circuit — evidence: wiring notes
   - VFD command word `USED_IN_LOGIC` of motor start rung — evidence: wiring note 7

`tools/build_component_template.py` will:

1. Find GS10 chunks in `knowledge_entries`.
2. Send to Groq cascade with structured extraction prompt.
3. Return a fully-populated `component_templates` row.
4. Optionally insert (`--commit`) or print (`--dry-run`).
