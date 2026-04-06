"""Tests for TM parser knowledge abstraction pass.

Tests section classification, Ollama-based theory abstraction,
config toggle, and graceful failure when Ollama is unreachable.

Usage:
    cd mira-hud
    uv run --with httpx --with pytest pytest vim/tests/test_tm_parser.py -v -s
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx

from vim.config import ParserConfig
from vim.tm_parser import (
    TMChunk,
    _classify_section_type,
    _run_knowledge_abstraction,
)

# ---------------------------------------------------------------------------
# Sample text — realistic military TM theory paragraph
# ---------------------------------------------------------------------------

_THEORY_ORIGINAL = (
    "The T700-GE-701C turboshaft engine (NSN 2840-01-331-4649) uses a "
    "5-stage axial / 1-stage centrifugal compressor to achieve a 17:1 "
    "pressure ratio. Compressor discharge air is directed through 12 "
    "fuel nozzles in the annular combustion chamber. Turbine inlet "
    "temperature is limited to 1,650\u00b0F (899\u00b0C) to prevent "
    "first-stage turbine blade creep. The power turbine drives the "
    "output shaft at 20,900 RPM through a reduction gearbox."
)

_THEORY_ABSTRACTED = (
    "The turboshaft engine uses a multi-stage axial and centrifugal "
    "compressor to achieve a 17:1 pressure ratio. Compressor discharge "
    "air is directed through fuel nozzles in the annular combustion "
    "chamber. Turbine inlet temperature is limited to 1,650\u00b0F "
    "(899\u00b0C) to prevent first-stage turbine blade creep. The "
    "power turbine drives the output shaft through a reduction gearbox."
)


def _make_chunk(chunk_type: str, content: str = _THEORY_ORIGINAL) -> TMChunk:
    """Create a TMChunk with the given type and content."""
    return TMChunk(
        chunk_id=f"test_p1_c0",
        page_num=1,
        chunk_type=chunk_type,
        content=content,
        section="Theory of Operation",
        char_count=len(content),
    )


def _mock_ollama_response(text: str) -> MagicMock:
    """Create a mock httpx.Response that returns the given text."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"response": text}
    mock_resp.raise_for_status = MagicMock()
    return mock_resp


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSectionClassifier:
    """Verify heading-based section type classification."""

    def test_theory_heading(self):
        assert _classify_section_type("THEORY OF OPERATION") == "theory"
        assert _classify_section_type("Theory") == "theory"

    def test_general_principle_heading(self):
        assert _classify_section_type("GENERAL INFORMATION") == "general_principle"
        assert _classify_section_type("GENERAL DESCRIPTION") == "general_principle"
        assert _classify_section_type("GENERAL") == "general_principle"

    def test_procedure_heading(self):
        assert _classify_section_type("MAINTENANCE") == "procedure"
        assert _classify_section_type("Troubleshooting") == "procedure"
        assert _classify_section_type("REMOVAL AND INSTALLATION") == "procedure"

    def test_unknown_heading(self):
        assert _classify_section_type("SOME OTHER HEADING") == "text"
        assert _classify_section_type("") == "text"


class TestKnowledgeAbstraction:
    """Verify the knowledge abstraction pass on TMChunks."""

    @patch("vim.tm_parser.httpx.post")
    def test_theory_chunk_abstracted(self, mock_post):
        """Theory chunk with abstraction enabled: content differs from
        original_text, source_anonymized is True."""
        mock_post.return_value = _mock_ollama_response(_THEORY_ABSTRACTED)
        config = ParserConfig(enable_knowledge_abstraction=True)

        chunk = _make_chunk("theory")
        original = chunk.content

        _run_knowledge_abstraction([chunk], config)

        assert chunk.content == _THEORY_ABSTRACTED
        assert chunk.content != original
        assert chunk.metadata["original_text"] == original
        assert chunk.metadata["source_anonymized"] is True
        mock_post.assert_called_once()

    @patch("vim.tm_parser.httpx.post")
    def test_procedure_chunk_unchanged(self, mock_post):
        """Procedure chunk: content is unchanged, no source_anonymized flag."""
        config = ParserConfig(enable_knowledge_abstraction=True)

        procedure_text = "Step 1: Disconnect the negative battery cable."
        chunk = _make_chunk("procedure", content=procedure_text)

        _run_knowledge_abstraction([chunk], config)

        assert chunk.content == procedure_text
        assert "source_anonymized" not in chunk.metadata
        mock_post.assert_not_called()

    def test_abstraction_disabled_via_config(self):
        """Abstraction disabled via config: theory chunk content equals
        original text."""
        config = ParserConfig(enable_knowledge_abstraction=False)

        chunk = _make_chunk("theory")
        original = chunk.content

        _run_knowledge_abstraction([chunk], config)

        assert chunk.content == original
        assert "source_anonymized" not in chunk.metadata

    @patch("vim.tm_parser.httpx.post")
    def test_ollama_unreachable(self, mock_post):
        """Ollama unreachable: theory chunk still stored with original text,
        no crash."""
        mock_post.side_effect = httpx.ConnectError("Connection refused")
        config = ParserConfig(enable_knowledge_abstraction=True)

        chunk = _make_chunk("theory")
        original = chunk.content

        # Must not raise
        _run_knowledge_abstraction([chunk], config)

        assert chunk.content == original
        assert "source_anonymized" not in chunk.metadata
