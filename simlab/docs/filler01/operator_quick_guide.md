# Filler 01 — Operator Quick Guide

## Machine Overview
Filler 01 is a 20-valve rotary volumetric filling machine designed for still juice products.
It fills containers from a central product bowl supplied by an overhead balance tank.
Nominal throughput: 200 bottles per minute (BPM) at 12 oz target fill.

## Machine Identification
- **Asset ID:** filler01
- **Type:** rotary_filler
- **UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01`
- **Location:** Line 01, Station 4 (downstream of Rinser 01)

## Panel Controls
| Control | Function |
|---------|----------|
| AUTO / MANUAL selector | Production mode vs. single-valve manual test |
| START | Arms filler in PackML EXECUTE state |
| STOP (normal) | Completes in-progress fill cycle, then halts |
| E-STOP (red mushroom) | Immediate de-energize — requires key reset |
| Speed Dial (0–100%) | VFD speed setpoint override (manual mode only) |
| Fill Level Setpoint | HMI touchscreen — target fill level in ounces |

## Startup Sequence
1. Confirm product supply tank level > 30% (`tank_level_percent` on HMI).
2. Confirm filler bowl pressure within range (10–18 PSI; see `filler_bowl_pressure`).
3. Confirm VFD status = Ready; no motor overload active.
4. Confirm no active fault codes on the `fault_code` tag.
5. Press START on panel or issue PackML START command from line controller.
6. Monitor `bottles_per_minute` ramp-up — should reach setpoint within 30 s.

## Normal Operating Parameters
| Parameter | Normal Range | Tag |
|-----------|-------------|-----|
| Bowl pressure | 10–18 PSI | `filler_bowl_pressure` |
| Fill level | ±0.15 oz of target | `fill_level_variance` |
| Bottles per minute | 180–210 BPM | `bottles_per_minute` |
| VFD speed | 45–60 Hz | `vfd_speed_hz` |
| Motor current | 4.0–7.5 A | `motor_current_amps` |
| Product temperature | 34–42 °F | `product_temperature` |
| Tank level | > 20% | `tank_level_percent` |

## Normal Shutdown
1. Issue PackML STOP command or press STOP on panel.
2. Filler completes current rotation and halts at home position.
3. If product is to remain in bowl > 2 hours, initiate rinse cycle or drain bowl.
4. Log any fault codes observed during the shift.

## CIP Integration
Filler 01 participates in CIP Skid 01 cleaning cycles.
During CIP, the filler must be placed in PackML COMPLETING state.
Do NOT initiate CIP unless the CIP Skid 01 `cip_active` tag reads TRUE
and `cycle_step` is "pre-rinse" or later. Operator confirmation required before CIP.

*Synthetic SimLab fixture — not a real OEM document.*
