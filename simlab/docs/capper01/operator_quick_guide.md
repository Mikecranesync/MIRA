# Capper 01 — Operator Quick Guide

## Machine Overview
Capper 01 is an in-line rotary capping station applying screw caps to filled bottles.
A cap-chute gravity feeder delivers caps to the capping heads. A torque monitoring system
measures applied torque on every cap and rejects bottles outside the target torque window.
Nominal throughput: 200 bottles per minute.

## Machine Identification
- **Asset ID:** capper01
- **Type:** capper
- **UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.capper01`
- **Location:** Line 01, Station 5 (downstream of Filler 01)

## Panel Controls
| Control | Function |
|---------|----------|
| AUTO / MANUAL | Production vs. single-head manual test |
| START | Arms PackML EXECUTE state |
| STOP | Completes in-progress cycle, halts |
| E-STOP | Immediate de-energize |
| Torque Target Dial | HMI — target torque in in-lb |

## Normal Operating Parameters
| Parameter | Normal Range | Tag |
|-----------|-------------|-----|
| Cap torque | 14–18 in-lb | `cap_torque_inlb` |
| Torque variance | < ±2.0 in-lb | `cap_torque_variance` |
| Cap chute level | > 30% | `cap_chute_level` |
| Motor current | 3.5–6.0 A | `motor_current_amps` |

## Common Operator Actions
- **Cap chute empty:** Refill cap hopper from bulk supply bin. `cap_chute_level` < 20% triggers WARN alarm.
- **Jam detected:** Machine auto-halts (`jam_detected` = TRUE). Clear jam per jam-clearance SOP before resetting.
- **Torque out of spec:** Inspect clutch pads and torque heads per troubleshooting guide.

*Synthetic SimLab fixture — not a real OEM document.*
