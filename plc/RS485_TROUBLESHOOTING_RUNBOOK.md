# RS-485 Modbus RTU Troubleshooting Runbook
**Micro820 2080-LC20-20QBB ↔ GS10 DURApulse VFD — bench link**

> **Where the running code lives:** the PLC is running code from the
> separate **`MIRA_PLC`** GitHub repo (PR #6 / `Conv_Simple_1.4`). The
> `MIRA/plc/` directory in *this* repo is a parallel/historical lineage —
> useful as reference (full ST history, register map, vfd_diag.py,
> live_monitor.py, rs485_sniff.py) but NOT what the controller is
> executing today. When a command below cites a path under
> `MIRA_PLC/Conv_Simple_1.4/…` that's the bench code; when it cites
> `plc/…` that's a tool or reference in *this* repo. Both repos
> co-exist on the PLC laptop:
>
> ```
> C:\Users\hharp\Documents\GitHub\MIRA\          ← this repo (runbook + scripts)
> C:\Users\hharp\Documents\GitHub\MIRA_PLC\      ← PLC code (Conv_Simple_1.4)
> C:\Users\hharp\Documents\CCW\MIRA_PLC\         ← CCW IDE working copy
> ```
>
> **How to use this file:** read § 0 + § 0.5 first (state coming in),
> then run the **§ 2 cheapest-first triage in order**. Don't skip a step
> because intuition says "that's not it" — each step is a falsifiable
> discriminator, and the PR #6 review explicitly faulted us for skipping
> the cheap rungs and reaching for the $150 isolator card first.
>
> **Companion files in this repo (`plc/`):**
> - `RS485_CLAUDE_DRIVER_BRIEF.md` — prompt-style brief for the next
>   Claude session driving the diagnosis interactively.
> - `rs485_sniff.py` — standalone USB-RS485 bus sniffer (pyserial only).
> - `vfd_diag.py`, `test_modbus.py`, `live_monitor.py` — Modbus TCP
>   readers that pull PLC state over Ethernet (they read the PLC's view
>   of its own VFD comms, NOT the RS-485 bus directly).

---

## 0. The 60-Second Triage

```bash
python plc/vfd_diag.py --once --host 169.254.32.93
```

Four numbers in order:

| Field | What it tells you | If it's bad → jump to |
|---|---|---|
| `vfd_poll_step` | 1→2→3→4→(5) cycling = PLC code is polling. 0 = code not running the VFD section | § 3 "CCW download integrity" |
| `vfd_comm_ok` | TRUE = at least one read succeeded recently | Stays FALSE → § 0.5, then § 2 |
| `vfd_dc_bus` | > 0 V = real reply from drive (proves bidirectional comms) | 0 V despite step cycling → § 0.5 |
| `error_code` | 9 = comm watchdog fired (5 s with no reply) | § 7 "Watchdog fired" |

If `vfd_diag.py` itself can't connect to the PLC over Modbus TCP, see § 1 first.

---

## 0.5. What's already known (don't re-discover these)

Before you start testing, here's the state coming out of the 2026-05-21 expo
and the PR #6 review on 2026-05-23. **Confirm each is still true before
relying on it** — but use these as your starting prior, not unknown.

### ✓ Ruled IN (confirmed working)

- **Cable conductors end-to-end.** Mike's GSoft (over USB-RS485 adapter on
  this same cable) talks to the GS10 cleanly.
- **GS10 RS-485 transceiver is alive.** Same evidence as above.
- **GS10 baud / parity / slave-addr / protocol.** P09.00/.01/.04 are set
  such that *some* master can talk to the drive. GSoft proves that.
