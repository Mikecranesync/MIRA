# /mira-generate-component-template

Generate a reusable component-profile template for a given component type. Marks unknown values as `unknown` rather than inventing them.

## Input

- `component_type` (required) — e.g. `photoeye`, `vfd`, `contactor`, `proximity_sensor`, `inductive_sensor`, `flow_meter`, `pressure_transducer`, `servo_drive`, `pneumatic_cylinder`, `solenoid_valve`, `motor_starter`, `plc_io_card`, `relay`, `temperature_sensor`, `level_sensor`
- `manufacturer` (optional)
- `model` (optional)

## Output schema (must match `component-profile-builder` skill)

```yaml
component_type:         # required, lowercase, underscore-separated
manufacturer:           # unknown if not provided
model:                  # unknown if not provided
asset_context:          # list of UNS paths where this component appears (empty if generic template)
normal_states:          # list of {name, indicator, description}
failure_modes:          # list of {name, symptoms, common_causes, severity}
fault_codes:            # list of {code, description, source}
plc_tags:               # list of {tag_pattern, datatype, semantics_hint, confidence: proposed}
mqtt_topics:            # list of {topic_pattern, payload_hint}
wiring_references:      # list of {ref, description, source}
manual_references:      # list of {doc_pattern, section_hint}
maintenance_tasks:      # list of {task, interval, tools, parts}
inspection_intervals:   # list of {check, interval}
spare_parts:            # list of {part_number, description, vendor}
known_fixes:            # list of {symptom, action, evidence}
safety_notes:           # list of strings — LOTO, arc flash, lift, confined space if applicable
related_components:     # list of {component_type, relation}
verified_relationships: []
proposed_relationships: # list of {target, relation, evidence, confidence}
evidence:               # list of {type, source} — what the template was built from
confidence:             # overall confidence: template (low until customer-validated)
```

## What this command does

1. **Look up prior templates** for the same `component_type` in `docs/component-templates/` (or wherever templates live in the repo — discover dynamically). If one exists, surface it instead of regenerating.
2. **Use evidence-based defaults** drawn from:
   - Existing MIRA-ingested manuals (search `mira-crawler/ingest/` for matching docs)
   - Generic public knowledge MARKED `confidence: proposed` (so it's not mistaken for verified)
   - Common PLC tag naming conventions (Allen-Bradley, Banner, Siemens style)
3. **Mark unknowns explicitly.** Don't fabricate fault codes or PLC tag patterns. If unsure, list `unknown` and let downstream ingestion populate them.
4. **Include 1–3 known failure modes** from public component datasheets (with `source: public_datasheet` evidence).
5. **Write the template** to `docs/component-templates/<component_type>/<manufacturer>_<model>.yaml` (or `<component_type>/generic.yaml` if mfr/model unknown).
6. **Append the template path to an index file** at `docs/component-templates/INDEX.md`.

## Special cases

- `photoeye` / `proximity_sensor` / `occupancy_sensor` — include the B16.2 scenario hints (see `/mira-create-demo-plant`) as a usage example.
- `vfd` — include MODBUS holding-register hints (e.g. `HR100=speed_rpm`) from root `CLAUDE.md` industrial system map. Mark `confidence: proposed`.
- `contactor` / `relay` — include arc-flash safety note.

## Constraints

- **Never invent fault codes.** If you don't have a manual that lists them, the field is `unknown` with `confidence: proposed`.
- **Never assume PLC tag meaning.** Provide tag *patterns* with `semantics_hint` + `confidence: proposed`.
- **Generic templates start at low confidence.** Customer-specific instances graduate to higher confidence after technician/admin review.
- **One template per file.** No multi-component bundles.

## Verification

- The generated YAML loads via `yaml.safe_load()`.
- `confidence` field is present everywhere it's expected.
- Index file lists the new template.
- `grep -i "unknown" docs/component-templates/<file>` shows the unknown fields (sanity check that you didn't invent data).

## Cross-references

- `.claude/skills/component-profile-builder/SKILL.md` — full schema authority
- `.claude/skills/manual-ingestion-extractor/SKILL.md` — how extraction populates templates
- `docs/specs/mira-component-intelligence-architecture.md`
