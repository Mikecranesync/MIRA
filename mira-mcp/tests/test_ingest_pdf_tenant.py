"""Tests for per-request tenant_id resolution in _rest_ingest_pdf (issue #334)."""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def server_module(monkeypatch, tmp_path):
    """Import server.py with viking_store stubbed so ingest_pdf is observable."""
    fake_viking = MagicMock()
    calls: list[dict] = []

    def fake_ingest_pdf(save_path, tenant_id, equipment_type):
        calls.append(
            {"save_path": save_path, "tenant_id": tenant_id, "equipment_type": equipment_type}
        )
        return 7

    fake_viking.ingest_pdf = fake_ingest_pdf
    monkeypatch.setitem(sys.modules, "context.viking_store", fake_viking)

    import server

    monkeypatch.setattr(server, "DB_PATH", str(tmp_path / "mira.db"))
    server._test_ingest_calls = calls
    return server


class _FakeFileField:
    def __init__(self, filename: str = "pilz_pnoz_x3.pdf", data: bytes = b"%PDF-1.4 stub"):
        self.filename = filename
        self._data = data

    async def read(self) -> bytes:
        return self._data


class _FakeForm:
    def __init__(self, fields: dict):
        self._fields = fields

    def get(self, key, default=None):
        return self._fields.get(key, default)


class _FakeRequest:
    def __init__(self, form_fields: dict):
        self._form_fields = form_fields

    async def form(self):
        return _FakeForm(self._form_fields)


async def test_form_tenant_wins_over_env(server_module, monkeypatch):
    monkeypatch.setattr(server_module, "MIRA_TENANT_ID", "env-tenant-uuid")
    req = _FakeRequest(
        {"file": _FakeFileField(), "tenant_id": "form-tenant-uuid"}
    )
    resp = await server_module._rest_ingest_pdf(req)
    assert resp.status_code == 200
    assert len(server_module._test_ingest_calls) == 1
    assert server_module._test_ingest_calls[0]["tenant_id"] == "form-tenant-uuid"


async def test_env_fallback_when_no_form_field(server_module, monkeypatch):
    monkeypatch.setattr(server_module, "MIRA_TENANT_ID", "env-tenant-uuid")
    req = _FakeRequest({"file": _FakeFileField()})
    resp = await server_module._rest_ingest_pdf(req)
    assert resp.status_code == 200
    assert server_module._test_ingest_calls[0]["tenant_id"] == "env-tenant-uuid"


async def test_default_fallback_when_neither_set(server_module, monkeypatch):
    monkeypatch.setattr(server_module, "MIRA_TENANT_ID", "")
    req = _FakeRequest({"file": _FakeFileField()})
    resp = await server_module._rest_ingest_pdf(req)
    assert resp.status_code == 200
    assert server_module._test_ingest_calls[0]["tenant_id"] == "default"


async def test_empty_form_tenant_falls_through_to_env(server_module, monkeypatch):
    monkeypatch.setattr(server_module, "MIRA_TENANT_ID", "env-tenant-uuid")
    req = _FakeRequest({"file": _FakeFileField(), "tenant_id": "   "})
    resp = await server_module._rest_ingest_pdf(req)
    assert resp.status_code == 200
    assert server_module._test_ingest_calls[0]["tenant_id"] == "env-tenant-uuid"


async def test_missing_file_returns_400(server_module, monkeypatch):
    monkeypatch.setattr(server_module, "MIRA_TENANT_ID", "env-tenant-uuid")
    req = _FakeRequest({"tenant_id": "form-tenant-uuid"})
    resp = await server_module._rest_ingest_pdf(req)
    assert resp.status_code == 400
