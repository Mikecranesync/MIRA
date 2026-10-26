"""Independent evidence resolution (spec §4B, §9 stage 4).

question → manufacturer/model family → candidate manuals → BM25 candidate pages.

This is the evaluator's own retrieval, built from scratch on page text the caller extracted
from OEM PDFs. It must never import or call MIRA's retrieval (`recall_knowledge`,
`neon_recall`, the RAG worker): if gold pages came from the ranking under test, the
benchmark would grade MIRA against itself. `tests/answer_radar/factory` enforces that.
Results are *candidates* for labelers, never gold on their own.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from answer_radar.factory.case import BenchmarkCase, Evidence

_TOKEN = re.compile(r"[a-z0-9]+")


def tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


@dataclass(frozen=True)
class ManualPage:
    source_id: str
    doc_sha256: str
    page: int
    text: str
    manufacturer: str = ""
    model: str = ""
    revision: str | None = None


def candidate_manuals(case: BenchmarkCase, pages: list[ManualPage]) -> list[ManualPage]:
    """Document-family resolution: same manufacturer, and same model when both sides name one."""
    q = case.question
    maker, model = q.manufacturer.lower(), q.model.lower().replace(" ", "")
    keep = [p for p in pages if not maker or not p.manufacturer or p.manufacturer.lower() == maker]
    if model:
        exact = [p for p in keep if p.model and p.model.lower().replace(" ", "") == model]
        keep = exact or keep
    return keep


def bm25_rank(
    query: str, pages: list[ManualPage], k1: float = 1.5, b: float = 0.75
) -> list[tuple[float, ManualPage]]:
    docs = [tokens(p.text) for p in pages]
    if not docs:
        return []
    avg = sum(map(len, docs)) / len(docs)
    df = Counter(t for d in docs for t in set(d))
    n = len(docs)
    scored = []
    for page, d in zip(pages, docs):
        tf = Counter(d)
        s = 0.0
        for t in set(tokens(query)):
            if t in tf:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / (avg or 1)))
        scored.append((s, page))
    return sorted(scored, key=lambda x: (-x[0], x[1].doc_sha256, x[1].page))


def resolve(case: BenchmarkCase, pages: list[ManualPage], k: int = 5) -> list[Evidence]:
    q = case.question
    query = " ".join(filter(None, [q.normalized_question, q.error_code, q.model]))
    ranked = [(s, p) for s, p in bm25_rank(query, candidate_manuals(case, pages)) if s > 0][:k]
    return [
        Evidence(p.source_id, p.doc_sha256, p.page, p.text[:200], p.revision) for _, p in ranked
    ]
