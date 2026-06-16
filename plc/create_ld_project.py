#!/usr/bin/env python3
r"""
create_ld_project.py -- Clone MIRA_PLC (ST) into MIRA_PLC_LD for Ladder Diagram entry.

Copies the entire CCW project, gives it a new GUID so both can coexist,
removes the ST source and compiled artifacts, and preserves all hardware
config, variables, and Modbus mappings.

Usage:
    python create_ld_project.py          # creates MIRA_PLC_LD in CCW folder
    python create_ld_project.py --force  # overwrites if already exists
"""

import os
import sys
import shutil
import uuid
import re

# ── Paths ──────────────────────────────────────────────────────────────────────
CCW_DIR = r"C:\Users\hharp\Documents\CCW"
SRC_PROJECT = os.path.join(CCW_DIR, "MIRA_PLC")
DST_PROJECT = os.path.join(CCW_DIR, "MIRA_PLC_LD")

OLD_GUID_LOWER = "a33e12c3-9d38-44f4-9a7f-e5672297bb8e"
OLD_GUID_UPPER = OLD_GUID_LOWER.upper()

# Relative paths inside the project (from DST_PROJECT root)
SLN_OLD = "MIRA_PLC.ccwsln"
SLN_NEW = "MIRA_PLC_LD.ccwsln"
ACFPROJ = os.path.join("Controller", "Controller.acfproj")
LOGICALVALUES = os.path.join("Controller", "Controller", "LogicalValues.csv")
PLC_DIR = os.path.join("Controller", "Controller", "Micro820", "Micro820")

# Files to DELETE (ST source + compiled artifacts CCW will regenerate)
DELETE_FILES = [
    os.path.join(PLC_DIR, "Prog2.stf"),
    os.path.join(PLC_DIR, "PROG2.rtc"),
    os.path.join(PLC_DIR, "PROG2.otc"),
    os.path.join(PLC_DIR, "PROG2.ic"),
    os.path.join(PLC_DIR, "Compile.ics"),
    os.path.join(PLC_DIR, "Compile.ict"),
    os.path.join(PLC_DIR, "Compile_PROG2.ict"),
    os.path.join(PLC_DIR, "MICRO820.ain"),
    os.path.join(PLC_DIR, "MICRO820.err"),
    os.path.join(PLC_DIR, "MICRO820.icp"),
    os.path.join(PLC_DIR, "MICRO820_Pou_PROG2.ipa"),
    os.path.join(PLC_DIR, "MICRO820_Pou_PROG2.xtc"),
    os.path.join(PLC_DIR, "MICRO820_SymbolsComplement.ttc"),
    os.path.join(PLC_DIR, "MICRO820_SymbolsDebug.d.xtc"),
    os.path.join(PLC_DIR, "MICRO820_SymbolsDebug.s.xtc"),
    os.path.join(PLC_DIR, "MICRO820_SymbolsDebug.xtc"),
    os.path.join(PLC_DIR, "MICRO820_SymbolsTarget.s.xtc"),
    os.path.join(PLC_DIR, "MICRO820_SymbolsTarget.xtc"),
    os.path.join(PLC_DIR, "MICRO820_LinkInfo.mtc"),
    os.path.join(PLC_DIR, "MICRO820_LinkInfo.s.mtc"),
    os.path.join(PLC_DIR, "MICRO820_MdfLinkReport.s.mtc"),
    os.path.join(PLC_DIR, "MICRO820_MiscLinkInfo.mtc"),
    os.path.join(PLC_DIR, "MICRO820_MiscLinkInfo.s.mtc"),
    os.path.join(PLC_DIR, "MICRO820_Dwl.txt"),
    os.path.join(PLC_DIR, "DwlOrder.txt"),
    os.path.join(PLC_DIR, "FBS_INPUTS_ASSIGNATION.ipa"),
    os.path.join(PLC_DIR, "IDS00103"),
    os.path.join(PLC_DIR, "Prog2.AcfMlge"),
    os.path.join("Controller", "Controller", "Compile.ic"),
    os.path.join("Controller", "Controller", "Conf.mtc"),
    os.path.join("Controller", "Controller", "CONTROLLER.err"),
    os.path.join("Controller", "Controller", "Breakpoints.lst"),
    os.path.join("Controller", "Controller", "RMD.info"),
]

