# Case Packer 01 — Operator Quick Guide

## Machine Overview
Case Packer 01 collates labeled bottles into groups of 12 and places them into
formed corrugated cases. A hot-melt glue case former builds cases from flat
blanks. A pneumatic tuck-fold-seal system closes the top of each case.
Downstream case discharge feeds Palletizer 01.
Nominal throughput: ~17 cases per minute (200 BPM ÷ 12 bottles per case).

## Machine Identification
- **Asset ID:** casepacker01
- **Type:** case_packer
- **UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.casepacker01`
- **Location:** Line 01, Station 7 (downstream of Labeler 01)

## Panel Controls
| Control | Function |
|---------|----------|
| AUTO / MANUAL | Production vs. manual case advance mode |
| START | Arms PackML EXECUTE |
| STOP | Completes current case, halts |
| E-STOP | Immediate de-energize |
| Glue Temp Setpoint | HMI — case former glue target temp (nominal 310 °F) |

## Normal Operating Parameters
| Parameter | Normal Range | Tag |
|-----------|-------------|-----|
| Glue level | > 25% | `glue_level` |
| Glue temperature | 300–325 °F | `glue_temperature` |
| Case former ready | TRUE | `case_former_ready` |
| Jam detected | FALSE | `jam_detected` |

## Common Operator Actions
- **Low glue:** Add glue pellets to hopper when `glue_level` < 30%. Machine halts at 10%.
- **Jam:** Machine auto-halts. Clear jam per jam-clearance SOP; reset before restarting.
- **Case former not ready:** Check glue temperature; ensure case blank magazine is loaded.

*Synthetic SimLab fixture — not a real OEM document.*
