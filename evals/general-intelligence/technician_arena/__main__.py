"""python -m technician_arena <command>

sign <case-id> --signer "Name" [--date YYYY-MM-DD]
      The expert signs one case's key after reviewing it (PRD §4). Any later
      edit to that key voids the signature until it is signed again.
status
      Key status of every case (signed / unsigned / tampered).
run [...]
      See technician_arena/run.py (--dry-run, --budget-usd, --arms, --workflow).
score <run-dir> --grades <dir>
      Build SCORECARD.md from attempts.jsonl + human grade files (*.json).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from technician_arena import cases as ta_cases  # noqa: E402
from technician_arena import keys, run, scorecard  # noqa: E402


def _sign(argv: list[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="technician_arena sign")
    ap.add_argument("case_id")
    ap.add_argument("--signer", required=True)
    ap.add_argument("--date", default=time.strftime("%Y-%m-%d"))
    a = ap.parse_args(argv)
    doc = json.loads(ta_cases.CASES_FILE.read_text(encoding="utf-8"))
    for i, c in enumerate(doc["cases"]):
        if c["id"] == a.case_id:
            doc["cases"][i] = keys.sign(c, signer=a.signer, date=a.date)
            ta_cases.CASES_FILE.write_text(
                json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            print(f"signed {a.case_id}: {doc['cases'][i]['expert_key']['key_sha256']}")
            return 0
    print(f"no case {a.case_id!r}", file=sys.stderr)
    return 2


def _score(argv: list[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="technician_arena score")
    ap.add_argument("run_dir")
    ap.add_argument("--grades", required=True)
    a = ap.parse_args(argv)
    run_dir = Path(a.run_dir)
    attempts = [json.loads(x) for x in (run_dir / "attempts.jsonl").read_text().splitlines() if x]
    grades = [json.loads(p.read_text()) for p in sorted(Path(a.grades).glob("*.json"))]
    sc = scorecard.build(attempts, grades)
    (run_dir / "SCORECARD.md").write_text(scorecard.render(sc) + "\n", encoding="utf-8")
    print(scorecard.render(sc))
    return 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "sign":
        return _sign(rest)
    if cmd == "status":
        for c in ta_cases.load():
            print(f"{keys.key_status(c):9}  {c['id']}")
        return 0
    if cmd == "run":
        return run.main(rest)
    if cmd == "score":
        return _score(rest)
    print(f"unknown command {cmd!r}\n{__doc__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
