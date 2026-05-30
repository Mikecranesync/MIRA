# Conv_Simple_1.6 — Changelog

Target: `MIRA_PLC` private repo, new branch `conv_simple_1.6` off
`bench/2026-05-23-conv-simple-1.4-stalled`.

Companion review: `docs/evaluations/conveyor-st-code-review-2026-05-24.md`
in the MIRA repo (commit `12fe0b5c`). Findings F1–F9 below match that
review's labelling.

This folder is the **drafts** for the v1.6 commit. The actual `.rtc`
binary regeneration happens in CCW after the human applies
`GlobalVariable.md` against the Controller Variables table. The three
deliverables here are the **source-of-truth artifacts**:

```
plc/Conv_Simple_1.6/
├── Prog_init.stf      ← drop into Conv_Simple_1.6/Controller/Controller/<POU>/
├── GlobalVariable.md  ← apply by hand to CCW Controller Variables table
├── MbSrvConf.xml      ← drop into Conv_Simple_1.6/Controller/Controller/
└── CHANGELOG.md       ← this file
```

## What v1.6 fixes (relative to v1.4)

| ID | Severity | Fix | Where |
|----|----------|-----|-------|
| F1 | P2 | **Retracted as a P0 type bomb.** `MSG_MODBUS` IS the RTU FB on Micro 800 family (per Rockwell 2080-RM001 and commit `b591fe47` 2026-05-25 retraction). v1.4's binding was already correct on the type axis. v1.6's actual F1 work: rename instance `READ_mODBUS` → `mb_read_monitor`; confirm cfg structs are `MSG_MODBUS_LOCAL` / `MSG_MODBUS_TARGET` (NOT the TCP `MSGMODBUSPARA_*`). See memory `feedback_msg_modbus_fb_types.md`. | `GlobalVariable.md` §1 |
| F2 | P1 | Read register `0x2101` → `0x2100` (drive Status Word, not Freq Cmd readback). ElementCnt 1 → 4 so one poll reads status + freq + current. | `Prog_init.stf` §2 |
| F3 | P0 | Serial framing locked to KB canonical: PLC port 19200 8-E-1 RTU master; GS10 `P09.00=1 / P09.01=2 / P09.04=4`. Not in ST — CCW serial-port properties + GS10 keypad. | `GlobalVariable.md` §8 |
| F4 | P1 | `READDATA` scalar landmine deleted. Only `read_data` ARRAY[1..125] OF UINT remains. | `GlobalVariable.md` §1 + §7 |
| F5 | P2 | All v3-lineage dead instances and dead vars deleted (see §7 of `GlobalVariable.md`). | `GlobalVariable.md` §7 |
| F6 | P2 | `ReadLocalAddress` dead var deleted. | `GlobalVariable.md` §7 |
| F7 | P2 | Instance renamed `READ_mODBUS` → `mb_read_monitor` (canonical). | `Prog_init.stf` §6, `GlobalVariable.md` §1 |
| F8 | P3 | MSG_MODBUS timeout sourced from CCW serial-port "Response timeout" (1000 ms), not from an ST struct member. | `GlobalVariable.md` §8 |
| F9 | P3 | Mixed-case `HEARTBEATTMR` / `HeartbeatTmr` collapsed to `HeartbeatTmr`. | `GlobalVariable.md` §2 |

## What v1.6 *adds* (new feature surface beyond bug-fix)

Conv_Simple_1.4 was Phase 0 — heartbeat-read only. The conveyor could
not actually run from PLC software because nothing wrote to `0x2000` /
`0x2001`. v1.6 closes that loop:

- **WRITE step 2** — `mb_write_cmd` writes `CmdWord` to `0x2000`
  (1=stop, 18=fwd+run, 20=rev+run, 34=fault-reset) when
  `WriteCmdPending` is TRUE.
- **WRITE step 3** — `mb_write_freq` writes `FreqSetpoint` to `0x2001`
  (Hz × 100) when `WriteFreqPending` is TRUE.
- **`commissioning_mode` feature flag** — when TRUE, both write steps
  are gated off and only the read step fires. Lets you prove
  bidirectional comms before commanding the drive. Default FALSE.
- **`PollStep` scheduler** — replaces the v1.4 unconditional read with
  a 3-step round-robin (read / write-cmd / write-freq). Skip logic
  bypasses write steps when no command is pending.
- **Status-word decode** — `VfdRunning` / `VfdAtSpeed` / `VfdFault` /
  `VfdCommCtrl` BOOLs derived from `ReadStatusWord`, exposed over the
  Modbus TCP server so the MIRA bridge gets clean booleans instead of
  raw bits.
- **`CommFault` watchdog** — TRUE when > 10 ticks (5 s @ 500 ms)
  elapse without a successful read. Phase 2 will wire this to the
  ladder fault chain.
- **Diagnostic counters per step** — `ReadErrCount`,
  `WriteCmdErrCount`, `WriteFreqErrCount`, `LastReadErrStep`,
  `LastWriteErrID`. Tells you *which* step is failing.
