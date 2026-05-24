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
