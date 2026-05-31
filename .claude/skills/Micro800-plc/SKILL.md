---
name: Micro800-plc
description: >-
  Author, review, and debug Structured Text / ladder programs for Allen-Bradley
  Micro800-family PLCs (Micro 820 / 850 / 870) — especially Modbus comms to a VFD
  such as the AutomationDirect GS10. Use this skill WHENEVER the work touches
  Micro800 PLC code, MSG_MODBUS / MSG_MODBUS2 function blocks, a GS10 (or other
  drive) Modbus RTU/TCP link, Connected Components Workbench (CCW), a conveyor /
  motor control state machine, a Modbus poll loop, or commissioning a drive — even
  when the user doesn't name the PLC explicitly. Triggers on phrases like "the GS10
  won't reply", "why is my MSG_MODBUS timing out", "write/fix the VFD comms POU",
  "Channel 0 vs 2", "ErrorID 55", "Conv_Simple", "read the drive status word",
  "set up Modbus RTU on the Micro 820", "commission the drive", or any ST/ladder
  edit under a `plc/` or MIRA_PLC tree. This codifies hard-won bench lessons (the
  MSG_MODBUS=RTU lock-in that has been inverted repeatedly, the GS10 register map,
  the poll-scheduler and COP write-buffer patterns) so we stop re-teaching ourselves
  the same Modbus facts. Do NOT use for read-only network/bus *discovery* — that's
  the `fieldbus-discovery` skill.
---

# Micro800 PLC programming (Micro 820 + GS10 over Modbus)

This skill carries the codified knowledge for **writing and debugging control code on
the Allen-Bradley Micro800 family** — primarily the Micro 820 (`2080-LC20-20QBB`)
talking Modbus RTU to an AutomationDirect **GS10 DURApulse** VFD on the conveyor bench,
plus the Modbus/TCP server it exposes for monitoring.

It exists because the same handful of facts kept getting re-derived (and re-inverted)
across sessions. The job here is to get them right the first time and to **verify the
volatile ones on the rig** rather than assert false precision.

## Scope — and the boundary with `fieldbus-discovery`

| Concern | Skill |
|---|---|
| **Authoring** ST / ladder, MSG_MODBUS config, poll loops, state machines, commissioning, CCW workflow | **this skill** |
| Read-only **scanning / identifying** what's on a network or RS-485 bus | `fieldbus-discovery` |

The read-only safety doctrine (a serial sweep can still fault-stop a motor; `--serial-bus-idle`
gate) lives in `.claude/rules/fieldbus-readonly.md` and the `fieldbus-discovery` skill —
**reference it, don't restate it.** This skill assumes you are the bus master writing the
control program, which is a different (and intentionally write-capable) job.

## ⛔ The one fact you must not get wrong: MSG_MODBUS = RTU

On the Micro800 family, per **Rockwell 2080-RM001**:

- **`MSG_MODBUS`** → Modbus **RTU** (serial / RS-485). Config structs `MSG_MODBUS_LOCAL` / `MSG_MODBUS_TARGET`.
- **`MSG_MODBUS2`** → Modbus **TCP** (Ethernet). Config structs `MSGMODBUSPARA_LOCAL` / `MSGMODBUSPARA_TARGET`.

The "2" denotes **TCP, not "version 2."** The GS10 is on RS-485, so its comms POU uses
**`MSG_MODBUS`**. This has been inverted at least three times in this project's history —
including in an older code-review doc (commit `12fe0b5c`) that was later retracted
(`b591fe47`). **If you find a MIRA doc claiming `MSG_MODBUS2 = RTU`, it is wrong; trust
this section and 2080-RM001.** See `references/msg-modbus-fb.md` for the full FB contract.

## The canonical control loop (how a Micro800↔VFD POU is shaped)

Every working version of the conveyor VFD POU follows the same skeleton. Read
`references/poll-scheduler-patterns.md` for the annotated pattern; the shape is:

1. **Self-retriggering heartbeat** — a `TON` driven by `IN := NOT t.Q` produces a one-scan
   pulse every `PT` (e.g. 500 ms). This is the master clock for the poll cycle.
2. **Round-robin step scheduler** — each heartbeat advances an integer `poll_step`
   (read → write-cmd → write-freq → [fault-reset] → [read-status]) and wraps. Write/optional
   steps are *skipped* when nothing is pending or when `commissioning_mode` is set.
3. **Edge-triggered MSG_MODBUS calls** — every instance exists every scan; exactly one has
   `IN := (poll_step = N) AND heartbeat_tick` true for a single scan. `TriggerType := 0`
   means the FB fires on the rising edge of `IN` — **never hold `IN` TRUE.**
