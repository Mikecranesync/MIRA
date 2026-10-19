"""Tests for mira-reranker's FastAPI app.

Run with: pytest mira-reranker/tests -q
(conftest.py ensures the pinned model is downloaded + verified locally first.)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402

QUERY = "What does fault code ocA mean on a GS10 drive?"
GOOD_PASSAGE = (
    "Over-current during acceleration (ocA) occurs when the motor draws excessive "
    "current while ramping up to the commanded speed."
)
UNRELATED_PASSAGE = "Mounting dimensions: 120mm x 80mm x 60mm, four M4 bolt holes on 100mm centers."


@pytest.fixture(scope="module")
def client():
    with TestClient(app_module.app) as c:
        yield c


def test_health_returns_503_before_load():
    """A fresh, unloaded Reranker reports not-loaded (no crash, no false 'ok')."""
    fresh = app_module.Reranker()
    assert not fresh.is_loaded


def test_health_ok_after_load(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model"] == app_module.MODEL_TAG


def test_rerank_rejects_query_too_long(client):
    resp = client.post("/rerank", json={"query": "x" * 1001, "passages": ["a passage"]})
    assert resp.status_code == 422


def test_rerank_rejects_empty_passages(client):
    resp = client.post("/rerank", json={"query": "ok", "passages": []})
    assert resp.status_code == 422


def test_rerank_rejects_too_many_passages(client):
    resp = client.post("/rerank", json={"query": "ok", "passages": ["p"] * 101})
    assert resp.status_code == 422


def test_rerank_accepts_boundary_counts(client):
    resp = client.post("/rerank", json={"query": "ok", "passages": ["p"] * 100})
    assert resp.status_code == 200
    assert len(resp.json()["scores"]) == 100

    resp = client.post("/rerank", json={"query": "ok", "passages": ["p"]})
    assert resp.status_code == 200
    assert len(resp.json()["scores"]) == 1


def test_rerank_truncates_oversized_passage_server_side(client):
    """A passage over 2000 chars is truncated, not rejected (per contract)."""
    resp = client.post("/rerank", json={"query": "ok", "passages": ["a" * 5000]})
    assert resp.status_code == 200
    assert len(resp.json()["scores"]) == 1


def test_rerank_deterministic(client):
    payload = {"query": QUERY, "passages": [GOOD_PASSAGE, UNRELATED_PASSAGE]}
    scores1 = client.post("/rerank", json=payload).json()["scores"]
    scores2 = client.post("/rerank", json=payload).json()["scores"]
    assert scores1 == scores2


def test_rerank_orders_relevant_passage_above_unrelated(client):
    resp = client.post(
        "/rerank",
        json={"query": QUERY, "passages": [UNRELATED_PASSAGE, GOOD_PASSAGE]},
    )
    assert resp.status_code == 200
    scores = resp.json()["scores"]
    unrelated_score, good_score = scores
    assert good_score > unrelated_score


def test_rerank_response_model_and_ms(client):
    resp = client.post("/rerank", json={"query": QUERY, "passages": [GOOD_PASSAGE]})
    body = resp.json()
    assert body["model"] == app_module.MODEL_TAG
    assert isinstance(body["ms"], int)
    assert body["ms"] >= 0


def test_rerank_refuses_a_second_concurrent_call_then_recovers(client, monkeypatch):
    """CU-RR1 review F1: one inference at a time; excess calls get 503 at once (the Hub
    then keeps today's order) instead of piling up tensors past the memory cap."""
    import threading
    import time

    assert app_module.MAX_CONCURRENT == 1
    started, release = threading.Event(), threading.Event()
    real_score = app_module.reranker.score

    def slow_score(query, passages):
        started.set()
        assert release.wait(5), "first call was never released"
        return real_score(query, passages)

    monkeypatch.setattr(app_module.reranker, "score", slow_score)
    body = {"query": QUERY, "passages": [GOOD_PASSAGE]}
    first: dict = {}
    t = threading.Thread(target=lambda: first.update(r=client.post("/rerank", json=body)))
    t.start()
    assert started.wait(5), "first call never reached scoring"

    t0 = time.monotonic()
    busy = client.post("/rerank", json=body)
    assert busy.status_code == 503
    assert time.monotonic() - t0 < 1.0, "a refused call must not wait for the busy one"

    release.set()
    t.join(5)
    assert first["r"].status_code == 200
    monkeypatch.setattr(app_module.reranker, "score", real_score)
    assert client.post("/rerank", json=body).status_code == 200, "admission must be released"
