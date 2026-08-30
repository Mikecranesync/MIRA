#!/usr/bin/env python3
"""Build the Conv_Simple_2.2 CCW project package.

Conv_Simple_2.2 is the discharge-acceptance package rebuilt on the confirmed
good 2.0 project shape:

1. Clone `Conv_Simple_2.0` -> `Conv_Simple_2.2`.
2. Preserve the two-POU layout and download order: PROG1, then PROG_INIT.
3. Bake the v2.2 PROG1 ladder source so DO4 follows amber_led_flash.
4. Bake the v2.2 PROG_INIT ST source with the human acceptance gate.
5. Stage the install/variable docs.

It deliberately does not edit PrjLibrary.accdb or generated compiled artifacts.
New globals still have to be declared in CCW, then CCW must Clean/Build.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


DEFAULT_CCW_ROOT = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC")
SRC_NAME = "Conv_Simple_2.0"
DST_NAME = "Conv_Simple_2.2"

MICRO_REL = Path("controller/Controller/Micro820/Micro820")
PROG1_REL = MICRO_REL / "Prog1.stf"
PROG_INIT_REL = MICRO_REL / "Prog_init.stf"
DWL_ORDER_REL = MICRO_REL / "DwlOrder.txt"

SKIP = shutil.ignore_patterns(
    ".vs",
    "SpyListPersistence",
    "*.tmp",
    "UserAccess.CCW.tmp",
    "CONTROLLER.err",
    "Breakpoints.lst",
    "*.bak",
)

HERE = Path(__file__).resolve().parent
PROG1_SRC = HERE / "Prog1_ConvSimple_v2.2.st"
PROG_INIT_SRC = HERE / "Prog_init_ConvSimple_v2.2.st"
STAGE_FILES = [
    PROG1_SRC,
    PROG_INIT_SRC,
    HERE / "CCW_VARIABLES_ConvSimple_v2.2_DELTA.md",
    HERE / "INSTALL_ConvSimple_v2.2.md",
    HERE / "DISCHARGE_CONVEYOR_HUMAN_ACCEPTANCE_PATCH.md",
]


def fail(message: str) -> "None":
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def read_ccw_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").lstrip("\ufeff")


def write_ccw_text(path: Path, text: str) -> None:
    path.write_text(text.lstrip("\ufeff"), encoding="utf-8", newline="\r\n")


def check_source(src: Path) -> None:
    if not src.is_dir():
        fail(f"source project not found: {src}")
    if not (src / f"{SRC_NAME}.ccwsln").is_file():
        fail(f"source solution not found: {src / (SRC_NAME + '.ccwsln')}")
    for rel in (PROG1_REL, PROG_INIT_REL, DWL_ORDER_REL):
        if not (src / rel).is_file():
            fail(f"source file missing: {src / rel}")
    order = (src / DWL_ORDER_REL).read_text(encoding="utf-8", errors="ignore").strip().splitlines()
    if order != ["PROG1", "PROG_INIT"]:
        fail(f"unexpected source download order {order!r}; expected ['PROG1', 'PROG_INIT']")
    for file in STAGE_FILES:
        if not file.is_file():
            fail(f"missing repo artifact to stage: {file}")


def check_baked_project(dst: Path) -> None:
    problems: list[str] = []
    order = (dst / DWL_ORDER_REL).read_text(encoding="utf-8", errors="ignore").strip().splitlines()
    if order != ["PROG1", "PROG_INIT"]:
        problems.append(f"DwlOrder.txt is {order!r}; expected PROG1 then PROG_INIT")

    prog1 = read_ccw_text(dst / PROG1_REL)
    if "PROGRAM Prog1" not in prog1:
        problems.append("Prog1.stf is missing PROGRAM Prog1")
    do4_lines = [line for line in prog1.splitlines() if "_IO_EM_DO_04" in line]
    if not any("amber_led_flash" in line for line in do4_lines):
        problems.append("Prog1.stf does not drive DO4 from amber_led_flash")
    if any("_IO_EM_DI_00*) (*dir_fwd_sw*)" in line for line in do4_lines):
        problems.append("Prog1.stf still appears to use DO4 as the forward-direction lamp")

    prog_init = read_ccw_text(dst / PROG_INIT_REL)
    required = [
        "PROGRAM Prog_init",
        "Conv_Simple_2.2 Prog_VFD V2.2",
        "simlab_discharge_request",
        "discharge_pending_acceptance := TRUE;",
        "green_start_rising := green_start_pb AND NOT prev_green_start_pb;",
        "amber_led_flash := discharge_pending_acceptance AND amber_blink_phase;",
        "remote_start_allowed",
        "vfd_run_permit :=",
        "END_PROGRAM",
    ]
    for needle in required:
        if needle not in prog_init:
            problems.append(f"Prog_init.stf missing {needle!r}")
    if prog_init.startswith("\ufeff") or prog1.startswith("\ufeff"):
        problems.append("baked ST source starts with UTF-8 BOM")
    if "PROGRAM Prog2" in prog_init or (dst / (MICRO_REL / "Prog2.stf")).exists():
        problems.append("bad Prog2 artifact found in 2.2 package")

    staged = dst / "_V2.2_APPLY"
    for file in STAGE_FILES:
        if not (staged / file.name).is_file():
            problems.append(f"staged apply file missing: {file.name}")

    if problems:
        print("\nPACKAGE CHECK FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  x {problem}", file=sys.stderr)
        fail("generated CCW package is inconsistent")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Conv_Simple_2.2 CCW package.")
    parser.add_argument("--ccw-root", type=Path, default=DEFAULT_CCW_ROOT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    src = args.ccw_root / SRC_NAME
    dst = args.ccw_root / DST_NAME
    check_source(src)

    if dst.exists() and not args.force and not args.dry_run:
        fail(f"{dst} already exists. Re-run with --force to overwrite it.")
    if dst.exists() and args.force and not args.dry_run and (dst / "UserAccess.CCW.tmp").exists():
        fail(f"{dst} appears to be open in CCW (UserAccess.CCW.tmp exists). Close CCW before --force.")

    print("Conv_Simple_2.2 package build plan")
    print("-" * 64)
    print(f"  Source        {src}  (confirmed-good 2.0 shape)")
    print(f"  Destination   {dst}{' (exists, will overwrite)' if dst.exists() else ''}")
    print(f"  Preserve      DwlOrder.txt = PROG1, PROG_INIT")
    print(f"  Bake ladder   {PROG1_SRC.name} -> {PROG1_REL}")
    print(f"  Bake ST       {PROG_INIT_SRC.name} -> {PROG_INIT_REL}")
    print(f"  Mode          {'DRY-RUN' if args.dry_run else 'APPLY'}")
    print("-" * 64)

    if args.dry_run:
        print("Dry-run complete. Re-run without --dry-run to build the project folder.")
        return

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=SKIP)
    print(f"[1/5] cloned {SRC_NAME} -> {dst}")

    old_sln = dst / f"{SRC_NAME}.ccwsln"
    new_sln = dst / f"{DST_NAME}.ccwsln"
    if old_sln.is_file():
        old_sln.rename(new_sln)
    print(f"[2/5] solution -> {new_sln.name}")

    prog1 = dst / PROG1_REL
    prog1_backup = prog1.with_suffix(".stf.pre_v2_2.bak")
    shutil.copy2(prog1, prog1_backup)
    write_ccw_text(prog1, read_ccw_text(PROG1_SRC))
    print(f"[3/5] baked {PROG1_SRC.name} -> {PROG1_REL}")

    prog_init = dst / PROG_INIT_REL
    prog_init_backup = prog_init.with_suffix(".stf.pre_v2_2.bak")
    shutil.copy2(prog_init, prog_init_backup)
    write_ccw_text(prog_init, read_ccw_text(PROG_INIT_SRC))
    print(f"[4/5] baked {PROG_INIT_SRC.name} -> {PROG_INIT_REL}")

    apply_dir = dst / "_V2.2_APPLY"
    apply_dir.mkdir()
    for file in STAGE_FILES:
        write_ccw_text(apply_dir / file.name, read_ccw_text(file))
    check_baked_project(dst)
    print(f"[5/5] staged apply kit -> {apply_dir} and package check passed")

    print("\nDONE. Open this in CCW:")
    print(f"  {new_sln}")
    print("\nThen follow:")
    print(f"  {apply_dir / 'INSTALL_ConvSimple_v2.2.md'}")


if __name__ == "__main__":
    main()
