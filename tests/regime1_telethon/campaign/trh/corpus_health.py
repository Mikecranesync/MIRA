"""Corpus Health — the state BEFORE retrieval can be blamed.

TRH classifies a failing turn into a layer, and its first layer is INGEST: "does
the answer exist at all". That question turned out to be too coarse. The
Manual Navigator experiment found PowerFlex 525 content that **exists, is
embedded, and is retrievable in principle** while being 1.80x duplicated across
five ingests of one publication, with a single paragraph carrying four different
page numbers. INGEST=PASS was true and useless.

So this module splits INGEST into a four-state ladder, and the whole point is
that the middle state used to be invisible:

    SOURCE_MISSING      no manual for this product. Ingest work. Never
                        substitute a sibling vendor's book.
    CORPUS_UNHEALTHY    the source IS present, but duplicated / mis-paged /
                        structurally bare. Retrieval tuning here is wasted:
                        the candidate pool is full of copies and any page
                        citation is unreliable.
    HEALTHY_INGEST      one authoritative copy, sane pages. If the answer is
                        still not found, the defect is downstream.
    RETRIEVAL_FAILURE   healthy corpus, expected passage still not retrieved.

Every metric is deterministic SQL over the public corpus. Nothing here writes.

## On thresholds

They are declared, not tuned. `DUP_WARN = 1.15` says a corpus more than 15%
duplicated is unhealthy; PowerFlex 525 measured 1.80x and AutomationDirect
1.01x, so the line sits well clear of both and is not fitted to make either
side of the experiment look better. Same for the others — each records the
observed value that motivated it, so a future change is an argument rather
than a nudge.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

SOURCE_MISSING = "SOURCE_MISSING"
CORPUS_UNHEALTHY = "CORPUS_UNHEALTHY"
HEALTHY_INGEST = "HEALTHY_INGEST"
RETRIEVAL_FAILURE = "RETRIEVAL_FAILURE"

#: > this much content duplication and the candidate pool is being crowded.
#: Observed: PF525 1.80, AutomationDirect 1.01.
DUP_WARN = 1.15
#: More than one authoritative copy means citations cannot be reconciled.
#: Observed: PF525 5 ingests of one publication.
MAX_INGESTS_PER_DOC = 1
#: A doc whose rows all sit on one page number cannot support a page citation.
#: Observed: the 989-row PF525 `equipment_manual` ingest, every row page=1.
MIN_DISTINCT_PAGES = 2
#: Below this many rows a "manual" is a stub, not a manual.
#: Observed: GS10's largest doc is 7 rows.
MIN_ROWS_FOR_MANUAL = 40


@dataclass
class DocHealth:
    doc_key: str
    ingests: int
    rows: int
    distinct_content: int
    collapsed_ingests: int
    max_distinct_pages: int
    issues: list[str] = field(default_factory=list)

    @property
    def dup_ratio(self) -> float:
        return self.rows / max(self.distinct_content, 1)


@dataclass
class ProductHealth:
    manufacturer: str
    model: str
    state: str
    rows: int = 0
    distinct_content: int = 0
    docs: list[DocHealth] = field(default_factory=list)
    conflicts: int = 0
    missing_structure: dict[str, int] = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)

    @property
    def dup_ratio(self) -> float:
        return self.rows / max(self.distinct_content, 1)

    def summary(self) -> str:
        return (
            f"{self.manufacturer}/{self.model}: {self.state} "
            f"rows={self.rows} distinct={self.distinct_content} "
            f"dup={self.dup_ratio:.2f}x docs={len(self.docs)} conflicts={self.conflicts}"
        )


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


_TOTALS = """
SELECT count(*) rows, count(DISTINCT md5(content)) distinct_content
FROM knowledge_entries WHERE is_private = false AND model_number ILIKE :m
"""

#: The metric the Manual Navigator surfaced: the SAME text carrying DIFFERENT
#: page numbers. Every one of these makes a page citation unfalsifiable.
_CONFLICTS = """
SELECT count(*) FROM (
  SELECT md5(content) h
  FROM knowledge_entries
  WHERE is_private = false AND model_number ILIKE :m AND source_page IS NOT NULL
  GROUP BY md5(content)
  HAVING count(DISTINCT source_page) > 1
) x
"""

_STRUCTURE = """
SELECT count(*) tot,
       count(*) FILTER (WHERE doc_id IS NULL)        no_doc_id,
       count(*) FILTER (WHERE section_path IS NULL)  no_section_path,
       count(*) FILTER (WHERE page_start IS NULL)    no_page_start,
       count(*) FILTER (WHERE source_page IS NULL)   no_source_page
