# Claude Driver Brief — RS-485 Bench Diagnosis (Micro 820 ↔ GS10)

> **You are taking over an in-progress diagnosis of a Modbus RTU bench
> link between a Micro 820 PLC and a GS10 DURApulse VFD.** Mike is at
> the panel with hands on hardware. Your job is to drive the diagnosis
> interactively: give him ONE test at a time, wait for the result, interpret,
> next test. Do not hand him a wall of documentation and expect him to
> read it. The reference runbook (`plc/RS485_TROUBLESHOOTING_RUNBOOK.md`)
> is for citing into, not for dumping.

## Who you're working with

- **Mike** — FactoryLM founder, MIRA PM. Knows industrial maintenance,
  not Python. At the bench panel right now, can run shell commands and
  observe LEDs / VFD keypad.
- He has direct hardware access. You don't. Everything goes through him.

## The hardware

- **PLC:** Allen-Bradley Micro 820 2080-LC20-20QBB at ~`169.254.32.93`
  (verify with him).
- **VFD:** AutomationDirect GS10 DURApulse on RS-485 Modbus RTU,
  slave addr 1, 9600 8N2, P00.21=2 (RS-485 run source).
- **Cable:** runs from Micro 820 D+/D-/G to GS10 RJ45 pins 5/4/3.
- **Bench code:** in the `MIRA_PLC` GitHub repo, project
  `Conv_Simple_1.4`, file
  `Controller/Controller/Micro820/Micro820/Prog_init.stf`.
- **NOT the bench code:** anything in *this* repo's `plc/` directory.
  That's a parallel reference lineage (`Micro820_v4.1.x_Program.st`).
  Don't confuse the two.

## Suspect chain (state coming in)

The PR #6 review on 2026-05-23 narrowed the suspect list to (cheapest
first):

1. **A/B polarity inverted at the GS10 terminal block.** Mike's GSoft
   test on this same cable does NOT rule this out — different vendors
   flip A/B label conventions. The Micro 820 `D+` may not be the same
   polarity as the GS10 `SG+`.
2. **Missing fail-safe bias on the PLC side.** The Micro 820 embedded
   RS-485 port has no built-in bias network. Floating differential
   pair reads as `1010101…` to the GS10 receiver, which discards it.
3. **Common-mode / shield grounding.** PLC + GS10 on separate supplies
   without a shared signal ground can drift outside ±7 V common-mode.
4. **GS10 `P09.05` response delay too short.** Default = 0 (immediate).
   Micro 820 has no auto-RTS; GS10 reply starts inside PLC's
   TX-release window → half-duplex collision.
5. **Baud rate.** Already at 9600 in the project, but worth verifying.

**Only after all five → 2080-SERIALISOL isolator card.** The PR #6
reviewer was explicit that the $150 card was being recommended before
the $1 cheaper rungs were tested.

## What's ruled IN (don't re-test)

- Cable conductors intact (GSoft on same cable works).
- GS10 RS-485 transceiver alive (same evidence).
- GS10 baud / parity / slave addr OK (same evidence).
- PLC IS transmitting per PR #6 bench evidence (last symptom was
  ErrorID 55, which means bidirectional comms with GS10 rejecting the
  register address).

## What's NOT ruled in or out

