# mira-plc-map-mcp — Spec

MCP server exposing PLC tag inventory + proposed component mappings. Tag *meaning* is never assumed from the name alone.

**Status:** proposed.
**Underlying data:** PLC programs in `plc/ccw/` (Structured Text, MicroLogix configs), Ignition tag exports in `ignition/`, optional CSV tag exports from customer onboarding.
**Auth:** tenant scope required; admin role required for `propose_tag_component_mapping` commit-to-verified path.

## Tools

### `list_plcs(tenant_id?: str) -> list[PLC]`
PLCs known for a tenant.

```jsonc
{
  "id": "plc_micro820_1",
  "name": "Conveyor Lab Micro820",
  "vendor": "Rockwell",
  "model": "Micro820",
  "address": "192.168.1.100:502",
  "uns_path": "enterprise.stardust_racers.site.garage_factory.area.conveyor_lab.line.line5.plc.micro820_1",
  "tag_count": 142,
  "source": "ccw|ignition_export|csv_upload",
  "confidence": "verified"
}
```

### `search_tags(query: str, plc_id?: str, limit?: int = 20) -> list[Tag]`
Free-text tag search across all PLCs (or scoped).

### `get_tag(tag_id: str) -> Tag`

```jsonc
{
  "id": "tag_conveyor_b16_run",
  "name": "Conveyor_B16_Run",
  "plc_id": "...",
  "data_type": "BOOL",
  "address": "%I0/12",
  "scope": "local|global",
  "format": "allen_bradley|local_io|structured_text|csv_export",
  "comments": ["// Run command for conveyor B16"],
  "proposed_component_id": null,
  "verified_component_id": "...",
  "evidence": [{"type": "ladder_comment", "ref": "MainProgram.Conveyor_B16.rung12"}],
  "confidence": "verified|proposed|none"
}
```

### `find_tags_by_component(component_id: str) -> list[Tag]`
All tags currently mapped (verified OR proposed) to a component.

### `propose_tag_component_mapping(tag_id: str, component_id: str, evidence: list, tenant_id?: str) -> Mapping`
Write. Persists with status `proposed` unless admin context promotes to `verified`. Empty `evidence` → reject.

### `get_logic_references(tag_id: str) -> list[LogicRef]`
Where this tag is read/written in the ST/ladder/FBD program. Useful for inferring meaning safely.

```jsonc
{
  "tag_id": "...",
  "program": "MainProgram",
  "block": "Conveyor_B16_FB",
  "rung_or_line": 12,
  "operation": "OUT",
  "context_snippet": "Conveyor_B16_Run := Conveyor_B16_Start AND NOT Conveyor_B16_Fault;"
}
```

## Tag formats supported

- Allen-Bradley structured tags (`AOI_Conveyor.Status.Run`)
- Local I/O (`%I0/12`, `%Q0/3`)
- Structured Text variables
- Ladder/FBD function-block references
- Generic PLC CSV tag exports (vendor-agnostic)

## Safety

- **Never assume physical meaning from a tag name.** A tag named `Pump_1_Run` may be a flag, a counter, an HMI display var, or unused. Always cite a drawing, PLC comment, naming convention, manual ref, or technician confirmation before mapping.
- **Distinguish verified vs proposed.** Bot-derived mappings start as `proposed`.
- **Confidence required** on every mapping.
- **Read-only on live PLC.** This MCP does NOT write to a PLC under any circumstance.
- **Audit trail.** Mapping status changes log to `plc_tag_mapping_audit`.

## Cross-references

- `.claude/skills/plc-tag-mapper/SKILL.md`
- `plc/ccw/` — Micro820 ST programs and tag config
- `ignition/` — Ignition tag exports
- `docs/specs/sparkplug-uns-bridge-spec.md` — how Sparkplug tags map to UNS
