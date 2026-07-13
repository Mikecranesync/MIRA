# CONTEXT — system-wide

System-wide domain language that crosses module contexts. Per-module language lives in each module's `CONTEXT.md` (lazy; grown by `/grill-with-docs` as terms are resolved). The module map is in `CONTEXT-MAP.md`.

## Language

### Proposals & suggestions

**AISuggestion**:
The unit of work the technician or admin decides on. One row in `ai_suggestions`. Has one of six `suggestion_type` values: `kg_edge`, `kg_entity`, `tag_mapping`, `component_profile`, `uns_confirmation`, `namespace_move`. This is what `/proposals` renders and what we mean by "1 proposal pending" in any user-facing surface (Slack, Hub UI, email).
_Avoid_: suggestion (alone), proposal (alone — ambiguous; see RelationshipProposal), pending decision, work item.

**RelationshipProposal**:
The edge-specific catalog row that backs an `AISuggestion` of type `kg_edge`. One row in `relationship_proposals` plus 1..N rows in `relationship_evidence`. Exists because edge promotion needs structured evidence + contradiction tracking; the other five suggestion types don't need it. Never read directly by user-facing surfaces — they read `ai_suggestions` and follow the `payload.relationship_proposal_id` pointer only when opening edge detail.
_Avoid_: the proposal table (ambiguous), edge suggestion, KG proposal.

**proposed** *(adjective)*:
The status on `kg_entities.approval_state` or `kg_relationships.approval_state` indicating an edge or entity has been written but not yet verified by a human. Not a noun; never use "a proposed" as a stand-in for an `AISuggestion` row.
_Avoid_: proposed entity (use "an `AISuggestion` of type `kg_entity`"), proposed edge (use "an `AISuggestion` of type `kg_edge`").

### Status words (cross-table)

Project-specific because the three proposal tables each use their own vocabulary. Full mapping in ADR-0017.

**accepted** *(`ai_suggestions.status`)*:
Admin clicked Accept on `/proposals`. Triggers the per-`suggestion_type` writer that lands the verified change on the canonical target table (e.g. `kg_relationships.approval_state='verified'` for `kg_edge`).
_Avoid_: approved, confirmed, verified (verified is a different status on a different table — see ADR-0017).

**deferred** *(`ai_suggestions.status` only)*:
Admin punted ("ask me later"). Engine-invisible; the suggestion stays in the queue and is shown again in the next admin review.
_Avoid_: pending (different status), snoozed, parked.

**superseded** *(`ai_suggestions`)* / **deprecated** *(`relationship_proposals`)*:
A newer proposal replaces this one. Paired states — `ai_suggestions.superseded` ↔ `relationship_proposals.deprecated` for the same logical decision. The newer proposal carries `payload.supersedes` pointing at the old row's id.

**contradicted** *(`relationship_proposals` only)*:
Engine re-evaluation job found evidence inconsistent with this edge. Flips the paired `ai_suggestions` row back to `pending` (with a reason) and reverts `kg_relationships.approval_state` from `verified` to `needs_review`.

**needs_review** *(`kg_*.approval_state` only)*:
Engine-internal flag that an edge or entity should be re-examined by an admin. Surfaces on `/proposals` as a re-queued `ai_suggestions` row of `status='pending'` with an "engine flagged" indicator.

### Things in the factory

**Template**:
The catalog row for a component model (e.g. "AutomationDirect GS10 VFD"). One row in `component_templates`, shared across all tenants — not RLS-scoped. Carries the manual-derived facts (fault codes, terminal pinout, recommended UNS skeleton) that are true for every Instance of that model. Authored once by the manual-ingestion pipeline + admin curation; reused forever.
_Avoid_: model record, catalog entry, part definition.

