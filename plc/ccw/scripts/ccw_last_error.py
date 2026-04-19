"""Extract the most recent CCW build / download errors for diagnosis.

The CCW IDE writes three log files. When a build fails, the Output pane only
shows the MSBuild stack trace — the actual cause is almost always in
RA.CCW.Logging.log, RA.CCW.CommServer.log, or RA.CCW.AutomationInterface.log.
This script tails each and filters for ERROR lines since the given window.

Usage:
    python scripts/ccw_last_error.py              # last 15 minutes
    python scripts/ccw_last_error.py --minutes 60
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LOG_ROOT = Path(r"C:/ProgramData/Rockwell/CCW/Log")
CANDIDATES = [
    LOG_ROOT / "RA.CCW.Logging.log",
    LOG_ROOT / "RA.CCW.CommServer.log",
    LOG_ROOT / "RA.CCW.AutomationInterface.log",
]

DATE_RX = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")
# Explicit mapping of known error substrings to a plain-English hint
HINTS: list[tuple[str, str]] = [
    ("IAcfVariable does not exist for mapping item:",
     "Modbus mapping references a variable the controller doesn't have. The 2080-LC20-20QBB is 12 DI + 7 DO — _IO_EM_DO_07 and higher do NOT exist. Fix by removing that row from the Modbus mapping or re-import a corrected .ccwmod."),
    ("undeclared identifier",
     "Structured Text references a variable that isn't in Global Variables or a local VAR block. Add it to Global Variables (declare type, initial value) and save the table before rebuilding."),
    ("Found unexpected configuration with same name as import configuration",
     "CCW is refusing to overwrite an existing mapping/config. Delete the existing one in Project Organizer, then reimport."),
    ("CIPMessage GeneralStatus: 0xFF",
     "CIP connection dropped mid-transfer — usually a cable unplug, PLC reboot, or Ignition hogging the CIP session. Close Designer's OPC connection to this device, retry."),
    ("Error in function ConnectedController.IsControllerConnectedByAnotherUser",
     "Recoverable: CCW checking whether another tool holds the CIP lock. Can be ignored unless you actually see 'Another user has control'."),
    ("Object reference not set to an instance of an object",
     "Internal CCW NullReferenceException, typically after a crashed download. Close and reopen the project; if it persists, delete the .vs/ folder next to the .ccwsln file."),
]


def parse_ts(line: str) -> datetime | None:
    m = DATE_RX.match(line)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=int, default=15)
    ap.add_argument("--all", action="store_true", help="Show all ERROR lines, not just ones with known hints")
    args = ap.parse_args()

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.minutes)
    print(f"Scanning CCW logs for ERROR lines since {cutoff:%Y-%m-%d %H:%M:%S} UTC ({args.minutes} min ago)\n")

    hits: list[tuple[datetime, str, str]] = []
    for path in CANDIDATES:
        if not path.exists():
            continue
        try:
            data = path.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            print(f"  skip {path.name}: {exc}")
            continue
        for line in data.splitlines():
            ts = parse_ts(line)
            if not ts or ts < cutoff:
                continue
            if " ERROR " not in line and "ERROR " not in line[:40]:
                continue
            hits.append((ts, path.name, line))

    if not hits:
        print("No ERROR lines in the window. Either there was no recent failure, or CCW hasn't flushed yet — try --minutes 120.")
        return 0

    hits.sort()
    shown_hint: set[str] = set()
    for ts, source, line in hits:
        hint = None
        for pattern, text in HINTS:
            if pattern in line:
                hint = text
                break
        if hint is None and not args.all:
            # uninteresting / known transient — skip when not in --all mode
            continue
        ts_local = ts.astimezone().strftime("%H:%M:%S")
        print(f"[{ts_local}] {source}")
        print(f"  {line.strip()[:300]}")
        if hint and hint not in shown_hint:
            print(f"  HINT: {hint}\n")
            shown_hint.add(hint)
        else:
            print()

    print(f"Total ERROR lines in window: {len(hits)}  (with known hint: {len(shown_hint)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
