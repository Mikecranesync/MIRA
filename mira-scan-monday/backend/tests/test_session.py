"""Tests for Monday sessionToken JWT verification."""

from __future__ import annotations

import importlib
import time

import jwt as pyjwt
import pytest


def _reload_session():
    from backend import session as _session

    return importlib.reload(_session)


def _sign(claims: dict, secret: str = "test-secret") -> str:
    return pyjwt.encode(claims, secret, algorithm="HS256")


def test_verify_roundtrip(monkeypatch):
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()

    token = _sign({"aid": 12345, "uid": 999, "iat": int(time.time())})
    claims = session.verify_session_token(token)
    assert claims["aid"] == 12345


def test_verify_rejects_bad_signature(monkeypatch):
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()

    token = _sign({"aid": 1}, secret="WRONG-SECRET")
    with pytest.raises(session.SessionInvalid):
        session.verify_session_token(token)


def test_verify_rejects_empty(monkeypatch):
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()
    with pytest.raises(session.SessionInvalid):
        session.verify_session_token("")


def test_verify_rejects_when_no_secret(monkeypatch):
    monkeypatch.delenv("MONDAY_SIGNING_SECRET", raising=False)
    monkeypatch.delenv("MONDAY_OAUTH_CLIENT_SECRET", raising=False)
    session = _reload_session()
    token = _sign({"aid": 1})
    with pytest.raises(session.SessionInvalid):
        session.verify_session_token(token)


def test_account_id_from_headers_no_token(monkeypatch):
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()
    # Standalone path — no header — returns None silently.
    assert session.account_id_from_headers({}) is None


def test_account_id_from_headers_extracts_aid(monkeypatch):
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()

    token = _sign({"aid": 42, "uid": 7})
    aid = session.account_id_from_headers({"x-monday-session-token": token})
    assert aid == "42"


def test_account_id_falls_back_to_dat(monkeypatch):
    """Some Monday tokens nest the account_id under `dat`."""
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()

    token = _sign({"dat": {"account_id": 7777, "user_id": 1}})
    aid = session.account_id_from_headers({"x-monday-session-token": token})
    assert aid == "7777"


def test_account_id_returns_none_on_bad_signature(monkeypatch):
    """Bad sig → None silently, never raises."""
    monkeypatch.setenv("MONDAY_SIGNING_SECRET", "test-secret")
    session = _reload_session()

    token = _sign({"aid": 1}, secret="WRONG")
    assert session.account_id_from_headers({"x-monday-session-token": token}) is None
