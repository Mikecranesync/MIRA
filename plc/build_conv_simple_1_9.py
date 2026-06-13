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
# NOTE: we deliberately do NOT bake MbSrvConf_ConvSimple_v1.9.xml into the clone.
# That map references the 7 new V1.9 variables, which don't exist until they're
# declared in CCW — and a Modbus mapping pointing at a non-existent variable makes
# the ISaGRAF build task throw (ISaGRAF.CCW.targets exception). The clone keeps
# 1.8's original map (builds clean); the V1.9 mappings are applied via CCW's
# Import Modbus Mapping using the staged .ccwmod, AFTER the vars are declared.
STAGE_FILES = [
    HERE / "Prog_init_ConvSimple_v1.9.st",
    HERE / "vars_ConvSimple_v1.9.csv",
    HERE / "Modbus_ConvSimple_v1.9.ccwmod",
    HERE / "INSTALL_ConvSimple_v1.9.md",
]


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
    for f in STAGE_FILES:
        if not f.is_file():
            fail(f"missing repo artifact to stage: {f}")
    if dst.exists() and not args.force:
        fail(f"{dst} already exists. Re-run with --force to overwrite, "
             f"or delete it first.")

    print("Conv_Simple_1.9 package build plan")
    print("-" * 60)
    print(f"  Source        {src}")
    print(f"  Destination   {dst}{'  (EXISTS, will overwrite)' if dst.exists() else ''}")
    print(f"  Slave map     KEEP 1.8 original (V1.9 map applied via .ccwmod Import")
    print(f"                AFTER vars are declared — NOT baked, see header note)")
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

    # --- 3. slave map: KEEP 1.8 original (do NOT bake the V1.9 map) --------
    # The V1.9 map references vars that don't exist until declared; baking it
    # makes ISaGRAF codegen throw. Leave the cloned 1.8 map so the project builds.
    print("[3/4] kept 1.8 Modbus map (V1.9 map staged for Import after vars exist)")

    # --- 4. stage the apply kit --------------------------------------------
    apply_dir = dst / "_V1.9_APPLY"
    apply_dir.mkdir(exist_ok=True)
    for f in STAGE_FILES:
        shutil.copy2(f, apply_dir / f.name)
    print(f"[4/4] staged apply kit -> {apply_dir}")

    print("\nDONE. Conv_Simple_1.9 is ready (clean — builds as-is, = renamed 1.8).")
    print(f"  Open:   {new_sln}")
    print(f"  Then follow: {apply_dir / 'INSTALL_ConvSimple_v1.9.md'}")
    print("  (declare 9 vars -> Import the .ccwmod -> paste Prog_init V1.9 -> Build -> Download)")


if __name__ == "__main__":
    main()
