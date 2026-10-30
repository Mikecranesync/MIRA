#!/usr/bin/env python3
"""
tools/investigator/label_sheet.py — LANE BENCH-B. Builds Mike's human-label
sheet (PREREGISTRATION.md §5, E6 PRIMARY): a CSV + a simple static HTML page
(no external assets — inline CSS only, no CDN, no JS framework), one row per
case x anonymised arm, columns: question, evidence excerpt, proposed next
check, then BLANK technically_valid / safe / would_save_time / notes for Mike
to fill in. A SEPARATE hidden key file maps each case's anonymised letters
back to real arm names — never embedded in the sheet itself.

Anonymisation method is the same idea as judge.ts's (deterministic shuffle
seeded by sha256(case id), letters A/B/C... in shuffled order) but
independently implemented here in Python — there is no cross-language import
to share, so this is a second, from-scratch implementation of the same
documented method, not an un-reused duplicate of existing code.

Stdlib only, $0, no network. Python 3.9 (no `X | None`).

Input: a JSON file, a list of cases shaped:
    {"caseId": str, "question": str,
     "evidenceExcerptsByArm": {arm: [str, ...]},
     "nextCheckByArm": {arm: str | null}}
(the SAME shape judge.ts's CLI reads, so one case file serves both halves of
E6 — human sheet and MODEL-JUDGE — without inventing two formats.)

    python3 label_sheet.py <cases.json> --out-prefix <path/without/extension>

Writes <prefix>.csv, <prefix>.html, <prefix>.key.json.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
from typing import Any, Dict, Iterator, List, Tuple

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def seeded_floats(seed: str) -> Iterator[float]:
    state = sha256_hex(seed)
    while True:
        state = sha256_hex(state)
        yield int(state[:8], 16) / 0x1_0000_0000


def seeded_shuffle(items: List[Any], seed: str) -> List[Any]:
    out = list(items)
    draws = seeded_floats(seed)
    for i in range(len(out) - 1, 0, -1):
        j = int(next(draws) * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def anonymize_arms(
    arms: List[str], case_id: str
) -> Tuple[List[str], Dict[str, str], Dict[str, str]]:
    if len(arms) > len(LETTERS):
        raise ValueError(f"anonymize_arms: {len(arms)} arms exceeds {len(LETTERS)}-letter budget")
    shuffled = seeded_shuffle(sorted(arms), f"label-sheet-anon:{case_id}")
    letters = list(LETTERS[: len(shuffled)])
    letter_to_arm = dict(zip(letters, shuffled))
    arm_to_letter = {arm: letter for letter, arm in letter_to_arm.items()}
    return letters, letter_to_arm, arm_to_letter


Case = Dict[str, Any]
SheetRow = Dict[str, str]


def build_rows_and_key(cases: List[Case]) -> Tuple[List[SheetRow], Dict[str, Dict[str, str]]]:
    """Returns (visible rows, key) where key = {case_id: {letter: real_arm}}
    — the key is returned separately so a caller can never accidentally
    write it into the visible sheet."""
    rows: List[SheetRow] = []
    key: Dict[str, Dict[str, str]] = {}
    for case in cases:
        case_id = case["caseId"]
        arms = sorted((case.get("evidenceExcerptsByArm") or {}).keys())
        letters, letter_to_arm, _arm_to_letter = anonymize_arms(arms, case_id)
        key[case_id] = letter_to_arm
        for letter in letters:
            arm = letter_to_arm[letter]
            excerpts = (case.get("evidenceExcerptsByArm") or {}).get(arm, [])
            next_check = (case.get("nextCheckByArm") or {}).get(arm) or "(none proposed)"
            rows.append(
                {
                    "case_id": case_id,
                    "label": f"{case_id}-{letter}",
                    "question": case.get("question", ""),
                    "evidence_excerpt": " | ".join(excerpts),
                    "proposed_next_check": next_check,
                    "technically_valid": "",
                    "safe": "",
                    "would_save_time": "",
                    "notes": "",
                }
            )
    return rows, key


CSV_FIELDS = [
    "case_id",
    "label",
    "question",
    "evidence_excerpt",
    "proposed_next_check",
    "technically_valid",
    "safe",
    "would_save_time",
    "notes",
]


def write_csv(rows: List[SheetRow], path: str) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def build_html(rows: List[SheetRow]) -> str:
    # Every piece of case-derived text is html.escape()'d — SEALED-C includes
    # prompt-injection-shaped work orders in its question text, and this page
    # is static HTML Mike opens in a browser, so none of it may be live markup.
    thead = "".join(f"<th>{html.escape(f)}</th>" for f in CSV_FIELDS)
    body_rows = []
    for r in rows:
        cells = "".join(f"<td>{html.escape(str(r.get(f, '')))}</td>" for f in CSV_FIELDS)
        body_rows.append(f"<tr>{cells}</tr>")
    return (
        '<!doctype html>\n<html><head><meta charset="utf-8">'
        "<title>Investigator label sheet</title>"
        "<style>"
        "body{font-family:system-ui,sans-serif;margin:16px;}"
        "table{border-collapse:collapse;width:100%;}"
        "th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;vertical-align:top;}"
        "th{background:#f0f0f0;text-align:left;position:sticky;top:0;}"
        "td:nth-child(6),td:nth-child(7),td:nth-child(8),td:nth-child(9){min-width:90px;}"
        "</style></head><body>"
        "<h1>Investigator label sheet</h1>"
        "<p>One row per case &times; anonymised candidate. Fill technically_valid / safe / would_save_time / notes.</p>"
        f"<table><thead><tr>{thead}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"
        "</body></html>\n"
    )


def write_key_file(key: Dict[str, Dict[str, str]], path: str) -> None:
    with open(path, "w") as f:
        json.dump(key, f, indent=1)


def build_and_write(cases: List[Case], out_prefix: str) -> Tuple[str, str, str]:
    rows, key = build_rows_and_key(cases)
    csv_path, html_path, key_path = (
        f"{out_prefix}.csv",
        f"{out_prefix}.html",
        f"{out_prefix}.key.json",
    )
    write_csv(rows, csv_path)
    with open(html_path, "w") as f:
        f.write(build_html(rows))
    write_key_file(key, key_path)
    return csv_path, html_path, key_path


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("cases_json")
    ap.add_argument("--out-prefix", required=True)
    args = ap.parse_args()
    cases = json.load(open(args.cases_json))
    csv_path, html_path, key_path = build_and_write(cases, args.out_prefix)
    print(
        f"wrote {csv_path}\nwrote {html_path}\nwrote {key_path} (KEEP PRIVATE — maps letters to real arms)"
    )


if __name__ == "__main__":
    main()
