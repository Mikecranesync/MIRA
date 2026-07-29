---
name: plc-ccw-deploy
description: >-
  Use when flashing/deploying a Connected Components Workbench (CCW) program to
  the bench Micro820 PLC — the Conv_Simple lineage driving the GS10 VFD. Triggers
  on: "flash V2.0 / the new program", "deploy Conv_Simple_X to the PLC", "the
  registers read 0 / torque/rpm/power are 0", "build it in CCW", "declare the
  vars + import the modbus map", "rebuild clean from 1.8", "the e-stop inverted",
  "validate the e-stop under LOTO", "verify the live telemetry / historian".
  Codifies the CCW project mechanics (PrjLibrary.accdb symbol table + Prog_init.stf
  + binary caches), the clone-from-proven-good-baseline anti-corruption doctrine,
  the GS10 Modbus facts (Channel 2, Addr=wire+1, monitor registers), the
  mandatory e-stop/LOTO safety gate, and — most important — the line between what
  Claude can script (clone builder, kit-consistency guard, read-only .accdb check,
  historian telemetry verify) and what is irreducibly human (CCW GUI clicks,
  physical e-stop, motor run). Use it instead of rediscovering this from scattered
  plc/ docs every time.
---

# PLC CCW Deploy (Micro820 / GS10 bench)

This skill captures the **whole** deploy loop for the bench conveyor PLC so it
doesn't get re-cobbled from scratch each session. The painful lessons here were
paid for in real bench time (a corrupted image that **inverted the e-stop**, a
stale variable checklist, registers stuck at 0). Honor them.

> **Scope:** BENCH / developer workflow only. None of this ships to a customer.
> Customer PLC reads go through Ignition (or the future Sparkplug subscriber);
> customer PLC writes do not exist. See `.claude/rules/fieldbus-readonly.md` and
> `.claude/rules/train-before-deploy.md` (read-only in beta).

## 0. The one thing to internalize: the AI/human boundary

The single biggest time-saver is knowing **where to stop**. "Do as much yourself,
then ask" has a real, principled line on this hardware:

| Step | Who | Why |
|---|---|---|
| Clone a proven-good CCW project → new version | **Claude** (`build_conv_simple_*.py`) | pure file copy; safe + idempotent |
| Stage the apply kit (program `.st`, `.ccwmod`, var checklist, INSTALL card) | **Claude** | file copy |
| Read-only verify the clone's symbol table (`PrjLibrary.accdb`) | **Claude** (pyodbc, `readonly=True`) | proves baseline integrity, lists exactly which vars need declaring |
| Kit-consistency guard (no stale checklist / wrong var count) | **Claude** | catches the desync class at build time |
| Historian telemetry verify after the run | **Claude** (`verify_v2_telemetry.py`) | read-only HTTP `/trends/summary` |
| **Declare vars / Import `.ccwmod` / paste program / Build / Download in CCW** | **HUMAN** | CCW is a GUI; the only "automation" (`.accdb` injection) is the exact symbol-table desync that corrupts the image |
| **🔴 Validate the e-stop under LOTO** | **HUMAN** | a person must press it and watch the contactor drop — never simulated/asserted |
| **Run the motor at 30 Hz** | **HUMAN** | physical |

