"""Unit 3.5 tests — magic-inbox safety gates on /ingest/document-kb.

Mocks db.neon helpers, the Open WebUI HTTP path, and the Groq classifier
so the tests run without infrastructure. Each test exercises one decision
branch in main.ingest_document_kb (lines ~708-835).
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import main as ingest_main  # noqa: E402

TENANT = "00000000-0000-0000-0000-000000000099"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _minimal_pdf_bytes() -> bytes:
    """Return a tiny but valid-enough PDF byte sequence for upload tests.

    pdfplumber will likely fail to parse this — that's fine; the
    relevance gate's pdfplumber call falls back to "" on parse error,
    which the classifier handles via fail-open.
    """
    return b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n"


@pytest.fixture
def client():
    return TestClient(ingest_main.app)


@pytest.fixture(autouse=True)
def _reset_env(monkeypatch):
    monkeypatch.delenv("RELEVANCE_GATE_ENABLED", raising=False)
    monkeypatch.delenv("MIRA_TENANT_ID", raising=False)


# Patches the Open WebUI HTTP path so the success branch can run end-to-end
# without a live OW. Returns the mock for assertion in tests that care.
def _mock_openwebui():
    return (
        patch.object(
            ingest_main,
            "_get_or_create_kb_collection",
            new=AsyncMock(return_value="col-fake-uuid"),
        ),
        patch.object(
            ingest_main,
            "_poll_file_status",
            new=AsyncMock(return_value="ready"),
        ),
        patch(
            "main.httpx.AsyncClient",
            new=lambda *a, **kw: _AsyncClientStub(),
        ),
    )


class _AsyncClientStub:
    """Replaces httpx.AsyncClient for OW upload + attach. Both return 200/{id}."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        resp = MagicMock()
        resp.status_code = 200
        resp.text = ""
        if "/api/v1/files/" in url and "/process/status" not in url:
            resp.json = lambda: {"id": "file-fake-uuid"}
        elif "/file/add" in url:
            resp.json = lambda: {}
        else:
            resp.json = lambda: {}
        resp.raise_for_status = lambda: None
        return resp


def _post_doc(client, *, content: bytes | None = None, **form):
    payload = content if content is not None else _minimal_pdf_bytes()
    return client.post(
        "/ingest/document-kb",
        files={"file": ("manual-yaskawa.pdf", payload, "application/pdf")},
        data={"tenant_id": TENANT, **form},
    )


# ---------------------------------------------------------------------------
# Gate 1: content-hash dedup
# ---------------------------------------------------------------------------


def test_dedup_hit_returns_duplicate_status_and_skips_openwebui(client):
    """When the hash already exists for the tenant, return early; no OW call."""
    existing = {
        "filename": "manual-yaskawa-gs20.pdf",
        "ingested_at": MagicMock(isoformat=lambda: "2026-04-19T10:00:00+00:00"),
        "source": "inbox",
    }
    with patch.object(
        ingest_main,
        "_get_or_create_kb_collection",
        new=AsyncMock(),
    ) as mock_collection, patch(
        "db.neon.tenant_ingested_files_lookup",
        return_value=existing,
    ), patch(
        "db.neon.check_tier_limit",
        return_value=(True, ""),
    ):
        resp = _post_doc(client)

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "duplicate"
    assert body["original_filename"] == "manual-yaskawa-gs20.pdf"
    assert body["original_uploaded_at"] == "2026-04-19T10:00:00+00:00"
    assert "content_hash" in body and len(body["content_hash"]) == 64
    # Critical: dedup short-circuits before OW. Collection was never created.
    mock_collection.assert_not_called()


def test_dedup_miss_records_after_openwebui_success(client):
    """First-seen file completes the ingest path AND records the hash ledger row."""
    record_calls = []

    def fake_record(tenant, h, fn, source="unknown"):
        record_calls.append((tenant, h, fn, source))

    patches = [
        patch("db.neon.tenant_ingested_files_lookup", return_value=None),
        patch("db.neon.tenant_ingested_files_record", side_effect=fake_record),
        patch("db.neon.check_tier_limit", return_value=(True, "")),
        *_mock_openwebui(),
    ]
    for p in patches:
        p.start()
    try:
        resp = _post_doc(client, source="inbox")
    finally:
        for p in patches:
            p.stop()

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert len(record_calls) == 1
    tenant, content_hash, filename, source = record_calls[0]
    assert tenant == TENANT
    assert len(content_hash) == 64  # SHA-256 hex
    assert filename == "manual-yaskawa.pdf"
    assert source == "inbox"


