"""Reproduce the absence verification of the unanswerable set (#4596).

Each frozen question records, per evidence term (a case-insensitive regex), how many pages of
its manual contain a match, as extracted by ``pdftotext -layout``. This tool re-derives those
counts from the pinned manual cache (``<sha256>.pdf``, the walk's cache) so the evidence is
reproducible, not only hash-pinned.

    python3 -m tools.retrieval_eval.termcheck --manual-dir <cache> [--set <json>]

Exit 0 when every count matches, 1 on any mismatch, 2 when a manual or pdftotext is missing.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SET = Path(__file__).resolve().parent / "data" / "unanswerable_v1.json"


def pdf_pages(pdf: Path) -> list[str]:
    out = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True,
        text=True,
        errors="ignore",
        check=True,
    ).stdout
    return out.split("\f")


def count_pages(pages: list[str], term: str) -> int:
    rx = re.compile(term, re.I)
    return sum(1 for p in pages if rx.search(p))


def recheck(questions: list[dict], manual_dir: Path) -> tuple[list[dict], list[str]]:
    """Return (mismatches, missing manual sha256s)."""
    cache: dict[str, list[str]] = {}
    mismatches: list[dict] = []
    missing: list[str] = []
    for q in questions:
        v = q["verification"]
        sha = v["manual_sha256"]
        if sha not in cache:
            pdf = manual_dir / f"{sha}.pdf"
            if not pdf.is_file():
                missing.append(sha)
                cache[sha] = []
                continue
            cache[sha] = pdf_pages(pdf)
        if sha in missing:
            continue
        for term, frozen in v["terms"].items():
            got = count_pages(cache[sha], term)
            if got != frozen:
                mismatches.append({"id": q["id"], "term": term, "frozen": frozen, "got": got})
    return mismatches, sorted(set(missing))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manual-dir", required=True, type=Path)
    ap.add_argument("--set", type=Path, default=DEFAULT_SET)
    args = ap.parse_args(argv)
    if not shutil.which("pdftotext"):
        print("pdftotext not found (poppler)", file=sys.stderr)
        return 2
    questions = json.loads(args.set.read_text())["questions"]
    mismatches, missing = recheck(questions, args.manual_dir)
    for m in mismatches:
        print(f"MISMATCH {m['id']} {m['term']!r}: frozen={m['frozen']} got={m['got']}")
    if missing:
        print(f"MISSING manuals: {', '.join(missing)}", file=sys.stderr)
        return 2
    n_terms = sum(len(q["verification"]["terms"]) for q in questions)
    print(f"{len(questions)} questions, {n_terms} terms: {len(mismatches)} mismatch(es)")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
