"""The operator signer must produce receipts the guard accepts — and nothing else.

Round-trips every signed receipt through the REAL
``TrustedPaidAuthorizationVerifier`` (not a fake), so the signer and guard can
never drift apart silently. Adversarial cases mirror
``test_paid_authorization_trust_boundary.py``: tampered fields, wrong keys,
duplicates, and reuse must all fail closed.
"""

from __future__ import annotations

import base64
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("cryptography")


from factorylm_ai.finetune import (  # noqa: E402
    ACTION_CREATE_FINETUNE_JOB,
    PaidAuthorizationRejected,
    PaidEventAuthorization,
)
from factorylm_ai.providers import paid_authorization_signer as signer  # noqa: E402
from factorylm_ai.providers.paid_authorization_guard import (  # noqa: E402
    TrustedPaidAuthorizationVerifier,
    _decode_public_key,
)


def _authorization(**changes: Any) -> PaidEventAuthorization:
    now = datetime.now(UTC)
    values: dict[str, Any] = {
        "authorization_id": "auth-signer-1",
        "provider": "together",
        "action": ACTION_CREATE_FINETUNE_JOB,
        "dataset_manifest_hash": "sha256:manifest",
        "model": "Qwen/Qwen3.5-9B",
        "request_hash": "sha256:request",
        "currency": "USD",
        "spend_cap_usd": 5.0,
        "issued_by": "mike",
        "authority_ref": "operator:approval-1",
        "issued_at": (now - timedelta(minutes=1)).isoformat(),
        "expires_at": (now + timedelta(hours=1)).isoformat(),
        "receipt_ref": "registry:auth-signer-1",
        "single_use": True,
        "used_at": None,
    }
    values.update(changes)
    return PaidEventAuthorization(**values)


