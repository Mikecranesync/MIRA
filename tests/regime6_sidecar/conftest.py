"""Fixtures for regime 6: MIRA RAG sidecar tests."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def sample_pdf_path(tmp_path: Path) -> Path:
    """Create a minimal PDF for testing ingestion."""
    # Minimal valid PDF
    pdf_content = b"""%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (VFD fault code OC means overcurrent.) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000236 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
330
%%EOF"""
    pdf = tmp_path / "test_manual.pdf"
    pdf.write_bytes(pdf_content)
    return pdf


@pytest.fixture
def sample_txt_path(tmp_path: Path) -> Path:
    """Create a sample text file for testing ingestion."""
    txt = tmp_path / "test_sop.txt"
    txt.write_text(
        "GS10 VFD Troubleshooting Guide\n\n"
        "Fault Code OC — Overcurrent\n"
        "Cause: Motor wiring short, excessive load, or undersized VFD.\n"
        "Fix: Check motor wiring for shorts. Reduce load. Verify VFD is rated "
        "for motor FLA. Check acceleration time (P01.01) is not too short.\n\n"
        "Fault Code OV — Overvoltage\n"
        "Cause: DC bus voltage exceeds 300V during deceleration.\n"
        "Fix: Increase deceleration time (P01.02). Add braking resistor if needed.\n",
        encoding="utf-8",
    )
    return txt


@pytest.fixture
def sample_state_history() -> list[dict]:
    """Mock state transition history for FSM builder testing."""
    # Simulates 10 cycles: idle(0) -> starting(1) -> running(2) -> stopping(3) -> idle(0)
    history = []
    t = 0
    for cycle in range(10):
        history.append({"state": "0", "timestamp_ms": t})
        t += 500 + (cycle * 10)  # idle dwell ~500ms
        history.append({"state": "1", "timestamp_ms": t})
        t += 1000 + (cycle * 20)  # starting dwell ~1000ms
        history.append({"state": "2", "timestamp_ms": t})
        t += 5000 + (cycle * 50)  # running dwell ~5000ms
        history.append({"state": "3", "timestamp_ms": t})
        t += 800 + (cycle * 15)  # stopping dwell ~800ms
    history.append({"state": "0", "timestamp_ms": t})
    return history


@pytest.fixture
def mock_llm_provider() -> MagicMock:
    """Mock LLM provider that returns canned responses."""
    provider = MagicMock()
    provider.model_name = "mock-model"
    provider.complete = AsyncMock(
        return_value="Based on the GS10 manual, fault code OC indicates overcurrent. "
        "Check motor wiring for shorts and verify VFD rating."
    )
    provider.embed = AsyncMock(return_value=[[0.1] * 384])
    return provider


@pytest.fixture
def chroma_path(tmp_path: Path) -> Path:
    """Temporary ChromaDB storage path."""
    p = tmp_path / "chroma_test"
    p.mkdir()
    return p
