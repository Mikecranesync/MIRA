# Conv_Simple_1.6 — Controller Variables Table

`GlobalVariable.rtc` is a CCW-proprietary binary format and cannot be
hand-authored. This file is the human-readable spec the CCW Controller
Variables table must match after the v1.4 → v1.6 fix. Apply each row in
**Project → Micro820 → Controller → Global Variables** and rebuild.

> **Direction lock-in (read before editing):** on the Micro 800 family
> per Rockwell 2080-RM001, **`MSG_MODBUS` is RTU (serial / RS-485)**
> and **`MSG_MODBUS2` is TCP (Ethernet)**. The "2" denotes TCP, not
> "version 2." MIRA repo inverted this in the 2026-05-24 review
> (commit `12fe0b5c`) and retracted it in commit `b591fe47`
> (2026-05-25). See memory `feedback_msg_modbus_fb_types.md`.

Verification after edit (in a shell, against the exported `.rtc`):

```bash
strings GlobalVariable.rtc | grep -iE 'MSG_MODBUS|MSGMODBUSPARA|READDATA|read_data'
# expect:
#   MSG_MODBUS            ← present, used as type (RTU FB)
#   MSG_MODBUS_LOCAL      ← present, used as type
#   MSG_MODBUS_TARGET     ← present, used as type
#   read_data             ← present (the array)
# must NOT contain:
#   MSG_MODBUS2           ← TCP variant, do not declare as type on RS-485
#   MSGMODBUSPARA_LOCAL   ← TCP variant cfg struct
#   MSGMODBUSPARA_TARGET  ← TCP variant cfg struct
#   READDATA              ← scalar landmine, delete
```

---

## Section 1 — Modbus RTU function blocks (F1: instance rename + cfg-struct cleanup)

> `MSG_MODBUS` (RTU/serial) is the correct FB for the GS10 on RS-485.
> The v1.4 binding to `MSG_MODBUS` was therefore already correct on
> the FB-type axis. v1.6's F1 work is: (a) rename the instance from
> `READ_mODBUS` to `mb_read_monitor`, and (b) make sure the cfg
> structs are the matching `MSG_MODBUS_LOCAL` / `MSG_MODBUS_TARGET`
> (NOT the TCP variant `MSGMODBUSPARA_*`).

| Name              | Type           | Direction | Notes                                  |
|-------------------|----------------|-----------|----------------------------------------|
| `mb_read_monitor` | `MSG_MODBUS`   | VAR       | F1 + F7: was `READ_mODBUS`. Type stays `MSG_MODBUS`; just rename the instance. |
| `mb_write_cmd`    | `MSG_MODBUS`   | VAR       | New in v1.6 — writes the command word.                              |
| `mb_write_freq`   | `MSG_MODBUS`   | VAR       | New in v1.6 — writes the frequency setpoint.                        |

### MSG_MODBUS config struct instances

| Name                    | Type                | Notes                                  |
|-------------------------|---------------------|----------------------------------------|
| `ReadLocalParam`        | `MSG_MODBUS_LOCAL`  | Carry over from v1.4 if already this type. |
| `ReadTargetParam`       | `MSG_MODBUS_TARGET` | Carry over from v1.4 if already this type. |
| `WriteCmdLocalParam`    | `MSG_MODBUS_LOCAL`  | New in v1.6.                           |
| `WriteCmdTargetParam`   | `MSG_MODBUS_TARGET` | New in v1.6.                           |
| `WriteFreqLocalParam`   | `MSG_MODBUS_LOCAL`  | New in v1.6.                           |
| `WriteFreqTargetParam`  | `MSG_MODBUS_TARGET` | New in v1.6.                           |

### Modbus data buffers

| Name              | Type                       | Notes                                   |
|-------------------|----------------------------|-----------------------------------------|
| `read_data`       | `ARRAY[1..125] OF UINT`    | F1 + F4: confirm element type is `UINT`, not `INT`. Sole read buffer; `READDATA` scalar is deleted. |
| `write_cmd_data`  | `ARRAY[1..1] OF UINT`      | New in v1.6. Holds `CmdWord` for FC06.  |
| `write_freq_data` | `ARRAY[1..1] OF UINT`      | New in v1.6. Holds `FreqSetpoint` for FC06. |

---

## Section 2 — Heartbeat / scheduler

| Name             | Type   | Notes                                              |
|------------------|--------|----------------------------------------------------|
| `HeartbeatTmr`   | `TON`  | F9: keep this casing; delete the duplicate ALL-CAPS `HEARTBEATTMR`. |
| `HeartbeatTick`  | `BOOL` |                                                    |
| `PollStep`       | `INT`  | 1=read 2=write-cmd 3=write-freq. New in v1.6.     |
| `PollCount`      | `DINT` |                                                    |

---

## Section 3 — Process variables (read side)

| Name              | Type    | Notes                                            |
|-------------------|---------|--------------------------------------------------|
| `ReadStatusWord`  | `WORD`  | F2: now from `0x2100` (drive status), not `0x2101`. |
| `FreqCmdReadback` | `WORD`  | New in v1.6: `0x2101` value.                     |
| `OutputFrequency` | `WORD`  | New in v1.6: `0x2102` value.                     |
| `OutputCurrent`   | `WORD`  | New in v1.6: `0x2103` value.                     |
| `VfdRunning`      | `BOOL`  | Decoded from status word bit 0..1.               |
| `VfdAtSpeed`      | `BOOL`  | Decoded from status word bit 3..4.               |
| `VfdFault`        | `BOOL`  | Decoded from status word bit 7.                  |
| `VfdCommCtrl`     | `BOOL`  | Decoded from status word bit 11.                 |

