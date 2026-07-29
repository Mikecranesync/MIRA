#!/usr/bin/env python3
"""Build Conv_Simple_2.1 — the V2.0 read logic, but the program is BAKED IN.

What changed vs build_conv_simple_2_0.py: 2.0 left "paste the program into
Prog_init" as a manual CCW step, and that step got skipped (the bare 1.8 clone
got downloaded, torque/rpm/power stayed 0). 2.1 writes the Prog_VFD V2.1 ST body
straight into the clone's Prog_init.stf, so the operator does NOT paste anything.

Why baking the PROGRAM is safe (and why we still don't bake the VARIABLES):
  * Prog_init.stf is plain ST *source* text. Writing it is a file edit, not
    symbol-table surgery. CCW reads it as the POU body; Build -> Clean recompiles
    from it. (This is what the inject tool already did for the program half.)
  * The 8 globals still live in PrjLibrary.accdb (the symbol table). Direct
    INSERTs there are the desync risk that inverted the e-stop on 1.9, so those
    stay a manual CCW row-clone. The operator is fine declaring 8 vars by hand;
    that is the ONLY in-CCW authoring step left.

So the operator's remaining steps shrink to:
    declare 8 vars  ->  Import .ccwmod  ->  Build (Clean first)  ->  Download

This does everything else SAFE to automate:
  1. Clone PROVEN-GOOD Conv_Simple_1.8 -> Conv_Simple_2.1 (1.8 stays pristine).
  2. Rename the .ccwsln so it opens as "Conv_Simple_2.1".
  3. BAKE Prog_init_ConvSimple_v2.1.st into the clone's Prog_init.stf (backup first).
  4. Stage _V2.1_APPLY/ with the program, the .ccwmod map, the 8-var checklist,
     and the INSTALL card.
  5. Kit-consistency guard + verify the bake took.

It still does NOT bake the Modbus map into MbSrvConf.xml (a map referencing
not-yet-declared vars makes the build throw -- declare vars THEN Import .ccwmod).

Usage (PLC laptop, CCW CLOSED):
    python plc/build_conv_simple_2_1.py --dry-run
    python plc/build_conv_simple_2_1.py
    python plc/build_conv_simple_2_1.py --force      # overwrite an existing 2.1
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

DEFAULT_CCW_ROOT = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC")
SRC_NAME = "Conv_Simple_1.8"          # PROVEN-GOOD baseline (correct e-stop)
DST_NAME = "Conv_Simple_2.1"

# Prog_init POU body inside the project (plain ST source text).
PROG_INIT_REL = Path("Controller/Controller/Micro820/Micro820/Prog_init.stf")

SKIP = shutil.ignore_patterns(
    ".vs", "SpyListPersistence", "*.tmp", "UserAccess.CCW.tmp",
    "CONTROLLER.err", "Breakpoints.lst", "*.bak",
)

HERE = Path(__file__).resolve().parent
PROGRAM_SRC = HERE / "Prog_init_ConvSimple_v2.1.st"
STAGE_FILES = [
    PROGRAM_SRC,
    HERE / "Modbus_ConvSimple_v1.9.ccwmod",            # register map is unchanged
    HERE / "CCW_VARIABLES_ConvSimple_v2.1_DELTA.md",   # 8 vars, no read_sel
    HERE / "INSTALL_ConvSimple_v2.1.md",
    HERE / "EVIDENCE_ConvSimple_1.9_corruption.md",
]

# The 8 globals the operator declares by hand (read_sel is v1.9-only, dropped).
EXPECTED_V21_VARS = {
    "vfd_warn_code", "vfd_freq_cmd", "vfd_torque", "vfd_motor_rpm",
    "vfd_power", "vfd_last_fault", "lp_toggle", "last_fault_clear",
}
_DELTA_VAR_ROW = re.compile(r"^\s*\|\s*`([A-Za-z_]\w*)`\s*\|")


def fail(msg: str) -> "None":
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def check_stage(apply_dir: Path, baked_stf: Path) -> None:
    """Fail loud if the kit isn't V2.1-consistent or the bake didn't take."""
    problems: list[str] = []

    delta = apply_dir / "CCW_VARIABLES_ConvSimple_v2.1_DELTA.md"
    if not delta.is_file():
        problems.append("v2.1 variable delta not staged")
    else:
        declared = {m.group(1) for ln in delta.read_text(encoding="utf-8", errors="ignore").splitlines()
                    if (m := _DELTA_VAR_ROW.match(ln))}
        if "read_sel" in declared:
            problems.append("staged delta declares read_sel (v1.9 leaked in)")
        if declared != EXPECTED_V21_VARS:
            problems.append(f"staged delta vars {sorted(declared)} != the 8 expected")

    # the bake: the project's Prog_init.stf must now be the V2.1 body
    if not baked_stf.is_file():
        problems.append(f"baked Prog_init.stf missing: {baked_stf}")
    else:
        head = baked_stf.read_text(encoding="utf-8", errors="ignore")
        if "Prog_VFD V2.1" not in head or "Conv_Simple_2.1" not in head:
            problems.append("baked Prog_init.stf header is not 'Conv_Simple_2.1  Prog_VFD V2.1'")
        if "vfd_torque" not in head or "lp_toggle" not in head:
            problems.append("baked Prog_init.stf does not reference the V2.1 load-block vars")

    if problems:
        print("\nKIT-CONSISTENCY CHECK FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        fail("build is inconsistent — fix sources and rebuild")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build Conv_Simple_2.1 (program baked in).")
    ap.add_argument("--ccw-root", type=Path, default=DEFAULT_CCW_ROOT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    src = args.ccw_root / SRC_NAME
    dst = args.ccw_root / DST_NAME

    if not src.is_dir():
        fail(f"source project not found: {src}")
    if not (src / f"{SRC_NAME}.ccwsln").is_file():
        fail(f"{src} does not look like a CCW project (no {SRC_NAME}.ccwsln)")
    if not (src / PROG_INIT_REL).is_file():
        fail(f"source Prog_init.stf not found at {src / PROG_INIT_REL}")
    for f in STAGE_FILES:
        if not f.is_file():
            fail(f"missing repo artifact to stage: {f}")
    if dst.exists() and not args.force:
        fail(f"{dst} already exists. Re-run with --force to overwrite, or delete it.")

    print("Conv_Simple_2.1 build plan  (clean from 1.8, program BAKED IN)")
    print("-" * 64)
    print(f"  Source        {src}   (PRISTINE -- correct e-stop)")
    print(f"  Destination   {dst}{'  (EXISTS, will overwrite)' if dst.exists() else ''}")
    print(f"  Bake program  {PROGRAM_SRC.name}  ->  {PROG_INIT_REL.name}")
    print(f"  Slave map     KEEP 1.8 original; V2.1 map via .ccwmod Import AFTER vars")
    print(f"  Operator left declare 8 vars -> Import .ccwmod -> Build(Clean) -> Download")
    print(f"  Mode          {'DRY-RUN (no changes)' if args.dry_run else 'APPLY'}")
    print("-" * 64)
    if args.dry_run:
        print("Dry-run complete. Re-run without --dry-run to build.")
        return

    # 1. clone
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=SKIP)
    print(f"[1/4] cloned {SRC_NAME} -> {dst}")

    # 2. rename the solution file
    old_sln = dst / f"{SRC_NAME}.ccwsln"
    new_sln = dst / f"{DST_NAME}.ccwsln"
    if old_sln.is_file():
        old_sln.rename(new_sln)
        print(f"[2/4] solution -> {new_sln.name}  (references are relative; safe)")
    else:
        print(f"[2/4] WARN: {old_sln.name} not found — open the .ccwsln present")

    # 3. BAKE the program into Prog_init.stf (backup first)
    baked = dst / PROG_INIT_REL
    bak = baked.with_suffix(".stf.prebake.bak")
    if not bak.exists():
        shutil.copy2(baked, bak)
    baked.write_text(PROGRAM_SRC.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"[3/4] baked {PROGRAM_SRC.name} -> {PROG_INIT_REL.name}  (backup {bak.name})")

    # 4. stage the apply kit + consistency/bake check
    apply_dir = dst / "_V2.1_APPLY"
    apply_dir.mkdir(exist_ok=True)
    for f in STAGE_FILES:
        shutil.copy2(f, apply_dir / f.name)
    check_stage(apply_dir, baked)
    print(f"[4/4] staged apply kit -> {apply_dir}  (kit + bake checks passed)")

    print("\nDONE. Conv_Simple_2.1 is a clean 1.8 clone with Prog_VFD V2.1 baked in.")
    print(f"  Open:   {new_sln}")
    print(f"  Follow: {apply_dir / 'INSTALL_ConvSimple_v2.1.md'}")
    print("\n  Operator's ONLY remaining steps:")
    print("    1. Declare the 8 variables below (clone a row; blank Dimension).")
    print("    2. Device Config -> Modbus Mapping -> Import the .ccwmod.")
    print("    3. Build -> Clean, then Build (0 errors) -> Download.")
    print("    4. Validate the e-stop under LOTO, run 30 Hz, run live_capture.py.")
    print("\n  VARIABLES TO MAP (declare these 8 — Prog_VFD V2.1):")
    print("    clone vfd_status_word (WORD) ->")
    print("      vfd_warn_code   (HR 400120, reserved)   vfd_freq_cmd  (HR 400121)")
    print("      vfd_torque      (HR 400122)              vfd_motor_rpm (HR 400123)")
    print("      vfd_power       (HR 400124)              vfd_last_fault(HR 400125)")
    print("    clone poll_phase (BOOL) ->")
    print("      lp_toggle       (internal, not mapped)   last_fault_clear (coil 000024)")
    print("    (every register var's Dimension MUST be blank, or Build -> AnyArray error)")


if __name__ == "__main__":
    main()
