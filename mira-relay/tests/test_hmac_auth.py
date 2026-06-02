"""Tests for HMAC + nonce replay-protection auth (relay_server D4 / §4.3).

Signing contract (must match relay_server._check_hmac):
    message = nonce.encode() + b"." + raw_body_bytes
    signature = hmac.new(key.encode(), message, sha256).hexdigest()

All tests are offline — no live relay server or DB needed.
"""
from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from starlette.testclient import TestClient

import relay_server

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

_TEST_KEY = "test-hmac-signing-key-abc123"
_TEST_TENANT = "test-tenant-hmac"


def _make_payload(tenant_id: str = _TEST_TENANT) -> dict:
    return {
        "type": "tags",
        "tenant_id": tenant_id,
        "agent_id": "ignition-test",
        "equipment": {
            "VFD-001": {
                "outputFrequency": {"v": 42.1, "q": "Good", "t": "2026-06-01 10:00:00"},
            }
        },
    }


def _sign(body_bytes: bytes, key: str, nonce: str) -> str:
    """Compute HMAC-SHA256 over nonce + "." + body."""
    message = nonce.encode() + b"." + body_bytes
    return hmac.new(key.encode(), message, hashlib.sha256).hexdigest()


def _signed_post(
    client: TestClient,
    payload: dict,
    *,
    key: str = _TEST_KEY,
    tenant_id: str = _TEST_TENANT,
    nonce: str = "nonce-001",
    tamper_body: bool = False,
    tamper_sig: bool = False,
    override_nonce_in_header: str | None = None,
) -> TestClient:
    """Sign a payload and POST it, with optional tampering for negative tests."""
    body = json.dumps(payload).encode()
    if tamper_body:
        # Mutate the bytes after signing — signature was computed on original
        body_to_sign = body
        body = body.replace(b"42.1", b"99.9")
    else:
        body_to_sign = body

    sig = _sign(body_to_sign, key, nonce)
    if tamper_sig:
        sig = sig[:-4] + "0000"

    header_nonce = override_nonce_in_header if override_nonce_in_header is not None else nonce

    return client.post(
        "/ingest",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-MIRA-Tenant": tenant_id,
            "X-MIRA-Nonce": header_nonce,
            "X-MIRA-Signature": sig,
        },
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client_hmac(monkeypatch):
    """Client with HMAC key configured + legacy bearer ON (default)."""
    monkeypatch.setenv(f"MIRA_HMAC_KEY_{_TEST_TENANT.upper().replace('-', '_')}", _TEST_KEY)
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
    # Reset nonce store between tests
    relay_server._seen_nonces.clear()
    return TestClient(relay_server.app)


@pytest.fixture
def client_hmac_strict(monkeypatch):
    """Client with HMAC key + legacy bearer OFF (strict HMAC-only mode)."""
    monkeypatch.setenv(f"MIRA_HMAC_KEY_{_TEST_TENANT.upper().replace('-', '_')}", _TEST_KEY)
    monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
    relay_server._seen_nonces.clear()
    return TestClient(relay_server.app)


# ---------------------------------------------------------------------------
# HMAC auth tests
# ---------------------------------------------------------------------------

class TestHmacValid:
    def test_valid_signature_passes(self, client_hmac, _tmp_db):
        """A correctly-signed request is accepted."""
        payload = _make_payload()
        resp = _signed_post(client_hmac, payload)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_valid_signature_processes_tags(self, client_hmac, _tmp_db):
        """Tags are stored in SQLite after a valid HMAC request."""
        import sqlite3
        payload = _make_payload()
        _signed_post(client_hmac, payload)
        db = sqlite3.connect(_tmp_db)
        row = db.execute("SELECT COUNT(*) FROM equipment_status WHERE equipment_id='VFD-001'").fetchone()
        db.close()
        assert row[0] == 1


