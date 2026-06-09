"""Unit tests for Phase 6 direct-connection UNS gate in ignition_chat.py.

Tests that:
  - A turn WITH asset_id is accepted (no 422).
  - A turn WITH asset_context (but no asset_id) is accepted (no 422).
  - A turn with NEITHER asset_id nor asset_context → 422 {"error": "uns_required"}.

Auth is patched out — HMAC verification is already covered by test_chat_signing.py.
This suite focuses on the business-logic reject-on-missing-identifier contract
(Phase 6 acceptance criteria from issue #1658).

Skipped when fastapi is not installed (offline CI without mira-pipeline deps).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

fastapi = pytest.importorskip(
    "fastapi", reason="fastapi required for ignition_chat handler tests"
)

# Add mira-pipeline to the import path.
_PIPELINE_DIR = str(Path(__file__).resolve().parents[2] / "mira-pipeline")
if _PIPELINE_DIR not in sys.path:
    sys.path.insert(0, _PIPELINE_DIR)

from fastapi import FastAPI
from fastapi.testclient import TestClient

import ignition_chat as _ic  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TENANT = "test-tenant-uuid-0001"
HMAC_KEY = "unit-test-hmac-key"


def _make_app(engine_mock) -> FastAPI:
    """Build a minimal FastAPI app wired to the ignition_chat router."""
    app = FastAPI()
    router = _ic.build_router(get_engine=lambda: engine_mock)
    app.include_router(router)
    return app


def _signed_post(client: TestClient, body: dict, *, tenant: str = TENANT):
    """POST to /api/v1/ignition/chat with a valid HMAC signature."""
    import hashlib
    import hmac as hmaclib
    import time

    body_bytes = json.dumps(body).encode()
    ts = str(int(time.time()))
    nonce = hashlib.sha256(body_bytes + ts.encode()).hexdigest()[:32]
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed_string = f"{tenant}\n{nonce}\n{ts}\n{body_hash}"
    sig = hmaclib.new(
        HMAC_KEY.encode(),
        signed_string.encode(),
        hashlib.sha256,
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-MIRA-Tenant": tenant,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": ts,
        "X-MIRA-Signature": sig,
    }
    return client.post("/api/v1/ignition/chat", content=body_bytes, headers=headers)


@pytest.fixture()
def client():
    """TestClient with patched HMAC key, audit writer, and engine stub."""
    engine = MagicMock()
    engine.process = AsyncMock(return_value="MIRA: conveyor fault — check VFD F002")
    app = _make_app(engine)
    with (
        patch.dict("os.environ", {"MIRA_IGNITION_HMAC_KEY": HMAC_KEY}),
        patch("ignition_chat.MIRA_IGNITION_HMAC_KEY", HMAC_KEY),
        patch("ignition_chat.write_audit_row", return_value=True),
        patch("ignition_chat._nonce_store", {}),
    ):
        yield TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_asset_id_accepted(client):
    """Turn with asset_id present must NOT return 422."""
    resp = _signed_post(
        client,
        {"query": "why did conveyor stop", "asset_id": "CV-101"},
    )
    assert resp.status_code != 422, f"Unexpected 422: {resp.json()}"


def test_asset_context_accepted(client):
    """Turn with asset_context (no asset_id) must NOT return 422."""
    resp = _signed_post(
        client,
        {
            "query": "VFD fault on conveyor",
            "asset_context": {"equipment_id": "cv-101", "uns_path": "site.area.cv101"},
        },
    )
    assert resp.status_code != 422, f"Unexpected 422: {resp.json()}"


def test_missing_identifier_returns_422(client):
    """Turn with neither asset_id nor asset_context must return 422 uns_required."""
    resp = _signed_post(client, {"query": "what is a VFD"})
    assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("error") == "uns_required", f"Wrong body: {body}"


def test_empty_asset_id_returns_422(client):
    """Explicitly empty asset_id (whitespace) with no asset_context → 422."""
    resp = _signed_post(client, {"query": "motor overload", "asset_id": "  "})
    assert resp.status_code == 422
    assert resp.json().get("error") == "uns_required"
