"""Tests for OAuth helpers that don't require a live DB.

Run from the `mira-scan-monday/` directory:

    python -m pytest backend/tests/test_oauth.py -v
"""

from __future__ import annotations

import importlib
from urllib.parse import parse_qs, urlparse

import pytest


def _reload_oauth():
    """Re-import the oauth module so it picks up monkey-patched env vars
    (env is read at module-import time)."""
    from backend import oauth as _oauth

    return importlib.reload(_oauth)


def test_install_url_includes_required_params(monkeypatch):
    monkeypatch.setenv("MONDAY_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("MONDAY_OAUTH_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("MONDAY_OAUTH_REDIRECT_URI", "https://example.test/cb")
    monkeypatch.setenv(
        "MONDAY_OAUTH_SCOPES", "me:read boards:read boards:write"
    )
    oauth = _reload_oauth()

    url = oauth.install_url(state="abc123")
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)

    assert parsed.netloc == "auth.monday.com"
    assert parsed.path == "/oauth2/authorize"
    assert qs["client_id"] == ["test-client-id"]
    assert qs["redirect_uri"] == ["https://example.test/cb"]
    assert qs["state"] == ["abc123"]
    assert "boards:write" in qs["scope"][0]


def test_install_url_generates_random_state_when_none(monkeypatch):
    monkeypatch.setenv("MONDAY_OAUTH_CLIENT_ID", "x")
    monkeypatch.setenv("MONDAY_OAUTH_CLIENT_SECRET", "y")
    oauth = _reload_oauth()

    url1 = oauth.install_url()
    url2 = oauth.install_url()
    state1 = parse_qs(urlparse(url1).query)["state"][0]
    state2 = parse_qs(urlparse(url2).query)["state"][0]

    assert state1 != state2
    assert len(state1) >= 16  # secrets.token_urlsafe(24) is comfortably > 16


def test_install_url_raises_when_unconfigured(monkeypatch):
    monkeypatch.delenv("MONDAY_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MONDAY_OAUTH_CLIENT_SECRET", raising=False)
    oauth = _reload_oauth()

    with pytest.raises(oauth.OAuthError):
        oauth.install_url()


def test_configured_flag(monkeypatch):
    monkeypatch.setenv("MONDAY_OAUTH_CLIENT_ID", "x")
    monkeypatch.setenv("MONDAY_OAUTH_CLIENT_SECRET", "y")
    oauth = _reload_oauth()
    assert oauth.configured() is True

    monkeypatch.delenv("MONDAY_OAUTH_CLIENT_SECRET", raising=False)
    oauth = _reload_oauth()
    assert oauth.configured() is False
