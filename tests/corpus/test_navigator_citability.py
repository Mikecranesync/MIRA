"""Citability must be honored end-to-end, not just computed in docmap.

Regression for the P2 finding: `docmap.authoritative()` deliberately returns a
best-available ingest even when nothing is citable (520-qs001 has only
chunk-index copies), but the navigator still rendered "p{source_page}" in
`retrieval_path()` and emitted raw `source_page` in `as_retrieved_meta()` —
presenting a chunk ordinal to a technician as a real page number.

The contract under test:

  * content stays RETRIEVABLE (ok=True) — losing the manual entirely because
    its page numbers are unusable would be worse;
  * page numbers are NOT quotable: no "p123" in the path, `source_page: None`
    on every emitted dict (passages AND parent_context rows);
  * the raw ordinal survives as `nav_ordinal` for internal use, and
    `nav_citable` carries the verdict — a uniform shape in both cases.

No database: `build_docmap` is monkeypatched and `navigate()` takes a stub conn.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mira-bots"))

from shared.manual_nav import docmap, navigator  # noqa: E402

QUESTION = "How do I clear a fault on the 520?"

#: A passage row shaped like a `knowledge_entries` mapping. Contains the
#: Troubleshooting anchor phrase "clear fault" and no dotted TOC leader.
PASSAGE_ROW = {
    "content": "To clear fault F004, press the Stop key or cycle drive power.",
    "manufacturer": "Rockwell Automation",
    "model_number": "PowerFlex 520",
    "equipment_type": "drive",
    "source_type": "manual",
    "source_url": "gdrive://520-qs001_-en-e.pdf",
    "source_page": 123,
    "metadata": None,
    "verified": False,
}

#: Same page, different content — survives the parent-window dedup so
#: `parent_context` is non-empty and its rows can be asserted on too.
PARENT_ROW = {
    **PASSAGE_ROW,
    "content": "The drive stores the last three fault codes in the fault buffer.",
}


class _StubResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def fetchall(self):
        return self._rows


class StubConn:
    """Returns passage rows for the anchor query, parent rows for the window query."""

    def __init__(self, passage_rows, parent_rows):
        self.passage_rows = passage_rows
        self.parent_rows = parent_rows

    def execute(self, stmt, params=None):
        if "BETWEEN" in str(stmt):
            return _StubResult(self.parent_rows)
        return _StubResult(self.passage_rows)


def _chunk_only_doc():
    """520-qs001 as staging has it: chunk-index copies only, nothing citable."""
    ingest = docmap.Ingest("gdrive://520-qs001_-en-e.pdf", "manual", 391, 0, 390, 391)
    assert ingest.pagination == "chunk_index"
    return [docmap.ManualDoc("520-qs001", "Rockwell Automation", "PowerFlex 520", [ingest])]


def _citable_doc():
    """A real-pagination ingest (rows/pages ~4.1, the literature-URL shape)."""
    ingest = docmap.Ingest(
        "https://literature.rockwellautomation.com/x/520-qs001_-en-e.pdf",
        "manual",
        1069,
        1,
        274,
        260,
    )
    assert ingest.pagination == "real"
    return [docmap.ManualDoc("520-qs001", "Rockwell Automation", "PowerFlex 520", [ingest])]


def _navigate(monkeypatch, docs):
    monkeypatch.setattr(docmap, "build_docmap", lambda mfr, model, conn=None: docs)
    conn = StubConn([PASSAGE_ROW], [PASSAGE_ROW, PARENT_ROW])
    return navigator.navigate(QUESTION, "Rockwell Automation", "PowerFlex 520", conn=conn)


class TestNonCitableIngest:
    def test_content_stays_retrievable_but_pages_are_suppressed(self, monkeypatch):
        res = _navigate(monkeypatch, _chunk_only_doc())

        assert res.ok is True, res.reason
        assert res.citable is False
        assert res.passages, "passage must still be retrieved"
        assert res.parent_context, "parent rows must exist for this test to bite"

        path = res.retrieval_path()
        assert "p123" not in path
        assert path == "520-qs001 → Troubleshooting → passage"

        metas = res.as_retrieved_meta()
        assert metas, "must emit evidence dicts"
        for m in metas:
            assert m["source_page"] is None
            assert m["nav_ordinal"] == 123
            assert m["nav_citable"] is False
            # retrieval_path() is embedded as nav_path — suppression must
            # reach that surface too.
            assert "p123" not in m["nav_path"]
        roles = {m["nav_role"] for m in metas}
        assert roles == {"passage", "parent_context"}

    def test_internal_parent_window_still_uses_raw_pages(self, monkeypatch):
        """Suppression is emission-only: the parent SQL ran and found p123 rows."""
        res = _navigate(monkeypatch, _chunk_only_doc())
        assert res.parent_context[0]["source_page"] == 123


class TestCitableIngest:
    def test_pages_are_kept_and_marked_citable(self, monkeypatch):
        res = _navigate(monkeypatch, _citable_doc())

        assert res.ok is True, res.reason
        assert res.citable is True
        assert "p123" in res.retrieval_path()

        metas = res.as_retrieved_meta()
        assert metas
        for m in metas:
            assert m["source_page"] == 123
            assert m["nav_ordinal"] == 123
            assert m["nav_citable"] is True
