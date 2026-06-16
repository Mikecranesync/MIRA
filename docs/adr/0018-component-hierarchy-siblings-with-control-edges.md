# ADR-0018: Component hierarchy — siblings in the tree, control relationships in `kg_relationships`

## Status
Accepted — 2026-05-24

**Related:** ADR-0013 (Hub migrations canonical for product-surface schema), ADR-0014 (`ai_suggestions` as broad work queue), ADR-0017 (Proposal state-machine mapping), `CONTEXT.md` (cross-cutting glossary — Things in the factory).
**Implements:** the component-hierarchy decision raised during the 2026-05-24 `/grill-with-docs` session, plan `~/.claude/plans/each-motor-should-be-majestic-popcorn.md`.

---

## Context

While reviewing the proposed component tree for a conveyor, the question came up: when a VFD controls a motor, should the motor be modeled as a **child of the VFD** in the asset tree, or as a **sibling under the same machine sub-assembly**?

The "motor under VFD" intuition is real on the bench — F004 on a GS10 is meaningless without knowing the motor it drives, and techs think of the pair as a unit. The question is whether to bake that pairing into the source-of-truth tree or to deliver it as a UI projection over a sibling tree.

We surveyed the primary sources before deciding.

### What standards say

| Standard | Position |
|---|---|
| **IEC 81346-1:2022** (Reference Designation System) | Motor and VFD are **siblings** under a common drive-axis subfunction. Example designation: `=S1.G1-VFD1` and `=S1.G1-M1`. The relationship is *semantic* (function), not hierarchical (containment). Multi-axis and shared-DC-bus cases use sibling subfunctions, not nesting. |
| **OPC UA Robotics (OPC 40010-1)** | Defines explicit reference types: `IsDrivenBy` / `Drives` are non-hierarchical edges between sibling Asset nodes. *"An electrical motor IsDrivenBy a servo amplifier (drive)."* |
| **OPC UA FX (OPC 10000-81)** | `IsHostedBy` maps one *FunctionalEntity* (drive axis) onto **two Assets** (inverter + motor). Neither is subordinate; the function spans both. |
| **ISA-95 / ISA-88** | Silent at the Control Module level. Doesn't prescribe VFD-motor structure either way. |
| **AAS** (IDTA-02011-1-1) | Neutral. Supports `HasPart` (containment) and `AnnotatedRelationshipElement` (semantic). Control relationships are recommended as semantic, not containment. |

### What vendors do

| Tool | Behavior |
|---|---|
| Rockwell **PlantPAx 5.x** | `P_Motor` and `P_VFD` ship as separate Add-On Instructions in the Library of Process Objects, linked by tag bindings — sibling objects, not nested. |
| Siemens **TIA Portal** | SINAMICS drive and motor are separate Devices in Devices & Networks. Topology view shows the connection; project tree shows them as peers. SIMOCODE ES manages motor protection as a third separate device. |
| Inductive Automation **Ignition** | UDT *inheritance* (a `VFD_Motor` UDT extending `Motor`) is supported, but the runtime *instance* tags for a motor and its VFD are typically separate folders, not nested. |
| **CMMS best practice** (Plant Services, 2026) | "The motor drives the gearbox, which drives the pump, and individually, each requires its own maintenance strategy and should have its own asset number." Siblings + own-asset-id each. |
| **MCC convention** | Each bucket is an Asset (child of MCC). Each bucket contains VFD/starter and motor as siblings. |

### What MIRA already has

- `cmms_equipment.parent_asset_id` (Hub migration 012) — recursive Asset tree, nests as deep as the customer's machine hierarchy.
- UNS path = 6-level ISA-95 (`enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}`) — sibling-shaped by design.
- `kg_relationships.relationship_type` enum (Hub migration 018) — has `HAS_COMPONENT`, `POWERED_BY`, `WIRED_TO`, `UPSTREAM_OF`, `DOWNSTREAM_OF`, `DEPENDS_ON`, etc.
- **Gap:** no `DRIVES` / `IS_DRIVEN_BY` relationship type. Closest existing is `POWERED_BY`, which is too generic (a 24V control PSU "powers" a relay without "driving" it in the variable-frequency sense).
- `docs/specs/uns-kg-standards-compliance.md` had already audited MIRA against ISA-95 / ISO 14224 / Sparkplug B / OPC UA and identified three gaps. This decision closes a 4th gap: typed control-edge relationship.

## Decision

**Source-of-truth tree = siblings.** Motor and VFD remain siblings under their common sub-assembly in `cmms_equipment.parent_asset_id` and in the UNS path. This matches IEC 81346, OPC UA Robotics/FX, ISA-95 spirit, and every major vendor's project tree.

**Control relationship = typed edge in `kg_relationships`.** Hub migration 028 (`028_drives_relationship_type.sql`) extends the `relationship_proposals.relationship_type` CHECK to include `DRIVES` + `IS_DRIVEN_BY` as an inverse pair. The AISuggestion accept handler for a `kg_edge` of these types writes both rows so any traversal (downstream from VFD or upstream from motor) hits the edge.

