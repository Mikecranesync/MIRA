#!/usr/bin/env python3
"""Rollback helper: remove the Tag History fields this session added to the 4 GS10 tags,
restoring them to their original (no-history) definition. Idempotent. Path-overridable for
dry-run testing:  python disable_history.py <vfd_tags_json>
"""
import io
import json
import os
import sys

GW = r"C:\Program Files\Inductive Automation\Ignition\data"
VFD_TAGS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    GW, r"config\resources\core\ignition\tag-definition\default\MIRA_IOCheck\VFD\tags.json")

HIST_TAGS = ["vfd_frequency", "vfd_freq_sp", "vfd_current", "vfd_dc_bus"]
HIST_KEYS = ["historyEnabled", "historyProvider", "historicalDeadband"]


def main():
    if not os.path.isfile(VFD_TAGS):
        print("history-rollback: VFD tags.json not found at %s -- skipped" % VFD_TAGS)
        return
    with io.open(VFD_TAGS, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    tags = data if isinstance(data, list) else data.get("tags", [])
    changed = 0
    for t in tags:
        if t.get("name") in HIST_TAGS:
            removed = False
            for k in HIST_KEYS:
                if k in t:
                    del t[k]
                    removed = True
            if removed:
                changed += 1
    if changed:
        with io.open(VFD_TAGS, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    print("history-rollback: cleared history on %d tag(s)" % changed)


if __name__ == "__main__":
    main()
