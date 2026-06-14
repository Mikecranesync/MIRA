#!/usr/bin/env python3
"""In-place, idempotent edits the elevated APPLY script can't do by file-copy:

  1. Enable Ignition Tag History on the 4 GS10 analog tags (so the native TrendChart fills).
  2. Append MAINTENANCE / TRENDS / ASK MIRA nav links to the live Conveyor + home coord views
     (they are hand-tuned and differ from the repo, so we edit in place rather than overwrite).

Run by APPLY_MAINTENANCE_PANEL.ps1 during the service-stopped window (needs admin to write
Program Files). Safe to re-run. Paths default to the live gateway but are argv-overridable so the
edits can be dry-run against copies:
    python deploy_edits.py <views_dir> <vfd_tags_json>
"""
import io
import json
import os
import sys

GW = r"C:\Program Files\Inductive Automation\Ignition\data"
VIEWS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    GW, r"projects\ConvSimpleLive\com.inductiveautomation.perspective\views")
VFD_TAGS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    GW, r"config\resources\core\ignition\tag-definition\default\MIRA_IOCheck\VFD\tags.json")

# The 4 confirmed analog GS10 tags the TrendChart pens read (must exist in the live tag store).
HIST_TAGS = ["vfd_frequency", "vfd_freq_sp", "vfd_current", "vfd_dc_bus"]
HIST_PROVIDER = "Sample_SQLite_Database"   # the live, working SqlHistorian provider

# (meta name, label, route, x) -- appended after the existing PMC Station / Conveyor links.
NAV_LINKS = [
    ("nav_maintenance", "MAINTENANCE", "/maintenance", 276),
    ("nav_trends", "TRENDS", "/trends", 402),
    ("nav_ask", "ASK MIRA", "/AskMira", 528),
]


def _load(path):
    with io.open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save(path, data):
    # UTF-8, no BOM, preserve unicode -- Ignition reads this directly.
    with io.open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def enable_history():
    if not os.path.isfile(VFD_TAGS):
        print("history: VFD tags.json not found at %s -- skipped" % VFD_TAGS)
        return
    data = _load(VFD_TAGS)
    tags = data if isinstance(data, list) else data.get("tags", [])
    changed = 0
    for t in tags:
        if t.get("name") in HIST_TAGS and not t.get("historyEnabled"):
            t["historyEnabled"] = True
            t["historyProvider"] = HIST_PROVIDER
            t["historicalDeadband"] = 0.0
            changed += 1
    if changed:
        _save(VFD_TAGS, data)
    print("history: enabled on %d tag(s) (%s)" % (changed, ", ".join(HIST_TAGS)))


def add_nav(view_name):
    path = os.path.join(VIEWS, view_name, "view.json")
    if not os.path.isfile(path):
        print("nav: %s/view.json not found -- skipped" % view_name)
        return
    data = _load(path)
    root = data.get("root", {})
    kids = root.get("children", [])
    names = set(c.get("meta", {}).get("name") for c in kids if isinstance(c, dict))
    if "nav_maintenance" in names:
        print("nav: %s already has the links -- skipped" % view_name)
        return
    base = next((c for c in kids if isinstance(c, dict)
                 and c.get("meta", {}).get("name") == "nav_conveyor"), None)
    pos = base.get("position", {}) if base else {}
    y = pos.get("y", 12)
    h = pos.get("height", 22)
    for meta_name, label, url, x in NAV_LINKS:
        kids.append({
            "type": "ia.navigation.link",
            "meta": {"name": meta_name},
            "position": {"x": x, "y": y, "width": 120, "height": h},
            "props": {"text": label, "url": url, "target": "self",
                      "style": {"color": "#8b949e", "fontSize": "13px",
                                "fontWeight": 600, "textTransform": "uppercase"}},
        })
    root["children"] = kids
    _save(path, data)
    print("nav: added %d links to %s" % (len(NAV_LINKS), view_name))


if __name__ == "__main__":
    enable_history()
    add_nav("Conveyor")
    add_nav("ConvSimpleLive")
    print("deploy_edits: done")
