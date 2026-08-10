"""Manual hierarchy index — derived, because the schema's columns are empty.

`knowledge_entries` already HAS the hierarchy columns — `doc_id`, `section_path`,
`page_start`, `page_end`, `source_ref`, `ingest_route`. They are populated on
**0 of 83,540 PUBLIC rows** (`is_private = false`). That measurement covers the
legacy shared corpus ONLY; private v2 Hub uploads were never checked and may
populate them (migration 045). An earlier draft of this docstring said the
columns were "designed and never filled" — that generalised beyond what was
measured, and is corrected here.

So this module derives the hierarchy from what IS present on the legacy rows
(`source_url`, `source_page`, `content`) without writing to the corpus. Nothing here mutates
`knowledge_entries`; the index is a read-only overlay.

## What the probe found, and why it changes the design

PowerFlex 525 is not one manual. It is **the same manual ingested five times**:

    gdrive://520-um001_-en-e (1).pdf   1910 rows   p0..1909
    gdrive://520-um001_-en-e.pdf       1910 rows   p0..1909   (exact twin)
    520-um001_-en-e.pdf                1087 rows   p0..1086
    literature.rockwellautomation.com  1069 rows   p1..274
    520-um001_-en-e (1).pdf             989 rows   ALL page=1

1.80x content duplication (7,547 rows -> 4,183 distinct). AutomationDirect, for
contrast, is 1.01x. And the single fault-clear paragraph appears FIVE times at
four different page numbers — 1, 160, 712 and 1251 — all from one source PDF.

Two consequences the navigator is built around:

1. **Page citations are currently unreliable.** "p160" and "p1251" are the same
   paragraph. A citation is only meaningful once it names WHICH ingest of WHICH
   document it came from.
2. **Duplication crowds the candidate pool.** Any top-k over PF525 spends its
   budget on near-identical copies. This is a more mundane and more likely
   explanation for the RET-001 miss than polysemy alone — and unlike polysemy it
   is fixable by choosing one authoritative document *before* ranking.

So step one of navigation is not "find the passage". It is "decide which
document is authoritative", which is exactly the technician's own first move.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Document identity
# ---------------------------------------------------------------------------

_NOISE = re.compile(r"\s*\(\d+\)\s*$")  # "foo (1).pdf" -> "foo.pdf"
_SCHEME = re.compile(r"^[a-z]+://", re.IGNORECASE)

#: chunks-per-distinct-page at or below this means `source_page` increments once
#: per chunk, i.e. it is a chunk index rather than a page number. Measured
#: clusters on staging: 1.00 (chunk index) vs 2.95-4.11 (real pages).
CHUNK_INDEX_MAX = 1.2
#: Below this many distinct pages the ratio is not informative; say `unknown`.
_MIN_PAGES_TO_JUDGE = 20


def doc_key(source_url: str | None, source_type: str | None = None) -> str:
    """Collapse the ingest variants of ONE document to a single key.

    `gdrive://520-um001_-en-e (1).pdf`, `520-um001_-en-e.pdf` and the Rockwell
    literature URL are all publication **520-um001**. Keying on the publication
    stem is what lets the navigator say "this is one manual, ingested four
    ways" instead of treating them as four sources that happen to agree.
    """
    if not source_url:
        return f"unknown:{source_type or 'na'}"
    url = _SCHEME.sub("", source_url.strip())
    stem = url.rsplit("/", 1)[-1]
    stem = re.sub(r"\.(pdf|htm|html)$", "", stem, flags=re.IGNORECASE)
    stem = _NOISE.sub("", stem).strip()
    # Rockwell publication ids: 520-um001_-en-e -> 520-um001
    m = re.match(r"^([0-9]{3,4}-[a-z]{2}\d{3})", stem, re.IGNORECASE)
    if m:
        return m.group(1).lower()
    return stem.lower() or f"unknown:{source_type or 'na'}"


@dataclass
class Ingest:
    """One physical ingest of a document."""

    source_url: str
    source_type: str
    rows: int
    page_min: int
    page_max: int
    distinct_pages: int

    @property
    def page_span(self) -> int:
        return max(0, (self.page_max or 0) - (self.page_min or 0))

    @property
    def collapsed(self) -> bool:
        """All rows on one page number — page data is meaningless for citation."""
        return self.distinct_pages <= 1 and self.rows > 5

    @property
    def chunks_per_page(self) -> float:
        return self.rows / max(self.distinct_pages, 1)

    @property
    def pagination(self) -> str:
        """`real` | `chunk_index` | `collapsed` | `unknown`.

        The discriminator that replaced "widest page span". A real page carries
        SEVERAL chunks; a `source_page` that increments once per chunk is a chunk
        index wearing a page number's clothes. Measured across four independent
        Rockwell publications on staging:

            chunks/page   1.00          gdrive + plain-filename ingests -> chunk index
            chunks/page   2.95 .. 4.11  literature-URL ingests          -> real pages
            chunks/page   419 .. 989    every row on page 1             -> collapsed

        The gap between 1.00 and 2.95 is wide and the 1.00 cases are *exactly*
        1.00, so `CHUNK_INDEX_MAX = 1.2` is nowhere near either cluster. Below
        `_MIN_PAGES_TO_JUDGE` distinct pages there is not enough signal to tell,
        and the honest answer is `unknown` rather than a coin-flip.
        """
        if self.collapsed:
            return "collapsed"
        if self.distinct_pages < 2:
            return "unknown"
        if self.distinct_pages < _MIN_PAGES_TO_JUDGE:
            return "unknown"
        return "chunk_index" if self.chunks_per_page <= CHUNK_INDEX_MAX else "real"

    @property
    def citable(self) -> bool:
        """Can a page number from this ingest be quoted to a technician?"""
        return self.pagination == "real"


@dataclass
class ManualDoc:
    """A logical manual: one publication, one or more ingests."""

    doc_key: str
    manufacturer: str
    model: str
    ingests: list[Ingest] = field(default_factory=list)

    @property
    def rows(self) -> int:
        return sum(i.rows for i in self.ingests)

    def authoritative(self) -> Ingest | None:
        """The ingest a citation should name.

        **Ranked by PAGINATION PLAUSIBILITY, not page span.** The previous rule
        ("widest span") reliably chose the WORST copy: on the ~300-page PowerFlex
        525 manual it picked `p0..1909`, because a chunk index counts higher than
        real page numbers by construction. Widest span is an anti-signal here.

        Order: `real` > `unknown` > `chunk_index` > `collapsed`, then row count,
        then source_url. The url tie-break keeps the choice reproducible across
        runs — a navigator that silently changed its mind about which copy is
        authoritative would make every citation unfalsifiable.

        Returns the best AVAILABLE ingest even when none is citable (520-qs001
        has only chunk-index copies). Callers that intend to quote a page must
        check `.citable`; returning None there would lose retrievable content
        just because its page numbers are unusable.
        """
        rank = {"real": 0, "unknown": 1, "chunk_index": 2, "collapsed": 3}
        pool = self.ingests
        if not pool:
            return None
        return sorted(pool, key=lambda i: (rank.get(i.pagination, 9), -i.rows, i.source_url))[0]


# ---------------------------------------------------------------------------
# Section derivation
# ---------------------------------------------------------------------------

#: Chapter/section cues that actually appear in OEM drive manuals. Ordered
#: most-specific first; the first match wins so "Chapter 4 — Troubleshooting"
#: resolves to the chapter, not the bare word.
_SECTION_CUES: tuple[tuple[str, str], ...] = (
    ("troubleshooting", "Troubleshooting"),
    ("fault and diagnostic", "Fault and Diagnostic"),
    ("fault code", "Fault Codes"),
    ("fault descriptions", "Fault Codes"),
    ("drive is faulted", "Troubleshooting"),
    ("programming and parameters", "Programming and Parameters"),
    ("parameter cross reference", "Parameter Reference"),
    ("advanced program group", "Programming and Parameters"),
    ("installation", "Installation"),
    ("wiring", "Wiring"),
    ("start-up", "Start-Up"),
    ("start up", "Start-Up"),
    ("specifications", "Specifications"),
    ("accessories", "Accessories and Dimensions"),
    ("dimensions", "Accessories and Dimensions"),
    ("safety ratings", "Safety Ratings"),
    ("communication", "Communications"),
    ("modbus", "Communications"),
)

#: A chunk that is mostly dots/leading is a table-of-contents line, not content.
_TOC_RE = re.compile(r"\.{6,}")


def classify_chunk(content: str) -> str:
    """`text` | `table` | `toc` | `figure` — the leaf type in the hierarchy.

    Kept coarse on purpose. A finer taxonomy would need layout data the corpus
    does not carry, and inventing one would put confidence behind a guess.
    """
    if not content:
        return "text"
    if _TOC_RE.search(content):
        return "toc"
    low = content.lower()
    if low.count(" = ") >= 4 or low.count(",") >= 12:
        return "table"
    if re.search(r"\bfigure\s+\d|\bschematic\b|\bdiagram\b", low):
        return "figure"
    return "text"


def derive_section(content: str) -> str | None:
    """Best-effort chapter/section label for a chunk.

    Returns None rather than guessing when nothing matches — an unlabelled
    chunk is honest, a mislabelled one silently misroutes navigation.
    """
    if not content:
        return None
    low = content.lower()
    for cue, label in _SECTION_CUES:
        if cue in low:
            return label
    return None


# ---------------------------------------------------------------------------
# Index build (read-only)
# ---------------------------------------------------------------------------

# MODEL-scoped, not `manufacturer OR model`. The OR form pulled every Rockwell
# publication — 150-um011, 750-in001, 22d-um001 — into a PowerFlex 525 lookup,
# and the navigator picks docs[0]. That is product contamination one step before
# retrieval even runs, and it would have been invisible: the top doc happens to
# be the right one for PF525 today, so the bug only bites on a model whose
# manual is smaller than a sibling's.
#
# Manufacturer is a FALLBACK, used only when no model is supplied, and it is
# never OR'd with the model.
_DOC_SQL_MODEL = """
SELECT coalesce(source_url,'') AS source_url,
       coalesce(source_type,'') AS source_type,
       count(*) AS rows,
       min(source_page) AS page_min,
       max(source_page) AS page_max,
       count(DISTINCT source_page) AS distinct_pages
