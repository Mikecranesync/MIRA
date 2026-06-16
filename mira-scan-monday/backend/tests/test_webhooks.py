"""Tests for the monday.com app-lifecycle webhook handler.

These tests verify signature handling and event dispatch in isolation —
they monkey-patch oauth's persistence helpers so no DB is required.

Run from the `mira-scan-monday/` directory:

    python -m pytest backend/tests/test_webhooks.py -v
"""

from __future__ import annotations

import asyncio
import importlib

import jwt as pyjwt
import pytest


def _reload_webhooks(monkeypatch, secret: str = "test-secret"):
    """Reload the webhooks module after env tweaks. Returns (webhooks, oauth)."""
    monkeypatch.setenv("MONDAY_WEBHOOK_SIGNING_SECRET", secret)
    from backend import oauth as _oauth
    from backend import webhooks as _webhooks

    importlib.reload(_oauth)
    return importlib.reload(_webhooks), _oauth


def _sign(claims: dict, secret: str = "test-secret") -> str:
    return pyjwt.encode(claims, secret, algorithm="HS256")


def _stub_oauth(monkeypatch, oauth, *, existing_token: str | None = None):
    """Replace oauth's DB-touching helpers with in-memory recorders."""
    state: dict = {
        "saved": [],
        "revoked": [],
        "subscription": [],
        "touched": [],
        "existing_token": existing_token,
    }

    async def _save_installation(**kwargs):
        state["saved"].append(kwargs)

    async def _mark_revoked(account_id):
        state["revoked"].append(account_id)

    async def _update_subscription_status(account_id, status):
        state["subscription"].append((account_id, status))

    async def _touch_last_seen(account_id):
        state["touched"].append(account_id)

    async def _get_token_for_account(account_id):
        return state["existing_token"]

    monkeypatch.setattr(oauth, "save_installation", _save_installation)
    monkeypatch.setattr(oauth, "mark_revoked", _mark_revoked)
    monkeypatch.setattr(oauth, "update_subscription_status", _update_subscription_status)
    monkeypatch.setattr(oauth, "touch_last_seen", _touch_last_seen)
    monkeypatch.setattr(oauth, "get_token_for_account", _get_token_for_account)
    return state


def test_install_event_records_install(monkeypatch):
    webhooks, oauth = _reload_webhooks(monkeypatch)
    state = _stub_oauth(monkeypatch, oauth)

    auth = "Bearer " + _sign({"aid": 4242, "type": "install"})
    body = {"type": "install", "data": {"account_id": 4242, "user_id": 99, "scope": "boards:read"}}

    result = asyncio.run(
        webhooks.handle_event(authorization_header=auth, body=body),
    )

    assert result["status"] == "ok"
    assert result["account_id"] == "4242"
    assert len(state["saved"]) == 1
    assert state["saved"][0]["account_id"] == "4242"
    assert state["saved"][0]["scope"] == "boards:read"
    # No prior token → save_installation, NOT touch_last_seen
    assert state["touched"] == []


def test_install_event_idempotent_when_token_already_stored(monkeypatch):
    """A second install delivery (or one fired after OAuth callback already
    saved a real token) should NOT overwrite the access_token. It should
    just bump last_seen_at."""
    webhooks, oauth = _reload_webhooks(monkeypatch)
    state = _stub_oauth(monkeypatch, oauth, existing_token="real-oauth-token-xyz")

    auth = "Bearer " + _sign({"aid": 4242})
    body = {"type": "install", "data": {"account_id": 4242, "user_id": 99}}

    result = asyncio.run(
        webhooks.handle_event(authorization_header=auth, body=body),
    )

    assert result["status"] == "ok"
    assert state["saved"] == []  # never overwrites a real token
    assert state["touched"] == ["4242"]


def test_uninstall_event_marks_revoked(monkeypatch):
    webhooks, oauth = _reload_webhooks(monkeypatch)
    state = _stub_oauth(monkeypatch, oauth)

    auth = "Bearer " + _sign({"aid": 7000})
    body = {"type": "uninstall", "data": {"account_id": 7000}}

    result = asyncio.run(
        webhooks.handle_event(authorization_header=auth, body=body),
    )

    assert result["status"] == "ok"
    assert state["revoked"] == ["7000"]


def test_subscription_changed_records_status(monkeypatch):
    webhooks, oauth = _reload_webhooks(monkeypatch)
    state = _stub_oauth(monkeypatch, oauth)

    auth = "Bearer " + _sign({"aid": 1234})
    body = {
        "type": "app_subscription_changed",
        "data": {"account_id": 1234, "subscription": {"status": "active"}},
    }

    result = asyncio.run(
        webhooks.handle_event(authorization_header=auth, body=body),
    )

    assert result["status"] == "ok"
    assert result["subscription_status"] == "active"
    assert state["subscription"] == [("1234", "active")]


def test_bad_signature_raises(monkeypatch):
    webhooks, oauth = _reload_webhooks(monkeypatch)
    _stub_oauth(monkeypatch, oauth)

    auth = "Bearer " + _sign({"aid": 1}, secret="WRONG-SECRET")
    body = {"type": "install", "data": {"account_id": 1}}

    with pytest.raises(webhooks.WebhookInvalid):
        asyncio.run(webhooks.handle_event(authorization_header=auth, body=body))


def test_missing_authorization_raises(monkeypatch):
    webhooks, _ = _reload_webhooks(monkeypatch)

    with pytest.raises(webhooks.WebhookInvalid):
        asyncio.run(
            webhooks.handle_event(
                authorization_header=None,
                body={"type": "install", "data": {"account_id": 1}},
            )
        )


def test_unknown_event_type_is_ignored_not_raised(monkeypatch):
    webhooks, oauth = _reload_webhooks(monkeypatch)
    state = _stub_oauth(monkeypatch, oauth)

    auth = "Bearer " + _sign({"aid": 9})
    body = {"type": "future_event_we_dont_handle", "data": {"account_id": 9}}

    result = asyncio.run(
        webhooks.handle_event(authorization_header=auth, body=body),
    )

    assert result["status"] == "ignored"
    assert result["reason"] == "unknown_type"
    assert state["saved"] == []
    assert state["revoked"] == []
    assert state["subscription"] == []


def test_account_id_falls_back_from_dat_or_body(monkeypatch):
    """account_id can come from claim.aid, claim.dat.account_id, or body.data.account_id."""
    webhooks, oauth = _reload_webhooks(monkeypatch)
    state = _stub_oauth(monkeypatch, oauth)

    # No `aid` claim — only nested `dat.account_id`
    auth = "Bearer " + _sign({"dat": {"account_id": 5151}})
    body = {"type": "uninstall", "data": {}}

    result = asyncio.run(
        webhooks.handle_event(authorization_header=auth, body=body),
    )

    assert result["status"] == "ok"
    assert state["revoked"] == ["5151"]
