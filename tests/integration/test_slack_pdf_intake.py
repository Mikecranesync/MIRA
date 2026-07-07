# MIRA FactoryLM — Apache 2.0
"""Slack PDF intake routes through the citable Hub folder door (issue #2543).

Asserts ``pdf_handler.ingest_pdf`` POSTs to ``/api/uploads/folder`` with the
Bearer token + ``X-Mira-Tenant-Id`` header (matching MiraDrop's shape), and
gracefully skips — without any HTTP call — when the Hub env is unset.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

# The Slack bot imports modules flat (``from pdf_handler import ingest_pdf``),
# so the slack dir must be on the path to import pdf_handler here too.
SLACK_DIR = Path(__file__).resolve().parents[2] / "mira-bots" / "slack"
if str(SLACK_DIR) not in sys.path:
    sys.path.insert(0, str(SLACK_DIR))

import pdf_handler  # noqa: E402


class _FakeResponse:
    def __init__(self, status_code: int = 200, json_data: dict | None = None) -> None:
        self.status_code = status_code
        self._json = json_data if json_data is not None else {"id": "up_123", "status": "queued"}
        self.text = "ok"

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=self)  # type: ignore[arg-type]

    def json(self) -> dict:
        return self._json


class _FakeClient:
    """Records the single POST ingest_pdf makes."""

    calls: list[dict] = []

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *args) -> bool:
        return False

    async def post(self, url, headers=None, files=None):
        _FakeClient.calls.append({"url": url, "headers": headers or {}, "files": files or {}})
        return _FakeResponse()


@pytest.fixture(autouse=True)
def _reset_calls():
    _FakeClient.calls = []
    yield
    _FakeClient.calls = []


async def test_ingest_pdf_posts_to_folder_door(monkeypatch):
    """Happy path: POST to /api/uploads/folder with Bearer + tenant header."""
    monkeypatch.setattr(pdf_handler, "httpx", httpx)
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(pdf_handler, "HUB_URL", "http://hub.local")
    monkeypatch.setattr(pdf_handler, "HUB_BASE_PATH", "/hub")
    monkeypatch.setattr(pdf_handler, "HUB_INGEST_TOKEN", "test-token")
    monkeypatch.setattr(pdf_handler, "MIRA_TENANT_ID", "11111111-1111-1111-1111-111111111111")

    reply = await pdf_handler.ingest_pdf(b"%PDF-1.7 fake", "pump_manual.pdf")

    assert len(_FakeClient.calls) == 1, "expected exactly one folder-door POST"
    call = _FakeClient.calls[0]
    assert call["url"] == "http://hub.local/hub/api/uploads/folder/"
    assert call["headers"]["Authorization"] == "Bearer test-token"
    assert call["headers"]["X-Mira-Tenant-Id"] == "11111111-1111-1111-1111-111111111111"
    # Raw multipart file part named "file", with the PDF MIME.
    name, _stream, mime = call["files"]["file"]
    assert name == "pump_manual.pdf"
    assert mime == "application/pdf"
    # No Open-WebUI collection door in the URL.
    assert "/api/v1/knowledge/" not in call["url"]
    assert "/api/v1/files/" not in call["url"]
    assert "knowledge base" in reply.lower()


async def test_ingest_pdf_skips_when_env_unset(monkeypatch):
    """Graceful skip: no HTTP call when HUB_INGEST_TOKEN / MIRA_TENANT_ID unset."""
    monkeypatch.setattr(pdf_handler, "httpx", httpx)
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(pdf_handler, "HUB_INGEST_TOKEN", "")
    monkeypatch.setattr(pdf_handler, "MIRA_TENANT_ID", "")

    reply = await pdf_handler.ingest_pdf(b"%PDF-1.7 fake", "pump_manual.pdf")

    assert _FakeClient.calls == [], "must not POST when Hub env is unset"
    assert "isn't configured" in reply


async def test_ingest_pdf_rejects_unsupported_mime(monkeypatch):
    """MIME allowlist: a non-PDF/image extension is rejected before any HTTP call."""
    monkeypatch.setattr(pdf_handler, "httpx", httpx)
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(pdf_handler, "HUB_INGEST_TOKEN", "test-token")
    monkeypatch.setattr(pdf_handler, "MIRA_TENANT_ID", "11111111-1111-1111-1111-111111111111")

    reply = await pdf_handler.ingest_pdf(b"MZ...", "malware.exe")

    assert _FakeClient.calls == [], "must not POST an unsupported type"
    assert "supported type" in reply