- **PLC is transmitting on the bus** (per PR #6 bench evidence: "valid
  PLC TX, GS10 healthy in master-test, ErrorID 55 on the PLC"). So we
  are very likely NOT looking at total silence; we're looking at frames
  that the GS10 either doesn't accept or replies to in a way the PLC
  doesn't process correctly.
- **`Prog_init.stf` compile fixes (PR #6 lines 21/30).** `READDATA` →
  `read_data` rename is correct.

### ✗ Ruled OUT

- Nothing. The GSoft-on-cable test is often misread as "polarity is
  fine at the PLC end too" — it is NOT. Vendors flip A/B label
  conventions, so the laptop adapter's A matching the GS10's A says
  nothing about whether the PLC's `D+` is the same polarity as the
  GS10's SG+. **Polarity swap at the GS10 terminal block is still
  step 2a.**

### ⚠️ Known landmines (fix these even if comms start working)

- **`READDATA` scalar still in `GlobalVariable.rtc`** despite PR #6's
  rename of call sites. Any future code writing `LocalAddr := READDATA`
  will compile, silently target the wrong storage, and reintroduce the
  1.3 bug. **Mandatory before merging PR #6:** delete the scalar via
  CCW Global Variables table, verify with
  `strings GlobalVariable.rtc | grep -iE 'READDATA'` → empty.
- **`Prog_init.stf` polls at `T#500ms`, doc says `200 ms`.** Pick one.
  500 ms is fine for bench commissioning, just align the doc.
- **PR body says register `0x2100` for status word, code says
  `16#2101`.** Code is right (per GS10 manual: 0x2100 = warn/error
  code, 0x2101 = drive status word). Fix the PR body.

### Why "PLC silent" and "ErrorID 55" can both be true at different times

The PR #6 evidence is from one bench session; Mike's current symptom
("PLC can't see drive") might be different. Possible states:

1. **Silent** — `vfd_diag.py` shows `vfd_poll_step` stuck at 0 (program
   isn't polling) or cycling but `vfd_dc_bus` stays 0 forever (frames
   leave PLC but get no reply / replies don't decode).
2. **ErrorID 55** — frames go out, GS10 replies with exception, PLC
   reads exception. Bidirectional bus, address rejected by drive.
3. **Intermittent** — works for N polls then drops; usually bias / noise.

§ 0 tells you which one. Don't assume.

---

## 1. Can the laptop reach the PLC over Modbus TCP?

Has to work before any RS-485 question is meaningful (all the diag tools
ride Modbus TCP on top of the PLC's own state).

```bash
ping -c 3 169.254.32.93                         # PLC reachable
nc -vz 169.254.32.93 502                        # Port 502 open
python plc/test_modbus.py 169.254.32.93         # heartbeat toggle = scan running
```

If ping fails → cable/switch/laptop NIC IP. If port 502 closed → PLC in
Program mode or Modbus TCP server disabled in the project. If port open
but heartbeat doesn't toggle → program is loaded but halted; cycle to
Run mode. If heartbeat toggles but every value is 0 → wrong/stale
program is loaded; re-download.

---

## 2. Cheapest-first physical triage (DO IN ORDER)

This is the canonical sequence from PR #6 review §1. Each step takes
30 sec to 5 min and rules out one hypothesis. Don't skip ahead. Capture
the result of each step (one-line note: "tried X, vfd_comm_ok = FALSE,
last_msg_error_id = 51") so you don't repeat yourself.

### 2a. A/B polarity swap at the GS10 terminal block — 30 sec, $0

**Why this is step 1 even though GSoft works:** GSoft talked to the GS10
over a USB-RS485 adapter where the *adapter's* A label matched the GS10's
SG+. The Micro 820's "D+" label is not guaranteed to be the same polarity
convention. Rockwell calls them D+/D-; AutomationDirect calls them SG+/SG-.
A Micro 820 D+ wired to a GS10 SG+ may or may not be in-phase.

What polarity inversion looks like on the bus:
- **TX side:** symptomless — the slave decides what's a 1 from relative
  voltage, so the GS10 might or might not decode the frame. Usually it
  doesn't, and frames are dropped silently with no exception reply.
- **RX side:** master sees inverted bits, CRC fails, frames look like
  noise → comms looks like silence.

**Action (at the panel, not in CCW):**
1. Open Q1 contactor (cuts 3-phase to VFD; comms terminals stay live
   from the keypad +10 V but motor stays safe).
2. At the GS10 RJ45 terminal block (or whatever your bench-end
   adapter is), swap the two RS-485 conductors. SGND stays where it is.
3. Close Q1. Run `python plc/vfd_diag.py --once`.
4. Note `vfd_comm_ok` and `last_msg_error_id` (if visible).
5. If `vfd_comm_ok` flips to TRUE → polarity was the issue, leave it
   swapped, move on. If still FALSE → swap back to original, continue
   to 2b.

### 2b. 120 Ω termination + 4.7 kΩ fail-safe bias on the PLC side — $1, 5 min

**Why this matters for the Micro 820 specifically:** the embedded RS-485
port on the Micro 820 2080-LC20-20QBB has **no built-in bias network**.
RS-485 needs the line to sit at a defined differential during the silent
gap between the PLC ending TX and the GS10 starting its reply. Without
bias, the line floats; a floating pair reads as `1010101…` to the GS10
receiver, and the GS10 discards it before deciding to acknowledge.

You can have perfect wiring and the bus still won't work without bias.
This is the #1 cause of "I tried everything and the master is silent"
on Micro 820s.

**Action:**

| Location | Resistor | Where |
|---|---|---|
| GS10 end of cable | 120 Ω | Across SG+ ↔ SG- (across the RJ45 pins 4↔5) |
| PLC end of cable | 120 Ω | Across D+ ↔ D- |
| Pull-up | 4.7 kΩ | D+ to +5 V (or +24 V via a 47 kΩ if no +5 V handy) |
| Pull-down | 4.7 kΩ | D- to 0 V (signal ground) |

A historical 110 Ω resistor was installed — close enough to 120 Ω, leave
it. Add the bias resistors if they aren't already there. After installation:
re-run `vfd_diag.py --once`.

If `vfd_comm_ok` flips to TRUE → bias was the issue, move on. If still
FALSE → continue to 2c.

### 2c. Common ground / shield continuity — multimeter beep, $0

**Why:** RS-485 tolerates ±7 V common-mode between transmitter and
receiver. PLC + GS10 on separate supplies *without* a signal-ground
wire and *without* the cable shield grounded at one end can drift
outside that. When they drift, the GS10's receiver mutes.

**Action:**
1. Multimeter to continuity mode (beep).
2. Probe between Micro 820 chassis screw and GS10 chassis screw → must
   beep (or read < 1 Ω).
3. Probe between Micro 820 0 V terminal and GS10 keypad SGND (RJ45 pin
   3) → must beep.
4. With everything powered, measure DC volts between Micro 820 0 V and
   GS10 SGND → should be < ±0.5 V. > ±2 V means common-mode drift is
   live and your bus will be flaky even if all else is right.

If you find no continuity, run a 14 AWG green wire between the two
chassis ground lugs. Re-test.

### 2d. GS10 `P09.05` response delay → 10 ms

**Why:** P09.05 defaults to 0 (immediate reply). The Micro 820 embedded
port has no auto-RTS / DE direction-control pin — the firmware drives
the transceiver into RX mode after a software delay that varies with
firmware rev. If the GS10 starts replying *inside* that PLC-side
turnaround window, the half-duplex bus collides and both frames are
corrupt. The PLC reads "no valid reply" → ErrorID 51 (timeout).

Bumping P09.05 to 10 ms gives the PLC enough time to release its
transmitter cleanly before the GS10 starts driving the line.

**Action (on VFD keypad):**
1. `MODE` → arrow to `P09.05` → `ENTER`.
2. Set to `10`. `ENTER`.
3. **No power-cycle needed** (P09.05 takes effect on next reply).
4. Run `vfd_diag.py --once`.

If `vfd_comm_ok` flips to TRUE → turnaround was the issue.

### 2e. Confirm baud is 9600

PR #6 roadmap had "drop to 9600" as a step; it should already be done.

Verify:
- VFD keypad: `P09.01` reads `96`.
- ST: `Prog_init.stf` baud setting / CCW Serial Port → Baud Rate = 9600.

If they disagree, fix the mismatch. (9600 is more forgiving than 19200/
38400 over long or noisy cables — keep it at 9600 for commissioning.)

### Only THEN consider 2080-SERIALISOL

The PR #6 review explicitly flagged the SERIALISOL recommendation as
premature. The isolated transceiver card brings built-in bias and clean
direction control — it fixes a real class of problems, but if you
install it before doing 2a-2d and the actual fault is polarity or
missing bias, you'll have a $200 isolator and *still* not have a
working link. Don't skip the $1 rungs.

---

## 3. PLC isn't polling at all (`vfd_poll_step` stuck at 0)

The state machine never enters the VFD comms section. Almost always a
deploy problem, not a wiring problem.

**Most likely cause:** CCW "embedded serial in the project and controller
are out of sync." Symptom: program logic runs (heartbeat toggles, state
machine works) but MSG function blocks never fire because the serial
port driver isn't loaded.

**Workarounds:**
- Download via USB instead of Ethernet — isolates the TCPIPObject failure
  from the serial config transfer.
- In CCW Download dialog, expand the tree; *Serial Port* should be
  listed as a child node. Check it explicitly.
- Confirm CCW says "Download successful" not "completed with errors."
- Cycle PLC mode Program → Run.
- Re-run `vfd_diag.py --once`. `vfd_poll_step` should now cycle.

**Other causes:**
- v4.1.9 (in `MIRA/plc/`) added 18 new variables that must exist in CCW
  Controller Variables table before the file will compile. **MIRA_PLC's
  `Conv_Simple_1.4` does NOT use v4.1.9 ST** — it has its own
  `Prog_init.stf`. So if you've been editing in `MIRA/plc/` thinking it
  drove the bench, that's the drift problem PR #6 reviewer §5 flagged.
- Program older than v4.1.7 doesn't have `vfd_poll_step` as a variable;
  `vfd_diag.py` will read garbage at that HR address.

---

## 4. v4.1.9-specific diagnostic visibility (only if v4.1.9 ST is loaded)

If you load the MIRA `plc/Micro820_v4.1.9_Program.st` (NOT what's on the
bench today — it's the reference lineage), you get per-step error
counters, `last_err_step`, `last_msg_error_id`, and a `commissioning_mode`
coil that masks writes so you can prove bidirectional reads without
commanding the drive.

To make those visible over Modbus TCP, bump `MbSrvConf.xml` to v4 and
add these mappings (full text in § Appendix D below). Until that's done,
`vfd_diag.py` only sees through HR400116 and can't read
`last_msg_error_id`.

This is reference material. Skip if you're on `Conv_Simple_1.4` —
work § 2 instead.

---

## 5. ErrorID interpretation (Rockwell MSG_MODBUS2 ErrorID byte)

When you can read `last_msg_error_id` (either via v4.1.9 + MbSrvConf v4,
or by watching the MSG block in CCW online mode):

| ErrorID | Meaning | Likely cause | What to try first |
|---:|---|---|---|
| 0 | No error captured | All steps succeeded — re-check `vfd_comm_ok` | — |
| 3 | Illegal Data Value | Out-of-range value written (e.g. freq > 4000) | Check `vfd_freq_setpoint` HR400116 |
| 51 | No response (timeout) | Drive silent | § 2a polarity, § 2b bias, § 2d P09.05 |
| 53 | CRC error | Line noise, baud mismatch | § 2c grounding, § 2e baud, P09.09 bump |
| 55 | Illegal Data Address | GS10 doesn't have that register | § 6 "Wrong address" |
| 56 | Illegal Function | Drive doesn't support FC03/FC06 | Wrong drive on the bus |
| 255 | MSG never completed (uninitialized) | Serial port driver never loaded | § 3 |

---

## 6. ErrorID 55 — Illegal Data Address (the PR #6 bench symptom)

Means a frame reached the drive and the drive understood the framing,
but doesn't have the register/function being asked for.

**On a GS10 this only happens if:**

- ST has a typo in the register address. Verify against the GS10 manual:
  ```bash
  grep -nE "(Read|Write).*Param\.Addr" \
    /path/to/MIRA_PLC/Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/Prog_init.stf
  ```
  Expected values:
  - `16#2101` (8449) — Status Monitor 2 (drive status word, FC03)
  - `16#2103` (8451) — Output frequency block start (FC03, 4 regs)
  - `16#2000` (8192) — Control command (FC06)
  - `16#2001` (8193) — Frequency setpoint (FC06)
  - `16#2002` (8194) — Fault reset (FC06)

  Anything else is a bug.

- You're talking to a GS1/GS2/GS3 instead of a GS10. Older drives use
  `0x2100` for the command register, not `0x2000`. Confirm the model
  sticker on the drive.

- READDATA landmine (see § 0.5) — if a future edit wrote
  `LocalAddr := READDATA` and the scalar global is still in
  `GlobalVariable.rtc`, the MSG block points at a 1-element buffer
  whose first WORD happens to look like an address, and FC03 with that
  as ElementCount can ask for a wildly invalid address range. Delete
  the scalar global before testing.

---

## 7. Comm watchdog fired (`error_code = 9`)

The PLC's own watchdog (5 s with no successful read) set `vfd_comm_err
= TRUE` and the state machine moved to FAULT. Downstream of any of the
issues above — fix the root cause and the watchdog clears on the next
successful read.

**To clear the latched fault:**

1. Selector to OFF.
2. Press the RUN pushbutton (rising edge with selector OFF and no E-stop
   sets `vfd_fault_reset_pending := TRUE`, which fires the fault-reset
   step on the next poll).
3. If the VFD itself shows F30 / CE10 on the keypad, press **STOP/RESET**
   on the keypad too — drive has its own latch independent of the PLC's.

If `error_code` keeps re-latching to 9 within a few seconds, comms is
fundamentally broken — back to § 2.

---

## 8. Bus sniff procedure (the decisive test)

When § 2 hasn't localized the fault, sniff the bus directly. This tells
you definitively whether the PLC is transmitting and what bytes the GS10
is replying with.

**Setup:**
1. Disconnect the cable's VFD-end from the GS10 RJ45.
2. Land that end onto your USB-RS485 adapter (A → SG+ conductor, B →
   SG-, GND → SGND if your adapter has it).
3. Leave the PLC end on the Micro 820 D+/D-/G as normal.
4. PLC stays in Run mode polling.

**Run:**
```bash
# install dependency once
pip install pyserial

# sniff for 10 s at 9600 8N2 (GS10 default)
python plc/rs485_sniff.py /dev/tty.usbserial-XXXX

# if you suspect stop-bit mismatch, try 8N1
python plc/rs485_sniff.py /dev/tty.usbserial-XXXX --stopbits 1
```

**Interpret:**

- **No bytes printed for 10 s:** PLC is not transmitting. The MSG blocks
  may be running but the serial port driver isn't loaded (§ 3) or the
  ST file's `Channel := N` doesn't match the embedded port (`2` for
  Micro 820 2080-LC20-20QBB).
- **PLC frames visible, but you reconnect the VFD and see no reply:**
  Drive isn't hearing or isn't accepting — § 2a polarity, § 2c ground,
  § 6 register address.
- **PLC frames + drive reply visible (with VFD reconnected and adapter
  passively probing the bus):** Wire and config are fine; the problem
  is application-layer (wrong register → § 6, wrong scaling → § 9).

A FC03 query for 4 regs at 0x2103 from slave 1 should look like:
`01 03 21 03 00 04 4E F6` (last 2 bytes = CRC16).
A good FC03 reply: `01 03 08 …8 bytes data… CC CC`.
An exception reply: `01 83 02 C0 F1` (0x83 = 0x03 | 0x80; 0x02 =
Illegal Data Address; 0xC0 0xF1 = CRC).

---

## 9. Comms work, values look wrong (application layer)

Rare given the v4.1.9 register cleanup, but worth a checklist:

- `vfd_dc_bus` reads 0 but other regs read sensible values → ElementCnt
  back to 6. Should be 4.
- `vfd_frequency` reads 600 but motor is at 30 Hz → remember scale is
  "Hz × 10" (HR400107 = 600 = 60.0 Hz). `vfd_diag.py` divides for you.
- Drive runs the wrong direction → `vfd_cmd_word = 18` is FWD+RUN,
  `= 20` is REV+RUN. If swapping these doesn't help, two of the three
  motor leads are swapped at the contactor.
- Drive runs but pegs at one speed → `vfd_freq_setpoint` not being
  written. Watch the write-freq step success counter increment; if it
  never completes, FC06 to 0x2001 is failing (separate from read).

---

## 10. When to escalate / second pair of eyes

Worked § 1 through § 8, bus still silent or unresolved. Before tearing
the panel apart:

1. **Swap the cable end-for-end.** A bad crimp on one RJ45 looks
   identical to a wiring fault.
2. **Bring up a known-good drive on the same cable.** Spare GS10 — if
   the spare answers immediately, the original drive is the problem.
3. **Bring up the PLC on a known-good cable to a Modbus simulator.** Run
   `modpoll` or `diagslave` on the laptop with USB-RS485 and see if the
   PLC's frames appear and your simulated replies are accepted.

Capture before escalating:
- `vfd_diag.py --once` output.
- VFD keypad: fault code (if any), operating display (F60.0, F30.x).
- All P09.xx + P00.21 values *read off the keypad*, not what you think
  you set.
- CCW "Serial Port" config screenshot.
- 10 s of `rs485_sniff.py` output.

---

## Appendix A — Cheat sheet of useful one-liners

```bash
# PLC reachable?
ping -c 3 169.254.32.93 && nc -vz 169.254.32.93 502

# One-shot PLC state dump
python plc/vfd_diag.py --once

# Live dashboard (keystroke-driven: F/R/S/X/+/-/0/Q)
python plc/live_monitor.py

# Heartbeat / PLC-scan-running check
python plc/test_modbus.py

# Sniff RS-485 bus (need USB-485 adapter)
ls /dev/tty.* | grep -i usb                          # macOS: find adapter
ls /dev/ttyUSB*                                       # Linux: find adapter
python plc/rs485_sniff.py /dev/tty.usbserial-XXXX     # default 10 s, 9600 8N2
python plc/rs485_sniff.py /dev/tty.usbserial-XXXX --stopbits 1   # try 8N1
python plc/rs485_sniff.py /dev/tty.usbserial-XXXX --seconds 30   # long capture
```

## Appendix B — Modbus address quick reference (PLC's TCP side, from MbSrvConf_v3.xml)

| Modbus Addr | Type | Variable | Notes |
|---|---|---|---|
| C1 (0) | Coil | `motor_running` | |
| C4 (3) | Coil | `vfd_comm_ok` | **The flag** — TRUE when last read succeeded |
| C9 (8) | Coil | `heartbeat` | Toggles every scan, proves PLC running |
| C21 (20) | Coil | `vfd_poll_active` | TRUE during an in-flight MSG |
| C22 (21) | Coil | `vfd_fault_reset_pending` | Step 4 fires next poll if TRUE |
| HR400106 (105) | Int | `error_code` | 0=ok 6=ESTOP 7=WIRING 8=DIR 9=VFD_COMM |
| HR400107 (106) | Int | `vfd_frequency` | Hz × 10 |
| HR400110 (109) | Int | `vfd_dc_bus` | Volts — >0 proves a real read succeeded |
| HR400114 (113) | Int | `conv_state` | 0=IDLE 1=START 2=RUN 3=STOP 4=FAULT |
| HR400115 (114) | Int | `vfd_cmd_word` | 1=STOP 18=FWD+RUN 20=REV+RUN |

## Appendix C — VFD keypad quick reference

| Action | Sequence |
|---|---|
| View running params | `MODE` → arrow to "Operation Status" |
| Clear F30 / CE10 fault | `STOP/RESET` |
| Edit P09.05 (response delay) | `MODE` → arrows to `P09.05` → `ENTER` → set → `ENTER` |
| Read current slave addr | `MODE` → arrows to `P09.00` |
| Verify run source = RS-485 | `MODE` → `P00.21` should read `02` |
| Power cycle | Open Q1 contactor for 30 s |

## Appendix D — MbSrvConf v4 mappings (v4.1.9 diagnostic visibility)

Only needed if running `MIRA/plc/Micro820_v4.1.9_Program.st` (reference
lineage). Add to `<modbusRegister name="HOLDING_REGISTERS">`:

```xml
<mapping variable="vfd_poll_step"          parent="Micro820" dataType="Int" address="400117"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
<mapping variable="vfd_status_word"        parent="Micro820" dataType="Int" address="400118"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
<mapping variable="last_err_step"          parent="Micro820" dataType="Int" address="400119"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
<mapping variable="last_msg_error_id"      parent="Micro820" dataType="Int" address="400120"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
<mapping variable="read_err_count"         parent="Micro820" dataType="Int" address="400121"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
<mapping variable="last_err_at_uptime"     parent="Micro820" dataType="Int" address="400122"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
<mapping variable="last_ok_at_uptime"      parent="Micro820" dataType="Int" address="400123"><MBVarInfo ElemType="Int" SubElemType="Any" DataTypeSize="2"/></mapping>
```

And to `<modbusRegister name="COILS">`:

```xml
<mapping variable="vfd_running_bit"    parent="Micro820" dataType="Bool" address="000023"><MBVarInfo ElemType="Bool" SubElemType="Any" DataTypeSize="1"/></mapping>
<mapping variable="vfd_at_speed_bit"   parent="Micro820" dataType="Bool" address="000024"><MBVarInfo ElemType="Bool" SubElemType="Any" DataTypeSize="1"/></mapping>
<mapping variable="vfd_drive_fault"    parent="Micro820" dataType="Bool" address="000025"><MBVarInfo ElemType="Bool" SubElemType="Any" DataTypeSize="1"/></mapping>
<mapping variable="commissioning_mode" parent="Micro820" dataType="Bool" address="000026"><MBVarInfo ElemType="Bool" SubElemType="Any" DataTypeSize="1"/></mapping>
```

Enable read-only commissioning mode:
```bash
python -c "from pymodbus.client import ModbusTcpClient; c=ModbusTcpClient('169.254.32.93',port=502,timeout=3); c.connect(); c.write_coil(25,True); c.close()"
```

## Appendix E — Cross-repo file map

```
MIRA repo (this one):
  plc/RS485_TROUBLESHOOTING_RUNBOOK.md   ← THIS FILE
  plc/RS485_CLAUDE_DRIVER_BRIEF.md       ← prompt for next Claude session
  plc/rs485_sniff.py                     ← standalone bus sniffer
  plc/vfd_diag.py                        ← PLC state via Modbus TCP
  plc/live_monitor.py                    ← interactive dashboard
  plc/test_modbus.py                     ← heartbeat / scan check
  plc/GS10_Integration_Guide.md          ← full register map + keypad params
  plc/Micro820_v4.1.x_Program.st         ← reference ST lineage (NOT what's on bench)
  plc/MbSrvConf_v3.xml                   ← reference Modbus TCP map

MIRA_PLC repo (separate, on PLC laptop):
  Conv_Simple_1.4/                       ← what's actually on the controller
    Controller/Controller/Micro820/Micro820/
      Prog_init.stf                      ← bench ST file (PR #6 fixes)
      GlobalVariable.rtc                 ← contains READDATA landmine
      MICRO820_SymbolsTarget.s.xtc       ← CCW transient (should be gitignored)
      ...
    MbSrvConf.xml                        ← bench Modbus TCP map
  specs/work-instruction-typst/
    06-modbus-comms.typ                  ← Typst port of register table
```