# Directories to DELETE
DELETE_DIRS = [
    ".vs",
    os.path.join("Controller", "Controller", "Micro820", "To Download"),
]


def main():
    force = "--force" in sys.argv

    # ── Preflight checks ───────────────────────────────────────────────────
    if not os.path.isdir(SRC_PROJECT):
        print(f"ERROR: Source project not found: {SRC_PROJECT}")
        sys.exit(1)

    if os.path.exists(DST_PROJECT):
        if force:
            print(f"Removing existing {DST_PROJECT} ...")
            shutil.rmtree(DST_PROJECT)
        else:
            print(f"ERROR: Destination already exists: {DST_PROJECT}")
            print("       Use --force to overwrite.")
            sys.exit(1)

    # ── Step 1: Copy entire project ────────────────────────────────────────
    print(f"Copying {SRC_PROJECT}")
    print(f"     -> {DST_PROJECT}")
    shutil.copytree(SRC_PROJECT, DST_PROJECT)
    print("  OK — project copied")

    # ── Step 2: Generate new GUID ──────────────────────────────────────────
    new_guid = str(uuid.uuid4())
    new_guid_upper = new_guid.upper()
    print(f"  New GUID: {{{new_guid}}}")

    # ── Step 3: Rename .ccwsln ─────────────────────────────────────────────
    sln_src = os.path.join(DST_PROJECT, SLN_OLD)
    sln_dst = os.path.join(DST_PROJECT, SLN_NEW)
    if os.path.exists(sln_src):
        os.rename(sln_src, sln_dst)
        print(f"  Renamed {SLN_OLD} -> {SLN_NEW}")

    # ── Step 4: Rewrite .ccwsln with new GUID ─────────────────────────────
    if os.path.exists(sln_dst):
        with open(sln_dst, "rb") as f:
            raw = f.read()
        # Detect encoding: try utf-16, utf-8-sig, then latin-1
        for enc in ("utf-16", "utf-8-sig", "latin-1"):
            try:
                content = raw.decode(enc)
                sln_encoding = enc
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        else:
            content = raw.decode("latin-1")
            sln_encoding = "latin-1"
        # Replace GUID (case-insensitive)
        content = content.replace(OLD_GUID_UPPER, new_guid_upper)
        content = content.replace(OLD_GUID_LOWER, new_guid)
        content = content.replace("{" + OLD_GUID_UPPER + "}", "{" + new_guid_upper + "}")
        content = content.replace("{" + OLD_GUID_LOWER + "}", "{" + new_guid + "}")
        with open(sln_dst, "wb") as f:
            f.write(content.encode(sln_encoding))
        print(f"  Updated .ccwsln GUID (encoding: {sln_encoding})")

    # ── Step 5: Rewrite Controller.acfproj with new GUID ──────────────────
    acfproj_path = os.path.join(DST_PROJECT, ACFPROJ)
    if os.path.exists(acfproj_path):
        with open(acfproj_path, "rb") as f:
            raw = f.read()
        for enc in ("utf-8-sig", "utf-8", "utf-16", "latin-1"):
            try:
                content = raw.decode(enc)
                proj_encoding = enc
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        else:
            content = raw.decode("latin-1")
            proj_encoding = "latin-1"
        content = content.replace(OLD_GUID_LOWER, new_guid)
        content = content.replace(OLD_GUID_UPPER, new_guid_upper)
        with open(acfproj_path, "wb") as f:
            f.write(content.encode(proj_encoding))
        print(f"  Updated Controller.acfproj GUID (encoding: {proj_encoding})")

    # ── Step 6: Delete ST source + compiled artifacts ──────────────────────
    deleted = 0
    for rel_path in DELETE_FILES:
        full_path = os.path.join(DST_PROJECT, rel_path)
        if os.path.exists(full_path):
            os.remove(full_path)
            deleted += 1

    for rel_dir in DELETE_DIRS:
        full_path = os.path.join(DST_PROJECT, rel_dir)
        if os.path.isdir(full_path):
            shutil.rmtree(full_path)
            deleted += 1

    # Also remove Controller_Backup.zip if present
    backup_zip = os.path.join(DST_PROJECT, "Controller", "Controller", "Controller_Backup.zip")
    if os.path.exists(backup_zip):
        os.remove(backup_zip)
        deleted += 1

    print(f"  Deleted {deleted} ST/compiled artifacts")

    # ── Step 7: Add xor_ok to LogicalValues.csv ────────────────────────────
    csv_path = os.path.join(DST_PROJECT, LOGICALVALUES)
    if os.path.exists(csv_path):
        with open(csv_path, "rb") as f:
            raw = f.read()
        for enc in ("utf-8-sig", "utf-8", "utf-16", "latin-1"):
            try:
                content = raw.decode(enc)
                csv_encoding = enc
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        else:
            content = raw.decode("latin-1")
            csv_encoding = "latin-1"
        xor_line = "Controller.Micro820.Micro820.xor_ok,"
        if xor_line not in content:
            content = content.rstrip("\n") + "\n" + xor_line + "\n"
            with open(csv_path, "wb") as f:
                f.write(content.encode(csv_encoding))
            print("  Added xor_ok to LogicalValues.csv")
        else:
            print("  xor_ok already in LogicalValues.csv")

    # ── Step 8: List preserved files ───────────────────────────────────────
    preserved = []
    plc_dir_full = os.path.join(DST_PROJECT, PLC_DIR)
    if os.path.isdir(plc_dir_full):
        preserved = os.listdir(plc_dir_full)

    print()
    print("=" * 65)
    print("  MIRA_PLC_LD project created successfully")
    print("=" * 65)
    print()
    print(f"  Location: {DST_PROJECT}")
    print(f"  GUID:     {{{new_guid}}}")
    print()
    print("  Preserved infrastructure files:")
    print(f"    GlobalVariable.rtc  — 80+ variable declarations")
    print(f"    MbSrvConf.xml       — 20 coils + 16 holding registers")
    print(f"    MdfConf.txt         — I/O mapping (7 DO, 12 DI, 4 AI, 1 AO)")
    print(f"    DevicePref.xml      — PLC at 169.254.32.93")
    print(f"    LogicView.xml       — Program structure (Prog2)")
    print(f"    PrjLibrary.accdb    — Project database")
    print(f"    LogicalValues.csv   — 59 system vars + xor_ok")
    print()
    if preserved:
        print(f"  Remaining PLC files ({len(preserved)}):")
        for f in sorted(preserved):
            print(f"    {f}")
    print()
    print("-" * 65)
    print("  NEXT STEPS — Open in CCW and create LD program:")
    print("-" * 65)
    print()
    print("  1. Open CCW")
    print(f"  2. File > Open > {os.path.join(DST_PROJECT, SLN_NEW)}")
    print()
    print("  3. In Organizer panel, expand:")
    print("       Controller > Micro820 > Programs")
    print()
    print("  4. If Prog2 appears with errors:")
    print("       Right-click Prog2 > Delete")
    print()
    print("  5. Right-click 'Programs' > Add Program")
    print("       Language: Ladder Diagram")
    print("       Name: Prog2")
    print()
    print("  6. Add variable 'xor_ok' (BOOL, default FALSE)")
    print("       In Global Variables editor")
    print()
    print("  7. Open MIRA_Ladder_Program.md side-by-side")
    print("       Enter Rungs 0-64 from the specification")
    print()
    print("  8. Build: Ctrl+Shift+B — expect 0 errors")
    print()
    print("  9. Download to PLC > Run mode")
    print("       Verify: heartbeat toggling, uptime counting")
    print()
    print("  Rung spec: plc/MIRA_Ladder_Program.md (65 rungs, 7 sections)")
    print("=" * 65)


if __name__ == "__main__":
    main()
