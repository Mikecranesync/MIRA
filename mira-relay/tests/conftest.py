from __future__ import annotations

import pytest

import relay_server


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "mira.db")
    monkeypatch.setattr(relay_server, "DB_PATH", db_path)
    monkeypatch.setattr(relay_server, "RELAY_API_KEY", "")
    yield db_path
