#!/usr/bin/env python3
"""Drop the MIRA Modbus server map into a CCW project — no typing.

CCW (Connected Components Workbench) stores the Modbus TCP/RTU server map
as a plain XML file inside the project directory:

    <ProjectDir>/Controller/Controller/MbSrvConf.xml

Editing it in the GUI is just typing into that file. So we skip the GUI
entirely: back up whatever's there, drop in `plc/MbSrvConf_v4.xml`
(22 coils + 17 holding registers, matching the v4.1.9 ladder), and
the next time CCW opens the project the mapping is fully populated.

Usage (run on the PLC laptop, where CCW lives):

    # auto-detect MIRA_PLC / Cosmos_Demo projects under ~/Documents/CCW
    python plc/deploy_modbus_map.py --auto

    # explicit project root
    python plc/deploy_modbus_map.py \\
        --project "C:/Users/hharp/Documents/CCW/Cosmos_Demo_v1.0"

    # dry-run (show what would change, don't write)
    python plc/deploy_modbus_map.py --auto --dry-run

    # use a different source XML (e.g. the older v3 map)
    python plc/deploy_modbus_map.py --auto --source plc/MbSrvConf_v3.xml

After it runs:

    1. Open CCW.
    2. Open the project file (.ccwsln).
    3. Build → Connect → Download → set to RUN.
    4. Verify from another box:
         python plc/live_monitor.py --host 192.168.1.100

Limitations:

  - CCW MUST NOT be holding the project open while this runs; close it
    first. Otherwise CCW's lock file will keep the old map.
  - Variables referenced in the map (motor_running, conveyor_running, ...)
    must already exist in the ladder. The Micro820 v3.x and v4.x programs
    in this repo include them all. If you're deploying onto a fresh
    project, run `populate_variables.py` first.
"""
from __future__ import annotations

import argparse
import datetime
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_SOURCE = "plc/MbSrvConf_v4.xml"
TARGET_RELATIVE = Path("Controller") / "Controller" / "MbSrvConf.xml"
COMMON_PARENTS = [
    Path.home() / "Documents" / "CCW",
    Path("C:/Users/hharp/Documents/CCW"),  # the original LAPTOP-0KA3C70H path
    Path("C:/CCW Projects"),
]


def _scan_for_projects(parents: list[Path]) -> list[Path]:
    """Find every directory under `parents` that contains the CCW Controller
    layout we expect — i.e. <parent>/Controller/Controller/ exists and could
    receive an `MbSrvConf.xml`."""
    found: list[Path] = []
    seen: set[Path] = set()
    for parent in parents:
        try:
            if not parent.exists():
                continue
        except OSError:
            continue
        for child in parent.iterdir():
            try:
                ctrl = child / "Controller" / "Controller"
                if not ctrl.is_dir():
                    continue
                if child.resolve() in seen:
                    continue
                seen.add(child.resolve())
                found.append(child)
            except (OSError, RuntimeError):
                continue
    return found


def _validate_source(path: Path) -> tuple[int, int]:
    """Return (coil_count, hr_count). Raises on malformed XML."""
    tree = ET.parse(path)
    root = tree.getroot()
    coils = 0
    hrs = 0
    for reg in root.findall("modbusRegister"):
        name = reg.get("name", "").upper()
        n = len(reg.findall("mapping"))
        if name == "COILS":
            coils += n
        elif "HOLDING" in name:
            hrs += n
    return coils, hrs


def _backup(target: Path) -> Path | None:
    """Backup an existing MbSrvConf.xml to a timestamped sibling."""
    if not target.exists():
        return None
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = target.with_name(f"{target.stem}.backup-{stamp}{target.suffix}")
    shutil.copy2(target, backup)
    return backup


def _ccw_is_open(project: Path) -> bool:
    """Cheap heuristic: any .lock / .ccwlock / ~$ file in the project tree."""
    patterns = ("*.lock", "*.ccwlock", "~$*")
    for pat in patterns:
        for hit in project.rglob(pat):
            if hit.is_file():
                return True
    return False


