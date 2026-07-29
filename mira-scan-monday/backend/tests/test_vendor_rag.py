"""Unit tests for the manufacturer-scoped chat path.

Run from `mira-scan-monday/`:

    python -m pytest backend/tests/test_vendor_rag.py -v
"""

from __future__ import annotations

import pytest

from backend import vendor_rag
from backend.models import ChatSource


def test_manufacturer_patterns_powerflex_525():
    pats = vendor_rag.manufacturer_patterns("ab-powerflex-525")
    # Curated entry has allen-bradley, allen bradley, rockwell, ab.
    assert "%allen-bradley%" in pats
    assert "%rockwell%" in pats


def test_manufacturer_patterns_unknown_asset():
    assert vendor_rag.manufacturer_patterns("not-a-real-id") == []
    assert vendor_rag.manufacturer_patterns(None) == []


def test_chunks_to_sources_dedupes_by_url_and_page():
    chunks = [
        {
            "manufacturer": "Allen-Bradley",
            "model_number": "PowerFlex 525",
            "source_url": "https://ex/manual.pdf",
            "source_page": 12,
            "content": "x",
        },
        {
            "manufacturer": "Allen-Bradley",
            "model_number": "PowerFlex 525",
            "source_url": "https://ex/manual.pdf",
            "source_page": 12,
            "content": "y",
        },
        {
            "manufacturer": "Allen-Bradley",
            "model_number": "PowerFlex 525",
            "source_url": "https://ex/manual.pdf",
            "source_page": 13,
            "content": "z",
        },
    ]
    sources = vendor_rag.chunks_to_sources(chunks)
    assert len(sources) == 2
    assert all(isinstance(s, ChatSource) for s in sources)
    assert sources[0].page == 12 and sources[1].page == 13


def test_build_grounded_messages_includes_citations_and_label():
    chunks = [
        {
            "manufacturer": "Allen-Bradley",
            "model_number": "PowerFlex 525",
            "source_url": "https://ex/m.pdf",
            "source_page": 7,
            "content": "P035 sets motor mode.",
        }
    ]
    msgs = vendor_rag.build_grounded_messages(
        chunks,
        asset_label="Allen-Bradley PowerFlex 525",
        history=[{"role": "user", "content": "hi"}],
        user_message="What is P035?",
    )
    assert msgs[0]["role"] == "system"
    sys = msgs[0]["content"]
    assert "Allen-Bradley PowerFlex 525" in sys
    assert "[1]" in sys
    assert "P035 sets motor mode." in sys
    assert msgs[-1] == {"role": "user", "content": "What is P035?"}


@pytest.mark.asyncio
async def test_vendor_chat_returns_none_when_no_patterns():
    # No asset_id → no patterns → fast fallback.
    result = await vendor_rag.vendor_chat(
        message="What is P035?",
        asset_id=None,
        asset_label=None,
        history=[],
    )
    assert result is None


@pytest.mark.asyncio
async def test_vendor_chat_no_chunks_returns_no_docs_message(monkeypatch):
    """Known asset in the allowlist but no KB chunks — should return a
    deterministic 'no documentation' message, NOT None (which would fall
    through to the raw MIRA_KB_BASE_URL config error).
    """

    async def empty_chunks(_patterns, _query, **_kwargs):  # noqa: ARG001
        return []

    monkeypatch.setattr(vendor_rag, "retrieve_vendor_chunks", empty_chunks)
    monkeypatch.setattr(
        vendor_rag,
        "_providers",
        lambda: [{"name": "stub", "url": "x", "key": "x", "model": "x"}],
    )

    result = await vendor_rag.vendor_chat(
        message="What does fault code F12 mean?",
        asset_id="automationdirect-gs10",
        asset_label="AutomationDirect GS10",
        history=[],
    )
    # Must NOT return None — returning None exposes the config-error string to users.
    assert result is not None
    reply, sources = result
    assert "AutomationDirect GS10" in reply
    assert "knowledge base" in reply.lower()
    assert sources == []


@pytest.mark.asyncio
async def test_vendor_chat_filters_by_manufacturer(monkeypatch):
    """The retrieval SQL must restrict by manufacturer ILIKE — never
    return chunks from unrelated vendors. We assert by inspecting the
    params passed to db.fetch_all (the full query) and feeding back a
    canned chunk-set; the LLM call is also stubbed.
    """
    captured: dict[str, object] = {}

    async def fake_fetch_all(sql: str, params):
        captured["sql"] = sql
        captured["params"] = params
        # Pretend NeonDB returned one PowerFlex chunk.
        return [
            (
                "Parameter P035 [Motor NP Volts] sets nameplate voltage.",
                "Allen-Bradley",
                "PowerFlex 525",
                "https://ex/pf525.pdf",
                42,
                {"chunk_index": 3},
                0.81,
            )
        ]

    async def fake_call(messages):  # noqa: ARG001 — signature parity
        return "P035 sets the motor nameplate voltage [1]."

    monkeypatch.setattr(vendor_rag.db, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(vendor_rag, "call_llm_cascade", fake_call)
    monkeypatch.setattr(
        vendor_rag,
        "_providers",
        lambda: [{"name": "stub", "url": "x", "key": "x", "model": "x"}],
    )

    result = await vendor_rag.vendor_chat(
        message="What is P035?",
        asset_id="ab-powerflex-525",
        asset_label="Allen-Bradley PowerFlex 525",
        history=[],
    )
    assert result is not None
    reply, sources = result
    assert "P035" in reply
    assert sources and sources[0].url == "https://ex/pf525.pdf"

    # Verify the SQL really restricts by manufacturer.
    sql = str(captured["sql"])
    assert "manufacturer ILIKE" in sql
    assert "content_tsv @@ plainto_tsquery" in sql
    # Patterns must include allen-bradley alias from the curated entry.
    params = list(captured["params"])  # type: ignore[arg-type]
    assert "%allen-bradley%" in params
