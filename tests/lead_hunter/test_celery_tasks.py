"""Tests that retries cover the discovery HTTP loop, not just DB/HubSpot."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest


def test_discovery_msca_call_uses_with_retries(monkeypatch):
    """scrape_msca should be invoked through hardening.with_retries.

    Implementation detail: we patch hardening.with_retries and assert
    the discovery code calls it with name='scrape_msca'.
    """
    import celery_tasks

    calls = []

    def fake_with_retries(fn, *, name, **kw):
        calls.append(name)
        # Don't actually run fn — we're only checking the call shape
        return []

    monkeypatch.setattr("celery_tasks.with_retries", fake_with_retries, raising=False)
    # Patch out everything else so the function returns quickly
    monkeypatch.setattr("celery_tasks._load_state", lambda: {
        "city_index": 0, "requests_today": 0, "last_date": "", "total_discovered": 0,
    })
    monkeypatch.setattr("celery_tasks._save_state", lambda s: None)
    monkeypatch.setattr("celery_tasks._check_daily_budget", lambda s: True)
    monkeypatch.setenv("NEON_DATABASE_URL", "")
    monkeypatch.setenv("HUNTER_API_KEY", "")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "")

    import hunt as hunt_mod
    monkeypatch.setattr(hunt_mod, "CITIES", [("TestCity", 0.0, 0.0, 10)])
    monkeypatch.setattr(hunt_mod, "QUERY_TEMPLATES", [])
    monkeypatch.setattr(hunt_mod, "apply_schema", lambda *a, **k: None)
    monkeypatch.setattr(hunt_mod, "RATE_LIMIT_SECS", 0)

    import discover as discover_mod
    monkeypatch.setattr(discover_mod, "MEDIUM_BIZ_QUERIES", [])
    monkeypatch.setattr(discover_mod, "search_ddg_medium",
                        lambda *a, **k: ([], None))

    celery_tasks.run_discover_and_enrich()
    assert "scrape_msca" in calls, f"Expected scrape_msca to be wrapped; got {calls}"


def test_discovery_ddg_search_uses_with_retries(monkeypatch):
    import celery_tasks
    import hunt as hunt_mod
    import discover as discover_mod

    calls = []
    def fake_with_retries(fn, *, name, **kw):
        calls.append(name)
        return None

    monkeypatch.setattr("celery_tasks.with_retries", fake_with_retries, raising=False)
    monkeypatch.setattr("celery_tasks._load_state", lambda: {
        "city_index": 1, "requests_today": 0, "last_date": "", "total_discovered": 0,
    })
    monkeypatch.setattr("celery_tasks._save_state", lambda s: None)
    monkeypatch.setattr("celery_tasks._check_daily_budget", lambda s: True)
    monkeypatch.setenv("NEON_DATABASE_URL", "")
    monkeypatch.setenv("HUNTER_API_KEY", "")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "")

    monkeypatch.setattr(hunt_mod, "CITIES", [("CityA", 0.0, 0.0, 10), ("CityB", 1.0, 1.0, 10)])
    monkeypatch.setattr(hunt_mod, "QUERY_TEMPLATES", ["machine shop {city}"])
    monkeypatch.setattr(hunt_mod, "apply_schema", lambda *a, **k: None)
    monkeypatch.setattr(hunt_mod, "RATE_LIMIT_SECS", 0)
    monkeypatch.setattr(hunt_mod, "extract_facilities_from_results",
                        lambda *a, **k: [])
    monkeypatch.setattr(discover_mod, "MEDIUM_BIZ_QUERIES", [])
    monkeypatch.setattr(discover_mod, "search_ddg_medium",
                        lambda *a, **k: ([], None))

    celery_tasks.run_discover_and_enrich()
    assert any(n.startswith("ddg_search:") for n in calls), \
        f"Expected ddg_search:* to be wrapped; got {calls}"
