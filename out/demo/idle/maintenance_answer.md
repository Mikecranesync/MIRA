# MIRA maintenance answer -- CV-101

**Question:** Why is CV-101 stopped?  
**Data source:** REPLAY fixture 'cv101_idle_healthy' (deterministic, no PLC)  
**Asset:** CV-101 (Discharge conveyor CV-101)

## Answer

CV-101 is stopped because it is **not being commanded to run** -- the GS10 command word reads STOP and the motor-running signal is OFF. This is a normal idle stop, **not a fault**: the PLC<->GS10 link is healthy (DC bus nominal at 321.5 V), no GS10 fault is active (fault_code = 0), and the e-stop is clear. Nothing is wrong with CV-101; it simply has no run command.

## Evidence used (approved context model)

| signal | value | source | confidence | approval |
|---|---|---|---|---|
| motor_running | False | C @0 (FC1) | high | approved |
| vfd_comm_ok | True | C @3 (FC1) | high | approved |
| e_stop_active | False | C @5 (FC1) | high | approved |
| estop_wiring_fault | False | C @9 (FC1) | high | approved |
| vfd_frequency | 0.00 Hz | H @106 (FC3) | high | approved |
| vfd_current | 0.00 A | H @107 (FC3) | high | approved |
| vfd_voltage | 0.00 V | H @108 (FC3) | high | approved |
| vfd_dc_bus | 321.50 V | H @109 (FC3) | high | approved |
| vfd_cmd_word | 1 (STOP) | H @114 (FC3) | high | approved |
| vfd_status_word | 9472 | H @117 (FC3) | medium | approved |
| vfd_fault_code | 0 | H @118 (FC3) | high | approved |

## What MIRA will NOT claim (unmapped signals)

- photo_eye: PE-101 (coil 000023 / offset 22) is not exposed on the current sparse Micro820 map (pre slave-map-v2). (MIRA must NOT assert or rule out a photo-eye jam (A12) from data. It has to say the signal is unavailable, not guess.)
- vfd101: Commanded-Hz setpoint (A7) is not in the provisioned 11-register set. (MIRA cannot judge freq-vs-setpoint tracking; it must not claim the drive is/ isn't holding commanded speed.)

> Grounding rule: MIRA answers only from approved, evidence-backed signals. Raw tags alone are not enough -- the context model is what turns them into a technician-grade answer, and what stops MIRA from guessing about signals it does not have.
