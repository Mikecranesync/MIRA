# Plan — Experiment: Unlock CCW's Ladder Diagram Import Format

> **Scope (this iteration):** narrow the previous 4-track plan down to one experimental track. The user wants to "unlock the LD framework and learn to write ladder logic that can be imported." Tracks A (CCW download blocker), C (VLM screen reading), and D (UI-TARS GUI agent) are **parked** — useful, but not what's being asked for now. This is research with a clear success/failure verdict by end-of-day.

## Context — Why This Is Suddenly Tractable

Survey of `/Users/bravonode/Mira/plc/` turned up two file formats already in the repo that are **plain XML CCW import files**, not binary blobs. The user has already used the `.ccwmod` variant to import Modbus server config — the import path works.

| File | Format | What it imports | Evidence in repo |
|------|--------|-----------------|------------------|
| `MbSrvConf_import.ccwmod` (3.8 KB) | XML 1.0 ASCII — `<modbusServer Version="2.0">` root with `<modbusRegister>` and `<mapping>` children | Modbus TCP server variable→register mappings via *Device Toolbox → Modbus Mapping → Import* | `plc/ccw/drive_test/step1_io_check/MbSrvConf_import.ccwmod` + `.xml` variant + `_no_heartbeat.ccwmod` UTF-8 variant |
| `PROG_IO.isaxch` (317 bytes) | XML 1.0 UTF-8 — `<ISaGRAF_Export version="1.0">` → `<Program><Name>PROG_IO</Name><Language>ST</Language><SourceCode><![CDATA[…]]></SourceCode></Program></ISaGRAF_Export>` | A CCW *Program* exported in **ISaGRAF Exchange** format. ST source goes verbatim in the CDATA block. | `plc/ccw/drive_test/step1_io_check/PROG_IO.isaxch` |

**Why this matters:** CCW's runtime is **ISaGRAF** (licensed from Rockwell partner — see `Controller.acfproj` `ISaGRAF.ISaGRAF5.targets` import). ISaGRAF is a multi-vendor IEC 61131-3 runtime supporting **LD, FBD, SFC, ST, IL** — all five languages. The `.isaxch` format demonstrably handles `Language="ST"`. The experiment is: **does `Language="LD"` work, and what's the SourceCode schema for ladder?**

If yes, we have a documented, supported, version-stable way to push ladder rungs into CCW projects without touching the `.accdb` or running a GUI agent.

## Hypothesis (the Thing the Experiment Tests)

> CCW's File → Export menu produces an `.isaxch` for any program (ST today, LD if we build one). The schema is uniform across languages — same `<Program>` wrapper — and only the `<SourceCode>` body changes shape per language. By manually building a small LD program in CCW and exporting it, we can capture the LD source schema, then write a generator that produces `.isaxch` files importable back into CCW.