- Polarity at the PLC end (see suspect #1).
- Bias network (see suspect #2).
- Common-mode (see suspect #3).
- Turnaround timing (see suspect #4).
- Current symptom — `vfd_diag.py --once` will tell you. Don't assume
  the symptom is what PR #6 saw; it might have changed.

## Known landmines (orthogonal to comms, fix anyway)

- `READDATA` scalar still declared in
  `MIRA_PLC/Conv_Simple_1.4/.../GlobalVariable.rtc` despite PR #6's
  rename of call sites. Future writes to `READDATA` will silently
  target wrong storage. Delete via CCW Global Variables table; verify
  `strings GlobalVariable.rtc | grep -iE 'READDATA'` → empty.
- `Prog_init.stf` polls `T#500ms`; doc says `200 ms`. Pick one.
- PR body says status word reg `0x2100`; code is `16#2101`. Code is
  right; fix the PR body.

## How to drive the session

### Test 1 — environment sanity (1 min)

```bash
pip install pyserial pymodbus
```

Ask Mike for:
1. Exact PLC IP (default `169.254.32.93` per the project; he may have
   changed it).
2. USB-RS485 adapter device path (`ls /dev/tty.* | grep -i usb` on
   macOS, `ls /dev/ttyUSB*` on Linux, COM-port name on Windows).

### Test 2 — establish current symptom (1 min)

```bash
python plc/vfd_diag.py --once --host <IP>
```

Read FOUR fields (in this priority order):
1. `vfd_poll_step` — 0 = code not running VFD section (jump to runbook §3);
   cycling 1→2→3→4(→5) = polling fine
2. `vfd_comm_ok` — TRUE = at least one read succeeded
3. `vfd_dc_bus` — > 0 V = real reply from drive (proves bidirectional)
4. `error_code` — 9 = comm watchdog fired

State the current symptom plainly back to Mike, e.g.:
> "PLC is polling (step cycles 1→2→3→4), but `vfd_comm_ok = FALSE` and
> `vfd_dc_bus = 0`. That means frames are going out but no replies are
> coming back, or replies are corrupt. We try cheapest physical fix first."

### Test 3 — § 2a polarity swap (30 sec, $0)

Before reaching for the sniffer. This is the single cheapest test and
the highest-prior hypothesis given the GSoft-works-on-cable data.

Instruct Mike:
1. Open Q1 contactor (safety — kills 3-phase to motor).
2. At the GS10 RJ45 terminal block, swap the two RS-485 conductors
   (SGND stays put).
3. Close Q1.
4. Run `python plc/vfd_diag.py --once`.

Outcome decides next move:
- `vfd_comm_ok = TRUE` → polarity was it. Leave swapped, run § 9 of
  runbook for sanity-check that values look sensible, commit a note in
  `MIRA_PLC` repo: which orientation works.
- Still FALSE → swap back to original (Mike's instinct may be right
  even though we tried), continue.

### Test 4 — § 2b bias + termination ($1, 5 min)

Walk Mike through installing:
- 120 Ω across SG+/SG- at GS10 end (probably already there; verify).
- 120 Ω across D+/D- at PLC end (probably NOT there).
- 4.7 kΩ pull-up D+ to +5 V (or +24 V via 47 kΩ).
- 4.7 kΩ pull-down D- to 0 V.

Re-run `vfd_diag.py --once`. Same outcome logic as Test 3.

### Test 5 — § 2c common ground (multimeter, $0)

Multimeter beep mode:
- PLC chassis ↔ GS10 chassis → must beep.
- PLC 0 V ↔ GS10 SGND (RJ45 pin 3) → must beep.
- With power on, DC volts PLC 0 V → GS10 SGND → must be < ±0.5 V.

If any of those fail → run a 14 AWG green wire between chassis ground
lugs. Re-test.

### Test 6 — § 2d P09.05 response delay

On the GS10 keypad: `MODE` → arrow to `P09.05` → set to `10` → `ENTER`.
No power-cycle needed. Re-test.

### Test 7 — § 8 bus sniff (last resort, definitive)

If § 2a–2d didn't fix it, this is the truth-teller.

1. Disconnect cable's VFD-end from the GS10 RJ45.
2. Land that end onto the USB-RS485 adapter (A → SG+ wire, B → SG-,
   GND → SGND if available).
3. PLC keeps polling.
4. `python plc/rs485_sniff.py /dev/tty.usbserial-XXXX`.

Interpretation:
- Zero bytes for 10 s → PLC is silent. § 3 (download integrity).
- PLC frames visible → at least the PLC side works. Reconnect VFD,
  re-sniff with `--seconds 30` and look for `01 03 …` master query
  paired with `01 03 08 …` reply or `01 83 02 …` exception.

## Rules for how you respond

- **One test at a time.** Don't list five tests and ask Mike to pick
  which to run. Send one, wait, interpret.
- **Tell Mike what to look for before he runs it.** "After this, tell
  me `vfd_comm_ok` and `last_msg_error_id`." Not "tell me what
  happened."
- **Interpret the result back in plain English** before moving on.
  Mike should never have to ask "OK so what does that mean?"
- **Cite into the runbook, don't restate it.** "Per § 2b, the Micro 820
  has no built-in bias, so we add 4.7 kΩ resistors at the PLC end."
- **When stuck, sniff.** Don't keep speculating — § 8 is decisive.
- **Update this brief and the runbook as you go.** If Test 3 reveals
  polarity was correct all along, edit § "What's ruled IN" of the
  brief and add a "Ruled OUT 2026-05-XX: polarity at PLC end (Mike
  swapped both ways, no change)" line. Next Claude shouldn't redo
  what you did.

## When to escalate up to Mike (not just back-and-forth)

- After § 2a–2d + § 8 sniff, if bus still won't come up: time to
  spend $150 on 2080-SERIALISOL. Tell Mike what's been ruled out
  and what the isolator card buys (isolated transceiver + built-in
  bias + clean direction control).
- If § 6 (ErrorID 55) — escalate the READDATA landmine because it
  could be poisoning the address.
- If the symptom is intermittent (some polls work, some fail):
  almost always bias or noise; § 2b + § 2c first.

## Files you'll touch

- `plc/RS485_TROUBLESHOOTING_RUNBOOK.md` — reference; cite into it.
- `plc/RS485_CLAUDE_DRIVER_BRIEF.md` — this file; update "ruled IN/OUT"
  as you confirm/eliminate hypotheses.
- `MIRA_PLC/Conv_Simple_1.4/.../Prog_init.stf` — only if you find a
  real ST-level bug. Coordinate with Mike on CCW IDE side.
- `MIRA_PLC/Conv_Simple_1.4/.../GlobalVariable.rtc` — delete the
  READDATA landmine via CCW Global Variables table (NOT by editing
  the binary file).

## Definition of done

The link is working when:
1. `vfd_comm_ok = TRUE` for ≥ 30 consecutive seconds.
2. `vfd_dc_bus` reads a plausible value (~300-340 V on 230 V class).
3. Writing `vfd_cmd_word = 18` (FWD+RUN) actually spins the motor and
   `vfd_frequency` reads back the commanded value (× 10).
4. Power-cycle the GS10, wait for it to reboot, comms re-establishes
   automatically within 10 s.
5. Run for 5 min continuous without an `error_code = 9` re-latch.

Then update this brief: move all five suspects from "NOT ruled out" to
"Ruled OUT 2026-05-XX: tested, link came up at step N."
