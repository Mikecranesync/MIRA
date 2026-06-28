# CIP Skid 01 — PLC Tag Description Sheet

**Asset ID:** `cipskid01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.cipskid01`
**Type:** `cip_skid`

**Note:** CIPSkid01 is a utility asset — it does not have a PackML `run_state`.
CIP is an either-active-or-not mode (`cip_active`).

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `cip_active` | `...cipskid01.process.cip_active` | BOOL | — | FALSE (production) | CIP cycle active; interlocks Filler01 and other food-contact machines out of production mode |
| `cycle_step` | `...cipskid01.process.cycle_step` | STRING | — | "idle" | Current CIP step: idle / pre-rinse / caustic / intermediate-rinse / acid / final-rinse / sanitize |
| `supply_temp` | `...cipskid01.process.supply_temp` | FLOAT | °F | 140–170 | CIP solution supply temperature (heated for caustic and sanitize steps) |
| `return_temp` | `...cipskid01.process.return_temp` | FLOAT | °F | 130–165 | CIP return line temperature — differential vs. supply indicates heat loss |
| `conductivity` | `...cipskid01.process.conductivity` | FLOAT | mS/cm | 8–15 (caustic) | In-line conductivity meter; monitors cleaning solution concentration |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `valve_fault` | `...cipskid01.faults.valve_fault` | BOOL | Any CIP valve actuator fault (stuck-open or stuck-closed) |

## Interlock Notes
When `cip_active` = TRUE, Filler01 is interlocked against production start (`DI-FLR-06 CIP Mode Active`).
Never allow `cip_active` to be TRUE and a production machine to be in EXECUTE simultaneously.

*Synthetic SimLab fixture — not a real OEM document.*
