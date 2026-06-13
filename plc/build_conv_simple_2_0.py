#!/usr/bin/env python3
"""Build the Conv_Simple_2.0 CCW package — clean, from the PROVEN-GOOD 1.8.

WHY 2.0 IS CLONED FROM 1.8 (NOT 1.9): the 1.9 project image corrupted (symbol-
table desync — its ladder source + compiled PROG1.ic + IO.rtc are byte-identical
to 1.8, but the variable-binding/config tables shifted under them, which inverted
the e-stop on download). Pristine 1.8 downloads correctly. So 2.0 starts from the
trustworthy 1.8 baseline and re-applies ONLY the torque/rpm/power additions on top.
Full evidence: plc/EVIDENCE_ConvSimple_1.9_corruption.md.

This also fixes the version-naming mismatch: project Conv_Simple_2.0 carries
Prog_VFD V2.0 (project name == POU version, the established convention).

Like the 1.9 builder, this does everything SAFE to automate and leaves the two
irreducible in-CCW actions (declare vars, paste the program) staged + trivial:

  1. Clone Conv_Simple_1.8 -> Conv_Simple_2.0   (1.8 stays pristine as fallback)
  2. Rename the .ccwsln so it opens as "Conv_Simple_2.0"
  3. Stage _V2.0_APPLY/ inside the clone: Prog_init V2.0 ST, the .ccwmod map,
     the variable delta, and the INSTALL card with the exact remaining clicks.

It deliberately does NOT bake the Modbus map into MbSrvConf.xml: a map that
references variables not yet declared makes the ISaGRAF build throw. Declare the
vars in CCW first, THEN Import the .ccwmod (this is the proven order).

Usage (PLC laptop, CCW CLOSED):
    python plc/build_conv_simple_2_0.py --dry-run     # show the plan
    python plc/build_conv_simple_2_0.py               # build it
    python plc/build_conv_simple_2_0.py --force       # overwrite an existing 2.0
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

DEFAULT_CCW_ROOT = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC")
SRC_NAME = "Conv_Simple_1.8"          # PROVEN-GOOD baseline (correct e-stop)
DST_NAME = "Conv_Simple_2.0"

# CCW per-solution/per-session transient state — never clone it (CCW regenerates).
SKIP = shutil.ignore_patterns(
    ".vs", "SpyListPersistence", "*.tmp", "UserAccess.CCW.tmp",
    "CONTROLLER.err", "Breakpoints.lst", "*.bak",
)

HERE = Path(__file__).resolve().parent          # repo plc/
STAGE_FILES = [
    HERE / "Prog_init_ConvSimple_v2.0.st",
    HERE / "Modbus_ConvSimple_v1.9.ccwmod",      # register map is unchanged for 2.0
    HERE / "CCW_VARIABLES_ConvSimple_v2.0_DELTA.md",  # 8 vars, no read_sel (NOT the v1.9 delta)
    HERE / "INSTALL_ConvSimple_v2.0.md",
    HERE / "EVIDENCE_ConvSimple_1.9_corruption.md",
]


def fail(msg: str) -> "None":
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# The 8 (NOT 9) new globals the V2.0 program needs. read_sel is v1.9-only and
# must never appear in a 2.0 kit (see CCW_VARIABLES_ConvSimple_v2.0_DELTA.md).
EXPECTED_V20_VARS = {
    "vfd_warn_code", "vfd_freq_cmd", "vfd_torque", "vfd_motor_rpm",
    "vfd_power", "vfd_last_fault", "lp_toggle", "last_fault_clear",
}
_DELTA_VAR_ROW = re.compile(r"^\s*\|\s*`([A-Za-z_]\w*)`\s*\|")  # md table row: | `name` | ...


def check_stage(apply_dir: Path) -> None:
    """Verify the staged kit is V2.0-consistent. Catches the stale-checklist
    desync (v1.9 delta / read_sel / wrong var count / wrong program header)
    that would otherwise only surface as confusion in CCW."""
    problems: list[str] = []

    delta = apply_dir / "CCW_VARIABLES_ConvSimple_v2.0_DELTA.md"
    if not delta.is_file():
        problems.append(
            "v2.0 variable delta not staged — operator would fall back to the "
            "v1.9 list (9 vars incl. read_sel)")
    else:
        declared = {m.group(1) for ln in delta.read_text(encoding="utf-8", errors="ignore").splitlines()
                    if (m := _DELTA_VAR_ROW.match(ln))}
        if "read_sel" in declared:
            problems.append("staged delta declares read_sel in its variable table (v1.9 leaked in)")
        if declared != EXPECTED_V20_VARS:
            problems.append(
                f"staged delta var table {sorted(declared)} != the 8 expected "
                f"{sorted(EXPECTED_V20_VARS)}")

    prog = apply_dir / "Prog_init_ConvSimple_v2.0.st"
    if prog.is_file():
        head = prog.read_text(encoding="utf-8", errors="ignore")
        if "Prog_VFD V2.0" not in head or "Conv_Simple_2.0" not in head:
            problems.append("staged program header is not 'Conv_Simple_2.0  Prog_VFD V2.0'")

    if problems:
        print("\nKIT-CONSISTENCY CHECK FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        fail("staged apply kit is inconsistent — fix STAGE_FILES / source docs and rebuild")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the Conv_Simple_2.0 CCW package.")
    ap.add_argument("--ccw-root", type=Path, default=DEFAULT_CCW_ROOT,
                    help=f"folder holding {SRC_NAME} (default: {DEFAULT_CCW_ROOT})")
    ap.add_argument("--dry-run", action="store_true", help="show the plan, change nothing")
    ap.add_argument("--force", action="store_true", help="overwrite an existing Conv_Simple_2.0")
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
        fail(f"{dst} already exists. Re-run with --force to overwrite, or delete it first.")

    print("Conv_Simple_2.0 package build plan  (clean, from proven-good 1.8)")
    print("-" * 64)
    print(f"  Source        {src}   (PRISTINE -- correct e-stop)")
    print(f"  Destination   {dst}{'  (EXISTS, will overwrite)' if dst.exists() else ''}")
    print(f"  Slave map     KEEP 1.8 original; V2.0 map applied via .ccwmod Import")
    print(f"                AFTER the 8 vars are declared (NOT baked).")
    print(f"  Staged in     {DST_NAME}/_V2.0_APPLY/:")
    for f in STAGE_FILES:
        print(f"                  {f.name}")
    print(f"  Mode          {'DRY-RUN (no changes)' if args.dry_run else 'APPLY'}")
    print("-" * 64)
    if args.dry_run:
        print("Dry-run complete. Re-run without --dry-run to build.")
        return

    # --- 1. clone ----------------------------------------------------------
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=SKIP)
    print(f"[1/3] cloned {SRC_NAME} -> {dst}")

    # --- 2. rename the solution file ---------------------------------------
    old_sln = dst / f"{SRC_NAME}.ccwsln"
    new_sln = dst / f"{DST_NAME}.ccwsln"
    if old_sln.is_file():
        old_sln.rename(new_sln)
        print(f"[2/3] solution -> {new_sln.name}  (references are relative; safe)")
    else:
        print(f"[2/3] WARN: {old_sln.name} not found in clone — open the .ccwsln present")

    # --- 3. stage the apply kit --------------------------------------------
    apply_dir = dst / "_V2.0_APPLY"
    apply_dir.mkdir(exist_ok=True)
    for f in STAGE_FILES:
        shutil.copy2(f, apply_dir / f.name)
    print(f"[3/3] staged apply kit -> {apply_dir}")

    # --- 4. kit-consistency check (fail loud on a stale-checklist desync) ----
    # Why: the kit once shipped the v1.9 variable delta into a 2.0 build. That
    # list's first row is read_sel (a v1.9-only var 2.0 dropped) and it said
    # "9 vars" — sending the operator to declare a var the program never uses.
    # This makes that class of desync a hard build-time failure, not a surprise
    # in CCW. (`8 vars, no read_sel` is the 2.0 invariant.)
    check_stage(apply_dir)
    print("[4/4] kit-consistency check passed (8 vars, no read_sel, header OK)")

    print("\nDONE. Conv_Simple_2.0 is a clean clone of proven-good 1.8 (builds as-is).")
    print(f"  Open:   {new_sln}")
    print(f"  Follow: {apply_dir / 'INSTALL_ConvSimple_v2.0.md'}")
    print("  (declare 8 vars -> Import .ccwmod -> paste Prog_init V2.0 -> Clean -> Build -> Download)")
    print("  THEN re-validate the e-stop under LOTO before running.")


if __name__ == "__main__":
    main()
