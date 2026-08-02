"""Tests for HMAC auth verifier (auth.py) and relay_server.py auth integration."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import time

import pytest
from starlette.testclient import TestClient

import auth
import relay_server

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

TEST_KEY = "test-hmac-key-32bytes-padded-ok!"
TEST_TENANT = "tenant-uuid-0001"


def _make_signature(
    tenant: str,
    nonce: str,
    timestamp: int,
    body_bytes: bytes,
    key: str = TEST_KEY,
) -> str:
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed = f"{tenant}\n{nonce}\n{timestamp}\n{body_hash}"
    return hmac.new(key.encode(), signed.encode(), hashlib.sha256).hexdigest()


def _hmac_headers(
    tenant: str = TEST_TENANT,
    nonce: str = "nonce-001",
    timestamp: int | None = None,
    body_bytes: bytes = b"",
    key: str = TEST_KEY,
    signature: str | None = None,
) -> dict[str, str]:
    ts = timestamp if timestamp is not None else int(time.time())
    sig = signature if signature is not None else _make_signature(tenant, nonce, ts, body_bytes, key)
    return {
        "X-MIRA-Tenant": tenant,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": str(ts),
        "X-MIRA-Signature": sig,
    }


def _make_payload(equipment_id: str = "VFD-001") -> dict:
    return {
        "type": "tags",
        "agent_id": "test",
        "equipment": {
            equipment_id: {
                "outputFrequency": {"v": 42.1, "q": "Good", "t": "2026-05-31 12:00:00"},
            }
        },
    }


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_relay(tmp_path, monkeypatch):
    """Reset relay_server module state and use a temp DB for each test."""
    db_path = str(tmp_path / "mira.db")
    monkeypatch.setattr(relay_server, "DB_PATH", db_path)
    monkeypatch.setattr(relay_server, "RELAY_API_KEY", "bearer-key")
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", TEST_KEY)
    yield db_path


@pytest.fixture(autouse=True)
def _clear_nonce_store():
    """Clear the replay store between tests."""
    auth._replay_store.clear()
    yield
    auth._replay_store.clear()


@pytest.fixture
def client():
    return TestClient(relay_server.app)


# ──────────────────────────────────────────────────────────────────────────────
# 1. Missing headers → 401
# ──────────────────────────────────────────────────────────────────────────────

class TestMissingHeaders:
    def test_no_hmac_headers_returns_401(self, client):
        resp = client.post("/ingest", json=_make_payload())
        assert resp.status_code == 401
        assert resp.json()["error"] == "auth_failed"

    def test_partial_headers_missing_signature_returns_401(self, client):
        body = json.dumps(_make_payload()).encode()
        ts = int(time.time())
        headers = {
            "X-MIRA-Tenant": TEST_TENANT,
            "X-MIRA-Nonce": "nonce-x",
            "X-MIRA-Timestamp": str(ts),
            # X-MIRA-Signature deliberately omitted
        }
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 401

    def test_partial_headers_missing_tenant_returns_401(self, client):
        body = json.dumps(_make_payload()).encode()
        ts = int(time.time())
        sig = _make_signature(TEST_TENANT, "nonce-x", ts, body)
        headers = {
            # X-MIRA-Tenant deliberately omitted
            "X-MIRA-Nonce": "nonce-x",
            "X-MIRA-Timestamp": str(ts),
            "X-MIRA-Signature": sig,
        }
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# 2. Bad signature → 401
# ──────────────────────────────────────────────────────────────────────────────

class TestBadSignature:
    def test_wrong_signature_returns_401(self, client):
        body = json.dumps(_make_payload()).encode()
        headers = _hmac_headers(body_bytes=body, signature="deadbeef" * 8)
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "signature_mismatch"

    def test_signature_for_different_body_returns_401(self, client):
        body = json.dumps(_make_payload()).encode()
        wrong_body = b'{"type":"tags","equipment":{}}'
        headers = _hmac_headers(body_bytes=wrong_body)  # sig computed over wrong_body
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "signature_mismatch"


# ──────────────────────────────────────────────────────────────────────────────
# 3. Timestamp skew > 300 s → 401
# ──────────────────────────────────────────────────────────────────────────────

class TestTimestampSkew:
    def test_old_timestamp_returns_401(self, client):
        body = json.dumps(_make_payload()).encode()
        old_ts = int(time.time()) - 400
        headers = _hmac_headers(body_bytes=body, timestamp=old_ts)
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "bad_timestamp"

    def test_future_timestamp_too_far_returns_401(self, client):
        body = json.dumps(_make_payload()).encode()
        future_ts = int(time.time()) + 400
        headers = _hmac_headers(body_bytes=body, timestamp=future_ts)
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "bad_timestamp"

    def test_timestamp_within_window_passes(self, client):
        body = json.dumps(_make_payload()).encode()
        ts = int(time.time()) - 299
        headers = _hmac_headers(body_bytes=body, timestamp=ts)
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 200


# ──────────────────────────────────────────────────────────────────────────────
# 4. Replay — same nonce twice for same tenant → 401 on second
# ──────────────────────────────────────────────────────────────────────────────

class TestReplay:
    def test_replay_same_tenant_nonce_rejected(self, client):
        body = json.dumps(_make_payload()).encode()
        nonce = "replay-nonce-unique"
        headers = _hmac_headers(nonce=nonce, body_bytes=body)
        resp1 = client.post("/ingest", content=body, headers=headers)
        assert resp1.status_code == 200

        # Second request with identical nonce — must fail
        resp2 = client.post("/ingest", content=body, headers=headers)
        assert resp2.status_code == 401
        assert resp2.json()["detail"] == "replay_detected"


# ──────────────────────────────────────────────────────────────────────────────
# 5. Same nonce, different tenant → both pass
# ──────────────────────────────────────────────────────────────────────────────

class TestReplayDifferentTenant:
    def test_same_nonce_different_tenant_both_pass(self, client):
        nonce = "shared-nonce-001"
        body = json.dumps(_make_payload()).encode()

        headers_a = _hmac_headers(tenant="tenant-A", nonce=nonce, body_bytes=body)
        resp_a = client.post("/ingest", content=body, headers=headers_a)
        assert resp_a.status_code == 200

        headers_b = _hmac_headers(tenant="tenant-B", nonce=nonce, body_bytes=body)
        resp_b = client.post("/ingest", content=body, headers=headers_b)
        assert resp_b.status_code == 200


# ──────────────────────────────────────────────────────────────────────────────
# 6. Valid HMAC → 200, row written with tenant_id
# ──────────────────────────────────────────────────────────────────────────────

class TestValidHmac:
    def test_valid_hmac_writes_tenant_id(self, client, _reset_relay):
        db_path = _reset_relay
        body = json.dumps(_make_payload()).encode()
        headers = _hmac_headers(tenant=TEST_TENANT, nonce="valid-nonce-1", body_bytes=body)
        resp = client.post("/ingest", content=body, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT tenant_id FROM equipment_status WHERE equipment_id = 'VFD-001'").fetchone()
        assert row is not None
        assert row["tenant_id"] == TEST_TENANT
        db.close()


# ──────────────────────────────────────────────────────────────────────────────
# 7. Legacy bearer with RELAY_LEGACY_BEARER=1 → 200, tenant_id=NULL
# ──────────────────────────────────────────────────────────────────────────────

class TestLegacyBearerEnabled:
    def test_legacy_bearer_enabled_passes(self, client, _reset_relay, monkeypatch):
        db_path = _reset_relay
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "bearer-key")

        resp = client.post(
            "/ingest",
            json=_make_payload(),
            headers={"Authorization": "Bearer bearer-key"},
        )
        assert resp.status_code == 200

        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT tenant_id FROM equipment_status WHERE equipment_id = 'VFD-001'").fetchone()
        assert row is not None
        assert row["tenant_id"] is None  # Legacy path has no tenant
        db.close()


# ──────────────────────────────────────────────────────────────────────────────
# 8. Legacy bearer with RELAY_LEGACY_BEARER=0 (or unset) → 401
# ──────────────────────────────────────────────────────────────────────────────

class TestLegacyBearerDisabled:
    def test_legacy_bearer_disabled_returns_401(self, client, monkeypatch):
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "bearer-key")
        # Send a bearer-only request with no HMAC headers
        resp = client.post(
            "/ingest",
            json=_make_payload(),
            headers={"Authorization": "Bearer bearer-key"},
        )
        assert resp.status_code == 401

    def test_bearer_without_hmac_key_configured_is_rejected(self, client, monkeypatch):
        """When HMAC key is set and legacy is off, bearer alone must fail."""
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
        monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", TEST_KEY)
        resp = client.post(
            "/ingest",
            json=_make_payload(),
            headers={"Authorization": "Bearer bearer-key"},
        )
        assert resp.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# Unit tests for auth.verify_hmac directly
# ──────────────────────────────────────────────────────────────────────────────

class TestVerifyHmacUnit:
    def test_valid_call_returns_tenant(self):
        body = b'{"hello":"world"}'
        now = time.time()
        ts = int(now)
        nonce = "unit-nonce-1"
        sig = _make_signature(TEST_TENANT, nonce, ts, body)
        headers = {
            "X-MIRA-Tenant": TEST_TENANT,
            "X-MIRA-Nonce": nonce,
            "X-MIRA-Timestamp": str(ts),
            "X-MIRA-Signature": sig,
        }
        result = auth.verify_hmac(headers, body, TEST_KEY, _now=now)
        assert result == TEST_TENANT

    def test_missing_header_raises(self):
        with pytest.raises(ValueError, match="missing_headers"):
            auth.verify_hmac({}, b"", TEST_KEY)

    def test_bad_timestamp_not_int_raises(self):
        headers = {
            "X-MIRA-Tenant": TEST_TENANT,
            "X-MIRA-Nonce": "n",
            "X-MIRA-Timestamp": "not-a-number",
            "X-MIRA-Signature": "abc",
        }
        with pytest.raises(ValueError, match="bad_timestamp"):
            auth.verify_hmac(headers, b"", TEST_KEY)

    def test_replay_raises_on_second_call(self):
        body = b"body"
        now = time.time()
        ts = int(now)
        nonce = "replay-unit-1"
        sig = _make_signature(TEST_TENANT, nonce, ts, body)
        headers = {
            "X-MIRA-Tenant": TEST_TENANT,
            "X-MIRA-Nonce": nonce,
            "X-MIRA-Timestamp": str(ts),
            "X-MIRA-Signature": sig,
        }
        auth.verify_hmac(headers, body, TEST_KEY, _now=now)
        with pytest.raises(ValueError, match="replay_detected"):
            auth.verify_hmac(headers, body, TEST_KEY, _now=now)


class TestSignHmacHeaders:
    """`sign_hmac_headers` is the client half of the contract `verify_hmac`
    enforces. Both call `auth._signed_string`, so these tests pin the shared
    definition directly rather than only through a publisher (PRD #3048, PR 3)."""

    def test_signed_headers_verify(self):
        body = b'{"source_system":"plc_bridge","tags":[]}'
        headers = auth.sign_hmac_headers(TEST_TENANT, body, TEST_KEY)
        assert auth.verify_hmac(headers, body, TEST_KEY) == TEST_TENANT

    def test_signature_matches_the_independently_computed_value(self):
        """Recomputed from the documented signed string, not from _signed_string
        — so a change to the shared helper cannot silently redefine the contract
        and keep both sides agreeing on something new."""
        body = b"payload"
        headers = auth.sign_hmac_headers(
            TEST_TENANT, body, TEST_KEY, _nonce="fixed-nonce", _now=1_700_000_000
        )
        expected = _make_signature(TEST_TENANT, "fixed-nonce", 1_700_000_000, body)
        assert headers["X-MIRA-Signature"] == expected
        assert headers["X-MIRA-Nonce"] == "fixed-nonce"
        assert headers["X-MIRA-Timestamp"] == "1700000000"
        assert headers["X-MIRA-Tenant"] == TEST_TENANT

    def test_a_tampered_body_fails_verification(self):
        body = b"payload"
        headers = auth.sign_hmac_headers(TEST_TENANT, body, TEST_KEY)
        with pytest.raises(ValueError, match="signature_mismatch"):
            auth.verify_hmac(headers, body + b"!", TEST_KEY)

    def test_a_different_key_fails_verification(self):
        body = b"payload"
        headers = auth.sign_hmac_headers(TEST_TENANT, body, "some-other-key")
        with pytest.raises(ValueError, match="signature_mismatch"):
            auth.verify_hmac(headers, body, TEST_KEY)

    def test_nonces_are_unique_so_signing_twice_is_not_a_replay(self):
        body = b"payload"
        first = auth.sign_hmac_headers(TEST_TENANT, body, TEST_KEY)
        second = auth.sign_hmac_headers(TEST_TENANT, body, TEST_KEY)
        assert first["X-MIRA-Nonce"] != second["X-MIRA-Nonce"]
        assert auth.verify_hmac(first, body, TEST_KEY) == TEST_TENANT
        assert auth.verify_hmac(second, body, TEST_KEY) == TEST_TENANT

    def test_the_key_never_appears_in_the_headers(self):
        headers = auth.sign_hmac_headers(TEST_TENANT, b"payload", TEST_KEY)
        assert TEST_KEY not in json.dumps(headers)
