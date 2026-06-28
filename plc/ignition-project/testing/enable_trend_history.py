#!/usr/bin/env python3
"""Enable Ignition Tag History on the 4 GS10 analog tags so the native TrendChart fills.
Additive + harmless (just records to the existing Sample_SQLite_Database historian); does NOT
touch any project. Idempotent. Path-overridable for dry-run: python enable_trend_history.py <tags.json>
"""
import io, json, os, sys
GW = r"C:\Program Files\Inductive Automation\Ignition\data"
VFD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    GW, r"config\resources\core\ignition\tag-definition\default\MIRA_IOCheck\VFD\tags.json")
TAGS = ["vfd_frequency", "vfd_freq_sp", "vfd_current", "vfd_dc_bus"]
if not os.path.isfile(VFD):
    print("enable: tags.json not found -- skipped"); sys.exit(0)
with io.open(VFD, "r", encoding="utf-8") as fh:
    d = json.load(fh)
n = 0
for t in (d if isinstance(d, list) else d.get("tags", [])):
    if t.get("name") in TAGS and not t.get("historyEnabled"):
        t["historyEnabled"] = True
        t["historyProvider"] = "Sample_SQLite_Database"
        t["historicalDeadband"] = 0.0
        n += 1
if n:
    with io.open(VFD, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
print("enable: tag history on %d tag(s)" % n)
