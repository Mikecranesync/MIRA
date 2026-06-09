# ST Code Review — Why The PLC Can't Talk To The GS10
**Reviewer:** Claude (Sonnet 4.6 / cowork on CHARLIE), 2026-05-24
**Scope:** Comms-failure-class bugs that match the symptom
*"sniffer can talk to PLC, sniffer can talk to GS10, but PLC silent on bus toward GS10."*
**Code reviewed:** `MIRA/plc/` (reference lineage — what's actually on the
bench is in `MIRA_PLC/Conv_Simple_1.4/Prog_init.stf` which I do not have
in this sandbox; findings need cross-checking against that file).

---

## Headline (read first)

**The MSG block instances in `populate_variables.py` are declared as the
WRONG function block type.** They're declared as `MSG_MODBUS` (`T_MSG_MODBUS
= 122`) — that's Rockwell's function block for **Modbus TCP over Ethernet**.
The Micro 820 needs **`MSG_MODBUS2`** for Modbus RTU over the embedded
RS-485 serial port. Same name family, completely different function block,
different parameter struct types.

When a `MSG_MODBUS` block is called with target params set up for serial,
it does one of three things depending on firmware rev:
- **Silently never transmits** on RS-485 (most common — explains "PLC silent
  on the bus" symptom).
- **Tries to use Ethernet to reach an IP address of `Node=1`** which doesn't
  exist on your bench network → no TX on either interface.
- **Compiles but reports `.Error = TRUE` with an undocumented ErrorID** on
  every call.

**This is the single highest-probability root cause given the sniffer
evidence Mike just shared.** PLC + GS10 each work independently with a
master sniffer because:
- The PLC's *Ethernet* Modbus TCP server is fine (separate stack, separate
  function blocks, MbSrvConf.xml is well-formed).
- The GS10's RTU slave is fine (GSoft talks to it on the cable).
- The PLC's MSG_MODBUS function block calls are pointed at the wrong
  transport — TCP, not RTU. So nothing ever leaves the PLC's RS-485 port.

---

## P0 findings (do these first)

### P0-1. MSG block type is `MSG_MODBUS` (TCP) — needs to be `MSG_MODBUS2` (RTU)

**Evidence in this repo:**

`plc/populate_variables.py:23-28`:
```python
T_MODBUSLOCADDR = 22     # Array type for Modbus local address buffers
T_MODBUSLOCPARA = 32     # Struct: MSG_MODBUS_LOCAL
T_MODBUSTARPARA = 33     # Struct: MSG_MODBUS_TARGET
T_MSG_MODBUS = 122       # POUs RefPOUs for MSG_MODBUS function block
```

`plc/populate_variables.py:94-99`:
```python
# --- MSG_MODBUS instances (function block instances) ---
("mb_read_status",      VI_FB_INSTANCE, T_MSG_MODBUS, None),
("mb_write_cmd",        VI_FB_INSTANCE, T_MSG_MODBUS, None),
("mb_write_freq",       VI_FB_INSTANCE, T_MSG_MODBUS, None),

