"""TDD for mira-relay/tools/sign_and_post.py — written BEFORE the implementation.

The whole point of the smoke client is that its signer and the relay's real
verifier (auth.verify_hmac) agree. This test proves that with zero network
I/O: build a signed request with `build_signed_request`, then feed the exact
body bytes + headers to `auth.verify_hmac` and assert it accepts them (and
correctly rejects tampering / wrong keys). It also proves the CLI's
--dry-run path never prints the raw HMAC key.
"""

from __future__ import annotations

import pytest

import auth
from tools.sign_and_post import _coerce_value, build_signed_request, main

TEST_KEY = "test-key-for-sign-and-post"
TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe"


# ── sign-then-verify (the core proof) ───────────────────────────────────────


def test_signed_request_verifies_against_the_real_auth_module():
    body_bytes, headers = build_signed_request(
        tenant_id=TENANT,
        key=TEST_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        value_type="float",
        quality="good",
        source_system="ignition",
    )
    tenant = auth.verify_hmac(headers, body_bytes, TEST_KEY)
    assert tenant == TENANT


def test_tampered_body_fails_verification():
    body_bytes, headers = build_signed_request(
        tenant_id=TENANT,
        key=TEST_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        value_type="float",
    )
    tampered = body_bytes.replace(b"60.0", b"99.9")
    with pytest.raises(ValueError, match="signature_mismatch"):
        auth.verify_hmac(headers, tampered, TEST_KEY)


def test_wrong_key_fails_verification():
    body_bytes, headers = build_signed_request(
        tenant_id=TENANT,
        key=TEST_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
    )
    with pytest.raises(ValueError, match="signature_mismatch"):
        auth.verify_hmac(headers, body_bytes, "a-different-key")


def test_stale_timestamp_fails_verification():
    body_bytes, headers = build_signed_request(
        tenant_id=TENANT,
        key=TEST_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        timestamp=1,  # 1970 — way outside the 300s skew window
    )
    with pytest.raises(ValueError, match="bad_timestamp"):
        auth.verify_hmac(headers, body_bytes, TEST_KEY)


# ── body shape ───────────────────────────────────────────────────────────


def test_body_is_the_canonical_ingest_batch_shape_and_omits_tenant():
    import json

    body_bytes, headers = build_signed_request(
        tenant_id=TENANT,
        key=TEST_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        value_type="float",
        source_connection_id="gw-1",
    )
    payload = json.loads(body_bytes)
    assert payload["source_system"] == "ignition"
    assert payload["tags"] == [
        {"tag_path": "[default]Conveyor/VFD_Hz", "value": 60.0, "value_type": "float", "quality": "good"}
    ]
    assert payload["source_connection_id"] == "gw-1"
    # HMAC mode: X-MIRA-Tenant header is authoritative, tenant_id omitted from body.
    assert "tenant_id" not in payload
    assert headers["X-MIRA-Tenant"] == TENANT


def test_headers_have_all_four_required_fields():
    _body, headers = build_signed_request(
        tenant_id=TENANT, key=TEST_KEY, tag_path="[default]Conveyor/VFD_Hz", value=60.0
    )
    for h in ("X-MIRA-Tenant", "X-MIRA-Nonce", "X-MIRA-Timestamp", "X-MIRA-Signature"):
        assert headers[h]


# ── value coercion ───────────────────────────────────────────────────────


def test_coerce_value_bool_int_float_string():
    assert _coerce_value("true", "bool") is True
    assert _coerce_value("0", "bool") is False
    assert _coerce_value("42", "int") == 42
    assert _coerce_value("3.14", "float") == 3.14
    assert _coerce_value("hello", "string") == "hello"


# ── CLI: --dry-run never prints the key ─────────────────────────────────


def test_dry_run_prints_body_and_headers_but_never_the_key(monkeypatch, capsys):
    monkeypatch.setenv("MIRA_TEST_HMAC_KEY", TEST_KEY)
    exit_code = main(
        [
            "--url", "https://example.invalid/api/v1/tags/ingest",
            "--tenant", TENANT,
            "--key-env", "MIRA_TEST_HMAC_KEY",
            "--tag", "[default]Conveyor/VFD_Hz",
            "--value", "60.0",
            "--value-type", "float",
            "--dry-run",
        ]
    )
    assert exit_code == 0
    out = capsys.readouterr().out
    assert TEST_KEY not in out
    assert "X-MIRA-Signature" in out
    assert TENANT in out


def test_missing_key_env_errors_without_crashing(monkeypatch, capsys):
    monkeypatch.delenv("MIRA_MISSING_KEY_XYZ", raising=False)
    exit_code = main(
        [
            "--url", "https://example.invalid/api/v1/tags/ingest",
            "--tenant", TENANT,
            "--key-env", "MIRA_MISSING_KEY_XYZ",
            "--tag", "[default]Conveyor/VFD_Hz",
            "--value", "60.0",
            "--dry-run",
        ]
    )
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "MIRA_MISSING_KEY_XYZ" in err