4. **COP into the write buffer** — Modbus writes read from an `ARRAY[1..n] OF WORD`, not a
   scalar. A `COP`/`COP_FILE` block marshals the scalar command into `write_*_data[1]`
   before the write FB fires. See the COP signature in the reference.
5. **Capture `.Q` / `.Error` every scan** — success path stores `read_data[...]`, error path
   bumps a counter and (after a watchdog window) latches a comm fault. `.ErrorID` is **not
   reliably readable in ST on Micro820** — mirror `.Error` and track ErrorIDs via the
   instrumentation pattern in the reference.
6. **`commissioning_mode` write-disable** — a BOOL that masks every write step so you can
   prove bidirectional comms (reads succeeding) *before* the program is allowed to command
   the drive to move. Default FALSE. This is a safety-first commissioning gate, not a debug toggle.

The command word itself is gated by **E-stop / wiring-fault / contactor (MLC) state** before
it is ever written — the safety interlock is upstream of the Modbus write, never inside it.

## Volatile facts — VERIFY on the rig, don't hard-code from memory

These have legitimately differed across rigs, firmware revs, and codelines. State the
bench-proven default, then confirm against the actual device:

- **Serial channel number.** Bench-proven MIRA_PLC value is **`Channel := 0`** (matches
  `device-profiles/micro820.yaml`). The monorepo v4.x R&D lineage used `Channel := 2`. The
  CCW serial-port name for the embedded RS-485 port **varies across firmware revisions.**
  Symptom of the wrong channel: **zero TX activity on the wire.** Symptom of a channel that
  exists but was never configured: **`ErrorID 255`** (serial port config never downloaded —
  a CCW sync problem, *not* a wiring fault). If one value shows no traffic, try the other.
- **The 0x21xx monitor register meanings.** Anchor on the codified map in
  `references/gs10-register-map.md` (sourced from `device-profiles/gs10.yaml`). Note that
  MIRA's own code has *mislabeled* this block before (the `Prog_VFD.stf` POU labels
  `read_data[1]`@`0x2103` as the status word, while the device profile says `0x2103` =
  output frequency and the status word lives at `0x2100`/`0x2101`). **Verify the block you
  read against the GS10 manual before trusting variable names** — this is the F2 lesson.
- **Read `ElementCnt`.** Reading past the documented monitor block (`0x2103..0x2106`) has
  produced `ErrorID 55` (Illegal Data Address) on some firmware. Keep the count inside the
  documented block and confirm.

## Reference files (read the one that matches the task)

- **`references/msg-modbus-fb.md`** — MSG_MODBUS / MSG_MODBUS2 contract: config structs and
  every field (`Channel`, `TriggerType`, `Cmd`, `ElementCnt`, `Addr`, `Node`), function-code
  mapping (FC03 read / FC06 write-single), `.Q`/`.Error`/`.ErrorID` semantics, the Modbus
  exception/ErrorID table, and the per-step timeout that catches silent hangs.
- **`references/gs10-register-map.md`** — the GS10 DURApulse register map (read block, command
  word values, frequency scaling, fault reset), GS10 keypad params (P09.xx / P00.21), and the
  "verify the labels" warning.
- **`references/poll-scheduler-patterns.md`** — annotated heartbeat + round-robin + edge-trigger
  + COP write-buffer + `commissioning_mode` + comm-watchdog patterns, with the reasoning behind each.
- **`references/ccw-workflow.md`** — Connected Components Workbench idiom: `.stf` source vs `.rtc`
  binary, the Global Variables table (no `VAR` blocks in Micro800 POUs), build/download, the
  cascade-error gotcha, remote-programming notes, and the source-of-truth ordering for constants.

## Working discipline (the meta-lesson)

- **Source-of-truth order for constants:** the codified device profiles
  (`device-profiles/gs10.yaml`, `micro820.yaml`) **>** the actual `.stf`/`.st` source you read
  with your own eyes **>** any summary or memory of it. When they disagree, the profile +
  the file you opened win over recollection.
- **Distrust prior MIRA docs on the MSG_MODBUS axis specifically** — the inversion is sticky.
- **Volatile facts get a verify step, not an assertion.** Channel number, the 0x21xx labels,
  and framing are confirmed on the rig (CCW online watch table, a bus sniffer, or the GS10
  keypad), not asserted from memory. "It built clean" is not "it talks."
- This is bench / hardware-in-the-loop work: a code change is *proven* only when the drive
  responds (frequency feedback moves, the motor spins, the watch table shows `comm_ok`),
  per the bench verification sequence the Conv_Simple lineage uses.