**UI delivers both views.** The Hub `/assets` page renders either:
- **Physical view (default):** mirrors the UNS path + `parent_asset_id` chain. Matches what the tech sees on the QR sticker.
- **Control view (toggle):** motors render as indented children of the VFD that `DRIVES` them. Orphan motors (across-the-line started, no `IS_DRIVEN_BY` edge) stay at their physical-tree position. Orphan VFDs (spare, no motor downstream) stay at their physical-tree position. Toggle is session-sticky.

Both views read the same underlying data — the difference is rendering, not storage.

## Why this is right

- **Standards alignment.** ISA-95 + IEC 81346 + OPC UA Robotics/FX all converge on siblings + typed edge. MIRA's `docs/specs/uns-kg-standards-compliance.md` already commits to standards alignment as a defensibility property; this decision keeps that commitment.
- **Vendor interop.** Future imports from Studio 5000 device tags, TIA Portal exports, Sparkplug B node IDs, or OPC UA Companion Specs land cleanly without a hierarchy-translation layer.
- **Maintainability.** A `DRIVES` edge is a row in `relationship_proposals` / `kg_relationships`. It can be proposed, accepted, contradicted, replaced (per ADR-0017) without touching the asset tree. A child-of-VFD position couldn't be re-edged without moving a row in the tree — every edge change becomes a structural change.
- **Edge cases collapse.** Multi-motor drives, shared DC bus, MCC buckets, across-the-line motors, spare drives — all fit naturally as siblings with optional edges. A child-of-VFD model has to invent special cases for each.
- **Delivers the user UX.** The "motor under VFD" view the original ask called for is exactly what the Control view renders. Users get what they asked for; the data model doesn't pay for it.

## Consequences

- New Hub migration `028_drives_relationship_type.sql`: extends CHECK constraint, fully backwards-compatible, reversible.
- New entries in `CONTEXT.md` under "Things in the factory" documenting the sibling + edge model and the orphan cases.
- New section "§ Component hierarchy" in `docs/specs/maintenance-namespace-builder-spec.md` with four worked examples (single VFD-motor pair, two-motor VFD, common DC bus, MCC bucket).
- `docs/specs/uns-kg-standards-compliance.md` gets a 4th gap-closure note pointing at this ADR.
- Phase 2 Hub UI work adds the view toggle on `/assets`. Helper `mira-hub/lib/asset-tree-views.ts` (pure function: physical tree + DRIVES edges → control tree) is the optional separable extraction.
- AISuggestion writers that previously had nowhere clean to put VFD-motor proposals now use `kg_edge` of type `DRIVES`. They flow through the standard ADR-0017 status mapping.
- Engine diagnostic paths gain a new edge type to traverse: "what does this VFD drive" / "what drives this motor". Indexes on `(source_id, relationship_type)` and `(target_id, relationship_type)` already exist.

## What was NOT decided here

- **UNS path format.** Stays 6-level ISA-95. No new path segment for "what drives this" — the graph carries that.
- **IEC 81346 reference designation syntax** (`=function+location-product`). Not adopted. MIRA's UNS path is the designation system already.
- **PLC ↔ I/O module nesting.** Same pattern likely applies (siblings + typed edges), but each integration needs its own decision when the use case arrives.
- **Sensor ↔ analog-input wiring.** Will use `WIRED_TO` (existing) when the case arises.
- **Auto-promote rule for `DRIVES` proposals.** Still requires admin acceptance per ADR-0017. The engine never reads a `DRIVES` edge until it's `verified`.
- **Drive-Composer-style parameter-set viewer** mentioned in the spec as a Control-view UI possibility. Out of scope; UI scope is the tree toggle only.

---

## Verification

```bash
# Schema migration is reversible.
psql "$STAGING_NEON_URL" -f mira-hub/db/migrations/028_drives_relationship_type.sql
psql "$STAGING_NEON_URL" -c "INSERT INTO relationship_proposals (tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type, relationship_type, confidence, status, created_by, risk_level) VALUES (gen_random_uuid(), gen_random_uuid(), 'component', gen_random_uuid(), 'component', 'DRIVES', 0.95, 'proposed', 'human', 'low');"

# Pre-existing types still valid.
psql "$STAGING_NEON_URL" -c "INSERT INTO relationship_proposals (tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type, relationship_type, confidence, status, created_by, risk_level) VALUES (gen_random_uuid(), gen_random_uuid(), 'equipment', gen_random_uuid(), 'component', 'HAS_COMPONENT', 1.0, 'verified', 'import', 'low');"

# Spec example tree matches what Hub renders (after UI lands).
# See docs/specs/maintenance-namespace-builder-spec.md §"Component hierarchy"
# for the four worked examples that drive the test seed.
```
