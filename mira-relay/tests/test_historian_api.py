"""Starlette TestClient tests for the Historian Query API routes (#2339).

A fake adapter (the in-memory reference) is injected via relay_server._get_historian
so no DB is touched. Auth reuses the existing HMAC flow (auth.verify_hmac); HMAC
headers are built exactly like test_auth.py. The WS tests use a fake "latest
values" source so subscribe/tag_update is deterministic without a DB/poll loop.
"""

from __future__ import annotations

import hashlib
import hmac
import itertools
import json
import time
from datetime import datetime, timezone

import pytest
from starlette.testclient import TestClient

import auth
import relay_server
from historian import InMemoryHistorianAdapter, Sample

TEST_KEY = "test-hmac-key-32bytes-padded-ok!"
TENANT_A = "tenant-aaaa"
TENANT_B = "tenant-bbbb"

_nonce_seq = itertools.count()


def _dt(minute: int, second: int = 0) -> datetime:
    return datetime(2026, 6, 1, 12, minute, second, tzinfo=timezone.utc)


def _sig(tenant: str, nonce: str, ts: int, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    signed = f"{tenant}\n{nonce}\n{ts}\n{body_hash}"
    return hmac.new(TEST_KEY.encode(), signed.encode(), hashlib.sha256).hexdigest()


def _headers(tenant: str = TENANT_A, body: bytes = b"") -> dict[str, str]:
    nonce = f"n-{next(_nonce_seq)}"
    ts = int(time.time())
    return {
        "X-MIRA-Tenant": tenant,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": str(ts),
        "X-MIRA-Signature": _sig(tenant, nonce, ts, body),
    }


def _ws_auth(tenant: str) -> dict:
    nonce = f"ws-{next(_nonce_seq)}"
    ts = int(time.time())
    body = json.dumps(
        {"type": "auth_hmac", "tenant": tenant, "nonce": nonce, "timestamp": ts},
        separators=(",", ":"),
    ).encode()
    return {
        "type": "auth_hmac",
        "tenant": tenant,
        "nonce": nonce,
        "timestamp": ts,
        "signature": _sig(tenant, nonce, ts, body),
    }


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(relay_server, "RELAY_API_KEY", "")
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", TEST_KEY)
    auth._replay_store.clear()
    relay_server.subscriptions.clear()
    yield
    auth._replay_store.clear()
    relay_server.subscriptions.clear()


@pytest.fixture
def adapter():
    a = InMemoryHistorianAdapter()
    a.add_live(TENANT_A, Sample(tag_path="rpm", value="1500", numeric=1500.0, last_seen_at=_dt(1)))
    a.add_live(TENANT_A, Sample(tag_path="state", value="RUN", last_seen_at=_dt(1)))
    for i in range(4):
        a.add_event(TENANT_A, "rpm", str(1000 + i * 10), "float", _dt(1, i * 10))
    a.add_event(TENANT_A, "state", "RUN", "string", _dt(1, 5))
    fw = "00000000-0000-0000-0000-000000000001"
    a.add_diff(TENANT_A, fw, tag_path="estop", diff_type="rising_edge",
               prev_value="0", new_value="1", event_timestamp=_dt(10, 0))
    a.add_trace(TENANT_A, ts=_dt(10, 0), user_question="why?", recommendation="check estop")
    return a, fw


@pytest.fixture
def client(adapter, monkeypatch):
    a, _ = adapter
    monkeypatch.setattr(relay_server, "_get_historian", lambda: a)
    return TestClient(relay_server.app)


# ── routes registered ────────────────────────────────────────────────────────


def test_routes_registered():
    paths = {getattr(r, "path", None) for r in relay_server.app.routes}
    for expected in (
        "/api/tags/live",
        "/api/trends",
        "/api/evidence/{fault_window_id}",
        "/api/runs/{run_id}",
        "/ws/tags",
    ):
        assert expected in paths, f"missing route {expected}: {paths}"
    # history uses a :path converter for slash-containing tag paths
    assert any("history" in (getattr(r, "path", "") or "") for r in relay_server.app.routes)


# ── GET /api/tags/live ───────────────────────────────────────────────────────


class TestLive:
    def test_happy_path(self, client):
        resp = client.get("/api/tags/live", headers=_headers())
        assert resp.status_code == 200
        tags = {t["tag_path"] for t in resp.json()["tags"]}
        assert tags == {"rpm", "state"}

    def test_auth_required(self, client):
        resp = client.get("/api/tags/live")
        assert resp.status_code == 401

    def test_tenant_scoped(self, client):
        # tenant B has no live tags seeded → empty
        resp = client.get("/api/tags/live", headers=_headers(tenant=TENANT_B))
        assert resp.status_code == 200
        assert resp.json()["tags"] == []


# ── GET /api/tags/{id}/history ───────────────────────────────────────────────


class TestHistory:
    def test_raw(self, client):
        resp = client.get("/api/tags/rpm/history", headers=_headers())
        assert resp.status_code == 200
        pts = resp.json()["points"]
        assert len(pts) == 4
        assert all(p["bucketed"] is False for p in pts)

    def test_bucketed(self, client):
        resp = client.get("/api/tags/rpm/history?interval=minute", headers=_headers())
        assert resp.status_code == 200
        pts = resp.json()["points"]
        assert len(pts) == 1
        assert pts[0]["bucketed"] is True

    def test_range_filter(self, client):
        resp = client.get(
            "/api/tags/rpm/history",
            params={"start": _dt(1, 10).isoformat(), "end": _dt(1, 20).isoformat()},
            headers=_headers(),
        )
        assert resp.status_code == 200
        assert len(resp.json()["points"]) == 2

    def test_bad_interval_400(self, client):
        resp = client.get("/api/tags/rpm/history?interval=fortnight", headers=_headers())
        assert resp.status_code == 400

    def test_auth_required(self, client):
        resp = client.get("/api/tags/rpm/history")
        assert resp.status_code == 401


# ── POST /api/trends ─────────────────────────────────────────────────────────


class TestTrends:
    def test_happy_path(self, client):
        body = json.dumps({"tag_paths": ["rpm"], "interval": "minute"}).encode()
        resp = client.post("/api/trends", content=body, headers=_headers(body=body))
        assert resp.status_code == 200
        buckets = resp.json()["buckets"]
        assert len(buckets) == 1
        assert buckets[0]["count"] == 4
        assert buckets[0]["avg"] is not None

    def test_non_numeric_null_aggregates(self, client):
        body = json.dumps({"tag_paths": ["state"], "interval": "minute"}).encode()
        resp = client.post("/api/trends", content=body, headers=_headers(body=body))
        assert resp.status_code == 200
        b = resp.json()["buckets"][0]
        assert b["avg"] is None
        assert b["count"] == 1
        assert b["latest"] == "RUN"

    def test_missing_tag_paths_400(self, client):
        body = json.dumps({"interval": "minute"}).encode()
        resp = client.post("/api/trends", content=body, headers=_headers(body=body))
        assert resp.status_code == 400

    def test_auth_required(self, client):
        body = json.dumps({"tag_paths": ["rpm"]}).encode()
        resp = client.post("/api/trends", content=body)
        assert resp.status_code == 401


# ── GET /api/evidence/{id} ───────────────────────────────────────────────────


class TestEvidence:
    def test_happy_path(self, client, adapter):
        _, fw = adapter
        resp = client.get(f"/api/evidence/{fw}", headers=_headers())
        assert resp.status_code == 200
        body = resp.json()
        assert body["fault_window_id"] == fw
        assert len(body["diffs"]) == 1
        assert len(body["traces"]) == 1

    def test_auth_required(self, client, adapter):
        _, fw = adapter
        resp = client.get(f"/api/evidence/{fw}")
        assert resp.status_code == 401


# ── GET /api/runs/{id} → 501 ─────────────────────────────────────────────────


class TestRuns:
    def test_runs_returns_501(self, client):
        resp = client.get("/api/runs/run-1", headers=_headers())
        assert resp.status_code == 501
        assert "2341" in json.dumps(resp.json())

    def test_auth_required(self, client):
        resp = client.get("/api/runs/run-1")
        assert resp.status_code == 401


# ── WS /ws/tags ──────────────────────────────────────────────────────────────


class TestWebSocketSubscribe:
    def test_subscribe_poll_unsubscribe_flow(self, client, monkeypatch):
        monkeypatch.setattr(
            relay_server,
            "_latest_values_for",
            lambda tenant: {"rpm": {"tag_path": "rpm", "value": "1500"}},
        )
        with client.websocket_connect("/ws/tags") as ws:
            ws.send_json(_ws_auth(TENANT_A))
            assert ws.receive_json()["type"] == "auth_ok"

            ws.send_json({"type": "subscribe", "tag_path": "rpm"})
            assert ws.receive_json() == {"type": "subscribed", "tag_path": "rpm"}

            ws.send_json({"type": "poll"})
            upd = ws.receive_json()
            assert upd["type"] == "tag_update"
            assert upd["tag_path"] == "rpm"
            assert upd["sample"]["value"] == "1500"

            ws.send_json({"type": "unsubscribe", "tag_path": "rpm"})
            assert ws.receive_json() == {"type": "unsubscribed", "tag_path": "rpm"}

            # After unsubscribe a poll yields no tag_update — ping proves the
            # next message is pong, not a stale update.
            ws.send_json({"type": "poll"})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

    def test_auth_required(self, client):
        with client.websocket_connect("/ws/tags") as ws:
            ws.send_json({"type": "subscribe", "tag_path": "rpm"})
            # No auth → server rejects before any subscribe handling
            resp = ws.receive_json()
            assert "error" in resp

    def test_cross_tenant_isolation(self, client, monkeypatch):
        # Each tenant's poll yields its own value. The manager keys by
        # (tenant_id, tag_path), so A's broadcast can NEVER reach B.
        def latest(tenant):
            return {"rpm": {"tag_path": "rpm", "value": f"val-{tenant}"}}

        monkeypatch.setattr(relay_server, "_latest_values_for", latest)

        with client.websocket_connect("/ws/tags") as ws_a, \
             client.websocket_connect("/ws/tags") as ws_b:
            ws_a.send_json(_ws_auth(TENANT_A))
            assert ws_a.receive_json()["type"] == "auth_ok"
            ws_b.send_json(_ws_auth(TENANT_B))
            assert ws_b.receive_json()["type"] == "auth_ok"

            # Both subscribe to the SAME tag_path.
            ws_a.send_json({"type": "subscribe", "tag_path": "rpm"})
            assert ws_a.receive_json()["type"] == "subscribed"
            ws_b.send_json({"type": "subscribe", "tag_path": "rpm"})
            assert ws_b.receive_json()["type"] == "subscribed"

            # A polls → only A's socket receives A's value.
            ws_a.send_json({"type": "poll"})
            upd = ws_a.receive_json()
            assert upd["type"] == "tag_update"
            assert upd["sample"]["value"] == f"val-{TENANT_A}"

            # B must NOT have received A's update. Prove it: B's next message is
            # its own pong, not a tag_update carrying A's value.
            ws_b.send_json({"type": "ping"})
            resp = ws_b.receive_json()
            assert resp["type"] == "pong"