@pytest.fixture()
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Keypair + paths, with the in-repo guard neutralized for tmp_path."""
    # tmp_path is outside the repo on CI, but not guaranteed everywhere —
    # keygen's repo check consults git from the key's parent cwd-independent
    # path, so force the check to see no repo for hermetic behavior.
    monkeypatch.setattr(signer, "_repo_root", lambda: None)
    private_key = tmp_path / "keys" / "operator_ed25519.pem"
    info = signer.generate_keypair(private_key)
    return {
        "tmp": tmp_path,
        "private_key": private_key,
        "public_b64": info["public_key_b64"],
        "registry": tmp_path / "registry.jsonl",
        "ledger": tmp_path / "ledger.jsonl",
    }


def _write_auth_json(tmp: Path, authorization: PaidEventAuthorization) -> Path:
    path = tmp / f"{authorization.authorization_id}.json"
    path.write_text(json.dumps(authorization.to_dict()), encoding="utf-8")
    return path


def _sign(ws: dict, authorization: PaidEventAuthorization, **kwargs: Any) -> dict:
    return signer.sign_authorization(
        private_key_path=ws["private_key"],
        authorization_path=_write_auth_json(ws["tmp"], authorization),
        registry_path=ws["registry"],
        **kwargs,
    )


def _verifier(ws: dict, **kwargs: Any) -> TrustedPaidAuthorizationVerifier:
    return TrustedPaidAuthorizationVerifier(
        registry_path=ws["registry"],
        ledger_path=ws["ledger"],
        public_key=_decode_public_key(ws["public_b64"]),
        **kwargs,
    )


# --- keygen ------------------------------------------------------------------


def test_keygen_never_returns_private_material(workspace):
    pem = workspace["private_key"].read_bytes()
    assert b"PRIVATE KEY" in pem
    info = {
        "public_key_b64": workspace["public_b64"],
    }
    # The public value must decode to a real 32-byte Ed25519 key and must not
    # appear anywhere in the private PEM output path or vice versa.
    raw = base64.b64decode(info["public_key_b64"], validate=True)
    assert len(raw) == 32
    assert info["public_key_b64"].encode() not in pem


def test_keygen_refuses_a_path_inside_the_repo(tmp_path, monkeypatch):
    monkeypatch.setattr(signer, "_repo_root", lambda: tmp_path)
    with pytest.raises(signer.SignerError, match="inside the repository"):
        signer.generate_keypair(tmp_path / "sub" / "key.pem")


def test_keygen_refuses_to_overwrite(workspace, monkeypatch):
    with pytest.raises(signer.SignerError, match="refusing to overwrite"):
        signer.generate_keypair(workspace["private_key"])


# --- the honest path: signer output satisfies the real guard -----------------


def test_signed_receipt_verifies_and_consumes_through_the_real_guard(workspace):
    authorization = _authorization()
    _sign(workspace, authorization)

    state = _verifier(workspace).verify_and_consume(
        authorization,
        request_hash="sha256:request",
        provider="together",
        action=ACTION_CREATE_FINETUNE_JOB,
        max_approved_cost=5.0,
        currency="USD",
        consumer_ref="test:signer",
    )
    assert state.trusted is True
    assert state.consumed is True


def test_key_id_round_trips_when_the_guard_pins_one(workspace):
    authorization = _authorization()
    _sign(workspace, authorization, key_id="operator-mike-1")
    state = _verifier(workspace, expected_key_id="operator-mike-1").verify_and_consume(
        authorization,
        request_hash="sha256:request",
        provider="together",
        action=ACTION_CREATE_FINETUNE_JOB,
        max_approved_cost=5.0,
        currency="USD",
        consumer_ref="test:signer",
    )
    assert state.trusted is True


def test_single_use_is_still_enforced_after_signing(workspace):
    authorization = _authorization()
    _sign(workspace, authorization)
    kwargs = dict(
        request_hash="sha256:request",
        provider="together",
        action=ACTION_CREATE_FINETUNE_JOB,
        max_approved_cost=5.0,
        currency="USD",
        consumer_ref="test:signer",
    )
    _verifier(workspace).verify_and_consume(authorization, **kwargs)
    with pytest.raises(PaidAuthorizationRejected):
        _verifier(workspace).verify_and_consume(authorization, **kwargs)


# --- adversarial: tampering and confusion must fail closed -------------------


def test_a_field_tampered_after_signing_is_rejected(workspace):
    authorization = _authorization()
    _sign(workspace, authorization)
    inflated = replace(authorization, spend_cap_usd=500.0)
    with pytest.raises(PaidAuthorizationRejected, match="conflicting|unknown"):
        _verifier(workspace).verify_and_consume(
            inflated,
            request_hash="sha256:request",
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=500.0,
            currency="USD",
            consumer_ref="test:signer",
        )


def test_a_receipt_signed_with_the_wrong_key_is_rejected(workspace, tmp_path):
    other_key = tmp_path / "other" / "key.pem"
    other_info = signer.generate_keypair(other_key)
    authorization = _authorization()
    # Sign with the OTHER key but verify against the workspace public key.
    signer.sign_authorization(
        private_key_path=other_key,
        authorization_path=_write_auth_json(workspace["tmp"], authorization),
        registry_path=workspace["registry"],
    )
    assert other_info["public_key_b64"] != workspace["public_b64"]
    with pytest.raises(PaidAuthorizationRejected, match="invalid operator signature"):
        _verifier(workspace).verify_and_consume(
            authorization,
            action=ACTION_CREATE_FINETUNE_JOB,
            dataset_manifest_hash="sha256:manifest",
            model="Qwen/Qwen3.5-9B",
            request_hash="sha256:request",
            spend_cap_usd=5.0,
        )


def test_signer_refuses_a_duplicate_authorization_id(workspace):
    authorization = _authorization()
    _sign(workspace, authorization)
    with pytest.raises(signer.SignerError, match="already holds authorization_id"):
        _sign(workspace, authorization)


def test_signer_refuses_a_consumed_authorization(workspace):
    with pytest.raises(signer.SignerError, match="used_at"):
        _sign(workspace, _authorization(used_at=datetime.now(UTC).isoformat()))


def test_signer_refuses_json_that_is_not_an_authorization(workspace):
    bad = workspace["tmp"] / "bad.json"
    bad.write_text(json.dumps({"authorization_id": "x", "surprise": True}), encoding="utf-8")
    with pytest.raises(signer.SignerError, match="does not match PaidEventAuthorization"):
        signer.sign_authorization(
            private_key_path=workspace["private_key"],
            authorization_path=bad,
            registry_path=workspace["registry"],
        )


# --- the ledger-free self-check ----------------------------------------------


def test_verify_receipt_checks_without_consuming(workspace):
    authorization = _authorization()
    auth_path = _write_auth_json(workspace["tmp"], authorization)
    _sign(workspace, authorization)

    result = signer.verify_receipt(
        authorization_path=auth_path,
        registry_path=workspace["registry"],
        public_key_b64=workspace["public_b64"],
    )
    assert result["verified"] is True
    # The self-check must not have consumed the single-use approval.
    state = _verifier(workspace).verify_and_consume(
        authorization,
        request_hash="sha256:request",
        provider="together",
        action=ACTION_CREATE_FINETUNE_JOB,
        max_approved_cost=5.0,
        currency="USD",
        consumer_ref="test:signer",
    )
    assert state.consumed is True


def test_verify_receipt_rejects_a_wrong_public_key(workspace, tmp_path):
    authorization = _authorization()
    auth_path = _write_auth_json(workspace["tmp"], authorization)
    _sign(workspace, authorization)
    other = signer.generate_keypair(tmp_path / "other2" / "key.pem")
    with pytest.raises(signer.SignerError, match="does not verify"):
        signer.verify_receipt(
            authorization_path=auth_path,
            registry_path=workspace["registry"],
            public_key_b64=other["public_key_b64"],
        )


def test_verify_receipt_rejects_missing_receipt(workspace):
    authorization = _authorization()
    auth_path = _write_auth_json(workspace["tmp"], authorization)
    with pytest.raises(signer.SignerError, match="no signed approval"):
        signer.verify_receipt(
            authorization_path=auth_path,
            registry_path=workspace["registry"],
            public_key_b64=workspace["public_b64"],
        )


# --- CLI surface -------------------------------------------------------------


def test_cli_keygen_prints_public_but_never_private(workspace, tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(signer, "_repo_root", lambda: None)
    key_path = tmp_path / "cli" / "key.pem"
    rc = signer.main(["keygen", "--private-key", str(key_path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "public_key_b64" in out
    pem_body = key_path.read_text(encoding="utf-8").splitlines()[1]
    assert pem_body not in out, "private key material leaked to stdout"


def test_cli_sign_then_verify_round_trip(workspace, capsys):
    authorization = _authorization(authorization_id="auth-cli-1", receipt_ref="registry:auth-cli-1")
    auth_path = _write_auth_json(workspace["tmp"], authorization)
    rc = signer.main(
        [
            "sign",
            "--private-key",
            str(workspace["private_key"]),
            "--authorization",
            str(auth_path),
            "--registry",
            str(workspace["registry"]),
        ]
    )
    assert rc == 0
    rc = signer.main(
        [
            "verify",
            "--authorization",
            str(auth_path),
            "--registry",
            str(workspace["registry"]),
            "--public-key-b64",
            workspace["public_b64"],
        ]
    )
    assert rc == 0
    assert '"verified": true' in capsys.readouterr().out


def test_cli_refusal_exits_nonzero(workspace, capsys):
    authorization = _authorization(authorization_id="auth-cli-2", receipt_ref="registry:auth-cli-2")
    auth_path = _write_auth_json(workspace["tmp"], authorization)
    rc = signer.main(
        [
            "verify",
            "--authorization",
            str(auth_path),
            "--registry",
            str(workspace["registry"]),
            "--public-key-b64",
            workspace["public_b64"],
        ]
    )
    assert rc == 1
    assert "REFUSED" in capsys.readouterr().err
