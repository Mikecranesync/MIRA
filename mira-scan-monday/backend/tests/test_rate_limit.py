"""Tests for /chat/message per-account burst rate limiter (CRA-159)."""

from __future__ import annotations

import asyncio
import importlib


def _reload():
    from backend import rate_limit as rl

    return importlib.reload(rl)


def test_empty_account_id_always_allowed():
    rl = _reload()
    result = asyncio.run(rl.check_and_record(""))
    assert result.allowed is True
    assert result.retry_after == 0


def test_account_under_limit_allowed(monkeypatch):
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_PER_WINDOW", "5")
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS", "60")
    rl = _reload()

    async def run():
        for _ in range(5):
            r = await rl.check_and_record("acct-A")
            assert r.allowed is True

    asyncio.run(run())


def test_account_over_limit_blocked_with_retry_after(monkeypatch):
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_PER_WINDOW", "3")
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS", "60")
    rl = _reload()

    async def run():
        for _ in range(3):
            assert (await rl.check_and_record("acct-B")).allowed is True
        r = await rl.check_and_record("acct-B")
        assert r.allowed is False
        assert r.retry_after >= 1
        assert r.used == 3
        assert r.limit == 3
        assert r.window_seconds == 60

    asyncio.run(run())


def test_accounts_isolated(monkeypatch):
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_PER_WINDOW", "2")
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS", "60")
    rl = _reload()

    async def run():
        assert (await rl.check_and_record("acct-X")).allowed is True
        assert (await rl.check_and_record("acct-X")).allowed is True
        assert (await rl.check_and_record("acct-X")).allowed is False
        # Different account starts fresh.
        assert (await rl.check_and_record("acct-Y")).allowed is True
        assert (await rl.check_and_record("acct-Y")).allowed is True

    asyncio.run(run())


def test_window_slides_releases_old_hits(monkeypatch):
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_PER_WINDOW", "2")
    monkeypatch.setenv("MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS", "60")
    rl = _reload()

    # Inject hits that are already older than the window so the slide
    # evicts them on next check.
    async def run():
        async with rl._lock:
            bucket = rl._buckets.setdefault("acct-Z", rl.deque())
            past = rl._now() - 120  # 2 min ago, window is 60s
            bucket.append(past)
            bucket.append(past)
        r = await rl.check_and_record("acct-Z")
        assert r.allowed is True
        assert r.used == 1

    asyncio.run(run())


def test_env_defaults_match_cra_159_spec():
    rl = _reload()
    # CRA-159 spec: 30 req / 5 min default.
    assert rl.CHAT_RATE_LIMIT_PER_WINDOW == 30
    assert rl.CHAT_RATE_LIMIT_WINDOW_SECONDS == 300
