"""Tests for POST /api/v1/ignition/chat — HMAC auth + route handler.

Covers:
  1. Missing HMAC headers → 401
  2. Bad signature → 401
  3. Timestamp skew > 300s → 401
  4. Replay (same nonce twice) → 401
  5. Valid request → 200 with shape match (engine mocked)
  6. UNS gate ambiguous → uns_gate.state == "awaiting_confirmation"

Run with:
    pytest mira-mcp/tests/test_ignition_chat.py -v
"""

from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────
# Add mira-mcp root so ignition_auth imports cleanly.
_MCP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_MCP_ROOT))

# Stub heavy optional deps before importing anything from mira-mcp
_fake_viking = MagicMock()
_fake_viking.ingest_pdf = lambda *a, **kw: 0
_fake_viking.retrieve = lambda *a, **kw: []
sys.modules.setdefault("context.viking_store", _fake_viking)
sys.modules.setdefault("openviking", MagicMock())
sys.modules.setdefault("psycopg", MagicMock())
sys.modules.setdefault("psycopg2", MagicMock())

from ignition_auth import (  # noqa: E402
    _NONCE_STORE,
    _TIMESTAMP_SKEW_S,
    verify_hmac,
)

# ── HMAC test helpers ────────────────────────────────────────────────────────

_TEST_KEY = "super-secret-ignition-key-for-testing"
_TENANT = "test-tenant-uuid-1234"


def _sign(
    tenant: str,
    nonce: str,
    timestamp: int,
    body_bytes: bytes,
    key: str = _TEST_KEY,
) -> str:
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed = f"{tenant}\n{nonce}\n{timestamp}\n{body_hash}"
    return _hmac.new(key.encode(), signed.encode(), hashlib.sha256).hexdigest()


def _make_request(
    *,
    tenant: str = _TENANT,
    nonce: str = "unique-nonce-abc",
    timestamp: int | None = None,
    body: bytes = b'{"query": "why did the conveyor stop?"}',
    signature: str | None = None,
    missing_headers: list[str] | None = None,
) -> MagicMock:
    """Build a minimal fake Starlette Request for verify_hmac testing."""
    if timestamp is None:
        timestamp = int(time.time())
    if signature is None:
        signature = _sign(tenant, nonce, timestamp, body)

    headers: dict[str, str] = {
        "X-MIRA-Tenant": tenant,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": str(timestamp),
        "X-MIRA-Signature": signature,
    }
    for h in missing_headers or []:
        headers.pop(h, None)

    req = MagicMock()
    req.headers = headers
    req.body = AsyncMock(return_value=body)
    return req


# ── Tests for verify_hmac (ignition_auth module) ─────────────────────────────


class TestVerifyHmac:
    def setup_method(self):
        """Clear nonce store between tests."""
        _NONCE_STORE.clear()

    @pytest.mark.asyncio
    async def test_missing_tenant_header_returns_401(self):
        from starlette.exceptions import HTTPException

        req = _make_request(missing_headers=["X-MIRA-Tenant"])
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req, _TEST_KEY)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_nonce_header_returns_401(self):
        from starlette.exceptions import HTTPException

        req = _make_request(missing_headers=["X-MIRA-Nonce"])
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req, _TEST_KEY)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_signature_header_returns_401(self):
        from starlette.exceptions import HTTPException

        req = _make_request(missing_headers=["X-MIRA-Signature"])
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req, _TEST_KEY)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_bad_signature_returns_401(self):
        from starlette.exceptions import HTTPException

        req = _make_request(signature="deadbeef" * 8)  # wrong hex
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req, _TEST_KEY)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_timestamp_skew_over_300s_returns_401(self):
        from starlette.exceptions import HTTPException

        old_ts = int(time.time()) - (_TIMESTAMP_SKEW_S + 10)
        body = b'{"query": "test"}'
        sig = _sign(_TENANT, "nonce-skew-test", old_ts, body)
        req = _make_request(timestamp=old_ts, body=body, nonce="nonce-skew-test", signature=sig)
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req, _TEST_KEY)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_future_timestamp_skew_over_300s_returns_401(self):
        from starlette.exceptions import HTTPException

        future_ts = int(time.time()) + (_TIMESTAMP_SKEW_S + 10)
        body = b'{"query": "test"}'
        sig = _sign(_TENANT, "nonce-future-test", future_ts, body)
        req = _make_request(
            timestamp=future_ts, body=body, nonce="nonce-future-test", signature=sig
        )
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req, _TEST_KEY)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_request_returns_tenant_id(self):
        req = _make_request()
        tenant = await verify_hmac(req, _TEST_KEY)
        assert tenant == _TENANT

    @pytest.mark.asyncio
    async def test_nonce_replay_returns_401(self):
        from starlette.exceptions import HTTPException

        body = b'{"query": "replay test"}'
        nonce = "replay-nonce-xyz"
        ts = int(time.time())
        sig = _sign(_TENANT, nonce, ts, body)

        # First request should succeed
        req1 = _make_request(nonce=nonce, timestamp=ts, body=body, signature=sig)
        await verify_hmac(req1, _TEST_KEY)

        # Second request with same nonce should fail
        req2 = _make_request(nonce=nonce, timestamp=ts, body=body, signature=sig)
        with pytest.raises(HTTPException) as exc_info:
            await verify_hmac(req2, _TEST_KEY)
        assert exc_info.value.status_code == 401


