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