**Falsifiers (will retire the hypothesis if observed):**
1. CCW has no LD export option, only ST/FBD export (some ISaGRAF deployments restrict exchange to text languages).
2. The LD `.isaxch` `<SourceCode>` body turns out to be opaque binary / base64 blob, not parseable XML.
3. CCW accepts an `.isaxch` import but silently drops or refuses the LD program (e.g., requires re-validation that can't be precomputed).
4. The schema is so version-tied to ISaGRAF 5 internals that hand-generated files trigger validation errors on import.

If any of (1-4) hits, the experiment ends with a documented finding ("LD .isaxch round-trip blocked because X") and we fall back to the parked Track D (UI-TARS GUI agent) for LD authoring — that's a known branch, not a failure.

## Experiment Protocol

> Treat each step as a checkpoint. After each step, decide: continue, pivot, or stop. Time-box the whole experiment to one working day. If it's not converging by EOD, write up findings and park.

### Step 0 — Set up the lab without touching anything live

- Make a working CCW project **named differently** from `MIRA_PLC` (`MIRA_LD_lab`), in a scratch CCW folder, not inside `Mira/plc/ccw/`. Reuse `create_mira_plc.py` pattern but **rename the project**, **change the target IP to a non-routable placeholder**, and **point at the lab Micro 820 only when explicitly testing**.
- The production project at `Mira/plc/ccw/MIRA_PLC.ccwsln` is read-only reference for this experiment. Do not write to it.

### Step 1 — Round-trip ST first to validate the export path (~20 min)

Goal: confirm CCW's export gives us back a file that round-trips, before we ask about LD.

1. In the lab project, paste a 3-line ST snippet (e.g., `heartbeat := NOT heartbeat;` like `PROG_IO.isaxch`) into a fresh ST program.
2. Use CCW's File → Export (or Project Organizer right-click → Export) on that program. Confirm output extension and contents.
3. Diff the result against `PROG_IO.isaxch`. Confirm wrapper schema is identical and only the program-name / source changes.
4. Delete the program from the lab project, then File → Import the exported `.isaxch`. Confirm the program reappears identical and builds clean.

**Decision point:** if ST export+import round-trip doesn't work, the whole experiment is moot — fall through to Track D immediately.

### Step 2 — Discover whether LD export exists (~30 min)

1. In the lab project, add a *Ladder Diagram* program with a single trivial rung: one XIC contact on a global variable, one OTE coil on another global variable. Build (Ctrl+Shift+B) to 0 errors.
2. Attempt File → Export on that LD program. Note what's offered (`.isaxch` only? other format? export disabled?).
3. If `.isaxch` is offered: open the file and inspect.
4. If only some other format is offered (e.g., `.L5X` like RSLogix, `.acd`, or a proprietary archive): note it and inspect that instead.
5. If **nothing** is offered for LD programs: the experiment hits falsifier (1). Document and park.

### Step 3 — Decode the LD source schema (~2 hours)

If Step 2 produced an `.isaxch` for the trivial LD rung:

1. Read the `<SourceCode>` body. Expect either inline XML (`<Rung><Contact .../><Coil .../></Rung>`) or a CDATA block with structured-text-ish ladder representation.
2. Build a second LD program in CCW: two rungs, where rung 1 has a series connection (XIC + XIO) and rung 2 has a parallel branch. Export and diff against the trivial example. The diff isolates how series, parallel, and rung sequencing are encoded.
3. Build a third LD program covering: timer (TON), comparator (EQU), move (MOV), and a function-block call (MSG_MODBUS if reachable). Export and capture each instruction's schema.
4. Document the schema in `wiki/references/ccw-ld-isaxch-schema.md` (one new file; the only doc artifact this experiment produces).

### Step 4 — Build the generator (~3 hours)

1. `tools/ccw_ld_gen.py` — input: a Python list of dicts describing rungs (`{"comment": "...", "elements": [...]}`); output: an `.isaxch` file.
2. Start with the smallest target: emit one rung from `MIRA_Ladder_Program.md` Section 1 Rung 0 (the e-stop XOR check — two parallel branches, two contacts each, one output coil).
3. Import that generated rung into a fresh lab project. Build to 0 errors. If it builds, repeat for Rungs 1 and 2.
4. **Stop expanding past 5 rungs in this experiment.** Three goals here: confirm the generator works, capture edge cases, and produce a clean schema doc. Generating all 62 rungs is a follow-on task once the unlock is proven.

### Step 5 — Verdict (~30 min)

Write `wiki/references/ccw-ld-isaxch-schema.md` Conclusions section answering:
1. Does `.isaxch` round-trip work for LD? **Yes / No / Partial**
2. What instruction set is covered? List exactly which of {XIC, XIO, OTE, OTL, OTU, EQU, NEQ, GRT, GEQ, LEQ, MOV, ADD, MUL, DIV, TON, MSG_MODBUS} were verified by build-clean import.
3. What's the next experiment if this one succeeded? (Probably: generate all 62 rungs of `MIRA_Ladder_Program.md`.)
4. What's the fallback if this one failed? (Probably: park and revisit Track D — UI-TARS for LD authoring — with measured expectations.)

## Files Touched / Created by This Experiment

- **Lab CCW project** (outside the repo, scratch location) — created
- `wiki/references/ccw-ld-isaxch-schema.md` — created (schema doc)
- `tools/ccw_ld_gen.py` — created (generator)
- `tools/ccw_ld_gen_examples/rung0_estop_xor.py` — created (example input → known-good output)

**Untouched:**
- `Mira/plc/ccw/MIRA_PLC.ccwsln` and any subdirectory (production CCW project)
- `Mira/plc/Micro820_v4.*.st` (committed ST history)
- The live Micro 820 PLC at 192.168.1.100 (the experiment never downloads to it; build-clean is the success criterion)

## Files to Read Before Starting (Already Surveyed)

- `Mira/plc/ccw/drive_test/step1_io_check/PROG_IO.isaxch` — known-good ST `.isaxch`, the schema starting point
- `Mira/plc/ccw/drive_test/step1_io_check/MbSrvConf_import.ccwmod` — confirms CCW import path works for Modbus; useful as a second XML-import reference
- `Mira/plc/ccw/drive_test/step1_io_check/README.md` — documents the `Device Toolbox → Modbus Mapping → Import` workflow
- `Mira/plc/MIRA_Ladder_Program.md` — 62-rung spec, source of truth for what Steps 4+ need to emit
- `Mira/plc/create_mira_plc.py` — boilerplate for the *lab* project bootstrap (same pattern, different name + IP)
- `Mira/plc/populate_variables.py` — only relevant if `.isaxch` import doesn't populate variables; we have a known fallback

## Implications & Safety (Specific to This Experiment)

1. **No production write paths.** The lab project never gets downloaded to the Micro 820. Build-clean in CCW is the only success criterion. The PLC the user mentioned as "currently in use" stays on its current program throughout.
2. **CCW EULA posture is unchanged.** `.isaxch` round-trip uses CCW's *own* export feature, which is intentionally supported. This is *less* aggressive than `populate_variables.py`'s direct `.accdb` writes — and the user has already accepted that posture.
3. **Open-source / free constraint is satisfied.** The experiment uses CCW Free Standard Edition (already installed, free), Python stdlib + `pyodbc` (BSD/MIT), and nothing else. No new licenses, no paid API, no external models.
4. **Risk to address before starting Step 2:** in Step 1 the user needs to perform a manual CCW export. Confirm whether CCW's UI exposes File → Export for individual programs, or whether export is project-level only. If project-level, the diff in Step 1 is still doable; the schema for a single program will live inside the larger export.

## Open Question Carried Forward

**v4.1.8 vs v5.0.0 vs v5.0.2 ST reconciliation.** The latest committed `.st` file is `Micro820_v4.1.8_Program.st` (Mar 18). `RESUME_VFD_COMMISSIONING.md` references "v5.0.0 in CCW Prog2.stf" as the correct on-PLC version. `Mira/plc/ccw/drive_test/README.md` says **"production Prog2.stf v5.0.2 is what's currently flashed"** as of 2026-04-17. Three different version claims across three docs. This experiment doesn't need the answer — it builds a generator, not the v5.0.2 program — but flag it so we don't accidentally make decisions on stale assumptions later.

## Verification (Per-Step Stop-Loss)

| Step | Pass | Fail → Action |
|------|------|---------------|
| 1 — ST round-trip | Exported `.isaxch` schema matches `PROG_IO.isaxch`; reimport builds clean | Stop. Document. Move to Track D. |
| 2 — LD export exists | File → Export on an LD program yields an inspectable file | Stop. Falsifier (1). Move to Track D. |
| 3 — LD schema decoded | Three sample LD programs produce diffable schema; all instructions used by `MIRA_Ladder_Program.md` Rungs 0-2 are covered or have a clear extension path | Stop. Falsifier (2) or (4). Document partial schema. Move to Track D. |
| 4 — Generator round-trips Rung 0 | `tools/ccw_ld_gen.py` emits an `.isaxch` that imports into a fresh lab project and builds clean | Iterate on the schema doc; if 3 attempts fail, falsifier (3) or (4). Move to Track D. |
| 5 — Verdict committed | `wiki/references/ccw-ld-isaxch-schema.md` written with explicit Yes/No/Partial verdict and instruction-coverage list | n/a — this is the write-up step |

## What I Have Not Changed

- `/Users/bravonode/Mira/plc/` is untouched.
- No new code written yet.
- No git operations.
- This plan file is the only artifact so far.
