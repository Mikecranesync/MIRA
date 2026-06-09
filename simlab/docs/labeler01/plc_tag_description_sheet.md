# Labeler 01 — PLC Tag Description Sheet

**Asset ID:** `labeler01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.labeler01`
**Type:** `labeler`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...labeler01.status.run_state` | ENUM | PackML machine state label |

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `label_roll_percent` | `...labeler01.process.label_roll_percent` | FLOAT | % | >20 | Label roll remaining, estimated by encoder rotation count |
| `label_web_tension` | `...labeler01.process.label_web_tension` | FLOAT | lb | 0.8–1.4 | Dancer roller tension — load cell measurement |
| `label_sensor_blocked` | `...labeler01.process.label_sensor_blocked` | BOOL | — | FALSE | Web-path photo-eye; TRUE = web not advancing or break |
| `glue_temperature` | `...labeler01.process.glue_temperature` | FLOAT | °F | 270–295 | Hot-melt glue pot temperature |
| `registration_error_mm` | `...labeler01.process.registration_error_mm` | FLOAT | mm | ±1.0 | Label placement deviation from target; negative = leading edge short |

## Quality Tags
| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `reject_count` | `...labeler01.quality.reject_count` | INT | count | Cumulative mis-label rejects this batch |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...labeler01.faults.fault_code` | STRING | Active fault code (L001–L007) |

## Tag Interaction Notes
- `registration_error_mm` is the primary quality indicator for Scenario C. It rises when `label_web_tension` drifts outside range, glue temperature is low, or the servo drive loses following accuracy.
- `label_sensor_blocked` = TRUE immediately stops label advance; if it triggers during a run (not during splice), it indicates a web break or jam.

*Synthetic SimLab fixture — not a real OEM document.*
