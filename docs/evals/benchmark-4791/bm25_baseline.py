"""Outside baseline: page-level Okapi BM25 over `pdftotext -layout` pages, no MIRA code. Zero tokens, stdlib only.

    python3 bm25_baseline.py <questions.json> <out.jsonl>

Each question is scored against the pages of its own manual only, matching the harness's doc scope. Writes rows
shaped like the #4589 harness (id, set, manual, kind, accepted, ranked_pages[:10], latency_ms) so analyze.py
scores both identically. Parity limits: whole pages, not MIRA's chunks; a plain tokenizer; no fault-code or
family logic. It is a reference point, not a competitor tuned to win.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import time
from collections import Counter

K1, B = 1.2, 0.75
TOKEN = re.compile(r"[a-z0-9]+(?:[.\-/][a-z0-9]+)*")
STOP = set(
    "a an and are as at be but by can do does for from has have how i if in is it its me my no not of on or "
    "so that the their there this to was what when where which while who why will with you your".split()
)


def tokens(s: str) -> list[str]:
    return [t for t in TOKEN.findall(s.lower()) if t not in STOP]


def pages(pdf: str) -> list[list[str]]:
    n = int(
        re.search(
            r"^Pages:\s+(\d+)",
            subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout,
            re.M,
        ).group(1)
    )
    text = subprocess.run(
        ["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True
    ).stdout.split("\f")
    return [tokens(text[i]) if i < len(text) else [] for i in range(n)]


def rank(question: str, docs: list[list[str]]) -> list[int]:
    n, avg = len(docs), sum(map(len, docs)) / max(1, len(docs))
    df = Counter(t for d in docs for t in set(d))
    tfs = [Counter(d) for d in docs]
    q = tokens(question)
    scores = []
    for i, tf in enumerate(tfs):
        s = 0.0
        for t in q:
            if tf[t]:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * tf[t] * (K1 + 1) / (tf[t] + K1 * (1 - B + B * len(docs[i]) / avg))
        scores.append((s, i))
    return [i + 1 for s, i in sorted(scores, key=lambda x: (-x[0], x[1])) if s > 0][:10]


def main() -> None:
    qs = json.load(open(sys.argv[1]))
    cache: dict[str, list[list[str]]] = {}
    with open(sys.argv[2], "w") as out:
        for q in qs:
            docs = cache.setdefault(q["pdf"], pages(q["pdf"]))
            t0 = time.perf_counter()
            ranked = rank(q["question"], docs)
            row = {
                "id": q["id"],
                "set": q["set"],
                "manual": q["manual"],
                "kind": "answerable" if q["accepted"] else "unanswerable",
                "accepted": q["accepted"],
                "ranked_pages": ranked,
                "latency_ms": (time.perf_counter() - t0) * 1000,
                "error": None,
            }
            out.write(json.dumps(row) + "\n")
    print(f"{len(qs)} rows -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