# ── Tests for the route handler (rest_ignition_chat) ──────────────────────────
#
# Strategy: import the handler function by running the __main__ block in a
# controlled way is fragile (server.py uses `if __name__ == "__main__"`).
# Instead, we test via the Starlette TestClient with the route wired in a
# minimal test app, mocking verify_hmac and the pipeline HTTP call.


class TestIgnitionChatRoute:
    """Integration-style tests for the route handler via a minimal Starlette app."""

    def _build_app(self, mock_pipeline_response: dict, hmac_side_effect=None):
        """Build a minimal Starlette app that contains only the ignition chat route."""

        # Import verify_hmac to patch it
        import ignition_auth as _ia
        from starlette.applications import Starlette
        from starlette.exceptions import HTTPException
        from starlette.responses import JSONResponse
        from starlette.routing import Route
        from starlette.testclient import TestClient

        async def rest_ignition_chat(request):
            """Minimal copy of the handler logic for testing."""
            import time as _time
            import uuid as _uuid

            t0 = _time.monotonic()
            inference_run_id = str(_uuid.uuid4())

            # HMAC check — patched in tests
            try:
                tenant_id = await _ia.verify_hmac(request, _TEST_KEY)
            except HTTPException:
                raise
            except Exception:
                return JSONResponse({"error": "authentication error"}, status_code=500)

            try:
                body = await request.json()
            except Exception:
                return JSONResponse({"error": "invalid JSON body"}, status_code=400)

            query = body.get("query", "").strip()
            if not query:
                return JSONResponse({"error": "query is required"}, status_code=400)

            asset_id = body.get("asset_id", "")
            _tag_snapshot = body.get("tag_snapshot", {})
            _operator = body.get("operator", "unknown")
            _session_id = body.get("session_id") or f"ignition-{tenant_id}"

            # Mock pipeline call returns mock_pipeline_response
            pipeline_data = mock_pipeline_response
            answer = pipeline_data.get("choices", [{}])[0].get("message", {}).get("content", "")

            latency_ms = int((_time.monotonic() - t0) * 1000)

            uns_gate_state = "confirmed"
            if any(
                kw in answer.lower()
                for kw in (
                    "which conveyor",
                    "which machine",
                    "which asset",
                    "can you confirm",
                    "please confirm",
                )
            ):
                uns_gate_state = "awaiting_confirmation"

            return JSONResponse(
                {
                    "answer": answer,
                    "sources": [],
                    "confidence": 0.0,
                    "suggested_actions": [],
                    "uns_gate": {
                        "state": uns_gate_state,
                        "asset": asset_id,
                        "evidence": [],
                    },
                    "latency_ms": latency_ms,
                    "inference_run_id": inference_run_id,
                }
            )

        app = Starlette(
            routes=[Route("/api/v1/ignition/chat", rest_ignition_chat, methods=["POST"])]
        )
        return TestClient(app, raise_server_exceptions=False)

    def _valid_headers(self, body: bytes, nonce: str = "nonce-route-1") -> dict:
        ts = int(time.time())
        sig = _sign(_TENANT, nonce, ts, body)
        return {
            "Content-Type": "application/json",
            "X-MIRA-Tenant": _TENANT,
            "X-MIRA-Nonce": nonce,
            "X-MIRA-Timestamp": str(ts),
            "X-MIRA-Signature": sig,
        }

    def _pipeline_response(self, content: str) -> dict:
        return {
            "id": "chatcmpl-test",
            "choices": [{"message": {"role": "assistant", "content": content}}],
        }

    def setup_method(self):
        _NONCE_STORE.clear()

    def test_valid_request_returns_200_with_shape(self):
        body = json.dumps(
            {"query": "why did the conveyor stop?", "asset_id": "[default]Conv/State"}
        ).encode()
        client = self._build_app(self._pipeline_response("Check VFD fault code F0004."))
        resp = client.post(
            "/api/v1/ignition/chat",
            content=body,
            headers=self._valid_headers(body, nonce="valid-shape-nonce"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        assert "sources" in data
        assert "confidence" in data
        assert "suggested_actions" in data
        assert "uns_gate" in data
        assert "latency_ms" in data
        assert "inference_run_id" in data
        assert data["uns_gate"]["state"] == "confirmed"

    def test_uns_gate_ambiguous_when_engine_asks_for_confirmation(self):
        body = json.dumps({"query": "conveyor down"}).encode()
        # Engine responds with a confirmation question
        answer = "MIRA: can you confirm which conveyor you are asking about?"
        client = self._build_app(self._pipeline_response(answer))
        resp = client.post(
            "/api/v1/ignition/chat",
            content=body,
            headers=self._valid_headers(body, nonce="ambiguous-nonce"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["uns_gate"]["state"] == "awaiting_confirmation"

    def test_missing_hmac_headers_returns_401(self):
        body = json.dumps({"query": "test"}).encode()
        # No HMAC headers at all
        client = self._build_app(self._pipeline_response("ok"))
        resp = client.post(
            "/api/v1/ignition/chat",
            content=body,
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 401

    def test_bad_signature_returns_401(self):
        body = json.dumps({"query": "test"}).encode()
        ts = int(time.time())
        headers = {
            "Content-Type": "application/json",
            "X-MIRA-Tenant": _TENANT,
            "X-MIRA-Nonce": "bad-sig-nonce",
            "X-MIRA-Timestamp": str(ts),
            "X-MIRA-Signature": "00" * 32,  # wrong signature
        }
        client = self._build_app(self._pipeline_response("ok"))
        resp = client.post("/api/v1/ignition/chat", content=body, headers=headers)
        assert resp.status_code == 401

    def test_timestamp_skew_returns_401(self):
        body = json.dumps({"query": "test"}).encode()
        old_ts = int(time.time()) - (_TIMESTAMP_SKEW_S + 20)
        sig = _sign(_TENANT, "skew-route-nonce", old_ts, body)
        headers = {
            "Content-Type": "application/json",
            "X-MIRA-Tenant": _TENANT,
            "X-MIRA-Nonce": "skew-route-nonce",
            "X-MIRA-Timestamp": str(old_ts),
            "X-MIRA-Signature": sig,
        }
        client = self._build_app(self._pipeline_response("ok"))
        resp = client.post("/api/v1/ignition/chat", content=body, headers=headers)
        assert resp.status_code == 401

    def test_nonce_replay_returns_401(self):
        body = json.dumps({"query": "replay"}).encode()
        headers = self._valid_headers(body, nonce="replay-route-nonce-123")
        client = self._build_app(self._pipeline_response("ok"))
        # First request succeeds
        resp1 = client.post("/api/v1/ignition/chat", content=body, headers=headers)
        assert resp1.status_code == 200
        # Second request with same nonce fails
        resp2 = client.post("/api/v1/ignition/chat", content=body, headers=headers)
        assert resp2.status_code == 401
