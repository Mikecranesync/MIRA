# GS10 DURApulse — Modbus register map & commissioning

AutomationDirect **GS10 DURApulse** VFD, RS-485 Modbus RTU, slave address **1**.
Source of truth for these constants: `device-profiles/gs10.yaml` in the MIRA monorepo
(codified KB, gotchas baked in). **Verify the 0x21xx labels against the GS10 manual** —
MIRA's own program code has mislabeled this block before (see the warning at the bottom).

## Read block (FC03 — read holding registers)

| Addr (hex) | Addr (dec) | Name | Scale | Units | Notes |
|---|---|---|---|---|---|
| 0x2100 | 8448 | `status_monitor_1` | — | bitfield | high byte = warning, low byte = error code |
| 0x2101 | 8449 | `status_monitor_2` | — | bitfield | operation status bits (decode below) |
| 0x2102 | 8450 | `frequency_command` | 0.1 | Hz | what the PLC commanded |
| 0x2103 | 8451 | `output_frequency` | 0.1 | Hz | **actual** motor frequency |
| 0x2104 | 8452 | `output_current` | 0.1 | A | motor amps |
| 0x2105 | 8453 | `dc_bus_voltage` | — | V | ~300–340 V when powered (good "is it alive" fingerprint) |
| 0x2106 | 8454 | `output_voltage` | — | V | motor voltage |

The Conv_Simple VFD POU reads a block starting at `0x2103`. Keep `ElementCnt` inside the
documented `0x2103..0x2106` range — reading past it has produced `ErrorID 55` (Illegal Data
Address) on some firmware revs.

### `status_monitor_2` (0x2101) bit decode

```
bit 0..1  run state    (00 stop / 01 decel / 10 standby / 11 running)
bit 2     JOG command
bit 3..4  direction status
bit 8     master frequency controlled by comm
bit 9     master frequency controlled by analog
bit 11    operation command controlled by comm
bit 12    parameters locked
bit 13    drive is in fault
```

`status_monitor_2` is useful because it is **non-zero while running**, whereas the output
registers read 0 at standstill — which is indistinguishable from "no reply." Reading the
status word disambiguates "drive stopped" from "comms dead."

## Write registers (FC06 — write single register)

| Addr (hex) | Addr (dec) | Name | Values |
|---|---|---|---|
| 0x2000 | 8192 | `control_command` (bitfield) | `1` = STOP · `18` = FWD+RUN · `20` = REV+RUN |
| 0x2001 | 8193 | `frequency_setpoint` | Hz × 10 — e.g. `300` = 30.0 Hz (range 0–4000 = 0.0–400.0 Hz) |
| 0x2002 | 8194 | `control_code_2` (bitfield) | bit 1 = Fault Reset — write `2` (`0x0002`) to clear latched faults |

Command-word values are a bitfield, not an enum — `18` and `20` are FWD/REV with the run bit
set; `1` is stop. Fault reset is a **separate register** (`0x2002`), not a command-word value.

## GS10 keypad parameters (set on the drive, not in PLC code)

| Param | Value | Meaning |
|---|---|---|
| P09.00 | 1  | Modbus slave address |
| P09.01 | 96 | 9600 baud |
| P09.03 | 5  | comm-loss timeout = 5 s → trips fault **CE10** if the master goes silent |
| P09.04 | 13 | RTU, **8-N-2** (8 data, no parity, 2 stop) |
| P00.21 | 2  | run source = RS-485 (so Modbus can command run/stop) |

**Framing gotcha:** `P09.04 = 13` means **8-N-2**, not 8-N-1. An older runbook
(`RESUME_VFD_COMMISSIONING.md`) had `P09.04 = 12` (wrong); `GS10_Integration_Guide.md` /
`device-profiles/gs10.yaml` are authoritative. The PLC serial-port framing (set in CCW, see
`ccw-workflow.md`) must match the GS10 exactly, or every frame fails UART validation and the
slave silently discards — symptom is `ErrorID 51/53` and no useful reply.

**`P09.03` is why a "read-only" RS-485 sweep can fault-stop the motor:** a second master on
the bus corrupts the PLC's polls (CRC failures); 5 s of that trips CE10 and the ladder
watchdog latches a fault → motor stop. This is the read-only-discovery safety rule — see
`.claude/rules/fieldbus-readonly.md` and the `fieldbus-discovery` skill.

## ⚠️ Verify the labels — the F2 lesson

MIRA's own `Prog_VFD.stf` POU has labeled `read_data[1]`@`0x2103` as `vfd_status_word`,
which **contradicts this map** (`0x2103` = output frequency; the status words are `0x2100` /
`0x2101`). A previous code review (F2) flagged exactly this kind of register/label mismatch.
Before trusting variable names in any existing POU, cross-check the address against this
table and the GS10 manual. When the code and the profile disagree, the profile + manual win.
