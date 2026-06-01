# tests/ignition/test_chat_signing.py
# Pytest suite for the MIRA Ignition HMAC signing helper.
# Tests the pure signing logic in isolation from all Ignition I/O.
# Run: cd /Users/charlienode/MIRA && python3 -m pytest tests/ignition/test_chat_signing.py -v

import sys
import os

# Ensure the signing module (sibling of doPost.py) is importable from Python 3 pytest
sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "../../ignition/webdev/FactoryLM/api/chat"
    )
)

import hashlib
import hmac as hmaclib
import pytest

from signing import sign_request, build_headers


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

KEY = "test-secret-key-abc123"
TENANT = "tenant-uuid-0000-0001"
NONCE = "aabbccddeeff00112233445566778899"
TIMESTAMP = 1748720000
BODY = b'{"query":"why did conveyor stop","asset_id":"conv_b16"}'


def _expected_sig(key, tenant, nonce, ts, body):
    body_hash = hashlib.sha256(body).hexdigest()
    signed_string = "%s\n%s\n%s\n%s" % (tenant, nonce, str(ts), body_hash)
    return hmaclib.new(
        key.encode("utf-8"),
        signed_string.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


# ---------------------------------------------------------------------------
# Determinism tests
# ---------------------------------------------------------------------------

def test_same_inputs_same_signature():
    """Identical inputs must always produce the same signature."""
    sig1 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    sig2 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    assert sig1 == sig2


def test_signature_matches_manual_computation():
    """Output must match an independently computed reference digest."""
    expected = _expected_sig(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    actual = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    assert actual == expected


def test_signature_is_lowercase_hex():
    """Signature must be a lowercase hex string of length 64 (SHA-256)."""
    sig = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    assert len(sig) == 64
    assert sig == sig.lower()
    assert all(c in "0123456789abcdef" for c in sig)


# ---------------------------------------------------------------------------
# Sensitivity tests — each dimension must change the signature
# ---------------------------------------------------------------------------

def test_different_nonce_different_signature():
    sig1 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    sig2 = sign_request(KEY, TENANT, "ff" * 16, TIMESTAMP, BODY)
    assert sig1 != sig2


def test_different_body_different_signature():
    sig1 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    sig2 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, b'{"query":"different question"}')
    assert sig1 != sig2


def test_different_timestamp_different_signature():
    sig1 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    sig2 = sign_request(KEY, TENANT, NONCE, TIMESTAMP + 1, BODY)
    assert sig1 != sig2


def test_different_tenant_different_signature():
    sig1 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    sig2 = sign_request(KEY, "other-tenant-uuid", NONCE, TIMESTAMP, BODY)
    assert sig1 != sig2


def test_different_key_different_signature():
    sig1 = sign_request(KEY, TENANT, NONCE, TIMESTAMP, BODY)
    sig2 = sign_request("different-key", TENANT, NONCE, TIMESTAMP, BODY)
    assert sig1 != sig2


# ---------------------------------------------------------------------------
# Fail-closed: empty key must raise ValueError
# ---------------------------------------------------------------------------

def test_empty_key_raises_value_error():
    with pytest.raises(ValueError):
        sign_request("", TENANT, NONCE, TIMESTAMP, BODY)


def test_none_key_raises_value_error():
    with pytest.raises(ValueError):
        sign_request(None, TENANT, NONCE, TIMESTAMP, BODY)


def test_build_headers_empty_key_raises_value_error():
    with pytest.raises(ValueError):
        build_headers("", TENANT, BODY)


# ---------------------------------------------------------------------------
# build_headers smoke tests
# ---------------------------------------------------------------------------

def test_build_headers_returns_required_fields():
    """All five MIRA auth headers must be present and non-empty."""
    hdrs = build_headers(KEY, TENANT, BODY)
    for field in ("Content-Type", "X-MIRA-Tenant", "X-MIRA-Nonce",
                  "X-MIRA-Timestamp", "X-MIRA-Signature"):
        assert field in hdrs, "Missing header: %s" % field
        assert hdrs[field], "Header %s is empty" % field


def test_build_headers_nonce_is_32_hex_chars():
    hdrs = build_headers(KEY, TENANT, BODY)
    nonce = hdrs["X-MIRA-Nonce"]
    assert len(nonce) == 32
    assert all(c in "0123456789abcdef" for c in nonce)


def test_build_headers_two_calls_different_nonces():
    """Every call generates a fresh nonce — no static nonce reuse."""
    hdrs1 = build_headers(KEY, TENANT, BODY)
    hdrs2 = build_headers(KEY, TENANT, BODY)
    assert hdrs1["X-MIRA-Nonce"] != hdrs2["X-MIRA-Nonce"]


def test_build_headers_signature_verifiable():
    """The signature in build_headers output must verify correctly."""
    hdrs = build_headers(KEY, TENANT, BODY)
    expected = _expected_sig(
        KEY,
        hdrs["X-MIRA-Tenant"],
        hdrs["X-MIRA-Nonce"],
        int(hdrs["X-MIRA-Timestamp"]),
        BODY
    )
    assert hdrs["X-MIRA-Signature"] == expected


def test_build_headers_tenant_propagated():
    hdrs = build_headers(KEY, TENANT, BODY)
    assert hdrs["X-MIRA-Tenant"] == TENANT
