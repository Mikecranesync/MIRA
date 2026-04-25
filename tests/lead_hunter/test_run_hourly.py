"""Tests for run_hourly._run silent-failure detectors and exit codes."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest


def _stub_required_env(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://stub")


def test_run_alerts_on_discovered_but_zero_enriched(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "stub")

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 0, "enriched_attempted": 5,
        "inserted": 0, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    # Degraded -> exit 1
    assert rc == 1


def test_run_alerts_on_inserted_but_zero_pushed(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)
    monkeypatch.setenv("HUBSPOT_API_KEY", "stub")

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 5, "enriched_attempted": 5,
        "inserted": 3, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    assert rc == 1  # degraded


def test_run_alerts_on_partial_enrichment_failure(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 1, "enriched_attempted": 5,
        "inserted": 1, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    # 1/5 < 50% -> partial failure alert -> degraded
    assert rc == 1


def test_run_returns_zero_on_clean_run(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "stub")
    monkeypatch.setenv("HUBSPOT_API_KEY", "stub")
    monkeypatch.setenv("SERPER_API_KEY", "stub")

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 5, "enriched_attempted": 5,
        "inserted": 5, "hs_pushed": 5,
    })
    rc = run_hourly._run()
    assert rc == 0


def test_run_skip_marks_degraded(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "skipped": True, "reason": "daily_budget",
    })
    rc = run_hourly._run()
    # skip without other failures: degraded -> exit 1
    assert rc == 1