def _yes(prompt: str, default: bool = False) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    try:
        ans = input(f"{prompt} {suffix} ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    if not ans:
        return default
    return ans in ("y", "yes")


def _print_table(rows: list[tuple[str, str]]) -> None:
    if not rows:
        return
    key_w = max(len(r[0]) for r in rows) + 2
    for k, v in rows:
        print(f"  {k.ljust(key_w)}{v}")


def deploy(source: Path, project: Path, *, dry_run: bool, force: bool) -> int:
    if not source.is_file():
        print(f"ERROR: source XML not found: {source}", file=sys.stderr)
        return 2

    target = project / TARGET_RELATIVE
    target_dir = target.parent
    if not target_dir.is_dir():
        print(f"ERROR: project layout not recognised — missing {target_dir}", file=sys.stderr)
        return 2

    try:
        coils, hrs = _validate_source(source)
    except ET.ParseError as exc:
        print(f"ERROR: source XML failed to parse: {exc}", file=sys.stderr)
        return 2

    if _ccw_is_open(project) and not force:
        print(
            "WARNING: Looks like CCW may have this project open (lock file detected).\n"
            "         Close the project in CCW before deploying, or re-run with --force.",
            file=sys.stderr,
        )
        return 3

    print()
    print("Modbus map deployment plan")
    print("-" * 60)
    _print_table([
        ("Source XML  ", str(source)),
        ("Coils        ", f"{coils} mapped"),
        ("Holding regs ", f"{hrs} mapped"),
        ("Project root ", str(project)),
        ("Target file  ", str(target)),
        ("Target exists", "yes" if target.exists() else "no — will create"),
        ("Mode         ", "DRY-RUN (no changes)" if dry_run else "WRITE"),
    ])
    print()

    if dry_run:
        print("Dry-run complete. Re-run without --dry-run to apply.")
        return 0

    if not force and not _yes("Apply this deploy?", default=True):
        print("Aborted by user.")
        return 1

    backup = _backup(target)
    shutil.copy2(source, target)
    print()
    print("done.")
    if backup:
        print(f"  backed up old map  -> {backup}")
    print(f"  wrote new map      -> {target}")
    print()
    print("Next steps (on this laptop):")
    print("  1. Open the .ccwsln in CCW.")
    print("  2. Build → Connect → Download → set RUN.")
    print()
    print("Verify from another machine:")
    print("  python plc/live_monitor.py --host 192.168.1.100")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--project",
        type=Path,
        help="CCW project root (the directory that contains 'Controller/Controller/').",
    )
    ap.add_argument(
        "--auto",
        action="store_true",
        help="Scan ~/Documents/CCW and C:/Users/hharp/Documents/CCW for projects and pick one.",
    )
    ap.add_argument(
        "--source",
        type=Path,
        default=Path(DEFAULT_SOURCE),
        help=f"Source XML to deploy (default: {DEFAULT_SOURCE}).",
    )
    ap.add_argument("--dry-run", action="store_true", help="Print plan, don't write.")
    ap.add_argument("--force", action="store_true", help="Skip confirmation prompt and CCW-open check.")
    args = ap.parse_args()

    # Resolve source relative to repo root if it's a relative path.
    src = args.source
    if not src.is_absolute():
        # Try CWD first, then repo root inferred from this script's location.
        for base in (Path.cwd(), Path(__file__).resolve().parent.parent):
            candidate = (base / src).resolve()
            if candidate.is_file():
                src = candidate
                break
        else:
            src = src.resolve()

    if args.project:
        return deploy(src, args.project.resolve(), dry_run=args.dry_run, force=args.force)

    if args.auto:
        candidates = _scan_for_projects(COMMON_PARENTS)
        if not candidates:
            print("ERROR: no CCW projects found under the common parents:", file=sys.stderr)
            for p in COMMON_PARENTS:
                print(f"  {p}", file=sys.stderr)
            print("Re-run with --project <path>.", file=sys.stderr)
            return 4
        if len(candidates) == 1:
            return deploy(src, candidates[0], dry_run=args.dry_run, force=args.force)
        print("Multiple CCW projects found:")
        for idx, c in enumerate(candidates, 1):
            print(f"  [{idx}] {c}")
        try:
            pick = int(input("Pick one: ").strip())
        except (ValueError, EOFError, KeyboardInterrupt):
            print("Aborted.", file=sys.stderr)
            return 1
        if not (1 <= pick <= len(candidates)):
            print("Invalid selection.", file=sys.stderr)
            return 1
        return deploy(src, candidates[pick - 1], dry_run=args.dry_run, force=args.force)

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
