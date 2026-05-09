#!/usr/bin/env python3
"""Aggregate all clicks.jsonl files into a broken-interactions table.

Writes to clicks-aggregate.md to avoid Windows console encoding issues with
unicode chars in element labels (e.g. sun emoji on the dark-theme toggle).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
CLICKS = ROOT / "clicks"
OUT_PATH = ROOT / "clicks-aggregate.md"

ALL_CLICKS = []
SUMMARIES = []

for slug_dir in sorted(CLICKS.iterdir()):
    if not slug_dir.is_dir():
        continue
    slug = slug_dir.name
    summary_path = slug_dir / "summary.json"
    if summary_path.exists():
        try:
            SUMMARIES.append((slug, json.loads(summary_path.read_text(encoding="utf-8"))))
        except Exception as e:
            print(f"# {slug}: summary parse error {e}", file=sys.stderr)
    jsonl_path = slug_dir / "clicks.jsonl"
    if jsonl_path.exists():
        for ln, line in enumerate(jsonl_path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                rec["__slug"] = slug
                ALL_CLICKS.append(rec)
            except Exception as e:
                print(f"# {slug} line {ln}: {e}", file=sys.stderr)

with OUT_PATH.open("w", encoding="utf-8") as f:
    f.write("# Interaction-crawl aggregate — 2026-05-04\n\n")

    # Per-route summary
    f.write("## Per-route interaction summary\n\n")
    f.write("| Slug | Status | Clickables | Run | Nav | ConsoleErr | NetFail | Skipped |\n")
    f.write("|---|---|---|---|---|---|---|---|\n")
    for slug, s in SUMMARIES:
        f.write(
            f"| {slug} | {s.get('initial_status')} | "
            f"{s.get('total_clickables_enumerated')} | "
            f"{s.get('interactions_run')} | "
            f"{s.get('interactions_with_navigation')} | "
            f"{s.get('interactions_with_console_errors')} | "
            f"{s.get('interactions_with_network_failures')} | "
            f"{s.get('skipped_external_or_destructive')} |\n"
        )

    # Broken-interactions table
    f.write("\n## Broken interactions\n\n")
    f.write("| Slug | # | Element | Tag | Failure |\n")
    f.write("|---|---|---|---|---|\n")
    broken = []
    for c in ALL_CLICKS:
        failures = []
        for ce in c.get("console_errors") or []:
            # Don't double-report the persistent SVG <rect> warning
            if "rect" in ce.get("text", "") and "Expected length" in ce.get("text", ""):
                continue
            failures.append(f"console:{ce.get('type')}: {ce.get('text', '')[:160]}")
        for nf in c.get("network_failures") or []:
            failures.append(f"net:{nf.get('status')} {nf.get('method')} {nf.get('url', '')[-80:]}")
        for n in c.get("notes") or []:
            if n:
                failures.append(f"note:{n[:160]}")
        if failures:
            broken.append((c, failures))

    for c, fs in broken:
        label = (c.get("label") or "")[:40].replace("|", "\\|").replace("\n", " ")
        for fmsg in fs:
            f_clean = fmsg.replace("|", "\\|").replace("\n", " ").replace("\r", "")
            f.write(
                f"| {c.get('__slug')} | {c.get('index')} | "
                f"{label} | {c.get('tag')} | "
                f"{f_clean[:200]} |\n"
            )

    # Persistent SVG <rect> warning note
    rect_count = 0
    for c in ALL_CLICKS:
        for ce in c.get("console_errors") or []:
            if "rect" in ce.get("text", "") and "Expected length" in ce.get("text", ""):
                rect_count += 1
                break
    f.write("\n## Persistent baseline noise\n\n")
    f.write(f"- Persistent SVG `<rect>` warning fires on {rect_count} interactions (suppressed in broken table). Root cause: an SVG element has `rx=\"0 0 12 12\"` instead of a valid length value. **Likely the SAFETY badge / step icon on home — bug introduced when the dark-theme cartoon hero shipped.**\n")

    # Totals
    total_clickables = sum(s.get("total_clickables_enumerated", 0) for _, s in SUMMARIES)
    total_run = sum(s.get("interactions_run", 0) for _, s in SUMMARIES)
    total_broken_pages = len({c.get("__slug") for c, _ in broken})
    f.write("\n## Totals\n\n")
    f.write(f"- Pages crawled: {len(SUMMARIES)}\n")
    f.write(f"- Total clickables enumerated: {total_clickables}\n")
    f.write(f"- Total interactions run: {total_run}\n")
    f.write(f"- Pages with at least one broken interaction (excl. SVG warning): {total_broken_pages}\n")
    f.write(f"- Broken-interaction records: {len(broken)}\n")

print(f"Wrote {OUT_PATH}", file=sys.stderr)
print(f"  pages={len(SUMMARIES)} clickables={total_clickables} run={total_run} broken_records={len(broken)}", file=sys.stderr)
