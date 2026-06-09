# Case Packer 01 — PLC Tag Description Sheet

**Asset ID:** `casepacker01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.casepacker01`
**Type:** `case_packer`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...casepacker01.status.run_state` | ENUM | PackML machine state label |

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `case_former_ready` | `...casepacker01.process.case_former_ready` | BOOL | — | TRUE | Case forming station ready: glue at temp, blank loaded, mandrel at home |
| `glue_level` | `...casepacker01.process.glue_level` | FLOAT | % | >25 | Hot-melt glue remaining in hopper (ultrasonic sensor) |
| `glue_temperature` | `...casepacker01.process.glue_temperature` | FLOAT | °F | 300–325 | Case former glue pot temperature |
| `jam_detected` | `...casepacker01.process.jam_detected` | BOOL | — | FALSE | Jam sensor in collation zone, forming station, or discharge lane |

## Production Tags
| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `case_count` | `...casepacker01.production.case_count` | INT | cases | Cumulative completed cases this batch |
| `bottle_infeed_count` | `...casepacker01.production.bottle_infeed_count` | INT | bottles | Cumulative bottles received from Labeler 01 |

## Quality Tags
| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `reject_count` | `...casepacker01.quality.reject_count` | INT | count | Cases rejected for failed seal or incomplete collation this batch |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...casepacker01.faults.fault_code` | STRING | Active fault code (CP001–CP007) |

## Tag Interaction Notes
- `jam_detected` is the primary Scenario D trigger. When TRUE, the machine halts and upstream `conveyorzone02.process.accumulation_percent` rises within 2–3 minutes. If not resolved, `conveyorzone01.process.accumulation_percent` follows.
- `case_former_ready` will not assert TRUE until `glue_temperature` reaches 295 °F minimum — this is an interlock, not a suggestion.
- `bottle_infeed_count` ÷ 12 should closely track `case_count`. A growing discrepancy indicates a collation fault or partial case.

*Synthetic SimLab fixture — not a real OEM document.*
