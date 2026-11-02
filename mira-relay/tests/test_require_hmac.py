"""RELAY_REQUIRE_HMAC — the deployed receiver must never run open.

``_authenticate_http`` treats "no RELAY_API_KEY and no MIRA_IGNITION_HMAC_KEY"
as OPEN (the original bench behaviour). That is correct for a laptop bench and
wrong for any deployed receiver: an empty Doppler value would silently turn the
CV-101 ingest route into an unauthenticated write path to tag_events. The
staging and production compose files set RELAY_REQUIRE_HMAC=1; with it the relay
refuses to START without a key, and with a key an unsigned request is refused.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import relay_server


def _start(app) -> None:
    # TestClient as a context manager runs the lifespan (startup) — the same
    # point at which uvicorn would abort the process.
    with TestClient(app):
        pass


def test_require_hmac_refuses_to_start_without_a_key(monkeypatch):
    monkeypatch.setattr(relay_server, "RELAY_REQUIRE_HMAC", True)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", "")
    with pytest.raises(RuntimeError, match="MIRA_IGNITION_HMAC_KEY"):
        _start(relay_server.app)


def test_require_hmac_refuses_to_start_with_legacy_bearer_enabled(monkeypatch):
    monkeypatch.setattr(relay_server, "RELAY_REQUIRE_HMAC", True)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", "k" * 64)
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
    with pytest.raises(RuntimeError, match="RELAY_LEGACY_BEARER"):
        _start(relay_server.app)


def test_require_hmac_with_key_starts_and_refuses_unsigned_ingest(monkeypatch):
    monkeypatch.setattr(relay_server, "RELAY_REQUIRE_HMAC", True)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", "k" * 64)
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
    with TestClient(relay_server.app) as client:
        assert client.get("/health").status_code == 200
        r = client.post("/api/v1/tags/ingest", json={"tags": []})
        assert r.status_code == 401
        assert r.json()["detail"] == "auth_required"
        # The legacy route is equally closed.
        assert client.post("/ingest", json={"type": "tags"}).status_code == 401


def test_without_the_flag_the_bench_default_is_unchanged(monkeypatch):
    """Off by default: the laptop bench (no keys) keeps its open behaviour."""
    monkeypatch.setattr(relay_server, "RELAY_REQUIRE_HMAC", False)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", "")
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
    _start(relay_server.app)


def test_flag_parses_only_the_literal_one(monkeypatch):
    for raw, expected in (("1", True), ("0", False), ("", False), ("true", False)):
        assert relay_server._env_flag_on(raw) is expected, raw
