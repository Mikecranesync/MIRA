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
        # A page that names a DIFFERENT model is never a candidate: a PowerFlex 40 manual does not
        # answer a PowerFlex 525 question just because the 525 manual is missing. Pages with no
        # model (family-wide documents) stay eligible. No match means no candidates: coverage gap.
        keep = [p for p in keep if not p.model or p.model.lower().replace(" ", "") == model]
    return keep


class PageIndex:
    """BM25 over a page corpus, tokenized once.

    Re-tokenizing every page per question made a 5,480-page corpus unusable for a 2,000-case
    cycle. Scores use corpus-wide document frequencies; only pages sharing a query token are
    touched (inverted index), and the document-family filter restricts which may be returned.
    """

    def __init__(self, pages: list[ManualPage], k1: float = 1.5, b: float = 0.75):
        self.pages, self.k1, self.b = pages, k1, b
        self.tf = [Counter(tokens(p.text)) for p in pages]
        self.length = [sum(t.values()) for t in self.tf]
        self.avg = (sum(self.length) / len(pages)) if pages else 0.0
        self.postings: dict[str, list[int]] = {}
        for i, tf in enumerate(self.tf):
            for t in tf:
                self.postings.setdefault(t, []).append(i)

    def rank(self, query: str, allowed: set[int] | None = None) -> list[tuple[float, ManualPage]]:
        n, scores = len(self.pages), Counter()
        for t in set(tokens(query)):
            post = self.postings.get(t, [])
            idf = math.log(1 + (n - len(post) + 0.5) / (len(post) + 0.5))
            for i in post:
                if allowed is not None and i not in allowed:
                    continue
                f = self.tf[i][t]
                norm = 1 - self.b + self.b * self.length[i] / (self.avg or 1)
                scores[i] += idf * f * (self.k1 + 1) / (f + self.k1 * norm)
        ranked = [(s, self.pages[i]) for i, s in scores.items() if s > 0]
        return sorted(ranked, key=lambda x: (-x[0], x[1].doc_sha256, x[1].page))


def resolve(
    case: BenchmarkCase, pages: list[ManualPage], k: int = 5, index: PageIndex | None = None
) -> list[Evidence]:
    """Top-k candidate pages from the question's document family. Pass `index` (built once
    over `pages`) when resolving many cases."""
    q = case.question
    query = " ".join(filter(None, [q.normalized_question, q.error_code, q.model]))
    index = index or PageIndex(pages)
    keep = {id(p) for p in candidate_manuals(case, index.pages)}
    allowed = {i for i, p in enumerate(index.pages) if id(p) in keep}
    ranked = index.rank(query, allowed)[:k]
    return [
        Evidence(
            p.source_id,
            p.doc_sha256,
            p.page,
            p.text[:200],
            p.revision,
            " ".join(filter(None, [p.manufacturer, p.model])),
        )
        for _, p in ranked
    ]
