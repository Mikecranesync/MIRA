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


def ing(url, rows, pmin, pmax, distinct, stype="manual"):
    return Ingest(url, stype, rows, pmin, pmax, distinct)


# Real ingests of 520-um001, numbers taken from staging.
GDRIVE = ing("gdrive://520-um001_-en-e.pdf", 1910, 0, 1909, 1910)
GDRIVE2 = ing("gdrive://520-um001_-en-e (1).pdf", 1910, 0, 1909, 1910)
PLAIN = ing("520-um001_-en-e.pdf", 1087, 0, 1086, 1087)
LIT = ing("https://literature.rockwellautomation.com/x/520-um001_-en-e.pdf", 1069, 1, 274, 260)
COLLAPSED = ing("520-um001_-en-e (1).pdf", 989, 1, 1, 1, "equipment_manual")


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
        assert ing("tiny.pdf", 6, 1, 6, 6).pagination == "unknown"


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
        a = ing("gdrive://520-qs001_-en-e.pdf", 391, 0, 390, 391)
        b = ing("520-qs001_-en-e.pdf", 191, 0, 190, 191)
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

    def test_empty_document_returns_none(self):
        assert ManualDoc("x", "m", "d", []).authoritative() is None