FROM knowledge_entries WHERE is_private = false AND model_number ILIKE :m
"""


def check_product(manufacturer: str, model: str, conn=None) -> ProductHealth:
    """Deterministic health for one product. Read-only."""
    import sys

    from sqlalchemy import text

    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
    bots = os.path.join(repo, "mira-bots")
    if bots not in sys.path:
        sys.path.insert(0, bots)
    from shared.manual_nav import docmap  # noqa: PLC0415

    owns = conn is None
    eng = _engine() if owns else None
    conn = conn or eng.connect()
    try:
        like = {"m": f"%{model}%"}
        tot = conn.execute(text(_TOTALS), like).mappings().first()
        h = ProductHealth(manufacturer, model, HEALTHY_INGEST, tot["rows"], tot["distinct_content"])

        if h.rows == 0:
            h.state = SOURCE_MISSING
            h.issues.append(f"no rows at all for model ~{model!r}")
            return h

        h.conflicts = conn.execute(text(_CONFLICTS), like).scalar() or 0
        st = conn.execute(text(_STRUCTURE), like).mappings().first()
        h.missing_structure = {
            k: st[k] for k in ("no_doc_id", "no_section_path", "no_page_start", "no_source_page")
        }

        for d in docmap.build_docmap(manufacturer, model, conn=conn):
            rows = d.rows
            dc = (
                conn.execute(
                    text(
                        "SELECT count(DISTINCT md5(content)) FROM knowledge_entries "
                        "WHERE is_private=false AND source_url = ANY(:urls)"
                    ),
                    {"urls": [i.source_url for i in d.ingests]},
                ).scalar()
                or 1
            )
            dh = DocHealth(
                doc_key=d.doc_key,
                ingests=len(d.ingests),
                rows=rows,
                distinct_content=dc,
                collapsed_ingests=sum(1 for i in d.ingests if i.collapsed),
                max_distinct_pages=max((i.distinct_pages for i in d.ingests), default=0),
            )
            if dh.ingests > MAX_INGESTS_PER_DOC:
                dh.issues.append(f"{dh.ingests} ingests of one publication")
            if dh.collapsed_ingests:
                dh.issues.append(f"{dh.collapsed_ingests} ingest(s) with all rows on one page")
            if dh.max_distinct_pages < MIN_DISTINCT_PAGES:
                dh.issues.append("no ingest has usable page numbers")
            h.docs.append(dh)

        biggest = max((d.rows for d in h.docs), default=0)
        if biggest < MIN_ROWS_FOR_MANUAL:
            h.state = SOURCE_MISSING
            h.issues.append(
                f"largest 'manual' is {biggest} rows (< {MIN_ROWS_FOR_MANUAL}) — stubs, not a manual"
            )
            return h

        if h.dup_ratio > DUP_WARN:
            h.issues.append(f"content duplication {h.dup_ratio:.2f}x > {DUP_WARN}")
        if h.conflicts:
            h.issues.append(f"{h.conflicts} text(s) carry conflicting page numbers")
        if any(d.issues for d in h.docs):
            h.issues.append("per-document issues (see docs)")
        if h.missing_structure.get("no_doc_id", 0) == h.rows:
            h.issues.append("structural columns (doc_id/section_path/page_start) 100% unpopulated")

        h.state = CORPUS_UNHEALTHY if h.issues else HEALTHY_INGEST
        return h
    finally:
        if owns:
            conn.close()


def report(healths: list[ProductHealth]) -> str:
    lines = [
        "| product | state | rows | distinct | dup | docs | ingests(max) | page-conflicts |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for h in healths:
        mx = max((d.ingests for d in h.docs), default=0)
        lines.append(
            f"| {h.manufacturer}/{h.model} | **{h.state}** | {h.rows} | {h.distinct_content} | "
            f"{h.dup_ratio:.2f}x | {len(h.docs)} | {mx} | {h.conflicts} |"
        )
    for h in healths:
        if h.issues:
            lines += ["", f"**{h.model} issues**"]
            lines += [f"- {i}" for i in h.issues]
            for d in h.docs:
                if d.issues:
                    lines.append(f"  - `{d.doc_key}` ({d.rows} rows): {'; '.join(d.issues)}")
    return "\n".join(lines)


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--product", action="append", default=[], help="Manufacturer/Model")
    a = ap.parse_args()
    pairs = [tuple(p.split("/", 1)) for p in a.product] or [
        ("Rockwell Automation", "PowerFlex 525"),
        ("AutomationDirect", "GS10"),
    ]
    hs = [check_product(m, mo) for m, mo in pairs]
    for h in hs:
        print(h.summary())
    print()
    print(report(hs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