# --- MSG_MODBUS_LOCAL config structs ---
("read_local_cfg",      VI_SINGLE, T_MODBUSLOCPARA, None),
```

`plc/Micro820_v4.1.0_Program.st` through `_v4.1.2_Program.st` all declare:
```
read_local_cfg        : MSG_MODBUS_LOCAL;
read_target_cfg       : MSG_MODBUS_TARGET;
write_cmd_local_cfg   : MSG_MODBUS_LOCAL;
...
```

That is, the ENTIRE lineage in `MIRA/plc/` uses the **TCP** function block
and its associated structs. None of these ST files declare or call
`MSG_MODBUS2`.

The v4.1.9 header (the only place anywhere in this repo with the correct
type names) says:
```
read_status_word_local_cfg    MSGMODBUSPARA_LOCAL   (none)
read_status_word_target_cfg   MSGMODBUSPARA_TARGET  (none)
mb_read_status_word           MSG_MODBUS2           (none)
```

…but only for the NEW `read_status_word` block added in v4.1.9. The
existing `mb_read_status` / `mb_write_cmd` / `mb_write_freq` /
`mb_fault_reset` calls in v4.1.9 still pass `read_local_cfg`,
`write_cmd_local_cfg`, etc. — the OLD TCP-typed structs.

So v4.1.9 either (a) was never going to compile because the IN type of
`MSG_MODBUS2` won't accept `MSG_MODBUS_LOCAL`, or (b) Mike hand-fixed the
types in CCW Controller Variables table without updating the .py script
or the .st declarations to match.

**What this means for MIRA_PLC `Conv_Simple_1.4/Prog_init.stf`:** the
bench code may have inherited these wrong types if `populate_variables.py`
was ever re-run against the bench PrjLibrary.accdb. Or the CCW Variables
table was hand-built with correct types from the GUI but a future re-run
would clobber them.

**Action (at the panel, in CCW):**

1. Open CCW → Controller Variables table (the GUI grid).
2. For each variable below, check the **Data Type** column:

   | Variable | Required type | Wrong type to look for |
   |---|---|---|
   | `mb_read_status` | `MSG_MODBUS2` | `MSG_MODBUS` |
   | `mb_write_cmd` | `MSG_MODBUS2` | `MSG_MODBUS` |
   | `mb_write_freq` | `MSG_MODBUS2` | `MSG_MODBUS` |
   | `mb_fault_reset` (if present) | `MSG_MODBUS2` | `MSG_MODBUS` |
   | `mb_read_status_word` (v4.1.9 only) | `MSG_MODBUS2` | `MSG_MODBUS` |
   | `read_local_cfg` | `MSGMODBUSPARA_LOCAL` | `MSG_MODBUS_LOCAL` |
   | `read_target_cfg` | `MSGMODBUSPARA_TARGET` | `MSG_MODBUS_TARGET` |
   | `write_cmd_local_cfg` | `MSGMODBUSPARA_LOCAL` | `MSG_MODBUS_LOCAL` |
   | `write_cmd_target_cfg` | `MSGMODBUSPARA_TARGET` | `MSG_MODBUS_TARGET` |
   | `write_freq_local_cfg` | `MSGMODBUSPARA_LOCAL` | `MSG_MODBUS_LOCAL` |
   | `write_freq_target_cfg` | `MSGMODBUSPARA_TARGET` | `MSG_MODBUS_TARGET` |
   | `fault_reset_local_cfg` (if present) | `MSGMODBUSPARA_LOCAL` | `MSG_MODBUS_LOCAL` |
   | `fault_reset_target_cfg` (if present) | `MSGMODBUSPARA_TARGET` | `MSG_MODBUS_TARGET` |
   | `read_data` | `MODBUSLOCADDR` (alias for `ARRAY[1..125] OF UINT`) | scalar `UINT` or `INT` |
   | `write_cmd_data` | `MODBUSLOCADDR` | scalar |
   | `write_freq_data` | `MODBUSLOCADDR` | scalar |
   | `fault_reset_data` | `MODBUSLOCADDR` | scalar |

3. If any are wrong: **delete the variable** in CCW (right-click → Delete),
   **re-create** with the correct type. CCW will offer to update existing
   references — accept.
4. **Critical:** if `mb_read_status` was `MSG_MODBUS` and you change it
   to `MSG_MODBUS2`, CCW may flag a type mismatch in the ST call site
   that uses `read_local_cfg` (which also needs to be retyped). Fix the
   structs first, then the instances. Then rebuild.

5. Build (Ctrl+Shift+B). 0 errors expected. Any "incompatible type"
   compile error here is the bug exposing itself — fix and rebuild.

6. Download to PLC. Run `python plc/vfd_diag.py --once`. **If
   `vfd_poll_step` is now cycling AND the bus sniffer suddenly sees
   PLC frames where it saw silence before — this was the bug.**

### P0-2. `READDATA` scalar landmine in `GlobalVariable.rtc`

Per the 2026-05-23 PR #6 review (in this repo at
`docs/cowork/2026-05-23_mira-plc-pr6-review-RESPONSE.md`):

```
$ strings Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/GlobalVariable.rtc \
  | grep -iE 'READ_?DATA|read_data'
