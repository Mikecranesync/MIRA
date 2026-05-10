"""Tests for usage helpers — fail-open behavior when DB is unavailable."""

from __future__ import annotations

import asyncio
import importlib


def _reload_usage():
    from backend import db as _db
    from backend import usage as _usage

    importlib.reload(_db)
    return importlib.reload(_usage)


def test_free_tier_cap_constant_set():
    usage = _reload_usage()
    assert usage.FREE_TIER_MONTHLY_CAP > 0
    assert isinstance(usage.FREE_TIER_MONTHLY_CAP, int)


def test_free_tier_cap_overridable_via_env(monkeypatch):
    monkeypatch.setenv("MIRA_FREE_TIER_MONTHLY_CAP", "12345")
    usage = _reload_usage()
    assert usage.FREE_TIER_MONTHLY_CAP == 12345


def test_month_scan_count_returns_zero_for_empty_account_id(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "")  # also unavailable
    usage = _reload_usage()
    result = asyncio.run(usage.month_scan_count(""))
    assert result == 0


def test_month_scan_count_returns_zero_when_db_unavailable(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    usage = _reload_usage()
    # DBUnavailable is raised internally and swallowed → 0 (fail-open).
    # A real account_id with no DB should never lock out a user.
    result = asyncio.run(usage.month_scan_count("99999"))
    assert result == 0


def test_bump_scan_count_no_op_when_db_unavailable(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    usage = _reload_usage()
    # Should not raise even though DB is unreachable.
    asyncio.run(usage.bump_scan_count("99999"))


def test_today_scan_count_returns_zero_when_db_unavailable(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    usage = _reload_usage()
    result = asyncio.run(usage.today_scan_count("99999"))
    assert result == 0


def test_days_summary_returns_empty_when_db_unavailable(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    usage = _reload_usage()
    result = asyncio.run(usage.days_summary("99999", days=7))
    assert result == []