# ---------------------------------------------------------------------------
# Gate 2: relevance classifier
# ---------------------------------------------------------------------------


def test_relevance_gate_yes_proceeds_with_ingest(client, monkeypatch):
    monkeypatch.setenv("RELEVANCE_GATE_ENABLED", "true")
    patches = [
        patch("db.neon.tenant_ingested_files_lookup", return_value=None),
        patch("db.neon.tenant_ingested_files_record"),
        patch("db.neon.check_tier_limit", return_value=(True, "")),
        patch(
            "relevance.classify_document",
            new=AsyncMock(return_value=(True, "manual")),
        ),
        *_mock_openwebui(),
    ]
    for p in patches:
        p.start()
    try:
        resp = _post_doc(client, relevance_gate="on")
    finally:
        for p in patches:
            p.stop()

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_relevance_gate_no_returns_rejected_status_and_skips_openwebui(
    client, monkeypatch
):
    monkeypatch.setenv("RELEVANCE_GATE_ENABLED", "true")
    with patch.object(
        ingest_main,
        "_get_or_create_kb_collection",
        new=AsyncMock(),
    ) as mock_collection, patch(
        "db.neon.tenant_ingested_files_lookup", return_value=None
    ), patch(
        "db.neon.check_tier_limit", return_value=(True, "")
    ), patch(
        "relevance.classify_document",
        new=AsyncMock(return_value=(False, "looks like a meeting agenda")),
    ):
        resp = _post_doc(client, relevance_gate="on")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["reason"] == "looks like a meeting agenda"
    assert "content_hash" in body
    mock_collection.assert_not_called()


def test_relevance_gate_groq_error_fails_open_and_ingests(client, monkeypatch):
    """If Groq raises, the gate returns (True, 'skipped-error') → ingest proceeds."""
    monkeypatch.setenv("RELEVANCE_GATE_ENABLED", "true")
    patches = [
        patch("db.neon.tenant_ingested_files_lookup", return_value=None),
        patch("db.neon.tenant_ingested_files_record"),
        patch("db.neon.check_tier_limit", return_value=(True, "")),
        # classify_document is the public wrapper that itself fails open;
        # simulate that by returning the fail-open value.
        patch(
            "relevance.classify_document",
            new=AsyncMock(return_value=(True, "skipped-error")),
        ),
        *_mock_openwebui(),
    ]
    for p in patches:
        p.start()
    try:
        resp = _post_doc(client, relevance_gate="on")
    finally:
        for p in patches:
            p.stop()

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_relevance_gate_disabled_by_default_skips_classifier(client, monkeypatch):
    """RELEVANCE_GATE_ENABLED unset → classifier never called even if form says on."""
    # NOTE: env is reset by autouse _reset_env fixture
    classify_mock = AsyncMock(return_value=(False, "should not be called"))
    patches = [
        patch("db.neon.tenant_ingested_files_lookup", return_value=None),
        patch("db.neon.tenant_ingested_files_record"),
        patch("db.neon.check_tier_limit", return_value=(True, "")),
        patch("relevance.classify_document", new=classify_mock),
        *_mock_openwebui(),
    ]
    for p in patches:
        p.start()
    try:
        resp = _post_doc(client, relevance_gate="on")
    finally:
        for p in patches:
            p.stop()

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    classify_mock.assert_not_called()


def test_relevance_gate_form_off_skips_classifier_even_when_env_on(
    client, monkeypatch
):
    """Web upload picker leaves relevance_gate=off; gate stays off even with env on."""
    monkeypatch.setenv("RELEVANCE_GATE_ENABLED", "true")
    classify_mock = AsyncMock(return_value=(False, "should not be called"))
    patches = [
        patch("db.neon.tenant_ingested_files_lookup", return_value=None),
        patch("db.neon.tenant_ingested_files_record"),
        patch("db.neon.check_tier_limit", return_value=(True, "")),
        patch("relevance.classify_document", new=classify_mock),
        *_mock_openwebui(),
    ]
    for p in patches:
        p.start()
    try:
        # No relevance_gate field → defaults to "off"
        resp = _post_doc(client, source="web-upload")
    finally:
        for p in patches:
            p.stop()

    assert resp.status_code == 200
    classify_mock.assert_not_called()
