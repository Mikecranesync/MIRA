#!/usr/bin/env python3
"""EXPERIMENTAL: pre-inject the V1.9 variables + program into the Conv_Simple_1.9
clone so opening it in CCW needs only Build + Download (the PLC physics floor).

WHY THIS IS A BEST-EFFORT BET, NOT A GUARANTEE:
CCW's source-of-record is PrjLibrary.accdb (an Access DB) for symbols/structure
plus the external Prog_init.stf for the ST body. There are ALSO binary caches
(GlobalVariable.rtc, *.xtc) that CCW normally rewrites only when *it* edits the
project. Whether CCW, on open, reloads from the .accdb/.stf (good -> our edits
take) or trusts those binary caches (bad -> our edits are ignored) cannot be
verified without running CCW. So this is bounded-downside:
  * It writes ONLY to Conv_Simple_1.9 (the clone). Conv_Simple_1.8 + the live
    PLC are never touched.
  * It backs up the .accdb and Prog_init.stf first.
  * If CCW shows variable errors or the OLD program after opening, the bet
    didn't take on your CCW build -> re-run BUILD_CONV_SIMPLE_1.9.cmd to restore
    the clean manual-path clone and follow _V1.9_APPLY/INSTALL_ConvSimple_v1.9.md.

Only 9 SIMPLE SCALAR variables are injected (the V1.9 redesign reuses the
existing read FB/buffer, so there are no new function-block instances, structs,
or arrays to inject -- those would need ComplexInstanceList/Dimension rows that
can't be replicated safely blind). The 6 register WORDs + the UINT counter
(`read_sel`) clone the `vfd_status_word` row (CCW type WORD; `read_sel` is then
edited to UINT); the 2 BOOLs clone `poll_phase`. All 9 are SCALARS -- the cloned
rows inherit the template's empty Dimension. A non-empty Dimension would make CCW
see them as `AnyArray` and Build would fail against the scalar `Word` Modbus map.

Usage (PLC laptop, CCW CLOSED):
    python plc/inject_vars_accdb.py --dry-run
    python plc/inject_vars_accdb.py
"""
from __future__ import annotations
import argparse, shutil, sys, uuid
from pathlib import Path
import pyodbc

HERE = Path(__file__).resolve().parent
CCW_ROOT = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC")
CLONE = CCW_ROOT / "Conv_Simple_1.9"
ACCDB = CLONE / "Controller" / "Controller" / "PrjLibrary.accdb"
STF = CLONE / "Controller" / "Controller" / "Micro820" / "Micro820" / "Prog_init.stf"
PROG_SRC = HERE / "Prog_init_ConvSimple_v1.9.st"

# (name, template variable to clone its type/scope/CRC from)
NEW_VARS = [
    ("read_sel",        "vfd_status_word"),
    ("vfd_warn_code",   "vfd_status_word"),
    ("vfd_freq_cmd",    "vfd_status_word"),
    ("vfd_torque",      "vfd_status_word"),
    ("vfd_motor_rpm",   "vfd_status_word"),
    ("vfd_power",       "vfd_status_word"),
    ("vfd_last_fault",  "vfd_status_word"),
    ("lp_toggle",       "poll_phase"),
    ("last_fault_clear","poll_phase"),
]

def conn(readonly=False):
    return pyodbc.connect(
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=%s;" % ACCDB,
        autocommit=False, readonly=readonly)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not ACCDB.is_file(): sys.exit(f"ERROR: clone .accdb not found: {ACCDB}\n"
                                     f"Run BUILD_CONV_SIMPLE_1.9.cmd first.")
    if not PROG_SRC.is_file(): sys.exit(f"ERROR: {PROG_SRC} missing")

    # read templates + current max ids (read-only)
    cn = conn(readonly=True); cur = cn.cursor()
    cur.execute("SELECT * FROM [Symbols]")
    cols = [d[0] for d in cur.description]
    rows = {r[cols.index("Name")]: dict(zip(cols, r)) for r in cur.fetchall()}
    existing = set(rows)
    for _, tmpl in NEW_VARS:
        if tmpl not in rows: cn.close(); sys.exit(f"ERROR: template '{tmpl}' not in Symbols")
    cur.execute("SELECT MAX(RefSymbols), MAX([Order]) FROM [Symbols]")
    max_ref, max_ord = cur.fetchone()
    cn.close()

    todo = [(n, t) for (n, t) in NEW_VARS if n not in existing]
    skip = [n for (n, _) in NEW_VARS if n in existing]
    print(f"Inject plan -> {ACCDB.name}")
    print(f"  template rows: vfd_status_word (WORD), poll_phase (BOOL); scalars, blank Dimension")
    print(f"  to insert ({len(todo)}): {', '.join(n for n,_ in todo) or '(none)'}")
    if skip: print(f"  already present (skip): {', '.join(skip)}")
    print(f"  next RefSymbols={max_ref+1}, next Order={max_ord+1}")
    print(f"  program: overwrite {STF.name} with {PROG_SRC.name}")
    if args.dry_run:
        print("DRY-RUN: nothing changed."); return
    if not todo:
        print("All vars already present; just refreshing the program .stf.")

    # back up
    for f in (ACCDB, STF):
        b = f.with_suffix(f.suffix + ".preinj.bak")
        if not b.exists(): shutil.copy2(f, b)
    print("  backups: *.preinj.bak written")

    # insert (skip identity columns CCW manages; copy the rest from the template)
    SKIP_COLS = {"s_GUID", "RefSymbols", "Name", "Order"}
    cn = conn(); cur = cn.cursor()
    try:
        ref, order = max_ref, max_ord
        for name, tmpl in todo:
            ref += 1; order += 1
            t = rows[tmpl]
            put = {c: t[c] for c in cols if c not in SKIP_COLS and t[c] is not None}
            put["Name"] = name
            put["RefSymbols"] = ref
            put["Order"] = order
            put["s_GUID"] = str(uuid.uuid4()).upper()
            collist = ", ".join(f"[{c}]" for c in put)
            qs = ", ".join("?" for _ in put)
            cur.execute(f"INSERT INTO [Symbols] ({collist}) VALUES ({qs})", list(put.values()))
            print(f"    + {name} (RefSymbols={ref}, clone of {tmpl})")
        cn.commit()
        print("  committed Symbols inserts")
    except Exception as e:
        cn.rollback(); cn.close()
        sys.exit(f"ERROR during insert (rolled back, .accdb unchanged): {e}")
    cn.close()

    # overwrite the program source
    STF.write_text(PROG_SRC.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"  wrote V1.9 program -> {STF.name}")

    # validate
    cn = conn(readonly=True); cur = cn.cursor()
    cur.execute("SELECT Name FROM [Symbols]")
    now = {r[0] for r in cur.fetchall()}; cn.close()
    missing = [n for (n, _) in NEW_VARS if n not in now]
    print("\nVALIDATION:")
    print("  all 9 vars present in Symbols:", not missing, "" if not missing else f"(missing {missing})")
    print("  program .stf starts with:", STF.read_text(encoding='utf-8').splitlines()[0])
    print("\nUNVERIFIED until you open Conv_Simple_1.9 in CCW. If CCW shows the new")
    print("vars + V1.9 program -> just Build + Download. If it errors or shows V1.8,")
    print("the binary caches overrode this bet -> re-run BUILD_CONV_SIMPLE_1.9.cmd and")
    print("use the manual card (_V1.9_APPLY/INSTALL_ConvSimple_v1.9.md).")

if __name__ == "__main__":
    main()
