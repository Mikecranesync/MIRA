# CV-101 Anomaly Log -- Ask MIRA brain over the fault battery

_Deterministic offline run of `rules_core.evaluate` (the exact A0-A12 brain the Ignition Ask MIRA button calls). 2026-07-03T07:55:53_

| scenario | banner | rule | sev | what MIRA says | next check |
|---|---|---|---|---|---|
| healthy_idle | **STOPPED** | - | - | Belt stopped -- no active faults. | - |
| healthy_run | **RUNNING** | - | - | All systems nominal. | - |
| A0_offline | **COMMS LOST** | `A0_OFFLINE` | CRITICAL | No fresh PLC data for 9999s (>= 30s). | Check the PLC bridge / Modbus link and that the gateway is polling the device. |
| A1_comm_down | **FAULT** | `A1_COMM_STALE` | CRITICAL | vfd_comm_ok is FALSE - the PLC<->GS10 serial link is down; all VFD values are stale (frozen from the last good poll). | Reseat the RS-485 wiring PLC<->GS10; confirm baud/parity; power-cycle the drive. |
| A2_vfd_fault_oL | **FAULT** | `A2_VFD_FAULT` *(reflash-gated live)* | HIGH | GS10 reports fault code 21: oL (overload) - the drive has tripped (0x2100 low byte). Clear the cause and reset the drive. | Read the GS10 keypad fault, clear the cause, then reset the drive (STOP+RESET). |
| A3_estop_wiring | **FAULT** | `A3_ESTOP_WIRING` | HIGH | Dual-channel e-stop disagreement (DI_02 NC and DI_03 NO read the SAME) or the wiring-fault flag is set - broken/shorted e-stop wire; drive not permitted. | Inspect the dual-channel e-stop loop for a broken/shorted wire (DI_02 vs DI_03). |
| A4_direction | **WARNING** | `A4_DIRECTION_FAULT` | MEDIUM | FWD (DI_00) and REV (DI_01) are both commanded - the PLC commands STOP. | Check the FWD/REV selector wiring -- both directions are commanded at once. |
| A5_illegal_run | **FAULT** | `A5_ILLEGAL_RUN` | HIGH | Motor reports RUNNING but it should not be: e-stop active. | Verify the safety interlock chain; the belt should not run while not permitted. |
| A6_not_responding | **WARNING** | `A6_DRIVE_NOT_RESPONDING` | MEDIUM | Command word is RUN (18) for 4s but the motor is not running. | Confirm the GS10 is in remote/RUN-enabled mode and not faulted/locked. |
| A7_freq_not_tracking | **WARNING** | `A6_DRIVE_NOT_RESPONDING` | MEDIUM | Command word is RUN (18) for 6s but the motor is not running. | Confirm the GS10 is in remote/RUN-enabled mode and not faulted/locked. |
| A7_freq_not_tracking | **WARNING** | `A7_FREQ_NOT_TRACKING` | MEDIUM | Commanded 30.0 Hz but output is 10.0 Hz (off by 20.0 Hz > 3.0) for 6s - drive not reaching commanded speed (mechanical drag, current-limit, or load). | Check for mechanical drag, a current-limit, or load -- drive can't hold speed. |
| A8_overcurrent | **FAULT** | `A8_OVERCURRENT` | HIGH | Output current 7.00 A exceeds motor FLA 5.00 A - possible overload/jam (cf. GS10 oL fault 21). | Inspect the belt/rollers for a jam or binding; compare current to motor FLA. |
| A9_dc_bus_low | **WARNING** | `A9_DC_BUS` | MEDIUM | DC bus 230 V is outside [250, 410] V (nominal ~327 V; low -> GS10 Lvd 12). | Check incoming supply voltage and the GS10 DC-bus (low->Lvd, high->ovd). |
| A10_freq_stuck_zero | **WARNING** | `A6_DRIVE_NOT_RESPONDING` | MEDIUM | Command word is RUN (18) for 6s but the motor is not running. | Confirm the GS10 is in remote/RUN-enabled mode and not faulted/locked. |
| A10_freq_stuck_zero | **WARNING** | `A10_FREQ_STUCK_ZERO` | MEDIUM | Commanded RUN for 6s but output Hz is still 0 - the drive is not following the run command. | Drive commanded RUN but 0 Hz out -- check enable, fault latch, output wiring. |
| A12_photoeye_jam | **FAULT** | `A12_PHOTOEYE_JAM` *(reflash-gated live)* | HIGH | Photo-eye DI_05 latched a soft-stop - an object is blocking the infeed beam (jam/backup); the belt is held stopped until Start re-arms it. | Clear the object blocking the infeed photo-eye (DI_05), then re-arm with Start. |

> Every message is generated from the approved signal(s) the rule read -- the `evidence` column in `anomaly_log.csv` lists the exact topics + values. Rules that need signals the live sparse map doesn't expose yet are marked *reflash-gated*.
