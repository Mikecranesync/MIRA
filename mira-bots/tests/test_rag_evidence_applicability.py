"""Applicability and evidence snapshots at the actual generation boundary."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from shared.workers.rag_worker import RAGWorker


def _make_worker():
    router = MagicMock()
    router.enabled = False
    worker = RAGWorker("http://test", "test", "test", router=router, tenant_id="tenant-a")
    worker._ingest_url = ""
    return worker


def row(text, vendor="Yaskawa", model="A1000", **metadata):
    return {
        "content": text,
        "manufacturer": vendor,
        "model_number": model,
        "metadata": metadata,
        "retrieval_streams": ["bm25"],
        "similarity": 0.1,
    }


def state(vendor="Yaskawa", model="A1000"):
    return {
        "state": "DIAGNOSIS",
        "exchange_count": 1,
        "asset_identified": f"{vendor} {model}",
        "context": {"uns_context": {"manufacturer": vendor, "model": model, "confidence": 0.5}},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("photo", [None, "photo-base64"])
async def test_prompt_excludes_conflicts_and_preserves_applicable_and_unknown(photo):
    worker = _make_worker()
    chunks = [
        row("wrong model secret", model="V1000"),
        row("wrong vendor secret", vendor="Rockwell", model="PowerFlex 525"),
        row("correct passage"),
        row("family passage", model="1000 series", applies_to_models=["A1000", "V1000"]),
        row("tenant drawing context", vendor="", model=""),
        row("excluded passage", excluded_models=["A1000"]),
    ]
    captured = []

    async def llm(messages, model=None):
        captured.append(str(messages))
        return "answer"

    s = state()
    with (
        patch.object(worker, "_embed_ollama", AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", return_value=chunks),
    ):
        await worker.process("Explain this alarm", s, photo_b64=photo)
    prompt = captured[0]
    assert "wrong model secret" not in prompt
    assert "wrong vendor secret" not in prompt
    assert "excluded passage" not in prompt
    assert all(t in prompt for t in ["correct passage", "family passage", "tenant drawing context"])
    assert "general/context only" in prompt
    assert s["_rag_sources"] == ["correct passage", "family passage", "tenant drawing context"]
    assert [c["evidence_applicability"] for c in s["_rag_last_chunks"]] == [
        "model",
        "family",
        "unknown",
    ]


@pytest.mark.asyncio
async def test_manufacturer_only_explicit_asset_drops_unrelated_vendor():
    worker = _make_worker()
    captured = []

    async def llm(messages, model=None):
        captured.append(str(messages))
        return "answer"

    s = state("Pilz", "")
    chunks = [
        row("wrong vendor secret", vendor="Rockwell", model="PowerFlex 525"),
        row("Pilz family guidance", vendor="Pilz", model=""),
    ]
    with (
        patch.object(worker, "_embed_ollama", AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", return_value=chunks),
    ):
        await worker.process("PNOZ relay won't reset", s)
    assert "wrong vendor secret" not in captured[0]
    assert "Pilz family guidance" in captured[0]


@pytest.mark.asyncio
async def test_rerank_keeps_text_metadata_and_snapshot_paired():
    worker = _make_worker()
    worker.nemotron = AsyncMock()
    worker.nemotron.enabled = True
    worker.nemotron.rerank.return_value = [{"text": "second passage", "score": 1}]
    captured = []

    async def llm(messages, model=None):
        captured.append(str(messages))
        return "answer"

    chunks = [row("first passage", section="First"), row("second passage", section="Second")]
    s = state()
    with (
        patch.object(worker, "_embed_ollama", AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", return_value=chunks),
    ):
        await worker.process("Explain this alarm", s)
    assert "[Source: Yaskawa A1000 — First]" not in captured[0]
    assert "[Source: Yaskawa A1000 — Second]" in captured[0]
    assert s["_rag_sources"] == ["second passage"]
    assert worker._last_distances == [0.1]
    assert s["_rag_last_chunks"][0]["metadata"]["section"] == "Second"


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_direct_prompt_builders_apply_same_evidence_policy(builder):
    worker = _make_worker()
    chunks = [
        row("wrong model secret", model="V1000"),
        row("alias passage", vendor="Allen-Bradley", model="PF525"),
        row(
            "family passage",
            vendor="Rockwell",
            model="520-series",
            applicability={"applies_to_models": ["PowerFlex 525"]},
        ),
        row("tenant drawing context", vendor="", model=""),
    ]
    s = state("Rockwell Automation", "PowerFlex 525")
    if builder == "_build_prompt":
        messages = worker._build_prompt(s, "Explain", neon_chunks=chunks)
    else:
        messages = worker._build_prompt_with_chunks(s, "Explain", chunks)
    prompt = str(messages)
    assert "wrong model secret" not in prompt
    assert "alias passage" in prompt
    assert "family passage" in prompt
    assert "tenant drawing context" in prompt
    assert "general/context only" in prompt


@pytest.mark.parametrize(
    "chunk,expected",
    [
        (row("alias", vendor="Allen-Bradley", model="PF525"), "model"),
        (row("context", vendor="", model=""), "unknown"),
        (row("context", vendor="Rockwell", model=""), "unknown"),
        (
            row(
                "excluded",
                vendor="Rockwell",
                model="PowerFlex 525",
                applies_to_models=["PowerFlex 525"],
                excluded_models=["PF525"],
            ),
            None,
        ),
        (
            row(
                "wrong", vendor="Rockwell", model="PowerFlex 520", applies_to_models="PowerFlex 525"
            ),
            None,
        ),
    ],
)
def test_applicability_aliases_unknown_and_exclusion_precedence(chunk, expected):
    from shared.workers.rag_worker import _applicable_chunk

    result = _applicable_chunk(chunk, state("Rockwell Automation", "PowerFlex 525"))
    assert (result["evidence_applicability"] if result else None) == expected
    assert "evidence_applicability" not in chunk  # caller-owned retrieval rows untouched


def test_incidental_low_confidence_vendor_does_not_suppress_evidence():
    from shared.workers.rag_worker import _applicable_chunk

    s = state("Delta Electronics", "")
    s["asset_identified"] = "pressure sensor"
    result = _applicable_chunk(row("drawing", vendor="Rockwell", model="PowerFlex 525"), s)
    assert result["evidence_applicability"] == "unknown"


@pytest.mark.parametrize("tag", ["A1000 Series", "V1000/A1000"])
def test_explicit_model_coverage_in_source_tag(tag):
    from shared.workers.rag_worker import _applicable_chunk

    assert _applicable_chunk(row("passage", model=tag), state()) is not None


@pytest.mark.parametrize("metadata", ["legacy", [], {"applicability": "legacy"}])
def test_legacy_metadata_does_not_break_evidence_boundary(metadata):
    from shared.workers.rag_worker import _applicable_chunk

    chunk = row("passage")
    chunk["metadata"] = metadata
    assert _applicable_chunk(chunk, state())["evidence_applicability"] == "model"


@pytest.mark.asyncio
@pytest.mark.parametrize("label", ["ch4Parameters", "Getting Started", "Serial Comms"])
async def test_actual_corpus_chapter_labels_remain_unknown_prompt_context(label):
    worker = _make_worker()
    chunk = row(
        "GS10 reference context retained, not independently model proof.",
        vendor=None,
        model=label,
        source_url=f"gdrive://{label}.pdf",
        section=None,
        chunk_type="text",
        chunk_index=4,
    )
    chunk["source_type"] = "gdrive"
    chunk["source_url"] = f"gdrive://{label}.pdf"
    s = state("AutomationDirect", "GS10")
    captured = []

    async def llm(messages, model=None):
        captured.append(str(messages))
        return "answer"

    with (
        patch.object(worker, "_embed_ollama", AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", return_value=[chunk]),
    ):
        await worker.process("GS10 VFD showing OC fault on startup", s)
    assert "GS10 reference context retained" in captured[0]
    assert "general/context only" in captured[0]
    assert s["_rag_last_chunks"][0]["evidence_applicability"] == "unknown"
    assert s["_rag_last_chunks"][0]["model_number"] == label


@pytest.mark.parametrize(
    "url,text",
    [
        (
            "https://html.duckduckgo.com/html/?q=Pilz+PNOZ",
            "Pilz PNOZ X safety relay manual at DuckDuckGo",
        ),
        (
            "https://www.pilz.com/en-US/support/downloads",
            "# 404 Error - Page not found\nPlease contact me",
        ),
        ("https://www.youtube.com/watch?v=demo", "Generic demonstration video"),
    ],
)
def test_clear_search_error_and_junk_sources_cannot_enter_reference_prompt(url, text):
    from shared.workers.rag_worker import _applicable_chunk

    chunk = row(text, vendor="Pilz", model="")
    chunk.update(source_url=url, source_type="equipment_manual")
    assert _applicable_chunk(chunk, state("Pilz", "PNOZ")) is None
    prompt = str(
        _make_worker()._build_prompt(state("Pilz", "PNOZ"), "Explain", neon_chunks=[chunk])
    )
    assert text not in prompt


def test_legitimate_manual_containing_404_remains_applicable():
    from shared.workers.rag_worker import _applicable_chunk

    chunk = row("Manual reference: parameter 404 is a diagnostic display item.")
    chunk.update(source_url="https://www.yaskawa.com/manual.pdf", source_type="manual")
    assert _applicable_chunk(chunk, state())["evidence_applicability"] == "model"


def test_ch_prefix_equipment_model_is_not_guessed_to_be_a_chapter():
    from shared.workers.rag_worker import _applicable_chunk

    assert _applicable_chunk(row("Different equipment", model="CH4A"), state()) is None


def test_pdf_diagnostic_section_is_not_misclassified_as_web_404_page():
    from shared.workers.rag_worker import _applicable_chunk

    chunk = row("# 404 Error - Page not found\nHTTP diagnostic reference in a genuine manual.")
    chunk.update(source_url="https://www.yaskawa.com/manual.pdf", source_type="manual")
    assert _applicable_chunk(chunk, state())["evidence_applicability"] == "model"


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_scope_warning_precedes_header_and_passage_stays_immediately_after_it(builder):
    worker = _make_worker()
    unknown_text = "Generic drawing observation, applicability not established."
    known_text = "Applicable A1000 passage."
    chunks = [row(unknown_text, model="", section="Drawing"), row(known_text, section="Manual")]
    s = state()
    if builder == "_build_prompt":
        messages = worker._build_prompt(s, "Explain", neon_chunks=chunks)
    else:
        messages = worker._build_prompt_with_chunks(s, "Explain", chunks, neon_chunks_meta=chunks)
    prompt = "\n".join(m["content"] for m in messages if isinstance(m.get("content"), str))
    lines = [line for line in prompt.splitlines() if line.strip()]
    unknown_header = next(
        i for i, line in enumerate(lines) if "[Source: Yaskawa — Drawing]" in line
    )
    known_header = next(
        i for i, line in enumerate(lines) if "[Source: Yaskawa A1000 — Manual]" in line
    )
    assert lines[unknown_header + 1] == unknown_text
    assert lines[known_header + 1] == known_text
    assert "Applicability unknown: general/context only" in lines[unknown_header - 1]
    assert prompt.count("Applicability unknown: general/context only") == 1
    assert (
        "do not use this passage to substantiate model-specific codes, settings or procedures"
        in prompt
    )
