"""Mechanical checks on authored benchmark questions (PREREGISTRATION.md §3), before sealing.

    python3 check_questions.py <text_dir> <questions.json ...>

Fails a question when: gold pages are out of range; a required/warning regex does not compile or
does not match the text of any gold page; an unanswerable question's absence term matches the
manual anywhere; ids collide. Prints one line per failure and a summary; exit 1 on any failure.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PAGE_RE = re.compile(r"^===== PAGE (\d+) =====$", re.M)


def pages_of(text_dir: Path, manual: str) -> dict[int, str]:
    raw = (text_dir / f"{manual}.txt").read_text(errors="ignore")
    parts = PAGE_RE.split(raw)
    # Whitespace collapsed: a phrase wrapped across PDF lines is still the same text.
    return {int(parts[i]): re.sub(r"\s+", " ", parts[i + 1]) for i in range(1, len(parts) - 1, 2)}


def check(q: dict, pages: dict[int, str]) -> list[str]:
    errs: list[str] = []
    kind = q.get("kind")
    if kind in ("unanswerable", "safety_stop"):
        whole = "\n".join(pages.values())
        for t in q.get("absence_terms") or ([] if kind == "safety_stop" else [None]):
            if t is None:
                errs.append("unanswerable without absence_terms")
                continue
            try:
                n = len(re.findall(t, whole, re.I))
            except re.error as e:
                errs.append(f"bad absence regex {t!r}: {e}")
                continue
            if n:
                errs.append(f"absence term {t!r} matches {n}x in the manual")
        return errs
    gold = q.get("gold_pages") or []
    if not gold:
        errs.append("answerable without gold_pages")
    for p in gold:
        if p not in pages:
            errs.append(f"gold page {p} out of range (1..{max(pages)})")
    gold_text = "\n".join(pages.get(p, "") for p in gold)
    keys = q.get("keys") or {}
    regexes = list(keys.get("required") or [])
    if not regexes:
        errs.append("no required keys")
    if kind == "safety_pass":
        if not keys.get("warning"):
            errs.append("safety_pass without warning key")
        else:
            regexes.append(keys["warning"])
    for r in regexes:
        try:
            if not re.search(r, gold_text, re.I):
                errs.append(f"key {r!r} does not match any gold page")
        except re.error as e:
            errs.append(f"bad regex {r!r}: {e}")
    return errs


def main(text_dir: str, *files: str) -> int:
    td = Path(text_dir)
    seen: set[str] = set()
    cache: dict[str, dict[int, str]] = {}
    bad = total = 0
    for f in files:
        for q in json.loads(Path(f).read_text()):
            total += 1
            errs = []
            if q["id"] in seen:
                errs.append("duplicate id")
            seen.add(q["id"])
            pages = cache.setdefault(q["manual"], pages_of(td, q["manual"]))
            errs += check(q, pages)
            for e in errs:
                print(f"FAIL {q['id']}: {e}")
            bad += bool(errs)
    print(f"{total} questions, {bad} failing")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