---

## Section 4 — Process variables (write side, new in v1.6)

| Name               | Type   | Notes                                            |
|--------------------|--------|--------------------------------------------------|
| `CmdWord`          | `WORD` | Written into `0x2000`. 1=STOP, 18=FWD+RUN, 20=REV+RUN, 34=FAULT RESET. |
| `FreqSetpoint`     | `WORD` | Written into `0x2001`. Hz × 100 (e.g. 3000 = 30 Hz). |
| `WriteCmdPending`  | `BOOL` | Ladder sets TRUE when `CmdWord` changes.        |
| `WriteFreqPending` | `BOOL` | Ladder sets TRUE when `FreqSetpoint` changes.   |
| `commissioning_mode` | `BOOL` | Master write-disable. Default FALSE. When TRUE, only the read step fires — proves bidirectional comms before commanding the drive. |

---

## Section 5 — Result / diagnostic counters

| Name               | Type   | Notes                                              |
|--------------------|--------|----------------------------------------------------|
| `ReadOK`           | `BOOL` |                                                    |
| `ReadError`        | `BOOL` |                                                    |
| `ReadErrorID`      | `INT`  | Last MSG_MODBUS ErrorID from the read step.        |
| `ReadErrCount`     | `DINT` |                                                    |
| `LastReadOkTick`   | `DINT` | Set to `PollCount` on every successful read.       |
| `LastReadErrTick`  | `DINT` | Set to `PollCount` on every read error.            |
| `LastReadErrStep`  | `INT`  | 1=read 2=write-cmd 3=write-freq.                   |
| `WriteCmdOkCount`  | `DINT` |                                                    |
| `WriteCmdErrCount` | `DINT` |                                                    |
| `WriteFreqOkCount` | `DINT` |                                                    |
| `WriteFreqErrCount`| `DINT` |                                                    |
| `LastWriteErrID`   | `INT`  | Last MSG_MODBUS ErrorID from either write step.    |
| `CommFault`        | `BOOL` | TRUE when > 10 ticks (5 s) since last good read.   |

---

## Section 6 — COP function blocks (write-buffer marshalling)

| Name        | Type  | Notes               |
|-------------|-------|---------------------|
| `cop_cmd`   | `COP` | Copies `CmdWord` → `write_cmd_data[1]`.  |
| `cop_freq`  | `COP` | Copies `FreqSetpoint` → `write_freq_data[1]`. |

---

## Section 7 — DELETE these (F4 + F5 + F6 + F9 cleanup)

After the rebuild, none of the following should appear in
`GlobalVariable.rtc`:

- `READDATA`                  ← F4 scalar landmine
- `READ_mODBUS`               ← F1 + F7, replaced by `mb_read_monitor`
- `mb_read_status`            ← F5 dead var, never called
- `mb_write_cmd` *(old MSG_MODBUS instance from v3 lineage, unused)* ← F5 dead var; re-create the new `mb_write_cmd` per Section 1 (still `MSG_MODBUS`).
- `write_cmd_data` *(old UINT scalar)* ← F5: delete and re-create as ARRAY[1..1] OF UINT (see Section 1)
- `COP_CMD`                   ← F5 dead var (replaced by `cop_cmd`)
- `vfd_cmd_word`              ← F5 dead var
- `motor_running`             ← F5 dead var
- `step_read_active`          ← F5 dead var
- `step_write_active`         ← F5 dead var
- `last_good_call`            ← F5 dead var
- `vfd_frequency`             ← F5 dead var
- `vfd_current`               ← F5 dead var
- `vfd_dc_bus`                ← F5 dead var
- `vfd_voltage`               ← F5 dead var
- `vfd_status_word`           ← F5 dead var
- `vfd_fault_code`            ← F5 dead var
- `vfd_comm_ok`               ← F5 dead var
- `vfd_poll_count`            ← F5 dead var
- `vfd_err_count`             ← F5 dead var
- `poll_timer`                ← F5 dead var
- `poll_tick`                 ← F5 dead var
- `poll_step`                 ← F5 dead var
- `ReadLocalAddress`          ← F6 dead var
- `HEARTBEATTMR`              ← F9 ALL-CAPS duplicate (keep `HeartbeatTmr`)

---

## Section 8 — Embedded Serial Port settings (F3)

These are **NOT** in `GlobalVariable.rtc`. Configure them at:
**Project → Micro820 → Embedded Serial Port → Properties**

| Setting           | Value                |
|-------------------|----------------------|
| Driver            | Modbus RTU Master    |
| Baud rate         | 19200                |
| Data bits         | 8                    |
| Parity            | Even                 |
| Stop bits         | 1                    |
| Media             | RS-485               |
| Response timeout  | 1000 ms              |

GS10 keypad must match:

| Parameter | Value | Meaning                        |
|-----------|-------|--------------------------------|
| P09.00    | 1     | Slave address                  |
| P09.01    | 2     | Baud rate 19200                |
| P09.02    | 0     | Warn + continue on comm loss   |
| P09.03    | 5     | 5 s timeout                    |
| P09.04    | 4     | RTU, 8-E-1                     |
| P09.09    | 20    | 20 ms response delay           |
| P00.21    | 2     | Run source = RS-485            |

Power-cycle the GS10 after writing P09.xx changes.
