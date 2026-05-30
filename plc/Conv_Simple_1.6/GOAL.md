# GOAL — Finish & promote Conv_Simple_1.6 (Micro 820 ↔ GS10, Modbus RTU)

> **DIRECTION LOCK-IN — read before touching anything.** On the Micro 800 family
> (Rockwell 2080-RM001): **`MSG_MODBUS` = RTU (serial / RS-485)**,
> **`MSG_MODBUS2` = TCP (Ethernet)**. The "2" means TCP, not "version 2." This was
> inverted in the 2026-05-24 review (`12fe0b5c`) and retracted in `b591fe47`
> (2026-05-25). It has been re-inverted 3×. The GS10 is on RS-485 → every Modbus
> instance here is `MSG_MODBUS`. Do **not** "upgrade" any of them to `MSG_MODBUS2`.
> Memory: `feedback_msg_modbus_fb_types.md`.

## What this is

Phase 1 control program for the conveyor bench: an Allen-Bradley **Micro 820
(2080-LC20-20QBB)** mastering an **AutomationDirect GS10 DURApulse VFD** (RTU
slave 1) over the embedded RS-485 port. Phase 0 (v1.4) was heartbeat-read only —
the drive could not be commanded. v1.6 closes the loop: it **reads** the GS10
status block and **writes** command word + frequency setpoint, with a
`commissioning_mode` flag that disables writes so bidirectional comms can be
proven read-only first.

## Current state (where you're starting)

Drafts are committed at `f7225a60` (branch `feat/uns-node-knowledge`) in
`plc/Conv_Simple_1.6/`:

| File | What it is | What to do with it |
|------|-----------|--------------------|
| `Prog_init.stf` | The ST POU (read step + 2 write steps + scheduler + watchdog) | Drop into the CCW POU |
| `GlobalVariable.md` | Human-readable Controller Variables spec (types, deletes, serial settings) | Apply **by hand** to CCW Global Variables table, then rebuild |
| `MbSrvConf.xml` | Modbus TCP **server** map (8 coils + 14 holding regs) for the MIRA bridge | Drop into the Controller folder |
| `CHANGELOG.md` | Findings F1–F9 + full verification sequence + promotion recipe | Your reference; quote it, don't duplicate it |

Nothing has been applied in CCW yet. No bench run has happened. No `MIRA_PLC`
promotion exists.

## THE GOAL (definition of done — all four must be true)

1. **Drafts applied in CCW**: `Prog_init.stf` + `MbSrvConf.xml` imported, the
   Controller Variables table matches `GlobalVariable.md` exactly, every variable
   in its Section 7 "DELETE" list is gone, project builds with **0 errors**.
2. **Phases A–D pass on the physical bench** with the observable evidence below.
3. **Promoted** to the private `MIRA_PLC` repo on branch `conv_simple_1.6` with the
   regenerated `.rtc` binaries committed and tagged
   `bench/<date>-conv-simple-1.6-verified`.
4. **Tracking closed**: PR #7 (draft) updated with the bench tag; issue #9 closed
   if its post-demo retro stub is addressed.

> Evidence-only completion (Cluster Law 1): "I applied it" is not done. Each gate
> below names a concrete value to read off the CCW watch table, the GS10 keypad, or
> `tools/live_monitor.py`. Record the actual numbers.

## Acceptance gates (run in order — cheapest physical-layer test first)

### Phase A — serial framing (F3)
- GS10 keypad reads `P09.00=1`, `P09.01=2`, `P09.04=4` (also confirm `P09.03=5`,
  `P00.21=2`). Power-cycle the GS10 after any P09.xx change.
- CCW → Micro820 → Embedded Serial Port → Properties: **Modbus RTU Master, 19200,
  8, Even, 1, RS-485, Resp Timeout 1000 ms**.
- Build (0 errors) + download. **PASS** = a bus sniffer shows 19200 8-E-1 frames.

### Phase B — read path + FB types (F1 / F2 / F4), commissioning_mode = TRUE
- Controller Variables confirm: `mb_read_monitor` type = `MSG_MODBUS` (NOT
  `MSG_MODBUS2`); `ReadLocalParam` = `MSG_MODBUS_LOCAL`; `ReadTargetParam` =
  `MSG_MODBUS_TARGET`; scalar `READDATA` is gone; `read_data` is
  `ARRAY[1..125] OF UINT`.
- Set `commissioning_mode := TRUE`, PLC in Run. **PASS** =
  `HeartbeatTick` pulses ~2 Hz · `PollCount` increments · `PollStep` pinned at 1 ·
  `mb_read_monitor.Q` pulses · `ReadOK=TRUE` · `ReadError=FALSE` ·
  `ReadStatusWord ≠ 0` · `ReadErrCount=0`.
