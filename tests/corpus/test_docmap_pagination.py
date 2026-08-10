"""`authoritative()` must rank by pagination plausibility, not page span.

Regression for a measured mis-selection: on the ~300-page PowerFlex 525 manual
the old "widest page span" rule chose `p0..1909`, because a chunk index counts
higher than real page numbers *by construction*. Widest span is an anti-signal.

Discriminator, verified across four Rockwell publications on staging:

    chunks/page  1.00         -> chunk index (source_page increments per chunk)
    chunks/page  2.95 .. 4.11 -> real pages  (several chunks share a page)
    chunks/page  419 .. 989   -> collapsed   (every row on page 1)
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mira-bots"))

from shared.manual_nav.docmap import Ingest, ManualDoc  # noqa: E402


def make_ingest(url, rows, page_min, page_max, distinct, source_type="manual"):
    return Ingest(url, source_type, rows, page_min, page_max, distinct)


# Real ingests of 520-um001, numbers taken from staging.
GDRIVE = make_ingest("gdrive://520-um001_-en-e.pdf", 1910, 0, 1909, 1910)
GDRIVE2 = make_ingest("gdrive://520-um001_-en-e (1).pdf", 1910, 0, 1909, 1910)
PLAIN = make_ingest("520-um001_-en-e.pdf", 1087, 0, 1086, 1087)
LIT = make_ingest(
    "https://literature.rockwellautomation.com/x/520-um001_-en-e.pdf", 1069, 1, 274, 260
)
COLLAPSED = make_ingest("520-um001_-en-e (1).pdf", 989, 1, 1, 1, "equipment_manual")


class TestPaginationClassification:
    def test_chunk_index_detected(self):
        assert GDRIVE.pagination == "chunk_index"
        assert PLAIN.pagination == "chunk_index"

    def test_real_pages_detected(self):
        assert LIT.pagination == "real"

    def test_collapsed_detected(self):
        assert COLLAPSED.pagination == "collapsed"

    def test_only_real_pagination_is_citable(self):
        assert LIT.citable
        assert not GDRIVE.citable
        assert not COLLAPSED.citable

    def test_small_ingest_is_unknown_not_guessed(self):
        """Too few pages to judge — say so rather than flip a coin."""
        assert make_ingest("tiny.pdf", 6, 1, 6, 6).pagination == "unknown"

    def test_boundary_exactly_at_chunk_index_max_is_chunk_index(self):
        """CHUNK_INDEX_MAX is inclusive: 24 rows / 20 pages == 1.2 exactly.

        The contract says "at or below this means chunk index"; a strict `<`
        classified the boundary as `real` and citable. Pin it from both sides.
        """
        at_boundary = make_ingest("boundary.pdf", 24, 1, 20, 20)
        assert at_boundary.pagination == "chunk_index"
        assert not at_boundary.citable

    def test_just_above_boundary_is_real(self):
        """25 rows / 20 pages == 1.25 > 1.2 — real pages, citable."""
        above = make_ingest("boundary.pdf", 25, 1, 20, 20)
        assert above.pagination == "real"
        assert above.citable


class TestAuthoritativeSelection:
    def _doc(self, *ingests):
        return ManualDoc("520-um001", "Rockwell Automation", "PowerFlex 525", list(ingests))

    def test_widest_span_does_NOT_win(self):
        """The regression. GDRIVE spans 1909 pages; LIT spans 273 and wins."""
        doc = self._doc(GDRIVE, GDRIVE2, PLAIN, LIT, COLLAPSED)
        chosen = doc.authoritative()
        assert chosen.source_url == LIT.source_url
        assert chosen.citable
        assert chosen.page_span < GDRIVE.page_span, "chose the wider span again"

    def test_collapsed_ranks_last(self):
        doc = self._doc(COLLAPSED, GDRIVE)
        assert doc.authoritative().source_url == GDRIVE.source_url

    def test_returns_best_available_when_nothing_is_citable(self):
        """520-qs001 has only chunk-index copies; losing it entirely is worse."""
        a = make_ingest("gdrive://520-qs001_-en-e.pdf", 391, 0, 390, 391)
        b = make_ingest("520-qs001_-en-e.pdf", 191, 0, 190, 191)
        chosen = ManualDoc(
            "520-qs001", "Rockwell Automation", "PowerFlex 525", [a, b]
        ).authoritative()
        assert chosen is not None
        assert not chosen.citable, "must not claim a chunk index is citable"

    def test_selection_is_deterministic(self):
        import random

        pool = [GDRIVE, GDRIVE2, PLAIN, LIT, COLLAPSED]
        picks = set()
        for _ in range(6):
            shuffled = pool[:]
            random.shuffle(shuffled)
            picks.add(self._doc(*shuffled).authoritative().source_url)
        assert len(picks) == 1, f"non-deterministic selection: {picks}"

    def test_url_tie_break_is_deterministic(self):
        """Identical pagination class AND identical row counts — only the URL
        differs, so the lexicographically smaller source_url must always win."""
        import random

        tie_a = make_ingest("https://a.example.com/520-um001.pdf", 1069, 1, 274, 260)
        tie_b = make_ingest("https://b.example.com/520-um001.pdf", 1069, 1, 274, 260)
        assert tie_a.pagination == tie_b.pagination == "real"
        for _ in range(10):
            pool = [tie_a, tie_b]
            random.shuffle(pool)
            chosen = self._doc(*pool).authoritative()
            assert chosen.source_url == tie_a.source_url, "url tie-break must be stable"

    def test_empty_document_returns_none(self):
        assert ManualDoc("x", "m", "d", []).authoritative() is None
