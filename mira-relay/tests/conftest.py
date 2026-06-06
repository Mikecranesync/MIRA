from __future__ import annotations

import pytest

import relay_server


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "mira.db")
    monkeypatch.setattr(relay_server, "DB_PATH", db_path)
    monkeypatch.setattr(relay_server, "RELAY_API_KEY", "")
    # Legacy bearer ON by default so pre-HMAC tests keep passing.
    # test_auth.py overrides this per-test as needed.
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", "")
    yield db_path