**Do NOT** try to drive the CCW GUI blind (pywinauto against a window tree you
can't see, on a safety deploy near a motor), and **do NOT** inject variables
straight into `.accdb` to "skip" the manual declare. Stage everything perfectly,
hand over a tight click-list, and verify the result afterward. That is the
maximum safe autonomy — and it's a lot.

## 1. CCW project mechanics (what actually lives where)

A CCW project (`Conv_Simple_X/`) is not one file. The source-of-record split is
why "I edited the .st but the PLC didn't change" keeps happening:

- `Controller/Controller/PrjLibrary.accdb` — **the symbol table** (every global
  variable: name, type, scope, CRC). MS Access DB. This is the real variable store;
  the `VAR ... END_VAR` block at the top of a `.st` file is just a **comment**.
- `.../Micro820/Micro820/Prog_init.stf` — the **ST body** of the `Prog_init` POU
  (the comms program). Editing this on disk only takes effect if CCW reloads it
  (it may instead trust its binary caches).
- `Prog1.stf` / `PROG1.ic` — the **ladder** POU (Prog1) source + compiled. Prog1
  drives the physical I/O: contactor, lights, **e-stop**. `Prog_init` does NOT.
- `PROG1.rtc` / `Pou_PROG1.xtc` / `Conf` / `Constants` — **binary caches** CCW
  rewrites only when *it* edits the project.

**The corruption mode = "symbol-table desync":** a correct compiled ladder bound
to a *shifted* variable/symbol map. When `Conv_Simple_1.9` was downloaded, `Prog1.stf`
/ `PROG1.ic` / `IO.rtc` were byte-identical to 1.8, but the variable/config tables
had shifted in binary offset — so the safety function read **inverted** (contactor
energized on e-stop pressed). Evidence pattern: `plc/EVIDENCE_ConvSimple_1.9_corruption.md`.

## 2. Anti-corruption doctrine (non-negotiable)

1. **A CCW project that just mis-behaved a safety function is NEVER patched in
   place.** Clone the last **proven-good** baseline and re-apply changes on top.
   `build_conv_simple_2_0.py` clones pristine `Conv_Simple_1.8` (correct e-stop) →
   `Conv_Simple_2.0`, never the suspect 1.9.
2. **CCW is the sole writer of the symbol table.** Declare vars in the GUI by
   **cloning an existing row** (guarantees type + blank Dimension). Direct `.accdb`
   `INSERT`s (`inject_vars_accdb.py`) are a **bench-only, bounded-downside bet** that
   is *exactly* the desync risk — never use it on a deploy whose job is to fix a
   safety-function fault.
3. **Clean before Build.** `Build → Clean` then `Build` so no stale compiled ladder
   is reused — stale-cache reuse is what corrupted 1.9.
4. **Re-validate the safety function physically after every download** (§5).

## 3. The clean deploy workflow (Path A)

```
1. Close CCW.  python plc/build_conv_simple_2_0.py --dry-run   # review
               python plc/build_conv_simple_2_0.py             # clone+stage+guard
2. Open Conv_Simple_2.0\Conv_Simple_2.0.ccwsln
3. Declare the new vars in Global Variables — CLONE A ROW:
     - clone vfd_status_word (WORD)  -> the new WORD register vars
     - clone poll_phase     (BOOL)  -> the new BOOL vars
     - every register var's Dimension MUST be blank (a dimension => CCW makes it
       ARRAY[..] OF WORD => type "AnyArray" => Build fails: "Data type of variable
       X:AnyArray does not match with current mapping item: Word").
4. Import the Modbus map: Device Config -> Modbus Mapping -> Import -> the .ccwmod.
     VARS MUST EXIST FIRST or the ISaGRAF post-build throws "undeclared variable".
5. Paste the program into Prog_init; confirm the header version string.
6. Build -> Clean, then Build  (0 errors)  -> Download.
7. 🔴 Re-validate the e-stop under LOTO BEFORE trusting it (§5).
8. Run, then verify telemetry (§6).
```

The current applied-instance specifics (which version, how many vars, the register
map) live in the staged `_V<ver>_APPLY/INSTALL_*.md` card — **read it**; it is the
authoritative click-list. Don't hard-code a var count from memory: the count drifts
between versions (V1.9 had 9 incl. `read_sel`; V2.0 has **8** — `read_sel` dropped).

## 4. GS10 + Micro820 Modbus facts (verified on the bench — don't re-derive)

- **Channel := 2** (embedded RS-485). NOT 0. Bench-proven 2026-05-26.
- **Addr = wire + 1.** The AB `MSG_MODBUS` firmware subtracts 1 from `TargetCfg.Addr`
  before TX. To read wire `0xNNNN`, set `Addr := 16#(NNNN+1)`. (Read `0x210C` →
  `Addr 16#210C` returns wire `0x210B`.)
- **Monitor block** `0x2100..0x2106` (7 regs): fault, status, keypad-F (reads 0 in
  comms mode — don't trend it), output freq (Hz×100), current (A×100), DC bus (V×10),
  output volts (V×10).
- **Load block** `0x210B..0x210F` (5 regs): torque (%×10), motor rpm, _, _, power
  (kW×1000). V1.8 never read these → torque/rpm/power sat at 0.
- **Write** `0x2001` (cmd word + freq setpoint) via FC16; obeyed only if `P00.20=1 /
  P00.21=2`. `vfd_ctrl_enable=FALSE` ⇒ read-only.
- **Comms params (bench-verified):** GS10 `P09.00=1`, `P09.01=96` (9600), `P09.04=12`
  (8N1 RTU), `P09.09=10.0 ms` ← critical (default 2.0 ms ⇒ ErrorID-55). PLC Serial
  Port 2: 9600/8/None/1, Modbus RTU Master, RS485.
- **Drive monitor preconditions** for non-zero load regs: rpm needs `P05.03`+`P05.04`;
  torque needs `P00.11=2` (SVC) + auto-tune (`P05.00`); power computes from V×I once
  loaded.

GS10 ≠ GS1 (different param numbering). See `plc/GS10_Integration_Guide.md` and the
`fieldbus-discovery` skill for register-meaning depth.

## 5. 🔴 The e-stop / LOTO safety gate (always, after any download)

A safety function was observed inverted on this exact bench. The
`mira-industrial-safety` skill governs this; it is **not optional** and is **never
simulated by Claude**:

- Keep `vfd_ctrl_enable = FALSE` until the gate passes.
- **Under LOTO** (OSHA 1910.147), physically verify on the image you actually
  downloaded: **released → contactor can run; pressed → contactor positively DROPS,
  red light on.**
- Do not return the machine to service until this passes. A human performs and
  witnesses this — Claude requests it and waits for the PASS/FAIL report.

## 6. Telemetry verification (the acceptance check)

After the motor runs at 30 Hz, confirm against the live trend historian (read-only):

```
python plc/conv_simple_anomaly/verify_v2_telemetry.py            # one-shot
python plc/conv_simple_anomaly/verify_v2_telemetry.py --watch    # hands-free poll
```

It checks the two acceptance criteria: (1) **torque/rpm/power non-zero at
`quality: good`**, (2) **freq cmd vs output track ~1:1** (a 10× ratio = a historian
divisor, not a PLC bug).

**Historian gotchas (verified — save yourself the false negative):**
- Endpoint is `GET :8766/trends/summary`; the per-tag value field is **`current`**
  (not `last`); quality vocab is `good | stale | no_data`.
- Tag names carry **unit suffixes**: `vfd_torque_pct`, `vfd_power_kw`,
  `vfd_frequency_hz`, `vfd_current_a`, `vfd_dc_bus_v`. The bare names
  (`vfd_torque`, `vfd_power`, `vfd_frequency`) **do not exist** in the historian.
- The historian must be running (serves `/viewer/` + `/trends/summary`). `/health`
  shows `connection` + `last_poll_ts`.

## 7. "Still 0 / no_data after a clean flash" decision tree

0. **`no_data` (not `0`) on a whole register block = the `.ccwmod` map wasn't
   imported.** Run `live_capture.py` first. If the LIVE tags are exactly the 1.8
   base-map registers (`400107–110`) and the `no_data` tags are exactly the
   `.ccwmod` block (`400118–125`) — including `vfd_status_word`, which the program
   populates from the *same* monitor read that feeds the live `vfd_frequency` — the
   globals are populated but **not exposed on Modbus**. Fix: Device Config → Modbus
   Mapping → **Import** the `.ccwmod` (vars must already exist) → Build → Download.
   This is the #1 cause and the cheapest to confirm; check it before the below.
   (Confirmed live 2026-06-13: clean split isolated exactly this.)
1. **The program didn't actually compile/download.** Confirm: correct version
   header, Clean was done, 0 errors, download completed. (This was the real cause of
   the V2.0 zeros — the flashed firmware was still V1.8, which never reads the load
   block.) Most likely cause — check first.
2. **Drive params unset** — only if the **keypad** also shows 0 (rpm: `P05.03/04`;
   torque: `P00.11=2` + auto-tune; power: needs load). If the keypad shows real
   numbers, this isn't it.
3. **Motor unloaded / disconnected at the bench** — drive outputs Hz/V at **0 A**, so
   0 torque/rpm/power is **correct telemetry, not a bug.** Need a turning, loaded motor.

## 8. Tooling map (what each script is for)

| Script | Role | Safety |
|---|---|---|
| `plc/build_conv_simple_2_0.py` | clone proven-good 1.8 → 2.0, stage apply kit, kit-consistency guard | safe (file copy); `--dry-run`/`--force` |
| `plc/conv_simple_anomaly/verify_v2_telemetry.py` | step-6 acceptance verifier (`--watch`) | read-only HTTP |
| `plc/conv_simple_anomaly/live_capture.py` | full-tag coverage logger (run while cycling functions; LIVE/no_data per tag) — **run this FIRST after a download** to spot a missed `.ccwmod` import (clean 400107-110-live / 400118-125-no_data split) before chasing program/drive causes | read-only HTTP |
| `plc/inject_vars_accdb.py` | pre-inject vars to `.accdb` | ⚠️ **bench-only bet**, symbol-table-desync risk — do NOT use on a safety deploy |
| `plc/ccw_autoflash_1_9.py` | pywinauto GUI Build/Download | ⚠️ untested, degrades gracefully, human-watched only; never blind near a motor |
| `plc/deploy_modbus_map.py` | write the Modbus map config | deliberate config-write tool, not a runtime path |
| `plc/discover.py` | read-only fieldbus discovery | read-only (Ethernet side-effect-free; serial needs `--serial-bus-idle`) |

## 9. After a clean, e-stop-validated flash (close the loop)

Export `Prog_init` → copy the `.stf` over the repo `plc/Prog_init_ConvSimple_v2.0.st`
**and** the CCW dir (always both — see `[[feedback_always_copy_prog2]]`) → commit
(conventional `feat(plc):`/`fix(plc):`) → update `wiki/hot.md`. The commit happens
**after** the physical safety re-validation, not before.

## 10. Cross-references

- `.claude/rules/fieldbus-readonly.md` — bench-only tools never ship to customers; discovery is read-only
- `.claude/rules/train-before-deploy.md` — read-only in beta; HMI deploys approved agents only
- `.claude/skills/mira-industrial-safety/SKILL.md` — the LOTO/e-stop STOP+escalate contract (§5)
- `.claude/skills/fieldbus-discovery/SKILL.md` — Modbus/EtherNet-IP register-meaning depth
- `plc/INSTALL_ConvSimple_v2.0.md` — the live click-list (authoritative per-version)
- `plc/EVIDENCE_ConvSimple_1.9_corruption.md` — the file-level corruption proof
- `plc/GS10_Integration_Guide.md` — GS10 params + register map
- Memory: `[[reference_ccw_modbus_and_project_mechanics]]`, `[[project_trend_viewer]]`,
  `[[feedback_gs10_not_gs1]]`, `[[feedback_micro820_channel0]]`
