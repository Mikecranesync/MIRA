#!/usr/bin/env python3
"""Extract Lighthouse scores into a single CSV/MD table."""
import json
import sys
from pathlib import Path

LH_DIR = Path(__file__).parent / "lighthouse"

rows = []
for f in sorted(LH_DIR.glob("*.json")):
    name = f.stem
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"# {name}: parse error {e}", file=sys.stderr)
        continue
    cats = d.get("categories", {})
    perf = cats.get("performance", {}).get("score")
    a11y = cats.get("accessibility", {}).get("score")
    bp = cats.get("best-practices", {}).get("score")
    seo = cats.get("seo", {}).get("score")
    def s(x):
        return int(x * 100) if x is not None else None
    rows.append((name, s(perf), s(a11y), s(bp), s(seo)))

# Find specific axe rules of interest
print("| Route | Perf | A11y | BP | SEO |")
print("|---|---|---|---|---|")
for r in rows:
    print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} |")

# Pull color-contrast audit details for each
print("\n## Color-contrast audit details")
for f in sorted(LH_DIR.glob("*.json")):
    name = f.stem
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        continue
    cc = d.get("audits", {}).get("color-contrast", {})
    score = cc.get("score")
    if score is None or score == 1:
        print(f"- {name}: PASS (score={score})")
    else:
        items = cc.get("details", {}).get("items", [])
        print(f"- {name}: FAIL (score={score}, {len(items)} items)")
        for it in items[:3]:
            sel = it.get("node", {}).get("selector", "")
            snippet = it.get("node", {}).get("snippet", "")[:80]
            print(f"  - `{sel}` — `{snippet}`")