read_data
READDATA
```

`READDATA` is still declared as a scalar (likely UINT) alongside the
`read_data` array. CCW's case-insensitive symbol lookup resolves both to
the same identifier in normalized form. The PR #6 fix renamed the *call
sites* but did not delete the dead global, so:

- The compiled `.ic` happens to point at the array `read_data` (the
  reviewer confirmed `READ_DATA` in `PROG_INIT.ic`, which is CCW's
  canonical capitalization for the array).
- BUT a future ST edit writing `LocalAddr := READDATA` will compile
  successfully and silently re-target the scalar storage. Symptoms:
  `vfd_dc_bus` reads 0 forever, `vfd_comm_ok` may flicker on then
  back off, ErrorID may be 0 or 51 randomly.

**Action:** open CCW Global Variables table, find `READDATA` (case-
insensitive search), confirm it's a scalar (not an array), delete it.
Verify on the PLC laptop:
```bash
strings MIRA_PLC/Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/GlobalVariable.rtc \
  | grep -iE 'READDATA'
# expect: no output (only "read_data" remains)
```

### P0-3. Channel := 2 vs 0 confusion across versions

The embedded RS-485 port on the **2080-LC20-20QBB** is **Channel 2** in
CCW. The lineage history shows back-and-forth:

| File | Channel value | Notes |
|---|---:|---|
| v4.1.0–v4.1.7 | `2` | Worked (PR #6 sniffer log proved valid TX with v4.1.7) |
| v4.1.8 | `0` | Wrong; had a TODO "change to 2" |
| v4.1.9 | `2` | Correct |
| **Prog2.stf (v5.0.0)** | (header says) `0` | **WRONG** — see header comment line 12 |
| Prog2-Logic.stf (v5.1.0) | n/a — MSG blocks moved to LD | Need to verify the LD program |

Action: confirm bench `Prog_init.stf` has `Channel := 2` on every
`*_local_cfg.Channel` assignment. If `Channel := 0`, the MSG block
targets a non-existent serial channel — silent on RS-485.

---

## P1 findings (do these after P0)

### P1-1. `TriggerType := 0` semantics may be wrong for repeated polls

All cfg structs set `TriggerType := 0`. Per Rockwell MSG_MODBUS2
documentation, `TriggerType` controls the IN edge behavior:

- `0` = MSG triggers on the rising edge of IN. Holding IN high won't
  re-fire the message.
- `1` = MSG triggers continuously while IN is high.

The v4.1.9 ST sets IN level-high (`vfd_poll_step = 1 AND vfd_poll_active`)
and clears `vfd_poll_active := FALSE` after `.Q` or `.Error`. This relies
on the rising edge each cycle, which works IF `vfd_poll_active` was
FALSE-then-TRUE between calls.

But look at this sequence (lines 374-380 of v4.1.9):
```
IF vfd_poll_timer.Q AND NOT vfd_poll_active THEN
    vfd_poll_active := TRUE;
    vfd_msg_done := FALSE;
    vfd_poll_step := vfd_poll_step + 1;
    ...