- **Populated `MbSrvConf.xml`** — v1.4 had an empty
  `<modbusServer Version="2.0"/>`. v1.6 maps 8 coils + 14 holding
  registers so MIRA bridge / `tools/live_monitor.py` / `vfd_diag.py`
  can read live state over Modbus TCP without touching CCW.

## What v1.6 deliberately does NOT do

- **No ladder logic changes.** `Prog1.stf` (E-stop + start + lights)
  is fine — the v1.4 review confirmed it. Carry it forward unchanged.
  v1.6 only touches the Modbus POU.
- **No state machine.** Conv_Simple stays simple — no IDLE / STARTING
  / RUNNING / STOPPING / FAULT case statement. That belongs in the
  parallel MIRA/plc/ v4.1.x → v5.0 lineage, not here.
- **No fault-reset auto-retry.** A fault-reset write fires only when
  the ladder (or the HMI) sets `CmdWord = 34` and `WriteCmdPending`.
  No auto-loop.
- **No `0x2104` DC-bus read.** ElementCnt is 4 (0x2100..0x2103) for
  this version. Phase 2 raises to 5.

## Verification sequence

After applying the drafts in CCW:

### Phase A — F3 first (cheapest physical-layer test)

1. GS10 keypad: read `P09.00` / `P09.01` / `P09.04`. Confirm
   `1 / 2 / 4`. Adjust + power-cycle if not.
2. CCW: Project → Micro820 → Embedded Serial Port → Properties →
   19200 8 Even 1 RTU Master, Media RS-485, Resp Timeout 1000 ms.
3. Build (Ctrl+Shift+B). Expect 0 errors. Download.
4. Sniffer should now show 19200 8-E-1 frames.

### Phase B — F1 + F2 + F4

5. CCW: Controller Variables → confirm:
   - `mb_read_monitor` row Data Type = `MSG_MODBUS` (the RTU FB —
     NOT `MSG_MODBUS2`, which is TCP).
   - `ReadLocalParam` row Data Type = `MSG_MODBUS_LOCAL`.
   - `ReadTargetParam` row Data Type = `MSG_MODBUS_TARGET`.
   - `READDATA` (scalar) is gone.
6. Set `commissioning_mode := TRUE` via online edit (or rebuild with
   the initial value set TRUE in the Controller Variables table).
7. PLC in Run. Watch in CCW:
   - `HeartbeatTick` pulses at 2 Hz.
   - `PollCount` increments.
   - `PollStep` stays at 1 (commissioning gate forces it).
   - `mb_read_monitor.Q` pulses; `ReadOK` = TRUE; `ReadError` = FALSE;
     `ReadStatusWord` ≠ 0 (a real drive status, since GS10 always has
     bit 8 / bit 11 set when in comm-control mode); `ReadErrCount` = 0.
8. If `mb_read_monitor.Error` latches: read `ReadErrorID`.
   `55` = no reply / timeout — re-check Phase A.
   `53` = CRC — framing still wrong.
   `56` = illegal function — wrong FB type bound (likely `MSG_MODBUS2`
   selected, which transmits on Ethernet not RS-485); confirm
   `mb_read_monitor` type is `MSG_MODBUS` per Section 1 of
   `GlobalVariable.md`.

### Phase C — Write path

9. Set `commissioning_mode := FALSE`.
10. Set `FreqSetpoint := 1500` (15.00 Hz) and `WriteFreqPending := TRUE`
    via online edit. Within one poll cycle (500 ms), expect:
    - `mb_write_freq.Q` pulses.
    - `WriteFreqPending` clears back to FALSE.
    - `WriteFreqOkCount` increments.
    - GS10 keypad shows new freq setpoint.
11. Set `CmdWord := 18` (FWD+RUN) and `WriteCmdPending := TRUE`. Same
    way. **Drive should spin at 15 Hz.**
12. Set `CmdWord := 1` (STOP) and `WriteCmdPending := TRUE`. Drive
    ramps down per GS10 deceleration parameter.

### Phase D — TCP server map

13. From CHARLIE: `python tools/live_monitor.py --host <PLC_IP>`
    should now report `VfdRunning`, `VfdAtSpeed`, `OutputFrequency`,
    `OutputCurrent`. Use the layout in this folder's `MbSrvConf.xml`.

## Promotion

After Phase A–D all pass:

```bash
# in the MIRA_PLC repo (private, off this filesystem)
git checkout -b conv_simple_1.6 bench/2026-05-23-conv-simple-1.4-stalled
# copy Conv_Simple_1.6/* over Conv_Simple_1.4/* equivalents
# rebuild in CCW to refresh the .rtc files
# commit, push, tag
git tag bench/$(date +%Y-%m-%d)-conv-simple-1.6-verified
```

Update PR #7 (draft) with the new bench tag and close issue #9 if the
post-demo retro stub is fully addressed.
