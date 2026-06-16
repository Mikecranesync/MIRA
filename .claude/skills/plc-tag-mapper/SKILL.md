---
name: plc-tag-mapper
description: Use when mapping PLC tags to physical components and UNS paths. Triggers on edits to `plc/`, `mira-connect/`, `ignition/`, or when a customer onboarding includes a PLC tag CSV export.
---

# PLC Tag Mapper

Convert messy PLC tag names into structured mappings to physical components and UNS paths — without ever assuming meaning from the name alone.

## Mapping shape

```
PLC tag → probable physical meaning → physical component → UNS path → evidence → confidence
```

Persisted as:

```jsonc
{
  "tag_id": "tag_conveyor_b16_run",
  "tag_name": "Conveyor_B16_Run",
  "plc_id": "plc_micro820_1",
  "datatype": "BOOL",
  "address": "%I0/12",
  "probable_meaning": "run command for conveyor B16",
  "component_id": "component:conveyor_b16",
  "uns_path": "enterprise.stardust_racers...conveyor_b16",
  "evidence": [
    {"type": "ladder_comment",     "ref": "MainProgram.Conveyor_B16.rung12"},
    {"type": "naming_convention",  "ref": "<Asset>_<Component>_<Action> per docs/specs/plc-naming.md"},
    {"type": "technician_confirm", "user_id": "...", "session_id": "..."}
  ],
  "confidence": "verified|proposed|low",
  "status": "verified|proposed|needs_review|rejected"
}
```

## Hard rules

1. **Never assume physical meaning from a tag name alone.** `Pump_1_Run` could be a control, a flag, an HMI display var, or unused. Only map after at least one evidence type from:
   - Drawings (with sheet ref)
   - PLC comments / rung comments / function-block comments
   - Documented naming convention (cite the spec)
   - Manual reference
   - Technician confirmation
   - Admin-approved mapping
2. **Verified vs proposed.** Mappings start as `proposed`. Promotion to `verified` requires admin/technician sign-off.
3. **Confidence required** on every mapping.
4. **Don't write to PLCs.** This skill is read-side only. PLC writes are explicitly out of scope.
5. **UNS-tag every mapping.** `uns_path` mandatory.

## Tag formats supported

- **Allen-Bradley structured** — `AOI_Conveyor.Status.Run`, `Program:MainProgram.Local:1.O.Data.0`
- **Local I/O** — `%I0/12`, `%Q0/3`, `%MW100`
- **Structured Text variables** — `Conveyor_B16_Run`, `Conveyor_B16_Fault`
- **Ladder / FBD function-block references** — `Conveyor_B16_FB.Run`
- **CSV tag exports** — vendor-agnostic; expect columns like `tag_name, data_type, address, comment`
- **Ignition tag exports** — JSON / CSV from `ignition/` exports; preserve folder structure as scope hint

## What to do when invoked

1. Locate the tag source — `plc/ccw/` (Micro820 ST), `ignition/`, customer CSV
2. Parse tag inventory — name, datatype, address, comment, scope
3. **For each tag**:
   - Search PLC source for rung/line where it's read or written → evidence: `ladder_comment` or `st_reference`
   - Check naming-convention spec if one exists for this customer
   - Search for the tag name in manual ingestion output (sometimes manuals reference tag tables)
   - Cross-reference with any technician confirmation history
4. **Generate proposed mappings** — never verified-by-default. Persist via `propose_tag_component_mapping` (mira-plc-map-mcp) or directly into `kg_entities`+`kg_relationships` with status `proposed`.
5. **For ambiguous tags**, generate a confirmation question for the technician: "Is `Conveyor_B16_Run` the run command for the Section B16 conveyor motor?"
6. **Maintain a mapping audit log** — every status change tracked.

## Naming convention helpers (use as evidence, not as truth)

| Pattern | Hint | Example |
|---|---|---|
| `<Asset>_<Component>_<Action>` | Generic AB-style | `Conveyor_B16_Run` |
| `<Line>.SOC_<Asset>_<Idx>` | Sortation occupancy sensor | `1.SOC_B16_2` |
| `*_FB.*` | Function block | `Conveyor_B16_FB.Status` |
| `HR<n>` (Modbus holding reg) | VFD / drive | `HR100=motor_speed` |
| `%I` / `%Q` | Discrete I/O | `%I0/12 = digital input bit 12` |
| `*_Run`, `*_Stop`, `*_Fault` | Common control suffixes | self-explanatory |
| `*_Cmd`, `*_PV`, `*_SP` | Command, process value, setpoint | analog control |

These patterns provide **evidence type `naming_convention`**, not verified meaning. Confirmation still required.

## Anti-patterns (these are bugs)

- Auto-mapping `Pump_1_Run` to a pump component because the name says "Pump"
- Promoting a mapping to `verified` after one technician thumbs-up reaction (require explicit text/button confirm)
- Mapping a tag to multiple components silently — flag for `needs_review`
- Carrying tag mappings across customer tenants — these are per-tenant
- Inferring datatype from name when source export already declares it

## Cross-references

- `plc/ccw/` — Micro820 Structured Text + tag config
- `ignition/` — Ignition tag exports
- `.claude/mcp/mira-plc-map-mcp-spec.md`
- `.claude/skills/component-profile-builder/SKILL.md`
- `.claude/skills/knowledge-graph-proposer/SKILL.md`
- `docs/specs/sparkplug-uns-bridge-spec.md` — Sparkplug → UNS mapping
