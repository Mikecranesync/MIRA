# MSG_MODBUS / MSG_MODBUS2 — the function-block contract

The Micro800 Modbus message function blocks are instance-based vendor FBs available in CCW.
This is the single most error-prone area, so get the type right first.

## RTU vs TCP (Rockwell 2080-RM001)

| FB | Transport | Config struct types | Use for |
|---|---|---|---|
| `MSG_MODBUS`  | **RTU** (serial / RS-485) | `MSG_MODBUS_LOCAL`, `MSG_MODBUS_TARGET` | GS10 over RS-485 |
| `MSG_MODBUS2` | **TCP** (Ethernet)        | `MSGMODBUSPARA_LOCAL`, `MSGMODBUSPARA_TARGET` | Modbus/TCP server/client over Ethernet |

The "2" is **TCP**, not a version bump. Both FBs expose `.Q` / `.Error` / `.ErrorID`
identically, so binding the *wrong* type still compiles and is type-safe — it just never
talks. That is exactly why the inversion is so sticky and why it must be checked by type,
not by "it builds." If an older MIRA doc says `MSG_MODBUS2 = RTU`, it is the retracted
inverted claim (`12fe0b5c` → retracted `b591fe47`); trust 2080-RM001.

## Config structs and fields

Each MSG call pairs a **Local** struct (how to talk) with a **Target** struct (who to talk to):

```
LocalCfg  : MSG_MODBUS_LOCAL
  .Channel       (INT)  -- serial channel. Bench-proven MIRA_PLC = 0; monorepo v4.x = 2.
                        --   VERIFY on rig (see SKILL.md "Volatile facts").
  .TriggerType   (INT)  -- 0 = fire on rising edge of IN (one-scan pulse). Use 0.
  .Cmd           (INT)  -- Modbus function code: 3 = read holding regs, 6 = write single reg.
  .ElementCnt    (INT)  -- number of registers in the transaction.

TargetCfg : MSG_MODBUS_TARGET
  .Addr          (INT)  -- holding-register address (decimal). e.g. 0x2103 = 8451, 0x2000 = 8192.
  .Node          (INT)  -- Modbus slave address. GS10 = 1.
```

The data buffer is a separate array passed as `LocalAddr`:

```
read_data       : ARRAY[1..125] OF WORD   -- FB fills this on a read (16-bit words, 1-based)
write_cmd_data  : ARRAY[1..1]   OF WORD   -- you fill index [1] before a write (via COP, below)
```

## Function codes actually used

| FC | Name | `.Cmd` | Direction | Typical use |
|---|---|---|---|---|
| 03 | Read Holding Registers   | 3 | PLC ← drive | read the 0x21xx monitor block |
| 06 | Write Single Register    | 6 | PLC → drive | command word (0x2000), freq setpoint (0x2001), fault reset (0x2002) |

Prefer **FC06** for single-register commands — atomic and simple. FC16 (write multiple) is
unnecessary complexity for one register on this rig.

## Calling convention

```structured-text
(* config (set every scan, cheap) *)
read_local_cfg.Channel     := 0;       (* verify on rig *)
read_local_cfg.TriggerType := 0;
read_local_cfg.Cmd         := 3;       (* FC03 *)
read_local_cfg.ElementCnt  := 4;       (* stay inside the documented block *)
read_target_cfg.Addr       := 16#2103; (* verify the label against the GS10 map *)
read_target_cfg.Node       := 1;

(* fire on a one-scan edge from the scheduler *)
MB_READ_STATUS(IN        := step_read_active,
               LOCALCFG  := read_local_cfg,
               TARGETCFG := read_target_cfg,
               LOCALADDR := read_data);

IF MB_READ_STATUS.Q THEN          (* one-scan success pulse *)
  (* copy read_data[...] into named vars; set comm_ok := TRUE *)
END_IF;
IF MB_READ_STATUS.Error THEN      (* one-scan error pulse *)
  err_count := err_count + 1;     (* mirror .Error; track which step failed *)
END_IF;
```

`IN := step_read_active` must be a **one-scan pulse** (`(poll_step = N) AND heartbeat_tick`).
Holding `IN` TRUE breaks edge triggering.

## Outputs and error handling

- `.Q` — success, true for ~one scan. Read your data here.
- `.Error` — failure, true for ~one scan. Bump a counter here.
- `.ErrorID` — **not reliably readable in ST on Micro820** (unlike CompactLogix). Mirror
  `.Error` into a BOOL and capture the last ErrorID via instrumentation where the firmware
  exposes it; don't depend on reading `.ErrorID` directly in a Micro820 POU.

### ErrorID / Modbus exception reference (observed on this rig)

| Code | Meaning | Likely cause / action |
|---|---|---|
| 3   | Illegal Data Value      | bad value written to a register |
| 51  | No response             | slave silent — framing/baud/parity or wrong node |
| 53  | CRC error               | framing still wrong, or bus contention (two masters) |
| 55  | Illegal Data Address    | read ran past the documented block — reduce `ElementCnt`/fix `Addr` |
| 56  | Illegal Function        | wrong FB type bound (e.g. `MSG_MODBUS2` on RS-485) or unsupported FC |
| 255 | Message never completed | **serial port config never downloaded** — CCW sync issue, not wiring |

`ErrorID 255` is the classic "I changed the serial settings but the drive still won't talk":
the CCW serial-port configuration didn't actually make it to the controller. Re-download.

## Per-step timeout (catches silent hangs)

If the serial driver isn't loaded, a MSG instance can sit with **neither `.Q` nor `.Error`**
ever firing, stalling the whole round-robin. Guard each step with a short `TON`:

```structured-text
msg_step_timer(IN := poll_active AND NOT msg_done, PT := T#2000ms);
IF msg_step_timer.Q THEN
  comm_ok  := FALSE;
  comm_err := TRUE;
  msg_done := TRUE;     (* release the scheduler so it advances *)
END_IF;
```
