#!/usr/bin/env python3
"""Build the Conv_Simple_1.9 CCW package — Trends V2, full GS10 monitoring.

WHY A BUILDER (and not a fully-baked project): CCW stores program logic and
variable declarations in proprietary BINARY files (`*.rtc`, binary `*.xtc`
symbol tables, and `PrjLibrary.accdb` — a MS Access DB). Hand-authoring those
blind corrupts the project. The ONE thing CCW reliably reads from plain text on
open is the device config XML (`MbSrvConf.xml`) — so the slave map CAN be baked,
but the program + variables must be brought in through CCW's own UI/import.

So this builder does everything that is SAFE to automate, and leaves the
irreducible two in-CCW actions (import variables, paste the program) staged and
trivial:

  1. Clone Conv_Simple_1.8 -> Conv_Simple_1.9   (1.8 stays pristine as fallback)
  2. Rename the .ccwsln so it opens as "Conv_Simple_1.9"
  3. BAKE the V1.9 slave map into the clone's MbSrvConf.xml (CCW reads on open)
  4. Stage _V1.9_APPLY/ inside the clone: the Prog_init V1.9 ST, the variable
     import CSV, and the INSTALL card with the exact remaining clicks.

After it runs you: open Conv_Simple_1.9 -> import vars -> paste Prog_init V1.9
-> Build -> Download. The slave map is already in place.

Usage (PLC laptop, CCW CLOSED):
    python plc/build_conv_simple_1_9.py --dry-run        # show the plan
    python plc/build_conv_simple_1_9.py                  # build it
    python plc/build_conv_simple_1_9.py --force          # overwrite an existing 1.9

The repo artifacts it stages live next to this script in plc/:
    Prog_init_ConvSimple_v1.9.st, MbSrvConf_ConvSimple_v1.9.xml,
    vars_ConvSimple_v1.9.csv, INSTALL_ConvSimple_v1.9.md
"""
from __future__ import annotations

import argparse
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_CCW_ROOT = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC")
SRC_NAME = "Conv_Simple_1.8"
DST_NAME = "Conv_Simple_1.9"

# CCW per-solution/per-session transient state — never clone it (CCW regenerates).
SKIP = shutil.ignore_patterns(
    ".vs", "SpyListPersistence", "*.tmp", "UserAccess.CCW.tmp",
    "CONTROLLER.err", "Breakpoints.lst", "*.bak",
)

HERE = Path(__file__).resolve().parent          # repo plc/
SLAVE_MAP_SRC = HERE / "MbSrvConf_ConvSimple_v1.9.xml"
STAGE_FILES = [
    HERE / "Prog_init_ConvSimple_v1.9.st",
    HERE / "vars_ConvSimple_v1.9.csv",
    HERE / "INSTALL_ConvSimple_v1.9.md",
]
# Inside the cloned project, this is the device config CCW reads on open.
MBSRV_REL = Path("Controller") / "Controller" / "MbSrvConf.xml"


def fail(msg: str) -> "None":
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the Conv_Simple_1.9 CCW package.")
    ap.add_argument("--ccw-root", type=Path, default=DEFAULT_CCW_ROOT,
                    help=f"folder holding {SRC_NAME} (default: {DEFAULT_CCW_ROOT})")
    ap.add_argument("--dry-run", action="store_true", help="show the plan, change nothing")
    ap.add_argument("--force", action="store_true", help="overwrite an existing Conv_Simple_1.9")
    args = ap.parse_args()

    src = args.ccw_root / SRC_NAME
    dst = args.ccw_root / DST_NAME

    # --- preflight ---------------------------------------------------------
    if not src.is_dir():
        fail(f"source project not found: {src}")
    if not (src / f"{SRC_NAME}.ccwsln").is_file():
        fail(f"{src} does not look like a CCW project (no {SRC_NAME}.ccwsln)")
    if not SLAVE_MAP_SRC.is_file():
        fail(f"missing repo artifact: {SLAVE_MAP_SRC}")
    for f in STAGE_FILES:
        if not f.is_file():
            fail(f"missing repo artifact to stage: {f}")
    if dst.exists() and not args.force:
        fail(f"{dst} already exists. Re-run with --force to overwrite, "
             f"or delete it first.")

    # validate the slave map before we bake it
    try:
        t = ET.parse(SLAVE_MAP_SRC)
        nc = len(t.findall('.//modbusRegister[@name="COILS"]/mapping'))
        nh = len(t.findall('.//modbusRegister[@name="HOLDING_REGISTERS"]/mapping'))
    except ET.ParseError as e:
        fail(f"slave map is not well-formed XML: {e}")

    print("Conv_Simple_1.9 package build plan")
    print("-" * 60)
    print(f"  Source        {src}")
    print(f"  Destination   {dst}{'  (EXISTS, will overwrite)' if dst.exists() else ''}")
    print(f"  Slave map     {SLAVE_MAP_SRC.name}  ({nc} coils, {nh} HRs) -> {MBSRV_REL}")
    print(f"  Staged in     {DST_NAME}/_V1.9_APPLY/:")
    for f in STAGE_FILES:
        print(f"                  {f.name}")
    print(f"  Mode          {'DRY-RUN (no changes)' if args.dry_run else 'APPLY'}")
    print("-" * 60)
    if args.dry_run:
        print("Dry-run complete. Re-run without --dry-run to build.")
        return

    # --- 1. clone ----------------------------------------------------------
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=SKIP)
    print(f"[1/4] cloned -> {dst}")

    # --- 2. rename the solution file ---------------------------------------
    old_sln = dst / f"{SRC_NAME}.ccwsln"
    new_sln = dst / f"{DST_NAME}.ccwsln"
    if old_sln.is_file():
        old_sln.rename(new_sln)
        print(f"[2/4] solution -> {new_sln.name}  (references are relative; safe)")
    else:
        print(f"[2/4] WARN: {old_sln.name} not found in clone — open the .ccwsln present")

    # --- 3. bake the V1.9 slave map ----------------------------------------
    target_map = dst / MBSRV_REL
    if target_map.is_file():
        shutil.copy2(target_map, target_map.with_suffix(".xml.pre_v1_9.bak"))
    shutil.copy2(SLAVE_MAP_SRC, target_map)
    # confirm it took
    chk = ET.parse(target_map)
    cc = len(chk.findall('.//modbusRegister[@name="COILS"]/mapping'))
    ch = len(chk.findall('.//modbusRegister[@name="HOLDING_REGISTERS"]/mapping'))
    if (cc, ch) != (nc, nh):
        fail(f"slave-map bake mismatch: wrote {nc}/{nh}, read back {cc}/{ch}")
    print(f"[3/4] baked slave map -> {MBSRV_REL}  ({cc} coils, {ch} HRs)")

    # --- 4. stage the apply kit --------------------------------------------
    apply_dir = dst / "_V1.9_APPLY"
    apply_dir.mkdir(exist_ok=True)
    for f in STAGE_FILES:
        shutil.copy2(f, apply_dir / f.name)
    print(f"[4/4] staged apply kit -> {apply_dir}")

    print("\nDONE. Conv_Simple_1.9 is ready.")
    print(f"  Open:   {new_sln}")
    print(f"  Then follow: {apply_dir / 'INSTALL_ConvSimple_v1.9.md'}")
    print("  (slave map already baked; remaining = import vars + paste Prog_init V1.9 + build)")


if __name__ == "__main__":
    main()
