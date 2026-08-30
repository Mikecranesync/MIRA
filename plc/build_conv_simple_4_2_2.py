#!/usr/bin/env python3
"""Build the Conv_Simple_4.2.2 CCW project package.

This follows the older Claude/CCW package pattern:

1. Clone the existing v4-style CCW project (`MIRA_PLC.ccwsln` + `controller/`).
2. Rename the solution to `Conv_Simple_4.2.2.ccwsln`.
3. Bake `Micro820_v4.2.2_Program.st` into the clone's `Prog2.stf`.
4. Stage the install/variable/safety docs in `_V4.2.2_APPLY/`.

It deliberately does not edit `PrjLibrary.accdb` or compiled CCW artifacts.
The new globals still have to be declared in CCW, then CCW must Clean/Build.

Usage on the PLC laptop with CCW closed:

    python plc/build_conv_simple_4_2_2.py --dry-run
    python plc/build_conv_simple_4_2_2.py
    python plc/build_conv_simple_4_2_2.py --force
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


DEFAULT_CCW_ROOT = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC")
SRC_SOLUTION = "MIRA_PLC.ccwsln"
SRC_CONTROLLER_DIR = "controller"
DST_NAME = "Conv_Simple_4.2.2"

PROG2_REL = Path("controller/Controller/Micro820/Micro820/Prog2.stf")
DWELL_ORDER_REL = Path("controller/Controller/Micro820/Micro820/DwlOrder.txt")

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
PROGRAM_SRC = HERE / "Micro820_v4.2.2_Program.st"
STAGE_FILES = [
    PROGRAM_SRC,
    HERE / "CCW_VARIABLES_ConvSimple_v4.2.2_DELTA.md",
    HERE / "INSTALL_ConvSimple_v4.2.2.md",
    HERE / "DISCHARGE_CONVEYOR_HUMAN_ACCEPTANCE_PATCH.md",
]


def read_ccw_st_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").lstrip("\ufeff")


def fail(message: str) -> "None":
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def check_source(root: Path) -> None:
    if not (root / SRC_SOLUTION).is_file():
        fail(f"source solution not found: {root / SRC_SOLUTION}")
    if not (root / SRC_CONTROLLER_DIR).is_dir():
        fail(f"source controller folder not found: {root / SRC_CONTROLLER_DIR}")
    if not (root / PROG2_REL).is_file():
        fail(f"source Prog2.stf not found: {root / PROG2_REL}")
    if not (root / DWELL_ORDER_REL).is_file():
        fail(f"source DwlOrder.txt not found: {root / DWELL_ORDER_REL}")

    order = (root / DWELL_ORDER_REL).read_text(encoding="utf-8", errors="ignore").strip()
    if order != "PROG2":
        fail(f"unexpected download order {order!r}; expected PROG2")

    for file in STAGE_FILES:
        if not file.is_file():
            fail(f"missing repo artifact to stage: {file}")


def check_baked_project(dst: Path) -> None:
    prog2 = dst / PROG2_REL
    text = prog2.read_text(encoding="utf-8", errors="ignore")
    problems: list[str] = []

    required = [
        "PROGRAM Prog2",
        "Version:  v4.2.2",
        "O-04 = AmberLight",
        "Only Prog2 may drive _IO_EM_DO_04",
        "_IO_EM_DO_04 := TRUE;",
        "_IO_EM_DO_04 := amber_led_flash;",
        "discharge_pending_acceptance := TRUE;",
    ]
    for needle in required:
        if needle not in text:
            problems.append(f"baked Prog2.stf missing {needle!r}")
    if text.startswith("\ufeff"):
        problems.append("baked Prog2.stf starts with UTF-8 BOM; CCW reports this as PROG2(0,0) syntax error")
    if (
        "e_stop_ok :=" in text
        or "E_STOP_OK" in text
        or "e_stop_ok" in text[text.index("NEW VARIABLES") : text.index("Physical I/O")]
    ):
        problems.append("baked Prog2.stf still depends on undeclared e_stop_ok")

    if (dst / "controller/Controller/Micro820/Micro820/Prog1.stf").exists():
        problems.append("unexpected Prog1.stf in v4-style package")

    staged = dst / "_V4.2.2_APPLY"
    for file in STAGE_FILES:
        if not (staged / file.name).is_file():
            problems.append(f"staged apply file missing: {file.name}")

    if problems:
        print("\nPACKAGE CHECK FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  x {problem}", file=sys.stderr)
        fail("generated CCW package is inconsistent")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Conv_Simple_4.2.2 CCW package.")
    parser.add_argument("--ccw-root", type=Path, default=DEFAULT_CCW_ROOT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.ccw_root
    dst = root / DST_NAME
    check_source(root)

    if dst.exists() and not args.force and not args.dry_run:
        fail(f"{dst} already exists. Re-run with --force to overwrite it.")
    if dst.exists() and args.force and not args.dry_run and (dst / "UserAccess.CCW.tmp").exists():
        fail(f"{dst} appears to be open in CCW (UserAccess.CCW.tmp exists). Close CCW before --force.")

    print("Conv_Simple_4.2.2 package build plan")
    print("-" * 64)
    print(f"  Source solution {root / SRC_SOLUTION}")
    print(f"  Source project  {root / SRC_CONTROLLER_DIR}")
    print(f"  Destination     {dst}{' (exists, will overwrite)' if dst.exists() else ''}")
    print(f"  Bake program    {PROGRAM_SRC.name} -> {PROG2_REL}")
    print("  Variables       declare in CCW from the staged delta doc")
    print("  Build/download  manual in CCW; no headless build exists")
    print(f"  Mode            {'DRY-RUN' if args.dry_run else 'APPLY'}")
    print("-" * 64)

    if args.dry_run:
        print("Dry-run complete. Re-run without --dry-run to build the project folder.")
        return

    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)

    shutil.copytree(root / SRC_CONTROLLER_DIR, dst / SRC_CONTROLLER_DIR, ignore=SKIP)
    shutil.copy2(root / SRC_SOLUTION, dst / f"{DST_NAME}.ccwsln")
    print(f"[1/4] cloned controller project -> {dst}")

    prog2 = dst / PROG2_REL
    backup = prog2.with_suffix(".stf.pre_v4_2_2.bak")
    shutil.copy2(prog2, backup)
    prog2.write_text(read_ccw_st_text(PROGRAM_SRC), encoding="utf-8", newline="\r\n")
    print(f"[2/4] baked {PROGRAM_SRC.name} -> {PROG2_REL} (backup {backup.name})")

    apply_dir = dst / "_V4.2.2_APPLY"
    apply_dir.mkdir()
    for file in STAGE_FILES:
        shutil.copy2(file, apply_dir / file.name)
    print(f"[3/4] staged apply kit -> {apply_dir}")

    check_baked_project(dst)
    print("[4/4] package consistency check passed")

    print("\nDONE. Open this in CCW:")
    print(f"  {dst / (DST_NAME + '.ccwsln')}")
    print("\nThen follow:")
    print(f"  {apply_dir / 'INSTALL_ConvSimple_v4.2.2.md'}")


if __name__ == "__main__":
    main()

