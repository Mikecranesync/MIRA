"""The unanswerable set's absence evidence is reproducible from the pinned manuals (#4596)."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from retrieval_eval import termcheck

REPO = Path(__file__).resolve().parents[2]
MANUAL_DIR = Path(
    os.environ.get("RETRIEVAL_EVAL_MANUAL_DIR", REPO / ".planning/retrieval-phase0/manuals")
)


def _q(qid: str, terms: dict) -> dict:
    return {"id": qid, "verification": {"manual_sha256": "abc", "terms": terms}}


def test_recheck_counts_pages_case_insensitively(monkeypatch, tmp_path):
    (tmp_path / "abc.pdf").write_bytes(b"%PDF")
    monkeypatch.setattr(termcheck, "pdf_pages", lambda _p: ["IP65 rated", "nothing", "ip 20"])
    ok, missing = termcheck.recheck([_q("a", {"ip ?[0-9]{2}\\b": 2, "nema": 0})], tmp_path)
    assert ok == [] and missing == []


def test_recheck_reports_a_drifted_count(monkeypatch, tmp_path):
    (tmp_path / "abc.pdf").write_bytes(b"%PDF")
    monkeypatch.setattr(termcheck, "pdf_pages", lambda _p: ["NEMA 4X"])
    bad, _ = termcheck.recheck([_q("a", {"nema": 0})], tmp_path)
    assert bad == [{"id": "a", "term": "nema", "frozen": 0, "got": 1}]


def test_recheck_reports_a_missing_manual(tmp_path):
    bad, missing = termcheck.recheck([_q("a", {"nema": 0})], tmp_path)
    assert bad == [] and missing == ["abc"]


@pytest.mark.skipif(shutil.which("pdftotext") is None, reason="pdftotext (poppler) not installed")
def test_frozen_term_counts_reproduce_from_the_pinned_manuals():
    questions = json.loads(termcheck.DEFAULT_SET.read_text())["questions"]
    shas = {q["verification"]["manual_sha256"] for q in questions}
    if not MANUAL_DIR.is_dir() or not all((MANUAL_DIR / f"{s}.pdf").is_file() for s in shas):
        pytest.skip(f"pinned manual cache absent at {MANUAL_DIR}; set RETRIEVAL_EVAL_MANUAL_DIR")
    mismatches, missing = termcheck.recheck(questions, MANUAL_DIR)
    assert missing == [] and mismatches == []
