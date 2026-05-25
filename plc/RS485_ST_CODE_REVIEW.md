# ST Code Review — Why The PLC Can't Talk To The GS10
**Reviewer:** Claude (Sonnet 4.6 / cowork on CHARLIE), 2026-05-24
**Scope:** Comms-failure-class bugs that match the symptom
*"sniffer-readable on both endpoints, PLC ↔ GS10 RS-485 link not working."*
**Code reviewed:** `MIRA/plc/` (reference lineage — what's actually on
the bench is in `MIRA_PLC/Conv_Simple_1.4/Prog_init.stf` which I do not
have in this sandbox; findings need cross-checking against that file).

---

## ⚠️ RETRACTION: my prior P0-1 was a hallucination

**An earlier version of this review claimed `MSG_MODBUS` was the
Modbus TCP function block and `MSG_MODBUS2` was the RTU one. That was
backwards.** I bootstrapped that claim from two other LLM-written
comments (the v4.1.9 ST header and the PR #6 reviewer) plus an
inference from `populate_variables.py` — circular evidence, not a
real citation. Mike caught it.

The actual Rockwell documentation says the opposite:

| Function block | Transport | Per Rockwell official docs |
|---|---|---|
| **`MSG_MODBUS`** | **Serial port (RTU)** | "MSG_MODBUS sends a Modbus message over a serial port" — Allen-Bradley Micro800 General Instructions Manual, page 197 |
| **`MSG_MODBUS2`** | **Ethernet (Modbus/TCP)** | "The MSG_MODBUS2 instruction sends a MODBUS/TCP message over an Ethernet Channel" — Rockwell FactoryTalk Design Workbench Help, MSG_MODBUS2 page |

| Data type | Used by | Per Rockwell |
|---|---|---|
| `MODBUSLOCPARA` | MSG_MODBUS (RTU) | "Channel parameter… 2 representing the embedded serial port (RS-485)" |
| `MODBUSTARPARA` | MSG_MODBUS (RTU) | "TargetCfg parameter's .Node attribute… Target Node range is 1-247" |
| `MODBUS2LOCPARA` | MSG_MODBUS2 (TCP) | "local Ethernet port number (4 for Micro850 & Micro820 embedded Ethernet port)" |
| `MODBUS2TARPARA` | MSG_MODBUS2 (TCP) | "Target device's IP address… Target TCP port number, with the standard Modbus/TCP port being 502" |

**Implications for the bench code:**

1. **`populate_variables.py` is correct** in using `T_MSG_MODBUS` (type
   122) and `T_MODBUSLOCPARA` (32) / `T_MODBUSTARPARA` (33) for the
   RS-485 MSG instances. That's the RTU function block. No change
   needed here.

2. **The v4.1.9 header was wrong** when it said the new
   `read_status_word` block should use `MSG_MODBUS2` with
   `MSGMODBUSPARA_LOCAL`/`MSGMODBUSPARA_TARGET`. If you implemented
   that as written, the new block would attempt **Ethernet TCP** to
   the GS10's IP (which doesn't exist on the bus) and never transmit
   on RS-485. **For the status-word read at 0x2101, use `MSG_MODBUS`
   with `MODBUSLOCPARA`/`MODBUSTARPARA`** — same types as the other
   four blocks.

3. **The "MSG_MODBUS2 LocalAddr requires ARRAY[1..125] OF UINT"
   reasoning in the PR #6 review was likely also wrong about the
   FB name** but the underlying point (LocalAddr must be the 125-word
   `MODBUSLOCADDR` array, not a scalar) is correct — both
   `MSG_MODBUS` and `MSG_MODBUS2` use `MODBUSLOCADDR` for LocalAddr,
   per the official MSG_MODBUS2 page I fetched.

I'm sorry — that's the kind of error that costs you bench time. The
rest of this file is rebuilt with primary sources.

---

## Honest assessment of what I actually know

**What I can say with citation:**
- MSG_MODBUS / MSG_MODBUS2 are distinct function blocks for serial/TCP
  (cited above).
