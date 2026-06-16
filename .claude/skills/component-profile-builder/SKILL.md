---
name: component-profile-builder
description: Use when turning manuals, BOMs, PLC tags, wiring diagrams, work orders, and technician notes into reusable component profiles. Triggers on edits to `mira-crawler/ingest/`, manual ingestion flows, or when a customer onboarding spec arrives.
---

# Component Profile Builder

A **component profile** is the reusable unit of maintenance memory. It captures everything we know about a component — generic at the model level, specific at the instance level — so future troubleshooting can ground in it.

Profiles are the SaaS asset. Build them with discipline.

## Target schema (YAML; matches `/mira-generate-component-template`)

```yaml
component_type:           # required, lowercase, underscore-separated, e.g. occupancy_sensor
manufacturer:             # e.g. Banner — "unknown" if not extracted
model:                    # e.g. Q4X — "unknown" if not extracted
asset_context:            # list of UNS paths where this component instance appears
  - enterprise.stardust_racers.site.garage_factory.area.conveyor_lab.line.line5.work_cell.conveyor_b16.pe_b16_2

normal_states:
  - name: clear
    indicator: "DO output LOW"
    description: "No object in beam"
  - name: occupied
    indicator: "DO output HIGH"
    description: "Object detected in beam"

failure_modes:
  - name: occupied_too_long
    symptoms: ["1.SOC B16.2 OCCUPIED TOO LONG fault on HMI"]
    common_causes: ["jammed product", "misalignment", "dirty lens"]
    severity: line_stop

fault_codes:
  - code: "1.SOC_B16_2.OCCUPIED_TOO_LONG"
    description: "Beam occupied beyond threshold"
    source: {doc_id: "...", page: 14}

plc_tags:
  - tag_pattern: "*.SOC_B*_*"
    datatype: BOOL
    semantics_hint: "occupied flag"
    confidence: proposed

mqtt_topics:
  - topic_pattern: "spBv1.0/{group}/DDATA/{node}/conveyor_b16/pe_b16_2"
    payload_hint: "boolean occupied flag"

wiring_references:
  - ref: "Panel B16, terminal X3-7"
    description: "Sensor DO wired to PLC %I0/12"
    source: {drawing_id: "...", sheet: 4}

manual_references:
  - doc_pattern: "Banner Q4X manual"
    section_hint: "Troubleshooting / Output"

maintenance_tasks:
  - task: "Clean lens"
    interval: "monthly"
    tools: ["isopropyl wipe"]
    parts: []

inspection_intervals:
  - check: "Alignment LED steady green"
    interval: "weekly"

spare_parts:
  - part_number: "Q4XTBLD-Q8"
    description: "Banner Q4X 4-pin replacement"
    vendor: "Banner"

known_fixes:
  - symptom: "OCCUPIED_TOO_LONG repeats"
    action: "Reset at Panel B16, then realign sensor"
    evidence: {work_orders: ["wo_..."], confirmed_by: "..."}

safety_notes:
  - "LOTO Panel B16 disconnect before mechanical adjustment"

related_components:
  - component_type: conveyor_motor
    relation: shares_line
  - component_type: vfd
    relation: drives_motor

verified_relationships:
  - target: "fault:1.SOC_B16_2.OCCUPIED_TOO_LONG"
    relation: HasFaultMode
    evidence: [{type: manual, doc_id: "...", page: 14}, {type: wo_history, count: 14}]
    confidence: high
    verified_by: "..."

proposed_relationships:
  - target: "component:conveyor_motor_b16"
    relation: SharesLine
    evidence: [{type: ladder_comment, ref: "MainProgram.Conveyor_B16.rung12"}]
    confidence: medium

evidence:
  - {type: manual,      doc_id: "...", section: "Troubleshooting"}
  - {type: wo_history,  asset_id: "...", count: 14}
  - {type: technician,  user_id: "...", message_id: "..."}

confidence: high     # overall — template (low) | proposed (medium) | verified (high)
```

## Hard rules

1. **Evidence-based.** Every populated field carries a `source` (or `evidence`) reference. No naked facts.
2. **Unverified relationships go in `proposed_relationships`, not `verified_relationships`.** Promotion requires technician/admin sign-off.
3. **Mark unknowns explicitly.** `unknown` (string) for missing fields. Don't best-guess.
4. **Per-instance vs per-model.** A profile attached to an instance (a specific PE-B16-2) lives at `asset_context: [<uns_path>]`. A reusable model template has `asset_context: []`. Don't conflate.
5. **No invention from filename.** A manual named `Banner_Q4X_Manual.pdf` doesn't justify writing `manufacturer: Banner, model: Q4X` unless the manual content confirms it.
6. **UNS-tagged.** Profile entities live in `kg_entities` with `uns_path` populated (see `.claude/rules/uns-compliance.md`).

## Build flow

1. **Identify component_type** — from message context, manual title, or PLC tag prefix.
2. **Search existing templates** — `docs/component-templates/<component_type>/`. Reuse where possible.
3. **Extract from manuals** — call `manual-ingestion-extractor` skill to pull fault codes, PM schedule, troubleshooting table.
4. **Pull from PLC tag map** — call `plc-tag-mapper` skill to find tags pointing at this component.
5. **Mine work-order history** — call `work-order-history-miner` skill for known fixes + failure patterns.
6. **Draft profile** — fill schema above. Unknowns stay `unknown`.
7. **Score confidence** — overall is the **min** of populated-field confidences. A single low-confidence field caps the whole profile.
8. **Propose relationships** — via `knowledge-graph-proposer` skill / `mira-component-graph-mcp`. Never auto-verify.

## SaaS value

Component profiles are the **moat**:
- A new customer onboarding with PowerFlex 525 + Banner Q4X + Festo MS6 should reuse existing profiles, not start from zero.
- Profiles graduate from `template` → `proposed` → `verified` as field evidence accumulates.
- The graveyard of verified profiles is what makes MIRA hard to compete with after 12 months of customers.

## Cross-references

- `.claude/skills/manual-ingestion-extractor/SKILL.md`
- `.claude/skills/plc-tag-mapper/SKILL.md`
- `.claude/skills/work-order-history-miner/SKILL.md`
- `.claude/skills/knowledge-graph-proposer/SKILL.md`
- `.claude/mcp/mira-component-graph-mcp-spec.md`
- `.claude/commands/mira-generate-component-template.md`
- `docs/specs/mira-component-intelligence-architecture.md`