- If `mb_read_monitor.Error` latches, read `ReadErrorID`:
  `55`=timeout (re-check Phase A) · `53`=CRC (framing) · `56`=illegal function
  (wrong FB type — you almost certainly bound `MSG_MODBUS2`; fix per the lock-in).

### Phase C — write path, commissioning_mode = FALSE
- `FreqSetpoint := 1500` + `WriteFreqPending := TRUE` → within ~500 ms:
  `mb_write_freq.Q` pulses · `WriteFreqPending` clears · `WriteFreqOkCount`
  increments · GS10 keypad shows the new setpoint.
- `CmdWord := 18` (FWD+RUN) + `WriteCmdPending := TRUE` → **drive spins at 15 Hz.**
- `CmdWord := 1` (STOP) + `WriteCmdPending := TRUE` → drive ramps down.

### Phase D — TCP observability
- From CHARLIE: `python tools/live_monitor.py --host <PLC_IP>` reports
  `VfdRunning`, `VfdAtSpeed`, `OutputFrequency`, `OutputCurrent` consistent with the
  drive's actual state, using this folder's `MbSrvConf.xml` layout.

## Watch these while bench-testing (likely failure points, not yet bench-proven)

- **Re-trigger-while-busy.** `MSG_MODBUS` is async (edge-trigger, `TriggerType:=0`)
  and a reply can take up to the 1000 ms timeout, but in `commissioning_mode` the
  read step fires every 500 ms. If you see intermittent `ReadError`/`ErrorID 2`-class
  faults or dropped polls, the heartbeat is out-pacing message completion — gate the
  next trigger on the instance being idle (e.g. only fire when `NOT mb_read_monitor.Q
  AND NOT mb_read_monitor.Error` from the prior cycle, or lengthen `PT`). Flag it;
  don't silently paper over it.
- **Status-word bit decode.** `Prog_init.stf` Section 7 derives `VfdRunning` (bits
  0–1 = `0x0003`), `VfdAtSpeed` (bits 2–3 = `0x000C`), `VfdFault` (bit 7 = `0x0080`),
  `VfdCommCtrl` (bit 11 = `0x0800`). The header comment lists slightly different bit
  positions for direction/at-speed. **Validate the masks against the GS10's real
  status word** (force known drive states, read `ReadStatusWord`, confirm each BOOL).
  Correct the masks if the live bits disagree — the comment is a guess until proven.
- **DC-bus voltage is deferred.** `ElementCnt = 4` (reads `0x2100..0x2103`); `0x2104`
  (DC bus) is Phase 2. Don't add it here.
- **Ladder untouched.** `Prog1` (E-stop / start / lights) carries forward unchanged.
  v1.6 only touches the Modbus POU. No state machine, no fault-reset auto-retry.

## Promotion recipe (only after A–D all pass)

```bash
# in the MIRA_PLC repo (private, not on this filesystem)
git checkout -b conv_simple_1.6 bench/2026-05-23-conv-simple-1.4-stalled
# copy Conv_Simple_1.6/* over the Conv_Simple_1.4/* equivalents
# rebuild in CCW so the .rtc binaries regenerate, then commit them
git tag bench/$(date +%Y-%m-%d)-conv-simple-1.6-verified
git push --tags
```
Then update **PR #7** (draft) with the new bench tag and close **issue #9** if its
post-demo retro stub is fully addressed.

## Verify the `.rtc` after the CCW rebuild
```bash
strings GlobalVariable.rtc | grep -iE 'MSG_MODBUS|MSGMODBUSPARA|READDATA|read_data'
# MUST contain:    MSG_MODBUS  MSG_MODBUS_LOCAL  MSG_MODBUS_TARGET  read_data
# MUST NOT contain: MSG_MODBUS2  MSGMODBUSPARA_LOCAL  MSGMODBUSPARA_TARGET  READDATA
```

## Pointers
- Drafts: `plc/Conv_Simple_1.6/` — `CHANGELOG.md` has the F1–F9 fix matrix and the
  authoritative Phase A–D sequence; `GlobalVariable.md` has the full variable table,
  the Section 7 delete list, and the Section 8 serial/keypad settings.
- Code review this fixes: `docs/evaluations/conveyor-st-code-review-2026-05-24.md`
  (commit `12fe0b5c`) and its retraction `b591fe47`.
- Lock-in memory: `feedback_msg_modbus_fb_types.md`.
- GS10 register map + bit field: header comment block in `Prog_init.stf`.
