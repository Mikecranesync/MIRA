"""Tests for the photo OCR endpoint (ask_api/ocr_extract.py, EVID-4).

A minimal FastAPI app with ONLY the ocr_extract router — never ask_api.app
(which builds the heavy Supervisor engine at import time). pytesseract / the
tesseract binary are NOT required in the test environment; every degradation
path (flag off, engine missing, bad input, busy, timeout) must be provable
without them, because that is the state the endpoint must survive in
production when the dependency breaks. The happy path is exercised by
monkeypatching the worker with a canned tesseract data dict.

Run: cd mira-bots && python -m pytest tests/test_ask_api_ocr_extract.py -q
"""

import base64
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import ask_api.ocr_extract as oe
from ask_api.ocr_extract import assemble_text, router as ocr_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(ocr_router)
    return TestClient(app)


_TINY_IMAGE_B64 = base64.b64encode(b"\xff\xd8\xff\xe0 not a real jpeg").decode()


@pytest.fixture(autouse=True)
def _cold_module(monkeypatch):
    oe._engine_ready = False
    oe._engine_failed_reason = None
    oe._slot = threading.Semaphore(1)
    monkeypatch.delenv("ASK_API_KEY", raising=False)
    yield
    oe._engine_ready = False
    oe._engine_failed_reason = None
    oe._slot = threading.Semaphore(1)


def _tess_data(words):
    """Build a pytesseract image_to_data dict from (word, conf, block, par, line)."""
    keys = ["text", "conf", "block_num", "par_num", "line_num"]
    d = {k: [] for k in keys}
    for w, c, b, p, ln in words:
        d["text"].append(w)
        d["conf"].append(c)
        d["block_num"].append(b)
        d["par_num"].append(p)
        d["line_num"].append(ln)
    return d


class TestAssembleText:
    def test_reading_order_lines_and_paragraphs(self):
        data = _tess_data([
            ("", -1, 1, 1, 1),            # tesseract emits empty boxes for layout nodes
            ("Model", 91.5, 1, 1, 1),
            ("GS10", 88.0, 1, 1, 1),
            ("Rated", 70.0, 1, 1, 2),
            ("1.27A", 60.0, 1, 1, 2),
            ("Serial", 95.0, 1, 2, 1),
            ("49849", 85.5, 1, 2, 1),
        ])
        text, conf, words = assemble_text(data)
        assert text == "Model GS10\nRated 1.27A\n\nSerial 49849"
        assert words == 6
        assert conf == pytest.approx((91.5 + 88 + 70 + 60 + 95 + 85.5) / 6, abs=0.1)

    def test_empty_read_reports_none_confidence_not_perfect(self):
        text, conf, words = assemble_text(_tess_data([("", -1, 1, 1, 1), ("  ", -1, 1, 1, 1)]))
        assert text == ""
        assert conf is None
        assert words == 0

    def test_negative_conf_words_count_but_do_not_score(self):
        # tesseract uses -1 for words it kept but could not score
        text, conf, words = assemble_text(_tess_data([("A", -1, 1, 1, 1), ("B", 50, 1, 1, 1)]))
        assert text == "A B"
        assert words == 2
        assert conf == 50.0


class TestFeatureFlag:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("PHOTO_OCR_ENABLED", raising=False)
        resp = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64})
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert body["reason"] == "disabled"
        assert body["text"] == ""
        assert body["word_count"] == 0
        assert body["mean_confidence"] is None

    def test_key_gate(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        monkeypatch.setenv("ASK_API_KEY", "secret")
        assert _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64}).status_code == 401
        ok = _client().post(
            "/ocr/extract", json={"image_base64": _TINY_IMAGE_B64}, headers={"X-Mira-Key": "secret"}
        )
        assert ok.status_code == 200


class TestGracefulDegradation:
    def test_missing_engine_is_available_false_not_500(self, monkeypatch):
        """Flag on, tesseract absent (true here): caught, cached, reported."""
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        # Force the load to fail deterministically regardless of the host.
        monkeypatch.setattr(oe, "_load_engine", lambda: setattr(oe, "_engine_failed_reason", "ocr_load_failed: x"))
        resp = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64})
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert body["reason"].startswith("ocr_load_failed")

    def test_busy_slot_bounces(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        assert oe._slot.acquire(blocking=False)  # someone else is mid-OCR
        body = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64}).json()
        assert body["available"] is False
        assert body["reason"] == "busy"

    def test_inference_error_degrades(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")

        def boom(raw, lang):
            raise RuntimeError("tesseract exploded")

        monkeypatch.setattr(oe, "_run_ocr", boom)
        body = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64}).json()
        assert body["available"] is False
        assert body["reason"] == "inference_failed: RuntimeError"


class TestInputValidation:
    def test_invalid_base64_400(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        assert _client().post("/ocr/extract", json={"image_base64": "@@@"}).status_code == 400

    def test_undecodable_image_400(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        monkeypatch.setattr(oe, "_load_engine", lambda: setattr(oe, "_engine_ready", True))
        # _run_ocr reaches _prepare_image, which raises on non-image bytes.
        resp = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64})
        assert resp.status_code == 400
        assert "undecodable" in resp.json()["detail"]

    def test_decoded_pixel_cap_413(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        monkeypatch.setattr(oe, "_load_engine", lambda: setattr(oe, "_engine_ready", True))
        monkeypatch.setattr(oe, "_MAX_IMAGE_PIXELS", 4)
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (4, 4)).save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        assert _client().post("/ocr/extract", json={"image_base64": b64}).status_code == 413

    def test_bad_lang_422(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        resp = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64, "lang": "../x"})
        assert resp.status_code == 422


class TestHappyPath:
    def test_reports_text_and_quality(self, monkeypatch):
        monkeypatch.setenv("PHOTO_OCR_ENABLED", "1")
        monkeypatch.setattr(
            oe,
            "_run_ocr",
            lambda raw, lang: {"text": "Serial 49849", "mean_confidence": 87.3,
                               "word_count": 2, "width": 10, "height": 5},
        )
        body = _client().post("/ocr/extract", json={"image_base64": _TINY_IMAGE_B64}).json()
        assert body["available"] is True
        assert body["engine"] == "tesseract"
        assert body["text"] == "Serial 49849"
        assert body["mean_confidence"] == 87.3
        assert body["word_count"] == 2
        assert body["image"] == {"width": 10, "height": 5}
        assert isinstance(body["ms"], int)