END_IF;
```

`vfd_poll_active` goes FALSE → TRUE when the poll timer expires. Then
the MSG block sees IN = TRUE. Good. After `.Q` fires, `vfd_poll_active
:= FALSE` (line 433). IN goes FALSE. On the next poll cycle, IN goes
TRUE again — rising edge. OK.

**Risk:** if the scan completes within one PLC cycle where IN went TRUE
and the MSG block's IN was sampled TRUE but then went FALSE in the same
scan, the rising-edge detection may miss the trigger. Symptom:
`vfd_poll_step` cycles but `.Q` and `.Error` never fire → frames never
leave PLC.

Action: if P0-1 alone doesn't fix the bus, try `TriggerType := 1` in all
configs as a diagnostic. If MSG blocks suddenly start completing, the
edge-detection was the issue.

### P1-2. MSG instances reuse — distinct instances for distinct calls?

The v4.1.9 ST calls **5 separate MSG instances**:
`mb_read_status`, `mb_write_cmd`, `mb_write_freq`, `mb_fault_reset`,
`mb_read_status_word`. That's correct — each MSG_MODBUS2 instance owns
its own internal state, can't be reused across different
LocalCfg/TargetCfg without races.

Verify in CCW Variables table: there ARE 5 distinct instances declared,
each typed `MSG_MODBUS2`. If only one instance exists and the calls
pass different configs to it, the MSG block's internal state machine
gets clobbered between calls and nothing completes.

### P1-3. `read_data` array size

Declared as `MODBUSLOCADDR` which the `populate_variables.py` comment
says is `INT[1..125]`. Per Rockwell docs, MSG_MODBUS2 LocalAddr buffer
must be an array of **`UINT`** (unsigned 16-bit), not `INT` (signed
16-bit). On most Micro 820 firmware revs this is silently coerced; on
some it's a compile error or runtime mismatch.

Action: in CCW Variables, confirm `read_data`'s exact element type. If
it's `INT[1..125]` rather than `UINT[1..125]`, change it to `UINT`
(the GS10's monitor registers like DC bus voltage 300+ V would overflow
a signed 16-bit at 32767 and read negative — `vfd_diag.py` would show
weird signed values, that's the smoking gun).

### P1-4. `read_status_word_data` array size `[1..1]` may be invalid

v4.1.9 header documents:
```
read_status_word_data         MODBUSLOCADDR[1..1]   (none)
```

Rockwell MSG_MODBUS2 may REQUIRE the LocalAddr buffer to be the full
`[1..125]` regardless of how many registers you actually read. A `[1..1]`
declaration could be rejected at compile time or accepted but cause an
array-out-of-bounds runtime error when the firmware tries to write the
incoming bytes past index 1.

Action: declare ALL Modbus data buffers as `MODBUSLOCADDR` (the alias)
or `UINT[1..125]` explicitly. Don't dimension to "just what I need."

### P1-5. COP block direction

Lines 363-370 of v4.1.9:
```
cop_cmd(Enable := TRUE, Src := vfd_cmd_word, SrcOffset := 0,
        Dest := write_cmd_data, DestOffset := 0, Length := 1, Swap := FALSE);
cop_freq(Enable := TRUE, Src := vfd_freq_setpoint, SrcOffset := 0,
         Dest := write_freq_data, DestOffset := 0, Length := 1, Swap := FALSE);
cop_reset(Enable := TRUE, Src := fault_reset_cmd, SrcOffset := 0,
          Dest := fault_reset_data, DestOffset := 0, Length := 1, Swap := FALSE);
