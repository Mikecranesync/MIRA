"""The floor: pages of each question's own manual in a seeded random order. If a set cannot tell this from MIRA or BM25,
it cannot judge retrieval at all (validation test V1).

    python3 v02/random_baseline.py <questions.json> <out.jsonl>
"""

from __future__ import annotations

import json
import random
import re
import subprocess
import sys

SEED = 4791


def page_count(pdf: str) -> int:
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"^Pages:\s+(\d+)", out, re.M).group(1))


def main() -> None:
    qs = json.load(open(sys.argv[1]))
    counts: dict[str, int] = {}
    with open(sys.argv[2], "w") as out:
        for q in qs:
            n = counts.setdefault(q["pdf"], page_count(q["pdf"]))
            ranked = random.Random(f"{SEED}:{q['id']}").sample(range(1, n + 1), min(10, n))
            kind = "answerable" if q["accepted"] else "unanswerable"
            out.write(
                json.dumps(
                    {
                        "id": q["id"],
                        "set": q["set"],
                        "manual": q["manual"],
                        "kind": kind,
                        "accepted": q["accepted"],
                        "ranked_pages": ranked,
                        "latency_ms": None,
                        "error": None,
                    }
                )
                + "\n"
            )
    print(f"{len(qs)} rows -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
