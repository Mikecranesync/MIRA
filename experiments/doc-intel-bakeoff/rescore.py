"""Re-score results.jsonl in place from each row's RECORDED answer/evidence.

Every row already carries the raw answer text, evidence snippets, cited pages,
and expectations — so scoring fixes (e.g. the digit-grouping normalization) can
be re-applied deterministically without re-running any lane. Writes a new file
and prints a per-adapter before→after diff so no change is silent.

Usage: py rescore.py out/results.jsonl
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from common import QResult, score


def main() -> None:
    path = Path(sys.argv[1])
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    diffs: dict[str, list] = defaultdict(list)
    out_lines = []
    for raw in rows:
        before = raw.get("correct")
        r = QResult(**raw)
        q = {
            "expect_all": (raw.get("expected") or {}).get("expect_all"),
            "expect_any": (raw.get("expected") or {}).get("expect_any"),
            "expect_page": (raw.get("expected") or {}).get("expect_page"),
            "abstain": (raw.get("expected") or {}).get("abstain"),
            "scope_guard": raw.get("scope_ok") is not None or None,
        }
        # drop None-keyed entries so score() sees the same shape as live runs
        q = {k: v for k, v in q.items() if v is not None}
        if not raw.get("error"):
            score(r, q)
        after = r.correct
        if before != after:
            diffs[raw["adapter"]].append((raw["question_id"], before, after))
        d = raw | {
            "correct": r.correct,
            "citation_correct": r.citation_correct,
            "abstention_correct": r.abstention_correct,
        }
        out_lines.append(json.dumps(d, ensure_ascii=False))
    path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    if not diffs:
        print("rescore: no changes")
    for adapter, items in diffs.items():
        for qid, b, a in items:
            print(f"rescore: {adapter} {qid}: {b} -> {a}")


if __name__ == "__main__":
    main()