- MODBUSLOCADDR is a 125-word array used as the data buffer for both
  Read (incoming) and Write (outgoing) operations.
- The Target Node range for serial Modbus is 1-247.
- The Channel field is the serial port number (with multiple secondary
  sources saying `2` = embedded RS-485 on the 2080-LC20-20QBB; one
  source saying `0` = "built-in"; weight of evidence is `2`).
- v4.1.7 (per PR #6 sniffer log referenced in the v4.1.9 changelog)
  did produce valid TX with Channel := 2 — that's behavioral
  confirmation specifically for this controller.

**What I can't say without seeing the bench code:**
- Whether `Prog_init.stf` actually uses `Channel := 2` today.
- Whether the CCW Serial Port driver dropdown is set to "Modbus RTU
  Master" vs "Modbus RTU Slave" vs "CIP Serial" vs "ASCII".
- Whether the v4.x additions to the variable set exist in the bench
  PrjLibrary.accdb.
- Whether your USB-RS485 adapter actually saw PLC frames on the bus
  (a true passive bus sniff), or whether you tested each endpoint
  independently with the adapter acting as master (those are very
  different evidentiary value — see § "What 'sniffer-readable' proved
  and what it didn't").

**My confidence in the remaining suspect list is moderate, not high.**

---

## What "sniffer-readable" proved and didn't prove

Mike wrote: *"i can read the plc from a sniffer and the vfd from a
sniffer."* This needs disambiguation because the two interpretations
have very different diagnostic value:

| Interpretation | What it proves | What it doesn't prove |
|---|---|---|
| **A. Passive bus sniff** — USB-RS485 adapter tapped onto the bus, listening only, while PLC polls and GS10 normally replies | PLC is transmitting on RS-485 (very strong evidence). GS10 hears or doesn't hear (visible if it replies). This is what § 8 of the runbook prescribes. | — |
| **B. Independent master tests** — USB-RS485 adapter acts as master to query each device separately (GSoft → GS10; some Modbus tool → PLC over Ethernet TCP) | GS10 RS-485 transceiver alive + cable/wiring fine. PLC TCP server alive on Ethernet. | **Nothing about whether the PLC transmits on its own RS-485 port.** Both tests can pass while the PLC has never sent a single frame. |

If you've done (A), the PLC is definitely transmitting and the bug is
"VFD doesn't accept frame" or "PLC discards VFD's reply" — application-
layer or framing. If you've done (B), we don't actually know whether
the PLC is transmitting at all yet; the bug could still be silent-PLC.

**Action:** before chasing code, do a real (A) — passive sniff with the
adapter on the bus while the PLC polls. `python plc/rs485_sniff.py`
exists for this. If you see frames like `01 03 21 03 00 04 4E F6`,
PLC is transmitting. If you see silence, PLC is silent and we look at
driver/channel/download.

---

## Re-ranked suspects (with citations where I have them)

### P0-A. CCW Serial Port driver may not be set to "Modbus RTU Master"

This is the single most common Micro 820 RTU-master failure on the
forums I searched. The CCW project's Device Configuration → Controller
→ Serial Port → **Driver** dropdown must be **"Modbus RTU"**, and the
**Modbus Role** dropdown (or equivalent) must be **"Master"**. If
either is wrong, MSG_MODBUS calls execute in software but transmit
nothing.

**Evidence:** the GS10_Integration_Guide.md in this repo (Mike's own
write-up) at § "PLC Serial Port Configuration (CCW)" lists the
required values:

```
Driver:        Modbus RTU
Baud Rate:     9600
Parity:        None
Modbus Role:   Master
Media:         RS485
Control Line:  No Handshake
Data Bits:     8
Stop Bits:     2
```

**Action:** in CCW, open Device Configuration → Micro820 → Serial
Port. Confirm every field above. If any differs, fix and re-download
(the historical CCW "embedded serial out of sync" gotcha — see
`RESUME_VFD_COMMISSIONING.md` in this repo).

### P0-B. The CCW download may have silently skipped the serial port config

Historical blocker per `RESUME_VFD_COMMISSIONING.md`: CCW pops
*"embedded serial in the project and controller are out of sync"* and
silently fails the serial config transfer when the TCPIPObject part
of the download fails. ST runs (heartbeat toggles, state machine
works), but MSG blocks never transmit because the underlying driver
isn't loaded.

**Action:** download via **USB** instead of Ethernet. In the Download
dialog, expand the tree and confirm *Serial Port* is listed and
checked. Confirm CCW reports "Download successful," not "completed
with errors." Cycle PLC mode Program → Run. Then run
`python plc/vfd_diag.py --once` — if `vfd_poll_step` is now cycling
where it was 0 before, that was the bug.

### P0-C. READDATA scalar landmine in `GlobalVariable.rtc`

Per the 2026-05-23 PR #6 review (in this repo at
`docs/cowork/2026-05-23_mira-plc-pr6-review-RESPONSE.md`):
```
$ strings GlobalVariable.rtc | grep -iE 'READ_?DATA|read_data'
read_data
READDATA
```
The scalar `READDATA` is still declared alongside the array
`read_data`. CCW's case-insensitive symbol lookup may resolve them
to the same identifier, with undefined behavior depending on which
the compiler picks first. The reviewer found that the compiled `.ic`
points at the array — so this may not be the *current* bug, but it's
a landmine for future edits.

**Action:** open CCW Global Variables, find `READDATA` (case-insensitive
search), delete it. Verify with `strings GlobalVariable.rtc | grep -iE
'READDATA'` → empty.

### P0-D. Channel value — verify what's actually on the bench

The 2080-LC20-20QBB embedded RS-485 port is **Channel 2** per weight
of evidence (multiple secondary sources including Mike's own
GS10_Integration_Guide.md; v4.1.7 produced valid TX with this value
per PR #6). v4.1.8 set Channel := 0 (regression). v4.1.9 reverted
to 2.

**Action:** in CCW, open `Prog_init.stf` and search for
`local_cfg.Channel`. Confirm every assignment is `:= 2`. If you see
`:= 0` anywhere, change to `2` (or vice versa if you have evidence
that `0` worked on this firmware rev — but `2` is the canonical value
for this controller family).

### P1-A. TriggerType = 0 means rising-edge

Per the Rockwell MSG_MODBUS2 docs (and by analogy MSG_MODBUS):
*"Output Q cannot be used to re-trigger the instruction because IN is
edge triggered."* TriggerType=0 means the IN input must transition
FALSE→TRUE to re-fire. The v4.1.9 ST does this correctly
(`vfd_poll_active` goes FALSE between cycles), but if the bench code
holds IN high continuously, the MSG never re-fires.

**Action:** confirm bench code has a `vfd_poll_active := FALSE` after
each `.Q` or `.Error`, OR uses an explicit edge-detection. If the IN
stays high across multiple scans without going low, the MSG won't
re-fire.

### P1-B. LocalAddr must be `MODBUSLOCADDR` (125-word array), not scalar

Per the Rockwell MSG_MODBUS2 docs (and MSG_MODBUS uses the same
LocalAddr type):
> "MODBUSLOCADDR data type is a 125 Word array. LocalAddr usage:
> For Read commands, store the data (1-125 words) returned by the
> Modbus slave. For Write commands, buffer the data (1-125 words)
> to be sent to the Modbus slave."

`populate_variables.py` declares `read_data`, `write_cmd_data`, and
`write_freq_data` as `T_MODBUSLOCADDR = 22` — correct array type.

If the bench has any MSG block whose LocalAddr is wired to a scalar
(like the `READDATA` landmine), that MSG will fail because the
firmware tries to write 1-125 words into a 1-word storage.

### P2-A. `populate_variables.py` is v3.1, missing v4.x variables

The .py script declares only the v3.1 variable set: 23 BOOLs, 19 INTs,
5 TONs, 3 MSG instances, 3 LOCAL + 3 TARGET configs, 3 data arrays.

The v4.1.9 ST adds: `fault_reset_data` (data array), `mb_fault_reset`
(MSG instance), `fault_reset_local_cfg` / `fault_reset_target_cfg`
(plus an entire 5th block for `read_status_word`), plus 18 new
diagnostic variables (`e_stop_ok`, `last_msg_error_id`, error
counters, etc.).

**If you ever re-run `populate_variables.py` against the bench
PrjLibrary.accdb, it WILL DELETE every v4.x addition** (look at
its `DELETE FROM Symbols WHERE Name NOT LIKE '__SYSVA%' AND Name
NOT LIKE '_IO_EM%'` line — that nukes every user variable, then
re-inserts only the v3.1 list).

**Action:** don't re-run that script. If you need to bulk-import v4.x
variables, update the script first.

### P2-B. `Prog2.stf` v5.0.0 header comment says Channel 0 — wrong

Line 12 of `MIRA/plc/Prog2.stf`: *"Channel 0 = built-in RS-485
(confirmed Rockwell docs)."* That comment is the v4.1.8 regression
resurfacing. If anyone reads it as authoritative and trusts it, the
bug returns.

**Action:** fix the comment to read Channel 2 (or delete the comment).

---

## What to actually do at the panel

Before any more code reading, capture the ground truth with two
30-second tests. Each answers a different question.

### Test 1: Is the PLC transmitting on RS-485?

```bash
pip install pyserial pymodbus
python plc/rs485_sniff.py /dev/tty.usbserial-XXXX --seconds 30
```

While that's running, the PLC must be in Run mode polling. With cable
landed normally PLC ↔ GS10. If you see frames like `01 03 21 03 00 04
4E F6` → PLC IS transmitting. Go to Test 2. If silence for 30s → PLC
is NOT transmitting. Go to § P0-A and § P0-B.

### Test 2: Is the GS10 replying?

Same sniff, but watch for both query AND reply frames:
- Master query (PLC → GS10): `01 03 21 03 00 04 4E F6`
- Good slave reply (GS10 → PLC): `01 03 08 00 00 00 00 00 00 01 50 …`
- Exception reply (GS10 → PLC): `01 83 XX YY YY` (e.g. `01 83 02 C0 F1`
  for Illegal Data Address)

If you see master+reply pairs → comms is bidirectional, the bug is in
how the PLC interprets the reply (LocalAddr buffer, scale, endianness).

If you see master queries but no replies → GS10 isn't accepting the
frame. Could be address (`Target.Node` mismatch with `P09.00`), could
be turnaround timing (`P09.05` too short), could be the GS10 in fault
state (check keypad for F30 / CE10).

If you see master queries that look mangled (wrong CRC, wrong slave
addr) → the PLC's serial port config is wrong. Re-check § P0-A.

---

## What I couldn't review

I do NOT have:
- `MIRA_PLC/Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/Prog_init.stf`
- `MIRA_PLC/Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/GlobalVariable.rtc`
- The CCW Device Configuration → Serial Port settings as actually
  loaded on the bench PLC (only what the .py and .st files prescribe)

If you (or the next Claude session) can paste those into a chat,
the analysis can be much more concrete.

---

## Sources

- **MSG_MODBUS (serial RTU):**
  [Allen-Bradley Micro800 General Instructions Manual page 197 (ManualsLib)](https://www.manualslib.com/manual/1225046/Allen-Bradley-Micro800.html?page=197) —
  "MSG_MODBUS sends a Modbus message over a serial port"
- **MSG_MODBUS2 (Ethernet TCP):**
  [Rockwell FactoryTalk Design Workbench Help — MSG_MODBUS2 (MODBUS/TCP message)](https://www.rockwellautomation.com/en-ie/docs/factorytalk-design-workbench/1-00-00/ftdw-help-ditamap/micro800-controller/micro800-instruction-set/messaging-instructions/msg_modbus2.html) —
  "The MSG_MODBUS2 instruction sends a MODBUS/TCP message over an Ethernet Channel"
- **MSG_MODBUS2 page 205 (proof MSG_MODBUS2 is distinct from MSG_MODBUS):**
  [Allen-Bradley Micro800 General Instructions Manual page 205 (ManualsLib)](https://www.manualslib.com/manual/1225046/Allen-Bradley-Micro800.html?page=205)
- **Modbus error codes (both MSG_MODBUS and MSG_MODBUS2):**
  [Allen-Bradley Micro800 General Instructions Manual page 199 (ManualsLib)](https://www.manualslib.com/manual/1225046/Allen-Bradley-Micro800.html?page=199) +
  [Modbus2 Error Codes page 208 (ManualsLib)](https://www.manualslib.com/manual/1225046/Allen-Bradley-Micro800.html?page=208)
- **MODBUSLOCPARA data type (Channel field semantics):**
  [Allen-Bradley Micro800 General Instructions Manual page 200 (ManualsLib)](https://www.manualslib.com/manual/1225046/Allen-Bradley-Micro800.html?page=200)
- **Micro820 user manual (serial port, Modbus mapping):**
  [Allen-Bradley Micro820 User Manual — Modbus RTU + CIP Serial section (ManualsLib)](https://www.manualslib.com/manual/3038756/Rockwell-Automation-Allen-Bradley-Micro820.html?page=61) +
  [Modbus Mapping For Micro800 Controllers page 103 (ManualsLib)](https://www.manualslib.com/manual/3366788/Rockwell-Automation-Allen-Bradley-Micro820.html?page=103)
- **Reference manual PDF (Rockwell Automation Publication 2080-RM001):**
  [Micro800 Programmable Controllers General Instructions Reference Manual PDF (SIU)](https://www.engr.siu.edu/staff/spezia/NewWeb438B/labs/2080-rm001_-en-e.pdf)
- **Micro820 user manual PDF:**
  [User Manual — Micro820 Programmable Controllers (sonicautomation.co.th)](https://sonicautomation.co.th/wp-content/uploads/2019/12/RA_Micro820-User-Manual.pdf)
- **Rockwell Knowledgebase (MSG_MODBUS / MSG_MODBUS2 error codes):**
  [Rockwell Automation answer 732566](https://support.rockwellautomation.com/app/answers/answer_view/a_id/732566/~/micro800-controllers:-msg_modbus-and-msg_modbus2-error-codes-)
- **Rockwell Knowledgebase (Micro800 Modbus support overview):**
  [Rockwell Automation answer 1062184](https://support.rockwellautomation.com/app/answers/answer_view/a_id/1062184/~/micro800-controllers-modbus-support-)
- **PLCtalk threads — practical Micro 820 RTU master commissioning:**
  - [Problems with Micro820 communication as Modbus RTU Master (PLCtalk)](https://www.plctalk.net/forums/threads/problems-with-micro820-communication-as-modbus-rtu-master.138540/)
  - [Micro 820 serial communication (PLCtalk)](https://www.plctalk.net/forums/threads/micro-820-serial-communication.125311/)
  - [Problems with Modbus Serial on Micro820 controller (PLCtalk)](https://www.plctalk.net/forums/threads/problems-with-modbus-serial-on-micro820-controller.133604/)
  - [Allen Bradley Micro820 - 2080-LC20-20QWB - and Modbus RTU (PLCtalk)](https://www.plctalk.net/forums/threads/allen-bradley-micro820-2080-lc20-20qwb-and-modbus-rtu.145708/)
- **In-repo references:**
  - `plc/GS10_Integration_Guide.md` § PLC Serial Port Configuration
  - `plc/RESUME_VFD_COMMISSIONING.md` — historical CCW serial-port sync blocker
  - `docs/cowork/2026-05-23_mira-plc-pr6-review-RESPONSE.md` — PR #6 reviewer findings (READDATA landmine, address typo)
