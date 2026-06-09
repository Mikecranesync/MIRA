# Filler 01 — PLC Tag Description Sheet

**Asset ID:** `filler01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01`
**Type:** `rotary_filler`

All tag paths follow the canonical pattern:
`enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.<category>.<tag_name>`

---

## Status Tags

| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `run_state` | `...filler01.status.run_state` | ENUM | — | PackML machine state label (IDLE / EXECUTE / HELD / ABORTED / etc.) |

---

## Process Tags

| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `bottles_per_minute` | `...filler01.process.bottles_per_minute` | FLOAT | BPM | 180–210 | Calculated throughput based on encoder counts |
| `fill_level_oz` | `...filler01.process.fill_level_oz` | FLOAT | oz | 11.85–12.15 | Average measured fill level of last 10 samples |
| `fill_level_target_oz` | `...filler01.process.fill_level_target_oz` | FLOAT | oz | 12.0 | Operator-set fill level target (HMI writable) |
| `fill_level_variance` | `...filler01.process.fill_level_variance` | FLOAT | oz | ±0.15 | Rolling standard deviation of fill level last 30 samples; negative = underfill trend |
| `tank_level_percent` | `...filler01.process.tank_level_percent` | FLOAT | % | 20–100 | Product supply balance tank level (0–100%) |
| `product_temperature` | `...filler01.process.product_temperature` | FLOAT | °F | 34–42 | Product temperature at bowl thermocouple |
| `filler_bowl_pressure` | `...filler01.process.filler_bowl_pressure` | FLOAT | PSI | 10–18 | Headspace pressure inside the product bowl |
| `nozzle_fault_count` | `...filler01.process.nozzle_fault_count` | INT | count | 0 | Number of nozzles reporting flow or actuation fault this cycle |

---

## Motor Tags

| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `vfd_speed_hz` | `...filler01.motor.vfd_speed_hz` | FLOAT | Hz | 45–60 | VFD output frequency to carousel drive motor |
| `motor_current_amps` | `...filler01.motor.motor_current_amps` | FLOAT | A | 4.0–7.5 | RMS motor current drawn by carousel drive motor |

---

## Quality Tags

| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `underfill_reject_count` | `...filler01.quality.underfill_reject_count` | INT | count | Cumulative count of bottles rejected for underfill this batch |
| `overfill_reject_count` | `...filler01.quality.overfill_reject_count` | INT | count | Cumulative count of bottles rejected for overfill this batch |

---

## Faults Tags

| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...filler01.faults.fault_code` | STRING | Active fault code (e.g. "F007"); empty = no active fault |

---

## Notes on Tag Interactions
- `filler_bowl_pressure` is the leading indicator for underfill: when it drops below 10 PSI, `underfill_reject_count` begins rising within 2–3 minutes.
- `nozzle_fault_count` > 0 while `filler_bowl_pressure` is normal indicates a mechanical nozzle issue rather than a system pressure problem.
- `motor_current_amps` rising with `vfd_speed_hz` stable indicates a mechanical drag increase (seal wear, carousel jam).
- `fill_level_variance` > ±0.5 oz with `filler_bowl_pressure` normal suggests bowl float valve instability.

*Synthetic SimLab fixture — not a real OEM document.*