FROM knowledge_entries
WHERE is_private = false
  AND model_number ILIKE :model
GROUP BY 1, 2
ORDER BY rows DESC
"""

_DOC_SQL_MFR = _DOC_SQL_MODEL.replace("model_number ILIKE :model", "manufacturer ILIKE :mfr")


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def build_docmap(manufacturer: str, model: str, conn=None) -> list[ManualDoc]:
    """Group every ingest for a (vendor, model) into logical manuals."""
    from sqlalchemy import text

    owns = conn is None
    eng = _engine() if owns else None
    conn = conn or eng.connect()
    try:
        if model:
            sql, params = _DOC_SQL_MODEL, {"model": f"%{model}%"}
        elif manufacturer:
            sql, params = _DOC_SQL_MFR, {"mfr": f"%{manufacturer}%"}
        else:
            return []
        rows = conn.execute(text(sql), params).mappings().fetchall()
    finally:
        if owns:
            conn.close()

    docs: dict[str, ManualDoc] = {}
    for r in rows:
        key = doc_key(r["source_url"], r["source_type"])
        doc = docs.setdefault(key, ManualDoc(key, manufacturer, model))
        doc.ingests.append(
            Ingest(
                source_url=r["source_url"] or "(none)",
                source_type=r["source_type"],
                rows=r["rows"],
                page_min=r["page_min"] or 0,
                page_max=r["page_max"] or 0,
                distinct_pages=r["distinct_pages"] or 0,
            )
        )
    return sorted(docs.values(), key=lambda d: -d.rows)


def summarize(docs: list[ManualDoc]) -> str:
    out = []
    for d in docs:
        auth = d.authoritative()
        out.append(f"doc={d.doc_key}  rows={d.rows}  ingests={len(d.ingests)}")
        for i in d.ingests:
            star = " *AUTH" if auth and i.source_url == auth.source_url else ""
            flag = " [collapsed]" if i.collapsed else ""
            out.append(
                f"    {i.rows:5} rows  p{i.page_min}..{i.page_max:<5} "
                f"[{i.source_type[:16]:16}] {i.source_url[:52]}{flag}{star}"
            )
    return "\n".join(out)
