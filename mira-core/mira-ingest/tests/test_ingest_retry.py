"""Tests for the OW upload transient-retry + recovery behavior on
/ingest/document-kb (added 2026-06-06 alongside the Docling->Tika swap).

Covers:
  - a transient 5xx on the OW file upload is retried and then succeeds (200)
  - a connection error on the OW file upload is retried then succeeds
  - a deterministic 4xx on the OW file upload is NOT retried (terminal 422)
  - an extraction `failed` status is terminal with a clear reason (no auto-retry)

Mocks db.neon helpers + the OW HTTP path so the tests run without infra. The
backoff sleep is patched to a no-op so retries don't slow the suite.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import main as ingest_main  # noqa: E402

TENANT = "00000000-0000-0000-0000-000000000099"


def _pdf() -> bytes:
    return b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n"


@pytest.fixture
def client():
    return TestClient(ingest_main.app)


@pytest.fixture(autouse=True)
def _no_backoff_sleep():
    # _ow_upload_file backs off with asyncio.sleep(2**n); make it instant.
    with patch.object(ingest_main.asyncio, "sleep", new=AsyncMock(return_value=None)):
        yield


@pytest.fixture(autouse=True)
def _bypass_gates():
    # No dedup, tier allowed, no relevance gate — isolate the upload path.
    with (
        patch("db.neon.tenant_ingested_files_lookup", return_value=None),
        patch("db.neon.check_tier_limit", return_value=(True, "")),
        patch("db.neon.tenant_ingested_files_record", return_value=None),
        patch.object(
            ingest_main,
            "_get_or_create_kb_collection",
            new=AsyncMock(return_value="col-fake-uuid"),
        ),
    ):
        yield


def _resp(status_code: int, *, body: dict | None = None, text: str = "") -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.text = text
    r.json = lambda: body or {}
    r.request = MagicMock()
    return r


class _FlakyClient:
    """httpx.AsyncClient stub. The first `fail_uploads` POSTs to /api/v1/files/
    behave per `mode`; subsequent ones return 200/{id}. attach + status always OK.
    """

    calls = {"upload": 0}

    def __init__(self, *, fail_uploads: int, mode: str):
        self._fail_uploads = fail_uploads
        self._mode = mode

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        if "/api/v1/files/" in url and "/process/status" not in url:
            _FlakyClient.calls["upload"] += 1
            n = _FlakyClient.calls["upload"]
            if n <= self._fail_uploads:
                if self._mode == "5xx":
                    return _resp(503, text="upstream down")
                if self._mode == "conn":
                    raise httpx.ConnectError("connection refused")
                if self._mode == "4xx":
                    return _resp(415, text="unsupported media type")
            return _resp(200, body={"id": "file-fake-uuid"})
        # /file/add attach
        return _resp(200, body={})


def _patch_client(*, fail_uploads: int, mode: str):
    _FlakyClient.calls["upload"] = 0
    return patch(
        "main.httpx.AsyncClient",
        new=lambda *a, **kw: _FlakyClient(fail_uploads=fail_uploads, mode=mode),
    )


def _post(client):
    return client.post(
        "/ingest/document-kb",
        files={"file": ("manual.pdf", _pdf(), "application/pdf")},
        data={"tenant_id": TENANT},
    )


def test_transient_5xx_is_retried_then_succeeds(client):
    with (
        _patch_client(fail_uploads=1, mode="5xx"),
        patch.object(ingest_main, "_poll_file_status", new=AsyncMock(return_value="completed")),
    ):
        resp = _post(client)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ok"
    # First attempt 503, second attempt 200 → exactly 2 upload calls.
    assert _FlakyClient.calls["upload"] == 2


def test_connection_error_is_retried_then_succeeds(client):
    with (
        _patch_client(fail_uploads=1, mode="conn"),
        patch.object(ingest_main, "_poll_file_status", new=AsyncMock(return_value="completed")),
    ):
        resp = _post(client)
    assert resp.status_code == 200, resp.text
    assert _FlakyClient.calls["upload"] == 2


def test_4xx_upload_is_terminal_not_retried(client):
    with (
        _patch_client(fail_uploads=99, mode="4xx"),
        patch.object(ingest_main, "_poll_file_status", new=AsyncMock(return_value="completed")),
    ):
        resp = _post(client)
    assert resp.status_code == 422, resp.text
    # A deterministic 4xx must NOT be retried — exactly one upload attempt.
    assert _FlakyClient.calls["upload"] == 1
    assert "rejected" in resp.json()["detail"].lower()


def test_extraction_failed_is_terminal_with_clear_reason(client):
    with (
        _patch_client(fail_uploads=0, mode="5xx"),
        patch.object(ingest_main, "_poll_file_status", new=AsyncMock(return_value="failed")),
    ):
        resp = _post(client)
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"].lower()
    # Clear reason, not the old generic "try re-uploading".
    assert "could not extract" in detail
    # Upload happened exactly once — extraction `failed` is NOT auto-retried.
    assert _FlakyClient.calls["upload"] == 1
