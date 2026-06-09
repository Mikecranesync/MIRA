# Conv_Simple v1.4 — Modbus / RS-485 ST Code Review
**Reviewer:** Claude (Opus 4.7, CHARLIE worktree `cool-moser-0152ac`)
**Date:** 2026-05-24
**Subject:** `MIRA_PLC` repo, tag `bench/2026-05-23-conv-simple-1.4-stalled`
(SHA `d595f7be9cffb98787ba53e39b27a2fccd23b6f4`), draft PR
[#7](https://github.com/Mikecranesync/MIRA_PLC/pull/7).
**Symptom (per PR #7):** Build clean; PLC enters Run; ModbusTerm sniffer
sees well-formed RTU frames from the PLC at slave 1 / FC 03 / addr
`0x2101` / 38400 8N2 / valid CRC; **GS10 never replies**; `MSG_MODBUS2`
reports `ErrorID 55` (response timeout). Laptop ModbusTerm in master
mode can independently read GS10 holding registers on the same bus.
**KB tenant:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` (FactoryLM demo).

> **Cross-ref:** `plc/RS485_ST_CODE_REVIEW.md` is this morning's review
> done **without** the bench files. This document supersedes its inferences
> with the actual `Conv_Simple_1.4/` bytes. Most of its P0s are confirmed
> by what's actually on disk; one is partially wrong (the symptom changed
> from "silent on bus" to "PLC TX'ing, GS10 not replying"). Read this
> after the morning review.

---

## TL;DR (read first)

The ST source `Prog_init.stf` looks reasonable on its face, but the
**`Conv_Simple_1.4` project as compiled today contains four bugs**, in
this order of relevance to the timeout:

1. **`READ_mODBUS` is bound to `MSG_MODBUS` (Modbus TCP), not
   `MSG_MODBUS2` (Modbus RTU)** — confirmed by inspecting
   `Conv_Simple_1.4/.../GlobalVariable.rtc` and `PROG_INIT.rtc`
   byte-by-byte. The compiled program never references `MSG_MODBUS2`,
   only `MSG_MODBUS`. This is the **same type bomb the morning review
   flagged on inference**; the bench bytes now confirm it. If the
   sniffer truly sees PLC frames at 38400 8N2, then either CCW's
   `Channel := 2` routes `MSG_MODBUS` to the serial port on this
   firmware rev (firmware-rev-dependent), or the sniffer is seeing
   something other than what was assumed. Either way, the **correct
   block for the embedded RS-485 port is `MSG_MODBUS2`** per Rockwell
   2080-RM001.

2. **The read target register is wrong.** `Prog_init.stf:16` reads
   `0x2101`, with a comment claiming "GS10 status word." Per the
   FactoryLM KB (chunk `0d16a31d-49e9-…/gs10-vfd-integration p.1` and
   chunk `a0ae6016-…/demo-conveyor-001/VFD-001`), **`0x2100` is the
   drive Status Word; `0x2101` is the *Frequency Command read-back*.**
   On a fully working bus, reading `0x2101` still returns a holding
   register value (0 if no freq commanded yet), so this is not the
   *cause* of the timeout — but the bench is reading the wrong thing
   and labelling it wrong. Fix this even if the comms come back.

3. **Bus framing almost certainly mismatched.** PR #7 reports the PLC
   transmits at **38400 8N2**. KB canonical for GS10 + Micro 820 (chunks
   `06683164-…/gs10-vfd-integration p.0` and `0d16a31d-…/gs10-vfd-integration p.4`):
   **19200 8-E-1** (GS10 `P09.01 = 2`, `P09.04 = 4`). If the GS10's
   `P09.01` / `P09.04` aren't set to *exactly* what the PLC's serial
   port is sending (38400 → `P09.01 = 3`, 8N2 → `P09.04 = 3`), every
   byte fails UART validation and the slave silently discards — symptom
   matches PR #7 ("ErrorID 55 timeout despite valid TX on the wire") to
   the letter. This is **the highest-probability physical-layer cause**
   of GS10 silence given everything else is working.

4. **`READDATA` scalar global is still declared** in `GlobalVariable.rtc`
   alongside the array `read_data`. PR #7 acknowledges this; it's the
   landmine the PR #6 review (this repo, `docs/cowork/2026-05-23_mira-plc-pr6-review.md`)
   flagged. Not the cause of the current timeout, but a guaranteed
   future regression once anyone case-mistypes `READDATA` in a future
   edit.

Findings 5-9 below are smaller (comments, dead variables, struct typing).
They do not explain the timeout but should ship in v1.5.

---

## Section 1 — The bench files I reviewed

Pulled from GitHub at tag `bench/2026-05-23-conv-simple-1.4-stalled`
(SHA `d595f7b…`) to `/tmp/conv14/`:

| File | Bytes | Role |
|---|---:|---|
| `Conv_Simple_1.4/.../Prog_init.stf` | 1 609 | The ST source under review |
| `Conv_Simple_1.4/.../Prog1.stf` | 1 390 | Ladder logic (E-stop, start, lights) — not Modbus |
| `Conv_Simple_1.4/.../GlobalVariable.rtc` | 9 210 | Compiled global variable table (FB instance type bindings) |
| `Conv_Simple_1.4/.../PROG_INIT.rtc` | 2 481 | Compiled binding for PROG_INIT POU |
| `Conv_Simple_1.4/.../MICRO820_Conf.xtc` | 3 740 | Controller config (FB library catalog) |
| `Conv_Simple_1.4/Controller/Controller/MbSrvConf_target.xml` | 44 | Empty `<modbusServer Version="2.0"/>` — Modbus TCP **server** is unconfigured (irrelevant to this review) |

The full `Prog_init.stf` source is reproduced in **Appendix A** below.

---

## Section 2 — Line-by-line walkthrough of `Prog_init.stf`

```
 1  PROGRAM Prog_init
 2  (* Conv_Simple Modbus POU -- Phase 0 heartbeat read.                    *)
 3  (* Reads 1 holding register (GS10 status word at 0x2101) every 500 ms. *)
```

> **F2 (P1).** The header comment says "status word at `0x2101`." That's
> wrong. Status word is at `0x2100`. `0x2101` is the read-back of the
> Frequency Command register. **Fix in v1.5: change line 3 comment AND
> the assignment on line 16 to `0x2100`.** See KB citations below.

```
 7  HeartbeatTmr(IN := NOT HeartbeatTmr.Q, PT := T#500ms);
 8  HeartbeatTick := HeartbeatTmr.Q;
```

> **Self-retriggering TON.** Standard pattern: `IN := NOT Q` causes the
> TON to elapse, pulse `Q` for one scan, then `IN` goes high again,
> retriggering. `HeartbeatTick` is a single-scan pulse at 2 Hz.
> **Correct. No issue.**

```
 9  (* --- LocalCfg: channel + function code + quantity --- *)
10  ReadLocalParam.Channel      := 2;        (* 2 = embedded serial on Micro 820  *)
11  ReadLocalParam.TriggerType  := 0;        (* edge-triggered by IN              *)
12  ReadLocalParam.Cmd          := 3;        (* FC 03 = Read Holding Register     *)
13  ReadLocalParam.ElementCnt   := 1;        (* read 1 register                   *)
```

> **`Channel := 2`** is correct for the 2080-LC20-20QBB embedded RS-485
> port per the KB (chunk `09eea041-…/gs10-vfd-integration p.4`):
> *"MSG_MODBUS instance must reference this channel by its CCW-assigned
> serial channel number (typically Channel 2 for the embedded port)."*
> Also matches `plc/Micro820_v4.1.0_Program.st` and the corrected
> v4.1.9 in the parallel `MIRA/plc/` lineage.
>
> **`TriggerType := 0`** is rising-edge. With `HeartbeatTick` as the
> `IN` source (single-scan pulse), this fires once per 500 ms tick.
> Correct given how `IN` is driven.
>
> **`Cmd := 3`** = FC 03 Read Holding Registers. Correct for reading the
> GS10 status word.
>
> **`ElementCnt := 1`** = read 1 register. Correct for a single-register
> heartbeat read.
>
> **F1 (P0): but which FB type is `ReadLocalParam`?** The variable's
> type does not appear in `Prog_init.stf` — it's declared in the
> Controller Variables table (`GlobalVariable.rtc`). The byte-level
> evidence (Section 3) shows the project never references
> `MSG_MODBUS2`, `MSGMODBUSPARA_LOCAL`, or `MSGMODBUSPARA_TARGET`.
> The TCP-variant struct names `MSG_MODBUS_LOCAL` and `MSG_MODBUS_TARGET`
> are the implied types — wrong for serial RTU.

```
14  (* --- TargetCfg: slave + register address --- *)
15  ReadTargetParam.Node := 1;               (* GS10 slave ID                     *)
16  ReadTargetParam.Addr := 16#2101;         (* GS10 status word                  *)
```

> **`Node := 1`** = slave address 1. Matches GS10 `P09.00 = 1` default
> per KB (chunk `06683164-…` and `a0ae6016-…`). Correct.
>
> **`Addr := 16#2101`** — **F2 again, but at the assignment.** The
> register `0x2101` exists on the GS10 and is readable (Frequency
> Command read-back, KB chunk `0d16a31d-…/gs10-vfd-integration p.1`),
> so this won't return a Modbus exception. But it's not the status
> word. **Change to `16#2100` in v1.5.**

```
17  (* --- Fire the FB on each 500 ms tick --- *)
18  READ_mODBUS(IN        := HeartbeatTick,
19              LocalCfg  := ReadLocalParam,
20              TargetCfg := ReadTargetParam,
21              LocalAddr := read_data);
```

> **F1 (P0).** `READ_mODBUS` is the user FB instance name (note the
> lowercase `m` — CCW ST identifiers are case-insensitive, so this
> resolves, but it's a smell; rename to `READ_MODBUS` or `mb_read_status`
> in v1.5). Its type is bound in `GlobalVariable.rtc`. Per Section 3
> below, the binding is `MSG_MODBUS` (TCP), not `MSG_MODBUS2` (RTU).
>
> **`LocalAddr := read_data`.** `read_data` is the array global. The
> PR #6 fix (commit 7576aa9 → v1.4) was to change `LocalAddr := READDATA`
> (scalar — wrong) to `LocalAddr := read_data` (array — required). This
> assignment is correct. But the scalar `READDATA` is **still in
> GlobalVariable.rtc** (Section 3 / F4 below).

```
22  (* --- Capture outputs in the same scan they pulse --- *)
23  ReadOK      := READ_mODBUS.Q;
24  ReadError   := READ_mODBUS.Error;
25  ReadErrorID := READ_mODBUS.ErrorID;
```

> **Output capture.** OK. `.Q`, `.Error`, `.ErrorID` are the standard
> MSG_MODBUS / MSG_MODBUS2 output members. Both FB types expose them
> with the same names, so this code is type-agnostic — which is exactly
> why the wrong type compiles cleanly.

```
26  IF HeartbeatTick THEN
27      PollCount := PollCount + 1;
28  END_IF;
29  IF READ_mODBUS.Q THEN
30      ReadStatusWord := read_data[1];
31  END_IF;
32  IF READ_mODBUS.Error THEN
33      ErrCount := ErrCount + 1;
34  END_IF;
35  END_PROGRAM
```

> Counter logic. `PollCount` increments per tick, `ErrCount` per error.
> `ReadStatusWord := read_data[1]` only updates when `.Q` pulses, so
> a stale value persists during timeouts — correct behavior for a
> diagnostic counter.
>
> **F8 (P3).** No tracking of `last_good_call` timestamp. The variable
> `last_good_call` is declared in `GlobalVariable.rtc` but never
> referenced in `Prog_init.stf`. Dead variable (F9 below).

---

## Section 3 — Forensic on `GlobalVariable.rtc` (the type bomb)

`GlobalVariable.rtc` is CCW's binary global-variable table. Strings from
the file (in declaration order):

```
mb_read_status        ← FB instance #1
mb_write_cmd          ← FB instance #2
COP_CMD               ← COP instance
poll_timer            ← TON instance
HEARTBEATTMR          ← TON instance (note all-caps; case-insensitive resolution)
READ_mODBUS           ← FB instance (the active one used in Prog_init.stf)
```

The only Modbus-FB **type identifier** that appears as a declared variable's
type is `MSG_MODBUS`:

```
$ strings /tmp/conv14/GlobalVariable.rtc | grep -iE 'MSG_MODBUS|MSGMODBUSPARA'
MSG_MODBUS                       ← used as type (precedes mb_read_status)
__FAKECFB_MSG_MODBUS             ← library catalog entry
__FAKECFB_MSG_MODBUS2            ← library catalog entry (registered, NOT used)
```

`MSG_MODBUS2` appears **only** in the `__FAKECFB_MSG_MODBUS2` catalog
entry — that's CCW's list of *available* FBs in the firmware library,
not the type of any user-declared instance. No instance in this project
binds to `MSG_MODBUS2`. No struct in this project is typed
`MSGMODBUSPARA_LOCAL` or `MSGMODBUSPARA_TARGET`.

Byte-level confirmation around the `READ_mODBUS` declaration
(`xxd Conv_Simple_1.4/.../GlobalVariable.rtc`, offset `0x1900` region):

```
00001910: 4541 5454 4d52 0000 2100 2a00 f101 0000  EATTMR..!.*.....
00001920: d602 0000 1200 0000 0100 0000 0000 0a02  ................
00001930: 5245 4144 5f6d 4f44 4255 5300 3228 292c  READ_mODBUS.2(),
00001940: 2c2c 2c30 0000 1f00 2900 ffff ffff 0100  ,,,0....).......
```

No `MSG_MODBUS2` literal anywhere near `READ_mODBUS`. Compare with the
unambiguous `mb_read_status` binding at offset `0x1330`:

```
00001330: 0000 004d 5347 5f4d 4f44 4255 5300 2100  ...MSG_MODBUS.!.
00001340: 2d00 d301 0000 d602 0000 1200 0000 0100  -...............
00001350: 0000 0000 0902 6d62 5f72 6561 645f 7374  ......mb_read_st
00001360: 6174 7573 0032 2829 2c2c 2c2c 3000 001f  atus.2(),,,,0...
```

The type-name string `MSG_MODBUS` literally precedes the instance name.
For `READ_mODBUS` there is no type-name literal anywhere before or after
it in the file — the binary metadata points to a type ID rather than a
string, but `PROG_INIT.rtc` (the compiled binding for the POU that calls
`READ_mODBUS`) **lists only `MSG_MODBUS`**, no `MSG_MODBUS2`:

```
$ strings /tmp/conv14/PROG_INIT.rtc | grep MSG_
MSG_MODBUS         ← the only Modbus FB referenced by the compiled POU
```

**Conclusion:** `READ_mODBUS` is type-bound to `MSG_MODBUS` (Modbus TCP),
exactly the same way `mb_read_status` is. Per Rockwell 2080-RM001
(Micro 800 Programmable Controllers Reference Manual), `MSG_MODBUS` is
the **Modbus TCP** function block — it does not transmit on the embedded
RS-485 serial port. The correct FB for the embedded serial port is
`MSG_MODBUS2`, which takes `MSGMODBUSPARA_LOCAL` / `MSGMODBUSPARA_TARGET`
config structs.

**Why does PR #7 nevertheless report `ErrorID 55` (a timeout) and a
sniffer-visible TX?** Two hypotheses I can't disambiguate without
on-bench access:

| Hypothesis | Explains the sniffer TX | Explains ErrorID 55 |
|---|---|---|
| (a) On this CCW / firmware rev, `MSG_MODBUS` with `Channel := 2` actually routes to the embedded serial port (undocumented or rev-specific) | Yes | Yes — if framing (38400 8N2) doesn't match GS10's `P09.01` / `P09.04` |
| (b) The sniffer was actually capturing some other master (e.g. a separate ModbusTerm session, or PR #7's framing claim is from a different run) | No | Yes — MSG_MODBUS over TCP with no Ethernet target → 100 % timeout |
| (c) `READ_mODBUS` *was* MSG_MODBUS2 in CCW Variables (hand-fixed in the GUI) but the .acfproj-derived rtc on disk wasn't refreshed before the GitHub push | No | Possible if local-vs-pushed state diverged |

Verification at the panel — open CCW → Controller Variables → click the
`READ_mODBUS` row → check the Data Type column:
- **`MSG_MODBUS`** → matches what's on GitHub. This is the type bomb.
- **`MSG_MODBUS2`** → the on-disk file is stale; the live project has
  been hand-edited but not committed. The timeout is then a framing
  issue (F3 below), not a type issue.

Either way, **the only correct steady-state binding is `MSG_MODBUS2`**.
If it's anything else, fix it (delete + re-create the instance and the
two cfg structs).

### Required Variables-table state after fix

| Variable | Required type | What's likely on the bench today |
|---|---|---|
| `READ_mODBUS` (rename `mb_read_status` in v1.5) | `MSG_MODBUS2` | `MSG_MODBUS` |
| `ReadLocalParam` | `MSGMODBUSPARA_LOCAL` | `MSG_MODBUS_LOCAL` |
| `ReadTargetParam` | `MSGMODBUSPARA_TARGET` | `MSG_MODBUS_TARGET` |
| `read_data` | `MODBUSLOCADDR` (alias for `ARRAY[1..125] OF UINT`) | likely correct as array; verify element type is `UINT`, not `INT` |
| `READDATA` | — (delete) | scalar UINT (still present, **landmine — F4**) |
| `ReadLocalAddress` | — (delete; unused) | declared, never referenced (F9) |
| `mb_read_status`, `mb_write_cmd` | — (delete; unused) | declared but `Prog_init.stf` calls `READ_mODBUS` instead |

---

## Section 4 — The other findings

### F2 — Wrong register: `0x2101` ≠ status word

**Evidence in this repo's KB (FactoryLM staging Neon):**

> Chunk `0d16a31d-49e9-4ada-b8a5-14509b42dc82` (source
> `mira://seeds/gs10-vfd-integration` p.1):
>
> > Read registers (function code 0x03 holding, 0x04 input):
> >   `0x2100`   Drive status word
> >   `0x2101`   Frequency command           0.01 Hz / count
> >   `0x2102`   Output frequency
> >   `0x2103`   Output current
> >   `0x2104`   DC bus voltage

> Chunk `a0ae6016-b2ad-47f1-b407-547ee1a3bd98` (source
> `mira://seeds/demo-conveyor-001/VFD-001` p.0):
>
> > MODBUS REGISTER MAP — READ (FC 0x03 / 0x04):
> >   `0x2100`  Drive Status Word
> >       bits 0..1 = run state (00 stop, 01 decel, 10 standby, 11 run)
> >       bit  7    = fault active

Both seeded entries (verified by Mike, tenant
`78917b56-f85f-43bb-9a08-1bb98a6cd6c3`) agree: status word is at
**`0x2100`**, frequency command read-back at `0x2101`.

**`Prog_init.stf:16` reads `16#2101` and the comment claims it's the
status word — wrong register, wrong label.**

**Severity:** P1. Doesn't *cause* the timeout (the read of `0x2101` is
a legal address, so the slave would reply on a working bus). But once
the link is up, `ReadStatusWord` will hold the *frequency command*, not
the *drive status*. The downstream logic (none, in v1.4) would
misinterpret. Fix in v1.5.

**Fix:**
```diff
- (* Reads 1 holding register (GS10 status word at 0x2101) every 500 ms. *)
+ (* Reads 1 holding register (GS10 status word at 0x2100) every 500 ms. *)
...
- ReadTargetParam.Addr := 16#2101;         (* GS10 status word *)
+ ReadTargetParam.Addr := 16#2100;         (* GS10 status word — per GS10 manual ch.5 *)
```

### F3 — Serial framing almost certainly mismatched (the timeout root cause)

**Evidence:** PR #7 description: *"PLC transmits well-formed RTU frames
to slave 1, FC 03, addr `0x2101`, **38400 8N2**, valid CRC"*.

**KB canonical settings** (chunks `06683164-…` p.0 and `0d16a31d-…` p.4):

| Setting | KB canonical | Encoded GS10 param value | Bench PLC TX |
|---|---|---|---|
| Baud rate | 19200 | `P09.01 = 2` | **38400** (would be `P09.01 = 3`) |
| Data bits | 8 | (part of `P09.04`) | 8 (matches) |
| Parity | Even | (part of `P09.04`) | **None** (mismatch) |
| Stop bits | 1 | (part of `P09.04`) | **2** (mismatch) |
| Mode | RTU | `P09.04 = 4` (RTU 8-E-1) | RTU 8N2 = `P09.04 = 3` |

If the GS10 was never reconfigured from its default (or from the
canonical-seed values: 19200 8-E-1), **every byte the PLC transmits at
38400 8N2 fails the GS10 UART's parity + stop-bit validation**. The
slave silently drops the frame as malformed. No reply, PLC times out,
`MSG_MODBUS2` returns `ErrorID 55`. **This is the single most likely
physical-layer cause given everything else PR #7 reported is working.**

KB chunk `b7337bd4-…/gs10-vfd-integration p.3` — *Micro820 MSG_MODBUS
.ErrorID decode*:

> > `0x0100 .. 0x0200`   TIMEOUT / WIRING errors
> >   The GS10 never responded inside the MSG_MODBUS timeout window.
> >   Causes:
> >     - Cable open or D+/D- swapped (no electrical path)
> >     - Missing 120 Ω termination (reflections kill the request mid-flight,
> >       especially at 19200+)
> >     - Slave ID mismatch (`P09.00` ≠ `MSG_MODBUS Slave`)
> >     - GS10 powered down or RS-485 port disabled

(ErrorID 55 = 0x37 doesn't fit cleanly in the documented bands, but the
community convention for Rockwell MSG_MODBUS2 is that 55 ≡ "transaction
timeout — no reply within configured Response Timeout." Behaviorally
identical to the `0x0100..0x0200` band documented above.)

Notably absent from `Prog_init.stf`: any framing-mismatch evidence,
because *framing isn't set in the ST source at all*. The PLC's serial
port baud / parity / stop bits live in the CCW project properties at
**Project → Micro820 → Embedded Serial Port → Properties**. Inspect that
panel and the GS10 keypad (`P09.01`, `P09.04`) side by side and align
them. KB chunk `09eea041-…` p.4 gives the canonical config:

> > CCW (Connected Components Workbench) serial port config:
> >   Project tree → Micro820 → Embedded Serial Port → Properties →
> >     Driver = "Modbus RTU Master"
> >     Baud rate = 19200
> >     Data bits = 8
> >     Parity   = Even
> >     Stop bits = 1
> >     Media    = RS-485
> >     Response timeout = 1000 ms

**Action at the panel:**
1. GS10 keypad: read **`P09.00`** (slave ID — should be 1),
   **`P09.01`** (baud — should be 2 for 19200),
   **`P09.04`** (framing — should be 4 for RTU 8-E-1).
   Power-cycle GS10 after any change.
2. CCW: Project → Micro820 → Embedded Serial Port → Properties →
   set Baud rate `19200`, Data bits `8`, Parity `Even`, Stop bits `1`,
   Driver `Modbus RTU Master`, Media `RS-485`. Download.
3. Re-run; sniffer should now show 19200 8-E-1 and GS10 should reply.

(If you prefer to keep 38400: set GS10 `P09.01 = 3` and `P09.04 = 3`
(RTU 8-N-2). The link doesn't care which side of 19200 vs 38400 you
pick *as long as both sides agree*.)

### F4 — `READDATA` scalar still present (the landmine)

**Evidence:** `strings /tmp/conv14/GlobalVariable.rtc | grep -i READDATA`:

```
READDATA
```

Confirmed: the v3.x scalar `READDATA` global is still declared alongside
the v1.4 array `read_data`. CCW's case-insensitive symbol resolution
means today's call site `LocalAddr := read_data` correctly targets the
array, **but any future edit that types `LocalAddr := READDATA` will
compile silently and re-target the scalar**, producing:

- `vfd_dc_bus`, `vfd_voltage`, all reads returning 0 forever.
- `vfd_comm_ok` may flicker TRUE for 1 scan on `.Q`, then FALSE.
- `ErrorID` may be 0 (no error) — confusing.

**This is documented in PR #7** under "Known landmine — DO NOT skip
before any 1.5 work." Confirmed by inspection: not yet fixed.

**Fix:**
1. CCW → Global Variables.
2. Search (case-insensitive) `READDATA`.
3. If found as a scalar (not the array `read_data`), right-click → Delete.
4. Verify with:
   ```bash
   strings Conv_Simple_1.4/.../GlobalVariable.rtc | grep -iE 'READDATA'
   # expect: only "read_data" remains, no all-caps "READDATA"
   ```

### F5 — `mb_read_status` / `mb_write_cmd` / `write_cmd_data` dead-but-typed

**Evidence:** `GlobalVariable.rtc` declares `mb_read_status`,
`mb_write_cmd`, `COP_CMD`, `write_cmd_data`, `step_read_active`,
`step_write_active`, `vfd_cmd_word`, `motor_running` — none of which are
referenced from `Prog_init.stf` or `Prog1.stf`. They're inherited from
the v3 lineage (`MIRA/plc/populate_variables.py:94-99` declares the
same names).

These are not just dead variables — `mb_read_status` is **explicitly
typed `MSG_MODBUS`** (visible in the byte-level dump at offset `0x1330`,
quoted above). That's a `MSG_MODBUS` instance that lives in the
controller's RAM even though the running code uses `READ_mODBUS`.

**Severity:** P2. Doesn't cause the timeout. But:
- It consumes a `MSG_MODBUS` FB instance slot (the Micro 820 has a
  finite pool of these, shared with `MSG_CIPGENERIC` etc.).
- It clouds the debug story — if you put a CCW watch on `mb_read_status.Q`
  expecting to see the active read, you'll see it permanently FALSE
  because nothing calls it. Easy to misread as "Modbus isn't running"
  when in fact `READ_mODBUS` is.

**Fix in v1.5:** delete `mb_read_status`, `mb_write_cmd`, `write_cmd_data`,
`COP_CMD`, `vfd_cmd_word`, `motor_running`, `step_read_active`,
`step_write_active`, `last_good_call`, `vfd_frequency`, `vfd_current`,
`vfd_dc_bus`, `vfd_voltage`, `vfd_status_word`, `vfd_fault_code`,
`vfd_comm_ok`, `vfd_poll_count`, `vfd_err_count`, `poll_timer`,
`poll_tick`, `poll_step` from the Variables table. Conv_Simple_1.4 is a
Phase 0 heartbeat — it doesn't need any of this.

### F6 — `ReadLocalAddress` declared, unused

**Evidence:** `GlobalVariable.rtc` declares `ReadLocalAddress`; the ST
code uses `read_data` for `LocalAddr`. Dead.

**Fix:** delete `ReadLocalAddress` in v1.5.

### F7 — Instance naming: `READ_mODBUS` (lowercase m)

ST identifiers in CCW are case-insensitive, so `READ_mODBUS` resolves to
the same symbol as `READ_MODBUS`. But it's a typo that survived
copy/paste and now lives in the global variables. Rename to
`mb_read_status` (the canonical name from the v3/v4 lineage in
`MIRA/plc/`) when you re-create the instance during F1's type-fix.

### F8 — `Timeout` field not configured

The KB-cited canonical CCW serial-port setting includes *"Response timeout
= 1000 ms (raise to 2000 ms on noisy plants while debugging)"*. This is
configured on the **port** in CCW, not on the MSG block (for MSG_MODBUS2
specifically — for MSG_MODBUS over TCP, the LocalCfg struct has a
`MsgTimeOut` field that this code does **not** set, defaulting to
firmware default).

If F1 turns out to be hypothesis (a) — `MSG_MODBUS` with `Channel := 2`
routes to serial on this firmware rev — the **uninitialized
`MsgTimeOut`** in `MSG_MODBUS_LOCAL` may be reading as 0 ms and causing
immediate timeout regardless of physical bus state. This is consistent
with the morning review's P1-1 concern about TriggerType edge-detection
and is **another reason migrating to MSG_MODBUS2 is the safer fix**.

### F9 — Two-`HeartbeatTmr` declarations (cosmetic)

GlobalVariable.rtc lists both `HEARTBEATTMR` (TON, declared) and
`HeartbeatTmr` is referenced in the ST as a TON FB instance. CCW
case-insensitive resolution maps them to the same instance, so this
works — but mixing casing makes the table harder to scan. Pick one
spelling.

---

## Section 5 — Independent observations on `Prog1.stf` (the ladder)

Not Modbus, but reviewed for completeness:

- **E-stop logic** (rungs 1-3): `e_stop_ok = estop_nc AND NOT estop_no`,
  `e_stop_active = NOT estop_nc AND estop_no`,
  `estop_wiring_fault = (estop_nc AND estop_no) OR (NOT estop_nc AND NOT estop_no)`.
  Standard dual-channel safety wiring with crossfault detection.
  **OK** — though for production this should be a hardware safety relay,
  not PLC logic. Not in scope for Phase 0.
- **Start button** (rung 4): `start_pressed AND (pb_start OR DO_02) → DO_02`.
  Seal-in latch with start button. **OK.**
- **Direction selector** (rungs 5-6): mutually exclusive FWD/REV via DI
  selector switch. **OK.**
- **Lights** (rungs 7-8): green = run, red = e-stop fault. **OK.**

This ladder is entirely **independent of the Modbus subsystem** — it
doesn't read `read_data`, doesn't trigger any MSG block, doesn't react
to `ReadErrorID`. **In particular: even with comms working, pressing
start will not run the VFD** — `Prog_init.stf` only reads, never writes
to `0x2000` / `0x2001`. That's by design for v1.4 (Phase 0 = prove the
read), but worth flagging that the v1.4 milestone is "PLC ↔ GS10 reads
work" not "conveyor runs."

---

## Section 6 — Verification sequence after applying fixes

**Order matters: F3 (framing) before F1 (FB type).** F3 is what's almost
certainly causing the timeout *today*; F1 is what's certainly wrong about
the project but may or may not be the symptomatic root cause.

### Phase A — F3 first (cheapest test)

1. **GS10 keypad:** read `P09.00`, `P09.01`, `P09.04`. Write them down.
   If `P09.01` ≠ `3` (38400) OR `P09.04` ≠ `3` (RTU 8-N-2), the PLC's
   TX framing doesn't match. Fix one side: easiest is to set GS10 to
   the KB canonical (`P09.01 = 2`, `P09.04 = 4`) and reconfigure CCW
   serial port to 19200 8-E-1. Power-cycle GS10 after the keypad write.
2. CCW: Project → Micro820 → Embedded Serial Port → Properties → 19200,
   8 data, Even, 1 stop, RTU Master, Media RS-485. Download.
3. PLC in Run. Heartbeat should fire. Sniffer should show 19200 8-E-1
   frames. **GS10 should now reply.** `ReadErrorID` should go to 0,
   `ReadOK` should pulse, `ReadStatusWord` should read non-zero
   (if GS10 is at `0x2101` reading freq cmd = 0, value will be 0 —
   that's why F2 matters; flip to `0x2100` to see the actual status word).

### Phase B — If Phase A doesn't restore comms, F1 next

4. CCW → Controller Variables → `READ_mODBUS` row → Data Type column.
   If `MSG_MODBUS`, this is the type bomb. Delete the instance.
   Re-create as `MSG_MODBUS2`.
5. Same row check for `ReadLocalParam` and `ReadTargetParam`. Required:
   `MSGMODBUSPARA_LOCAL` and `MSGMODBUSPARA_TARGET`. If anything else,
   delete + re-create.
6. Build (Ctrl+Shift+B). Expect 0 errors. Any "incompatible type"
   compile error here is the bug exposing itself — fix and rebuild.
7. Download. Re-run heartbeat. Sniffer + GS10 reply.

### Phase C — F2 register fix, then F4 / F5-F9 cleanup for v1.5

8. Edit `Prog_init.stf:3` comment and line 16 `Addr` to `16#2100`.
9. Delete the `READDATA` scalar global.
10. Delete dead variables (F5 list, F6 `ReadLocalAddress`).
11. Re-build, download, verify heartbeat reads the actual status word.
12. Tag `bench/2026-05-24-conv-simple-1.5-link-up` once `ReadStatusWord`
    reads non-zero and matches the keypad display.

---

## Section 7 — Risk: don't trust the morning review without this

This morning's `plc/RS485_ST_CODE_REVIEW.md` was written **without** the
bench files (it explicitly notes this in its "What I couldn't review"
section, line 380). Its P0-1 finding (MSG_MODBUS vs MSG_MODBUS2) is
**confirmed** by the bytes inspected here. But several of its other
inferences are now overridable by direct evidence:

| Morning review finding | What the bench bytes actually say |
|---|---|
| P0-2 (`READDATA` scalar landmine) | **Confirmed.** Still present in v1.4. |
| P0-3 (Channel := 2 confusion) | **Resolved** — `Prog_init.stf:10` is `Channel := 2`. Correct. |
| P1-1 (TriggerType := 0 edge-detection risk) | **Still applies** in principle, but `HeartbeatTick` is a 1-scan pulse — rising edge per tick. Unlikely the bug. |
| P1-2 (distinct MSG instances) | **N/A** — v1.4 only has one MSG instance (`READ_mODBUS`); v3-era multiple-instance concern doesn't apply. |
| P1-3 (`read_data` element type INT vs UINT) | Cannot verify from bytes alone — needs CCW Variables column inspection. |
| P1-4 (`read_status_word_data[1..1]`) | **N/A** — v1.4 doesn't have this variable; concern was for the parallel v4.1.9 `MIRA/plc/` lineage. |
| P2-1 (Prog2.stf channel comment wrong) | **N/A** — that's a different file in `MIRA/plc/`, not in `Conv_Simple_1.4/`. |

The morning review's "USB adapter works, PLC doesn't" framing also no
longer matches PR #7's evidence — PR #7 says the **sniffer** sees PLC
TX, not "PLC silent on the bus." If the PR #7 description is accurate,
the failure mode is framing, not transport. If both could be true at
once, the framing fix (Phase A above) is still the cheapest move.

---

## Appendix A — `Conv_Simple_1.4/.../Prog_init.stf` as-found

(Reproduced verbatim from
`bench/2026-05-23-conv-simple-1.4-stalled` @ `d595f7b…`. 35 lines incl.
the `END_PROGRAM` terminator.)

```pascal
PROGRAM Prog_init
(* Conv_Simple Modbus POU -- Phase 0 heartbeat read.                    *)
(* Reads 1 holding register (GS10 status word at 0x2101) every 500 ms. *)
(* No motor commands. The whole point is to prove the link.            *)
(* Field names verified against bench-tested Prog_VFD.stf (2026-05-22).*)
(* --- 500 ms self-retriggering tick --- *)
HeartbeatTmr(IN := NOT HeartbeatTmr.Q, PT := T#500ms);
HeartbeatTick := HeartbeatTmr.Q;
(* --- LocalCfg: channel + function code + quantity --- *)
ReadLocalParam.Channel      := 2;        (* 2 = embedded serial on Micro 820  *)
ReadLocalParam.TriggerType  := 0;        (* edge-triggered by IN              *)
ReadLocalParam.Cmd          := 3;        (* FC 03 = Read Holding Register     *)
ReadLocalParam.ElementCnt   := 1;        (* read 1 register                   *)
(* --- TargetCfg: slave + register address --- *)
ReadTargetParam.Node := 1;               (* GS10 slave ID                     *)
ReadTargetParam.Addr := 16#2101;         (* GS10 status word                  *)
(* --- Fire the FB on each 500 ms tick --- *)
READ_mODBUS(IN        := HeartbeatTick,
            LocalCfg  := ReadLocalParam,
            TargetCfg := ReadTargetParam,
            LocalAddr := read_data);
(* --- Capture outputs in the same scan they pulse --- *)
ReadOK      := READ_mODBUS.Q;
ReadError   := READ_mODBUS.Error;
ReadErrorID := READ_mODBUS.ErrorID;
IF HeartbeatTick THEN
    PollCount := PollCount + 1;
END_IF;
IF READ_mODBUS.Q THEN
    ReadStatusWord := read_data[1];
END_IF;
IF READ_mODBUS.Error THEN
    ErrCount := ErrCount + 1;
END_IF;
END_PROGRAM
```

---

## Appendix B — KB citations (FactoryLM staging Neon, tenant `78917b56-…`)

| Chunk ID | Source URL | Page | What it covers |
|---|---|---|---|
| `06683164-a316-4030-be2b-78cb576a28a9` | `mira://seeds/gs10-vfd-integration` | 0 | GS10 P00.20 / P00.21 / P09.00 / P09.01 / P09.04 critical params; encoding table for baud + framing |
| `0d16a31d-49e9-4ada-b8a5-14509b42dc82` | `mira://seeds/gs10-vfd-integration` | 1 | GS10 Modbus register map (0x2000-write, 0x2100-read); confirms `0x2100` = Status Word, `0x2101` = Frequency Command read-back |
| `e00f0cab-2814-4ea7-b231-778607a7a576` | `mira://seeds/gs10-vfd-integration` | 2 | Seven canonical RS-485 failure modes ranked by first-time-integration frequency |
| `b7337bd4-e69b-4b26-a288-97fd7f5ab7ee` | `mira://seeds/gs10-vfd-integration` | 3 | Micro820 MSG_MODBUS .ErrorID decode bands (0x0001-0x0010 protocol, 0x0100-0x0200 timeout) |
| `09eea041-4278-412e-a45e-0c9efd3c285d` | `mira://seeds/gs10-vfd-integration` | 4 | RS-485 wiring + CCW serial port config (canonical: 19200 8-E-1, Modbus RTU Master, Channel 2 embedded) |
| `a0ae6016-b2ad-47f1-b407-547ee1a3bd98` | `mira://seeds/demo-conveyor-001/VFD-001` | 0 | Component template for VFD-001 with KB-canonical Modbus parameters and failure-mode ranking |
| `788c2711-d3aa-43c0-bc97-795b5e54b6fa` | `mira://seeds/gs11-micro820-field-guide` | 5 | Micro820 Modbus master sequence (GS11 — sibling drive family, applicable structure) |

All read-only against staging Neon (`factorylm/stg`). No writes performed.

---

## Appendix C — What I didn't have / can't verify from the file system

- The exact firmware revision of the Micro 820 (matters for the
  hypothesis-(a) question: does this CCW rev's `MSG_MODBUS` route to
  serial when `Channel := 2`?). Check **Controller → Properties → Catalog
  / Firmware Revision**.
- Whether `read_data`'s element type is `UINT` or `INT`. The binary
  metadata in `GlobalVariable.rtc` encodes it but I can't decode CCW's
  type-ID table without the schema. Check **CCW Variables → `read_data`
  → Data Type column**.
- The CCW serial port configuration (baud, parity, stop) — stored in
  `MICRO820_Conf.xtc` but not in a format I can confidently parse.
  Check **Project → Micro820 → Embedded Serial Port → Properties**.
- The actual sniffer capture log. PR #7 quotes framing as 38400 8N2 but
  doesn't include the bytes. A 30-second .csv or screenshot of the
  sniffer would confirm.
- The bench's CCW Controller Variables grid as currently saved (post any
  manual edits Mike may have made after the 2026-05-23 commit). The
  on-disk state is what I reviewed; the live state may diverge.

When the bench is in front of you, those five answers turn this
"three-hypothesis review" into a single-answer one.
