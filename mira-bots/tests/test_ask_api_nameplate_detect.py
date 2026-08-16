"""Tests for the nameplate detection endpoint (ask_api/nameplate_detect.py).

These construct a minimal FastAPI app with ONLY the nameplate_detect router —
never importing ask_api.app (which builds the heavy Supervisor engine at import
time). paddle is NOT installed in the test environment; that is the point —
every graceful-degradation path (flag off, import failure, bad input) must be
provable without the detector present, because that is exactly the state the
endpoint must survive in production when the dependency breaks.
"""

import base64

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import ask_api.nameplate_detect as nd
from ask_api.nameplate_detect import router as nameplate_detect_router, union_bbox


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(nameplate_detect_router)
    return TestClient(app)


_TINY_IMAGE_B64 = base64.b64encode(b"\xff\xd8\xff\xe0 not a real jpeg").decode()


@pytest.fixture(autouse=True)
def _reset_detector_cache():
    """Each test starts with a cold module: no cached detector, no cached
    failure, no occupied busy slot — so one test's state can't leak into
    another."""
    nd._detector = None
    nd._detector_failed_reason = None
    nd._busy_future = None
    yield
    nd._detector = None
    nd._detector_failed_reason = None
    nd._busy_future = None


class TestFeatureFlag:
    def test_disabled_by_default(self, monkeypatch):
        """Flag unset => available=false, HTTP 200 — callers fall through."""
        monkeypatch.delenv("NAMEPLATE_DETECT_ENABLED", raising=False)
        resp = _client().post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64})
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert body["reason"] == "disabled"
        assert body["regions"] == []
        assert body["union_bbox"] is None

    def test_disabled_explicitly(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "0")
        body = _client().post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64}).json()
        assert body["available"] is False


class TestGracefulDegradation:
    def test_missing_paddle_is_available_false_not_500(self, monkeypatch):
        """Flag on but paddle not importable (true in this test env): the load
        failure is caught, cached, and reported as available=false."""
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")
        resp = _client().post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64})
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert body["reason"].startswith("detector_load_failed")

    def test_load_failure_is_cached(self, monkeypatch):
        """Second request after a load failure short-circuits on the cached
        reason instead of re-importing."""
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")
        client = _client()
        client.post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64})
        assert nd._detector_failed_reason is not None
        cached = nd._detector_failed_reason
        body = client.post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64}).json()
        assert body["reason"] == cached


