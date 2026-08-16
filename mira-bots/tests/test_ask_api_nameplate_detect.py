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
    failure — so one test's load-failure cache can't leak into another."""
    nd._detector = None
    nd._detector_failed_reason = None
    yield
    nd._detector = None
    nd._detector_failed_reason = None


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
