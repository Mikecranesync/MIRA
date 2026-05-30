# PLC LAPTOP — START HERE (Conv_Simple_1.6)

Hand this file to the Claude Code session on the **PLC laptop** to get it up to
speed cold. Everything it needs is in the MIRA monorepo on one branch.

## 1. Get current

```bash
cd <your MIRA repo>            # the monorepo clone on the PLC laptop
git fetch origin
git checkout feat/uns-node-knowledge
git pull --ff-only
```

The work lives in **`plc/Conv_Simple_1.6/`**. Tip commit: `200d6acb`.

## 2. Read these two, in order

1. **`plc/Conv_Simple_1.6/GOAL.md`** — the full goal: definition-of-done, the
   Phase A–D bench acceptance gates, the promotion recipe, and the known risks to
   watch. **This is the source of truth. Follow it.**
2. **`plc/Conv_Simple_1.6/CHANGELOG.md`** — the F1–F9 fix matrix and the
   authoritative verification sequence behind the gates.

Supporting drafts in the same folder: `Prog_init.stf` (the ST POU),
`GlobalVariable.md` (Controller Variables spec to apply by hand in CCW),
`MbSrvConf.xml` (Modbus TCP server map).

## 3. The one fact you must not get wrong

On the Micro 800 family: **`MSG_MODBUS` = RTU (serial / RS-485)**,
**`MSG_MODBUS2` = TCP (Ethernet)**. The GS10 is on RS-485, so every Modbus
instance here is `MSG_MODBUS`. Do **not** change any to `MSG_MODBUS2`. (This has
been inverted 3× already — Rockwell 2080-RM001 is the authority; retraction commit
`b591fe47`.)

## 4. What "done" looks like (summary — GOAL.md has the detail)

- Drafts applied in CCW, Controller Variables match `GlobalVariable.md`, builds 0 errors.
- **Phase A** serial framing (19200 8-E-1, GS10 P09.00/01/04 = 1/2/4) → sniffer sees frames.
- **Phase B** read path, `commissioning_mode := TRUE` → `ReadOK=TRUE`, `ReadStatusWord ≠ 0`.
- **Phase C** write path, `commissioning_mode := FALSE` → `CmdWord:=18` spins the drive at 15 Hz.
- **Phase D** `tools/live_monitor.py --host <PLC_IP>` reports clean VFD booleans.
- Promote to the private **`MIRA_PLC`** repo, tag `bench/<date>-conv-simple-1.6-verified`, update PR #7, close issue #9.

## 5. Report back with evidence

Evidence-only completion: record the actual watch-table values / keypad readings /
`live_monitor` output for each phase. "I applied it" is not done.