class TestInputValidation:
    def test_invalid_base64_is_400(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")
        resp = _client().post("/nameplate/detect", json={"image_base64": "!!!not-base64!!!"})
        assert resp.status_code == 400

    def test_oversize_image_is_413(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")
        monkeypatch.setattr(nd, "_MAX_IMAGE_BYTES", 16)
        big = base64.b64encode(b"x" * 32).decode()
        resp = _client().post("/nameplate/detect", json={"image_base64": big})
        assert resp.status_code == 413

    def test_min_score_out_of_range_rejected(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")
        resp = _client().post(
            "/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64, "min_score": 1.5}
        )
        assert resp.status_code == 422


class TestAuthGate:
    def test_bad_key_is_401(self, monkeypatch):
        monkeypatch.setenv("ASK_API_KEY", "secret")
        resp = _client().post(
            "/nameplate/detect",
            json={"image_base64": _TINY_IMAGE_B64},
            headers={"X-Mira-Key": "wrong"},
        )
        assert resp.status_code == 401

    def test_good_key_passes_gate(self, monkeypatch):
        """With the right key the request proceeds to the flag check."""
        monkeypatch.setenv("ASK_API_KEY", "secret")
        monkeypatch.delenv("NAMEPLATE_DETECT_ENABLED", raising=False)
        resp = _client().post(
            "/nameplate/detect",
            json={"image_base64": _TINY_IMAGE_B64},
            headers={"X-Mira-Key": "secret"},
        )
        assert resp.status_code == 200
        assert resp.json()["reason"] == "disabled"


_FAKE_POLYS = [
    [[100, 100], [200, 100], [200, 150], [100, 150]],
    [[100, 300], [250, 300], [250, 360], [100, 360]],
]
_FAKE_SCORES = [0.9, 0.8]


def _arm_fake_detector(monkeypatch):
    """Simulate a loaded detector without paddle: _load_detector becomes a
    no-op that marks success, _predict returns fixed boxes, and the header
    size check passes (the tiny test payload is not a real image)."""
    monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")

    def fake_load():
        nd._detector = object()

    monkeypatch.setattr(nd, "_load_detector", fake_load)
    monkeypatch.setattr(nd, "_check_decoded_size", lambda raw: None)
    monkeypatch.setattr(nd, "_predict", lambda raw: (_FAKE_POLYS, _FAKE_SCORES, 1000, 800))


class TestReturnCrop:
    def test_detections_without_crop_by_default(self, monkeypatch):
        _arm_fake_detector(monkeypatch)
        body = _client().post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64}).json()
        assert body["available"] is True
        assert len(body["regions"]) == 2
        assert body["union_bbox"] == {"left": 100, "top": 100, "width": 150, "height": 260}
        assert body["crop_base64"] is None
        assert body["crop_bbox"] is None

    def test_return_crop_carries_jpeg_and_padded_bbox(self, monkeypatch):
        _arm_fake_detector(monkeypatch)
        monkeypatch.setattr(
            nd,
            "_crop_jpeg",
            lambda raw, bbox, pad: (b"jpegbytes", {"left": 60, "top": 60, "width": 230, "height": 340}, 90),
        )
        body = _client().post(
            "/nameplate/detect",
            json={"image_base64": _TINY_IMAGE_B64, "return_crop": True, "crop_pad": 40},
        ).json()
        assert body["available"] is True
        assert base64.b64decode(body["crop_base64"]) == b"jpegbytes"
        assert body["crop_bbox"] == {"left": 60, "top": 60, "width": 230, "height": 340}
        assert body["crop_rotation_deg"] == 90

    def test_crop_failure_keeps_detections(self, monkeypatch):
        """A failed crop degrades to crop_base64=null; the boxes still return
        so the caller can fall back to whole-photo recognition."""
        _arm_fake_detector(monkeypatch)

        def boom(raw, bbox, pad):
            raise ValueError("encode_failed")

        monkeypatch.setattr(nd, "_crop_jpeg", boom)
        body = _client().post(
            "/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64, "return_crop": True}
        ).json()
        assert body["available"] is True
        assert len(body["regions"]) == 2
        assert body["crop_base64"] is None
        assert body["crop_bbox"] is None
        assert body["crop_rotation_deg"] == 0

    def test_zero_boxes_yields_null_union_and_no_crop(self, monkeypatch):
        _arm_fake_detector(monkeypatch)
        monkeypatch.setattr(nd, "_predict", lambda raw: ([], [], 1000, 800))
        body = _client().post(
            "/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64, "return_crop": True}
        ).json()
        assert body["available"] is True
        assert body["regions"] == []
        assert body["union_bbox"] is None
        assert body["crop_base64"] is None


class TestResourceContainment:
    """Codex P1: the single inference slot must stay OCCUPIED until the worker
    thread actually finishes — a timed-out waiter releasing a semaphore would
    let 757-MiB inference jobs stack."""

    def test_timed_out_run_keeps_the_slot_until_the_thread_ends(self):
        """The contract itself, driven in ONE event loop (production shape —
        TestClient tears its loop down between requests, which cancels
        futures and would test an artifact instead)."""
        import threading

        release = threading.Event()
        started = threading.Event()
        runs = []

        def slow_worker():
            runs.append("slow")
            started.set()
            release.wait(timeout=10)
            return "slow-done"

        def fast_worker():
            runs.append("fast")
            return "fast-done"

        async def scenario():
            # Waiter 1 times out; its thread keeps running and OWNS the slot.
            ok1, v1 = await nd._run_exclusive(slow_worker, timeout=0.1)
            assert (ok1, v1) == (False, "timeout")
            assert started.is_set()
            # Waiter 2 while the slow thread still runs: bounced, NOT stacked.
            ok2, v2 = await nd._run_exclusive(fast_worker, timeout=1.0)
            assert (ok2, v2) == (False, "busy")
            assert runs == ["slow"]  # the fast worker never even started
            # Let the slow thread finish; the slot frees; a new run proceeds.
            release.set()
            await nd._busy_future
            ok3, v3 = await nd._run_exclusive(fast_worker, timeout=1.0)
            assert (ok3, v3) == (True, "fast-done")

        import asyncio

        asyncio.run(scenario())

    def test_slot_frees_after_worker_completes(self, monkeypatch):
        _arm_fake_detector(monkeypatch)
        client = _client()
        assert client.post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64}).json()["available"] is True
        # Slot released after a normal completion — next request runs.
        assert client.post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64}).json()["available"] is True

    def test_decoded_pixel_bomb_is_413(self, monkeypatch):
        """A small compressed payload that would DECODE past the pixel cap is
        rejected by the header check before any allocation."""
        _arm_fake_detector(monkeypatch)

        def boom(raw):
            raise ValueError("image_too_large_decoded")

        monkeypatch.setattr(nd, "_check_decoded_size", boom)
        resp = _client().post("/nameplate/detect", json={"image_base64": _TINY_IMAGE_B64})
        assert resp.status_code == 413

    def test_base64_field_itself_is_bounded(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DETECT_ENABLED", "1")
        too_long = "A" * (nd._MAX_IMAGE_B64_LEN + 100)
        resp = _client().post("/nameplate/detect", json={"image_base64": too_long})
        assert resp.status_code == 422  # rejected by the model, before decode


class TestUnionBbox:
    """union_bbox is the automated-crop rule that auto-region.ts qualified
    (union of every box at/above min_score). Verified against the real
    detection run: 13 boxes on the Oriental Motor photo union to
    x281-2374, y1184-2438."""

    def test_real_run_geometry(self):
        polys = [
            [[1457, 2050], [1913, 2050], [1913, 2433], [1457, 2433]],
            [[281, 1603], [598, 1603], [598, 2146], [281, 2146]],
            [[2186, 1804], [2374, 1804], [2374, 2179], [2186, 2179]],
            [[625, 1184], [837, 1184], [837, 1693], [625, 1693]],
        ]
        scores = [0.71, 0.62, 0.88, 0.71]
        box = union_bbox(polys, scores, 0.5)
        assert box["left"] == 281
        assert box["top"] == 1184
        assert box["left"] + box["width"] == 2374
        assert box["top"] + box["height"] == 2433

    def test_min_score_filters(self):
        polys = [
            [[0, 0], [10, 0], [10, 10], [0, 10]],
            [[100, 100], [110, 100], [110, 110], [100, 110]],
        ]
        box = union_bbox(polys, [0.9, 0.3], 0.5)
        assert box == {"left": 0, "top": 0, "width": 10, "height": 10}

    def test_no_boxes_is_none(self):
        assert union_bbox([], [], 0.5) is None
        assert union_bbox([[[0, 0], [1, 0], [1, 1], [0, 1]]], [0.2], 0.5) is None


class TestModelAllowlist:
    """groq review 2026-08-16: NAMEPLATE_DET_MODEL reaches PaddleOCR's model
    resolver, so an arbitrary value must not select a caller-named artifact."""

    def test_allowed_model_passes_through(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DET_MODEL", "PP-OCRv4_mobile_det")
        assert nd._det_model_name() == "PP-OCRv4_mobile_det"

    def test_unknown_model_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("NAMEPLATE_DET_MODEL", "../../etc/passwd")
        assert nd._det_model_name() == "PP-OCRv5_mobile_det"

    def test_unset_uses_default(self, monkeypatch):
        monkeypatch.delenv("NAMEPLATE_DET_MODEL", raising=False)
        assert nd._det_model_name() == "PP-OCRv5_mobile_det"