**Instance**:
The tenant-scoped physical deployment of a Template — one specific box bolted into one specific machine at one specific customer site. One row in `installed_component_instances`. Carries `template_id` (what it is), `asset_id` (which machine it's in), filled `uns_path` (where it sits in the namespace tree), `serial_number` (when present), and the panel/wire/PLC-tag binding.
_Avoid_: deployment, component (alone — ambiguous; the term "component" appears in `kg_entities.entity_type='component'` which is the mirror, not the source of truth).

**Asset**:
The parent machine an Instance is mounted in (e.g. Conveyor A holds the GS10 Instance). One row in `cmms_equipment` (Atlas CMMS, may live in a separate database). Reserved word for the CMMS parent — never used for an Instance itself, and never used for end devices.
_Avoid_: equipment (alone — `kg_entities.entity_type='equipment'` is the mirror, not the source of truth), parent.

**KGEntity**:
A node in the knowledge graph. One row in `kg_entities`. The engine's read view — `entity_type` projects onto five categories (`equipment`, `component`, `fault_code`, `procedure`, `specification`). For `equipment` and `component`, the row is a **mirror** of an `Asset` or `Instance` respectively, kept in sync at AISuggestion acceptance. For `fault_code`, `procedure`, and `specification`, the KGEntity is the only home — there is no upstream Hub-side table.
_Avoid_: node, entity (alone), graph row.

### Identity rule

Components are identified by **SerialNumber when present**, by **(UNS path, parent Asset, parent panel) tuple when absent**. The DB primary key is always `installed_component_instances.id` (UUID), but the *business identifier* — what techs read off a nameplate, what work orders cite, what humans search for — is the SerialNumber for serialized parts (drives, PLCs, motors, sensors, contactors) and the UNS path for end devices.

**End device**:
A component that does not carry a serial number — push buttons, selector switches, pilot lights, limit switches, photo eyes, pneumatic fittings, terminal blocks, fuses. Identified by the (`uns_path`, `asset_id`, `panel_id`) tuple. The UNS path becomes the human-facing identifier on the bench ("PB-7 on Panel 12 of Conveyor A's HMI"). `installed_component_instances.serial_number` is `NULL` for these rows; that's expected, not a data-quality issue.
_Avoid_: bulk part, generic component, unidentified part.

### Drive Commander product (ADR-0025)

**Drive Commander**:
The single sellable product — a read-only VFD diagnostic tool. Two surfaces: a **desktop fleet console** (direct read-only EtherNet/IP/Modbus-TCP to the whole drive fleet, DriveExplorer model) and a **mobile point-of-service** app (standalone, zero-integration fault-code/Ask-MIRA). Named after the Allen-Bradley DriveExplorer/DriveExecutive lineage, but overlays *diagnostic intelligence* on the raw parameters, not just a parameter viewer. Working name — trademark diligence pending.
_Avoid_: "the app" (ambiguous — name the surface: Drive Commander **desktop** or **mobile**), "Live Machine Context" (superseded framing), "copilot" (positioning is context-led, not copilot).

**drive pack** (a.k.a. **service pack for drives**):
The sellable *atom* — an OEM manual **transformed into KB/KG-backed diagnostic intelligence**, keyed to a **drive family**. NOT a JSON register table, NOT "chat with a PDF". A **manifest** binding three layers for one family: (1) **Document** — the manuals in `knowledge_entries` + citations in `component_template_sources`; (2) **Extracted intelligence** — `component_templates` (`common_failure_modes`/`troubleshooting_steps`/`diagnostic_indicators`/`pinout`/`safety_notes`) + `kg_entities` (`fault_code`/`specification`/`procedure`); (3) **Diagnostic reasoning** — the generic engine (`live_snapshot.assess_*` + Supervisor). A pack **REUSES** layers 1–2 (does not re-hold them) and **ADDS** only: the live-decode data (register/status/command decode + expected envelope → `tag_entities.expected_envelope`), the family + nameplate-recognition descriptor, and derived `diagnostic cards`. Adding a drive = converting its manuals into a family pack, not editing engine code. GS10/DURApulse is the gold reference pack.
_Avoid_: "the decode" (a pack is far more than decode), "chat with the manual" (a pack is *extracted*, not raw-RAG), "driver" (that's a fieldbus client), "profile" (reserved for component profiles), "model pack" (a pack is family-keyed — see below).

**drive family**:
The pack's primary key — a manufacturer's drive series that one manual covers (DURApulse GS10, Yaskawa GA500, PowerFlex 525). Holds the **shared family intelligence** (fault table, status/command decode, parameter groups — usually common across the family) once, with **per-model overrides** for the parts that differ (exact ratings, envelope, any register-address deltas). A nameplate **photo resolves family-first, model-refined**: photo → identify family → load family pack → answer + ask clarifiers → sharpen to the exact model. Groups the member `component_templates` rows via a `family` descriptor; not a new store.
_Avoid_: "model pack" (packs are family-keyed), "product line" (family is the specific technical grouping one manual covers).

**diagnostic card**:
A **derived, cited view** over a pack's extracted intelligence — one per fault code / symptom: `{fault_or_symptom, meaning, likely_causes[], first_checks[], citations[], confidence, provenance_tier}`. The unit the UI shows and the LLM cites. Generated at build/query time from `component_templates` + `kg_entities`, citations from `component_template_sources`. **Promotable** to a hand-curated per-card override when a human tunes one; default is automatic. Not a new hand-authored store.
_Avoid_: "card" (alone — ambiguous), "troubleshooting step" (a card composes several), a new `diagnostic_cards` table as the default (it's derived).

**pack provenance** (`bench_verified` | `manual_cited`):
Per-item trust tier inside a drive pack. `bench_verified` = confirmed on real hardware (GS10 live decode). `manual_cited` = extracted from the OEM manual with a page cite but not hardware-confirmed (most fault semantics, all packs for drives we don't own). Surfaced honestly in the answer ("per manual §X … not hardware-verified"). Tracked **per item**, not per pack — a "bench-verified" pack can still have manual-cited fault meanings. Same honesty discipline as `.claude/rules/fieldbus-readonly.md` ("confidently wrong is worse than no answer").
_Avoid_: "verified" (collides with `kg_*.approval_state='verified'` — see ADR-0017; say `bench_verified`), "trusted", "confirmed".

### Control relationships (sibling tree + typed edge)

Per ADR-0018: a Motor and the VFD that controls it are **siblings** in the Asset tree (under the same sub-assembly), connected by a `DRIVES` / `IS_DRIVEN_BY` edge in `kg_relationships`. Same rule for Inverter↔DC bus (via `POWERED_BY`), Sensor↔PLC analog input (via `WIRED_TO`), and any other "X controls Y" pairing. The tree captures *physical containment*; the graph captures *control / power / signal flow*. This matches IEC 81346, OPC UA Robotics (`IsDrivenBy`), and every major vendor tool (Rockwell PlantPAx `P_Motor`+`P_VFD` as separate AOIs; Siemens TIA Portal SINAMICS+motor as separate Devices).

The Hub `/assets` page renders either view from the same data — **Physical** (default, mirrors UNS path) or **Control** (motors indent under their VFDs via the `DRIVES` edge). Toggle is session-sticky. Orphan motors (across-the-line, no VFD) and orphan VFDs (spare drives in inventory) are first-class — they render at their physical-tree position in both views.
_Avoid_: "motor is part of the VFD" (it isn't — it's driven by one), "VFD parent / motor child" (no parent_asset_id relationship between them — they share a parent sub-assembly).

### Counting and reading rules

- "N proposals pending" = `SELECT count(*) FROM ai_suggestions WHERE status='pending'`. Never join through `relationship_proposals` for this count — the `kg_edge` header pattern double-counts.
- The engine reads only verified rows. Anything `proposed` is invisible to diagnostic paths; it's only visible to `/proposals` and to admin tools.
- Promotion path: `AISuggestion(status='accepted')` → for `kg_edge`, follow pointer to `relationship_proposals(status='verified')` → upsert into `kg_relationships(approval_state='verified')`. For the other five types, the writer determined by `suggestion_type` runs the equivalent upsert on its canonical target table.

## Flagged ambiguities

**"The proposal table"** — forbidden phrase. Code reviews and ADRs must name `ai_suggestions` or `relationship_proposals` explicitly. Resolved 2026-05-24 (this entry); enforced in `.claude/CLAUDE.md` § "Knowledge graph proposals".

## Example dialogue

> **Mike:** The May 21 photo demo — when a technician snaps a nameplate, what shows up on `/proposals`?
>
> **Claude:** One **AISuggestion** with `suggestion_type='kg_entity'`. The Hub `/proposals` page lists it under "New component instances". There's no `RelationshipProposal` involved because nothing's being linked yet — it's just a candidate `installed_component_instances` row waiting for admin acceptance.
>
> **Mike:** And if the technician also says "this drives motor M-204"?
>
> **Claude:** Two AISuggestions. One `kg_entity` for the new instance, one `kg_edge` for the `drives` relationship. The `kg_edge` one has a `RelationshipProposal` backing it with a `relationship_evidence` row pointing at the photo + the transcript. The Slack reply says "2 proposals pending" — one count, both rows.
>
> **Mike:** What does the engine see right after that?
>
> **Claude:** Nothing yet. Both AISuggestions are `status='pending'`; the engine reads only `approval_state='verified'` rows from `kg_entities` and `kg_relationships`. Once an admin accepts on `/proposals`, the engine sees the new instance + edge on the next diagnostic turn.
