"""Tests for seed_kb_gaps chunking + reference doc integrity."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPTS = REPO_ROOT / "mira-core" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from seed_kb_gaps import DOCS, REFERENCE_DIR, chunk_markdown


def test_reference_docs_exist():
    """All 3 reference docs are present."""
    for doc_meta in DOCS:
        path = REFERENCE_DIR / doc_meta["filename"]
        assert path.exists(), f"Missing: {path}"


def test_reference_docs_non_empty():
    """Each reference doc has substantial content (>1KB)."""
    for doc_meta in DOCS:
        path = REFERENCE_DIR / doc_meta["filename"]
        assert path.stat().st_size > 1000, f"{path} too small"


def test_chunk_splits_on_section_headers():
    """Chunker splits on `## ` headers."""
    lines = [
        "# Title",
        "",
        "Intro paragraph with enough content to be retained.",
        "",
        "## Section A",
        "",
        "Content A with enough length to make it a meaningful retrieval chunk.",
        "",
        "## Section B",
        "",
        "Content B with enough length to make it a meaningful retrieval chunk.",
    ]
    text = "\n".join(lines)
    chunks = chunk_markdown(text)
    assert any("## Section A" in c for c in chunks)
    assert any("## Section B" in c for c in chunks)


def test_chunk_respects_max_chars_with_paragraphs():
    """Sections that exceed max_chars get split on paragraph boundaries."""
    paragraph = "A" * 400
    # 5 paragraphs, each 400 chars, joined with \n\n — total ~2000 chars
    text = "## Section\n\n" + "\n\n".join([paragraph] * 5)
    chunks = chunk_markdown(text, max_chars=1000)
    # Each chunk should fit within the 1000-char budget (plus some slack)
    for c in chunks:
        assert len(c) <= 1200, f"Chunk too large: {len(c)} chars"
    # Should produce multiple chunks since 5 paragraphs × 400 > 1000
    assert len(chunks) >= 2


def test_chunk_drops_trivial_fragments():
    """Very short chunks (<50 chars) are dropped."""
    text = "## S\n\na\n\n## Real\n\nReal content here with plenty of text to be meaningful."
    chunks = chunk_markdown(text)
    # Trivial "## S\n\na" section is dropped
    for c in chunks:
        assert len(c) > 50


def test_expected_keywords_in_docs():
    """Each doc contains the benchmark keywords it's meant to cover."""
    expectations = {
        "motor-efficiency-nema-premium.md": [
            "NEMA Premium", "IE3", "efficiency",
        ],
        "shaft-voltage-vfd-bearing-currents.md": [
            "shaft voltage", "1 V", "fluting", "grounding ring",
        ],
        "motor-bearing-greasing.md": [
            "over-greasing", "regrease", "SKF",
        ],
    }
    for filename, keywords in expectations.items():
        path = REFERENCE_DIR / filename
        content = path.read_text()
        for kw in keywords:
            assert kw.lower() in content.lower(), f"{filename} missing keyword: {kw!r}"


def test_all_docs_chunk_to_multiple_sections():
    """Each reference doc produces >=5 retrieval chunks."""
    for doc_meta in DOCS:
        path = REFERENCE_DIR / doc_meta["filename"]
        chunks = chunk_markdown(path.read_text())
        assert len(chunks) >= 5, (
            f"{doc_meta['filename']} produced only {len(chunks)} chunks"
        )