class TestHmacBadSignature:
    def test_tampered_body_rejected(self, client_hmac, _tmp_db):
        """Body modified after signing → 401 (sig over original, different bytes sent)."""
        payload = _make_payload()
        resp = _signed_post(client_hmac, payload, tamper_body=True)
        assert resp.status_code == 401

    def test_wrong_key_rejected(self, client_hmac, _tmp_db):
        """Signature computed with wrong key → 401."""
        payload = _make_payload()
        resp = _signed_post(client_hmac, payload, key="wrong-key")
        assert resp.status_code == 401

    def test_corrupted_signature_rejected(self, client_hmac, _tmp_db):
        """Signature hex value mangled → 401."""
        payload = _make_payload()
        resp = _signed_post(client_hmac, payload, tamper_sig=True)
        assert resp.status_code == 401

    def test_missing_signature_header_with_hmac_strict(self, client_hmac_strict, _tmp_db):
        """No signature + strict mode → 401 (not silently accepted)."""
        payload = _make_payload()
        body = json.dumps(payload).encode()
        resp = client_hmac_strict.post(
            "/ingest",
            content=body,
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 401

    def test_nonce_bound_to_signature(self, client_hmac, _tmp_db):
        """Valid sig for nonce-A, sent with different nonce-B in header → 401.

        This proves the nonce is bound into the HMAC.  If the sig covered only
        the body, a fresh nonce with a valid body-sig would be accepted — that's
        the replay-via-nonce-swap vulnerability that §4.3 prevents.
        """
        payload = _make_payload()
        # Sign with nonce "correct-nonce", send header "different-nonce"
        resp = _signed_post(
            client_hmac,
            payload,
            nonce="correct-nonce",
            override_nonce_in_header="different-nonce",
        )
        assert resp.status_code == 401


class TestNonceReplay:
    def test_replayed_nonce_rejected(self, client_hmac, _tmp_db):
        """Same nonce used twice (even with valid sig) → second call returns 409."""
        payload = _make_payload()
        resp1 = _signed_post(client_hmac, payload, nonce="nonce-replay-test")
        assert resp1.status_code == 200

        # Re-sign with same nonce (different nonce would be a new request)
        resp2 = _signed_post(client_hmac, payload, nonce="nonce-replay-test")
        assert resp2.status_code == 409
        assert "replayed" in resp2.json()["error"]

    def test_different_nonces_both_accepted(self, client_hmac, _tmp_db):
        """Two requests with distinct nonces are both accepted."""
        payload = _make_payload()
        resp1 = _signed_post(client_hmac, payload, nonce="nonce-001-unique")
        resp2 = _signed_post(client_hmac, payload, nonce="nonce-002-unique")
        assert resp1.status_code == 200
        assert resp2.status_code == 200

    def test_nonce_scope_is_per_tenant(self, client_hmac, monkeypatch, _tmp_db):
        """Nonce 'xyz' accepted for tenant A and tenant B independently."""
        # Register key for a second tenant
        monkeypatch.setenv("MIRA_HMAC_KEY_TENANT_B", _TEST_KEY)
        relay_server._seen_nonces.clear()

        payload_a = _make_payload(tenant_id=_TEST_TENANT)
        payload_b = _make_payload(tenant_id="tenant-b")

        resp_a = _signed_post(client_hmac, payload_a, tenant_id=_TEST_TENANT, nonce="shared-nonce")
        resp_b = _signed_post(client_hmac, payload_b, tenant_id="tenant-b", nonce="shared-nonce")

        assert resp_a.status_code == 200
        assert resp_b.status_code == 200


class TestLegacyBearerBackcompat:
    """RELAY_LEGACY_BEARER=1 (default) — bearer-only clients still work."""

    def test_bearer_passes_with_legacy_on(self, _tmp_db, monkeypatch):
        """Valid bearer token accepted when RELAY_LEGACY_BEARER is True."""
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "bench-key-xyz")
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        payload = _make_payload()
        resp = client.post(
            "/ingest",
            json=payload,
            headers={"Authorization": "Bearer bench-key-xyz"},
        )
        assert resp.status_code == 200

    def test_no_auth_passes_when_key_empty_legacy_on(self, _tmp_db, monkeypatch):
        """Empty RELAY_API_KEY + legacy mode → allow (existing bench behaviour)."""
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "")
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        resp = client.post("/ingest", json=_make_payload())
        assert resp.status_code == 200

    def test_wrong_bearer_rejected_legacy_on(self, _tmp_db, monkeypatch):
        """Wrong bearer token rejected even in legacy mode."""
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "bench-key-xyz")
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        resp = client.post(
            "/ingest",
            json=_make_payload(),
            headers={"Authorization": "Bearer wrong-key"},
        )
        assert resp.status_code == 401

    def test_unsigned_rejected_with_legacy_off(self, _tmp_db, monkeypatch):
        """No HMAC headers + RELAY_LEGACY_BEARER=False → 401."""
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "bench-key-xyz")
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", False)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        resp = client.post("/ingest", json=_make_payload())
        assert resp.status_code == 401


class TestHmacKeyResolution:
    def test_per_tenant_key_takes_priority(self, _tmp_db, monkeypatch):
        """Per-tenant MIRA_HMAC_KEY_<TENANT> is used when set."""
        per_tenant_key = "per-tenant-specific-key"
        env_var = "MIRA_HMAC_KEY_%s" % _TEST_TENANT.upper().replace("-", "_")
        monkeypatch.setenv(env_var, per_tenant_key)
        monkeypatch.setenv("MIRA_HMAC_KEY", "shared-fallback-key")
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        payload = _make_payload()
        resp = _signed_post(client, payload, key=per_tenant_key)
        assert resp.status_code == 200

        # Shared key must NOT work when per-tenant key is set
        resp2 = _signed_post(client, payload, key="shared-fallback-key", nonce="nonce-fallback")
        assert resp2.status_code == 401

    def test_shared_fallback_key_used_when_no_per_tenant(self, _tmp_db, monkeypatch):
        """MIRA_HMAC_KEY fallback used when no per-tenant key configured."""
        fallback_key = "shared-fallback-key-only"
        monkeypatch.setenv("MIRA_HMAC_KEY", fallback_key)
        # Ensure no per-tenant key leaks from environment
        env_var = "MIRA_HMAC_KEY_%s" % _TEST_TENANT.upper().replace("-", "_")
        monkeypatch.delenv(env_var, raising=False)
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        payload = _make_payload()
        resp = _signed_post(client, payload, key=fallback_key)
        assert resp.status_code == 200

    def test_no_key_configured_rejects_signed_request(self, _tmp_db, monkeypatch):
        """If neither per-tenant nor shared key is configured, HMAC header → 401."""
        env_var = "MIRA_HMAC_KEY_%s" % _TEST_TENANT.upper().replace("-", "_")
        monkeypatch.delenv(env_var, raising=False)
        monkeypatch.delenv("MIRA_HMAC_KEY", raising=False)
        monkeypatch.setattr(relay_server, "RELAY_LEGACY_BEARER", True)
        relay_server._seen_nonces.clear()
        client = TestClient(relay_server.app)

        payload = _make_payload()
        resp = _signed_post(client, payload, key=_TEST_KEY)
        assert resp.status_code == 401