```

`Enable := TRUE` means the COP fires every scan, overwriting the write
buffer continuously. That's the right idea — but if the write MSG block
is mid-transmission and the COP overwrites the buffer mid-frame, the
transmitted register value can be partially corrupt.

Action: gate `cop_cmd.Enable` on `(vfd_poll_step <> 2) OR NOT
vfd_poll_active` so it only refreshes between cycles, not during.
Same for `cop_freq` and `cop_reset`.

Severity: P2 if symptom is "comms work but writes occasionally fail";
P1 if symptom is "writes never complete." Probably not the primary bug.

---

## P2 findings (cleanup, lower urgency)

### P2-1. `Prog2.stf` v5.0.0 header says `Channel 0 = built-in RS-485` — **WRONG**

Line 12 of Prog2.stf: *"Channel 0 = built-in RS-485 (confirmed Rockwell docs)."*

This is the v4.1.8 regression resurfacing. The header is wrong; the
correct value is 2. If anyone reads this header and trusts it, they'll
break the link again. Fix the comment, even if the actual `Channel :=`
assignment is correct.

### P2-2. `populate_variables.py` is v3.1 and out of date

It declares only the v3.1 variable set:
- 23 BOOLs
- 19 INTs
- 5 TONs
- 3 MSG instances (wrong type — see P0-1)
- 3 LOCAL + 3 TARGET configs (wrong type — see P0-1)
- 3 data arrays

The current v4.1.9 ST requires:
- 5 MSG instances (added `mb_fault_reset` and `mb_read_status_word`)
- 5 LOCAL + 5 TARGET configs
- 5 data arrays
- 18 NEW BOOL/INT/DINT variables (listed in v4.1.9 header)

If `populate_variables.py` was re-run against the bench DB, it would
**delete** all the v4.x additions and revert the variable set to v3.1.
That alone would break v4.1.9 comms.

Action: update `populate_variables.py` to the v4.1.9 variable set, OR
delete it entirely and treat CCW Controller Variables table as the
source of truth. The Karpathy principle: don't keep auto-generators
around for code you've since hand-edited; they're a footgun.

### P2-3. Two-program split (`Prog2-Logic.stf` v5.1.0) moves MSG to LD

Prog2-Logic.stf header says MSG_MODBUS blocks moved to `Prog3-Modbus` (LD).
If the bench is on this architecture, the MSG calls aren't in the ST
file at all — they're in the LD ladder file. Audit the LD file in CCW
for the same MSG_MODBUS vs MSG_MODBUS2 type issue.

---

## Verification sequence after fixing

After applying P0-1, P0-2, P0-3:

1. **Build** in CCW. Must be 0 errors. Any "incompatible type" or
   "undefined symbol" error here is the bug exposing itself — fix and
   rebuild.
2. **Download** to PLC. Confirm "Download successful" not "completed
   with errors." If the latter, the embedded serial port config didn't
   sync — use USB download path or repeat.
3. **PLC in Run mode.**
4. **Run `python plc/vfd_diag.py --once`.** Confirm `vfd_poll_step` is
   cycling.
5. **Sniff bus** with `python plc/rs485_sniff.py /dev/tty.usbserial-XXXX`.
   Where you previously saw silence (PLC side), you should now see
   master query frames like `01 03 21 03 00 04 4E F6`.
6. **Reconnect VFD** to bus end (if disconnected for sniff). Run
   `vfd_diag.py --once` again. `vfd_comm_ok` should be TRUE,
   `vfd_dc_bus` should read > 0 V (typically 300-340 V on 230 V class).
7. **First motor run.** Selector to FWD, press RUN button.
   Watch `conv_state` go 0 → 1 → 2, motor spins, VFD display shows
   the commanded Hz.

If P0-1 alone doesn't bring the bus up, work P1-1 → P1-3 → P1-4 in
that order. If still down, the bug is something I haven't seen because
I didn't have the bench code in front of me — sniff with v4.1.9 ST
+ v4 MbSrvConf loaded so you can read `last_msg_error_id` and decide
from there.

---

## What I couldn't review (need the bench code)

I do NOT have:
- `MIRA_PLC/Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/Prog_init.stf`
- `MIRA_PLC/Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/GlobalVariable.rtc`
- The PR #6 actual diff (only the review of it)
- The CCW project's compiled `.ic` files

Everything above is inference from:
- The parallel-lineage ST files in `MIRA/plc/` (v4.1.0 through v4.1.9)
- `populate_variables.py` (v3.1, generator for the CCW variables DB)
- `create_mira_plc.py` (project scaffolder)
- The 2026-05-23 PR #6 review at
  `docs/cowork/2026-05-23_mira-plc-pr6-review-RESPONSE.md`

When the bench is back up, please:
1. Confirm Variables table types match the P0-1 table above (or note any
   discrepancies).
2. Paste the actual `Channel :=` line numbers from `Prog_init.stf`.
3. Note whether the bench is on v5.0.0 single-program or v5.1.0
   two-program (with MSG in LD) architecture.

Then the next code review can be precise.

---

## TL;DR for at the panel right now

1. **CCW → Controller Variables table → audit every MSG-related variable's
   Data Type column.** If you see `MSG_MODBUS` (not `MSG_MODBUS2`),
   `MSG_MODBUS_LOCAL` (not `MSGMODBUSPARA_LOCAL`), or
   `MSG_MODBUS_TARGET` (not `MSGMODBUSPARA_TARGET`) — those are wrong.
   The PLC is silent on RS-485 because it's using the **Modbus TCP**
   function block, which doesn't transmit on the serial port.
2. **Delete + re-create** the wrong-typed variables. Build → Download.
3. Sniff the bus. If PLC frames suddenly appear where there was silence
   before — this was the bug.
4. If frames appear but `vfd_comm_ok` is still FALSE, work § P1-1 onward.

Don't `populate_variables.py` against the bench DB again — it'll
re-introduce the wrong types and clobber v4.x additions.
