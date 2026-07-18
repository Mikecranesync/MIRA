"""OCR floor + provenance tests for VisionWorker (OCR-regime repair PR-A)."""

import pytest
from unittest.mock import AsyncMock, patch

from shared.workers.vision_worker import VisionWorker, parse_ocr_reply


class TestParseOcrReply:
    def test_numbered_list(self):
        raw = "1. -K17\n2. A1 A2\n3. 24VDC"
        assert parse_ocr_reply(raw) == ["-K17", "A1 A2", "24VDC"]

    def test_numbering_styles_preserve_dash_tags(self):
        assert parse_ocr_reply("2) A1") == ["A1"]
        assert parse_ocr_reply("3 - 24VDC") == ["24VDC"]
        assert parse_ocr_reply("3 -K17") == ["-K17"]
        assert parse_ocr_reply("12. -W412") == ["-W412"]
        assert parse_ocr_reply("-K17") == ["-K17"]
        assert parse_ocr_reply("4 A2") == ["A2"]

    def test_markdown_table_and_fences(self):
        raw = "```\n| -F12 | fuse |\n|:--|:--|\n{\n1. -S1\n```"
        items = parse_ocr_reply(raw)
        assert "-F12" in items and "fuse" in items and "-S1" in items
        assert "{" not in items

    def test_empty(self):
        assert parse_ocr_reply("") == []


def _worker() -> VisionWorker:
    return VisionWorker("http://unused:9", "", "unused-model")


class TestModelOcrLane:
    @pytest.mark.asyncio
    async def test_lane_off_by_default_no_network(self, monkeypatch):
        monkeypatch.delenv("OCR_MODEL_LANE", raising=False)
        with patch("shared.workers.vision_worker._inference_router") as router:
            router.complete = AsyncMock()
            assert await _worker()._call_ocr("aGk=") == []
            router.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_lane_on_routes_through_router(self, monkeypatch):
        monkeypatch.setenv("OCR_MODEL_LANE", "on")
        with patch("shared.workers.vision_worker._inference_router") as router:
            router.complete = AsyncMock(return_value=("1. -K17\n2. A1", {}))
            items = await _worker()._call_ocr("aGk=")
        assert items == ["-K17", "A1"]
        (messages,), _ = router.complete.await_args
        assert messages[0]["content"][0]["type"] == "image_url"

    @pytest.mark.asyncio
    async def test_lane_on_router_empty_returns_empty(self, monkeypatch):
        monkeypatch.setenv("OCR_MODEL_LANE", "on")
        with patch("shared.workers.vision_worker._inference_router") as router:
            router.complete = AsyncMock(return_value=("", {}))
            assert await _worker()._call_ocr("aGk=") == []


_TOKENS = [
    {"text": "-K17", "bbox": [640, 100, 700, 118], "line": (0, 1)},
    {"text": "A1", "bbox": [644, 132, 660, 144], "line": (0, 2)},
    {"text": "A2", "bbox": [666, 132, 682, 144], "line": (0, 2)},
]


def _patched_worker(monkeypatch, tokens=None, model_items=None):
    """Worker with vision prose + tesseract adapter + model lane all stubbed."""
    w = _worker()
    monkeypatch.setattr(
        "shared.workers.vision_worker.VisionWorker._call_vision",
        AsyncMock(return_value="electrical drawing, ladder logic"),
    )
    if tokens is None:
        from printsense.xref_extractor import OcrUnavailable

        def _raise(_b):
            raise OcrUnavailable("no binary")

        monkeypatch.setattr("shared.workers.vision_worker._tesseract_tokens_impl", _raise)
    else:
        monkeypatch.setattr(
            "shared.workers.vision_worker._tesseract_tokens_impl", lambda _b: tokens
        )
    monkeypatch.setattr(
        "shared.workers.vision_worker.VisionWorker._call_ocr",
        AsyncMock(return_value=model_items or []),
    )
    return w


class TestOcrFloor:
    @pytest.mark.asyncio
    async def test_tesseract_floor_feeds_items_tokens_source(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=_TOKENS)
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "tesseract"
        assert out["ocr_tokens"] == _TOKENS
        assert "-K17" in out["ocr_items"] and "A1 A2" in out["ocr_items"]
        assert "-K17" in out["tesseract_text"]

    @pytest.mark.asyncio
    async def test_both_lanes_dead_is_honest_none(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=None, model_items=[])
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "none"
        assert out["ocr_items"] == [] and out["ocr_tokens"] == []
        assert out["classification"]  # classification still works off vision prose

    @pytest.mark.asyncio
    async def test_model_lane_supplements_never_replaces(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=_TOKENS, model_items=["-F12", "-K17"])
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "tesseract+model"
        assert "-F12" in out["ocr_items"]           # model addition kept
        assert out["ocr_items"].count("-K17") == 1  # deduped, floor first

    @pytest.mark.asyncio
    async def test_model_only_when_floor_unavailable(self, monkeypatch):
        w = _patched_worker(monkeypatch, tokens=None, model_items=["-F12"])
        out = await w.process("aGk=", "what is this")
        assert out["ocr_source"] == "model"
        assert out["ocr_items"] == ["-F12"] and out["ocr_tokens"] == []
