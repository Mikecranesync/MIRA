from __future__ import annotations

import base64
import inspect
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from factorylm_ai.finetune import (
    ACTION_CREATE_FINETUNE_JOB,
    PaidAuthorizationLedger,
    PaidAuthorizationRejected,
    PaidEventAuthorization,
)
from factorylm_ai.providers import together as together_module
from factorylm_ai.providers.paid_authorization_guard import (
    SIGNED_AUTHORIZATION_SCHEMA_VERSION,
    TrustedPaidAuthorizationVerifier,
)

_SIGNATURE_DOMAIN = b"factorylm-paid-authorization-v1\x00"


def _authorization(**changes: Any) -> PaidEventAuthorization:
    now = datetime.now(UTC)
    values: dict[str, Any] = {
        "authorization_id": "auth-signed-1",
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
        "receipt_ref": "registry:auth-signed-1",
        "single_use": True,
        "used_at": None,
    }
    values.update(changes)
    return PaidEventAuthorization(**values)


def _signed_record(
    authorization: PaidEventAuthorization,
    private_key: Ed25519PrivateKey,
) -> dict[str, Any]:
    payload = authorization.trusted_receipt_dict()
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("utf-8")
    signature = private_key.sign(_SIGNATURE_DOMAIN + canonical)
    return {
        "schema_version": SIGNED_AUTHORIZATION_SCHEMA_VERSION,
        "key_id": "mike-offline-v1",
        "authorization": payload,
        "signature": base64.b64encode(signature).decode("ascii"),
    }


def _write_registry(path: Path, *records: dict[str, Any]) -> None:
    path.write_text(
        "".join(json.dumps(record, sort_keys=True) + "\n" for record in records),
        encoding="utf-8",
    )


def _verifier(
    tmp_path: Path,
    private_key: Ed25519PrivateKey,
) -> TrustedPaidAuthorizationVerifier:
    public_key = private_key.public_key()
    return TrustedPaidAuthorizationVerifier(
        registry_path=tmp_path / "signed-authorizations.jsonl",
        ledger_path=tmp_path / "paid-authorizations.jsonl",
        public_key=public_key,
        expected_key_id="mike-offline-v1",
    )


def _consume(
    verifier: TrustedPaidAuthorizationVerifier,
    authorization: PaidEventAuthorization,
):
    return verifier.verify_and_consume(
        authorization,
        request_hash=authorization.request_hash,
        provider=authorization.provider,
        action=authorization.action,
        max_approved_cost=authorization.spend_cap_usd,
        currency=authorization.currency,
        consumer_ref="test:consumer",
    )


class _FakeVerifier:
    def verify_and_consume(self, *args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a caller-controlled verifier must never run")


@pytest.mark.asyncio
async def test_create_finetune_rejects_caller_injected_verifier() -> None:
    assert "authorization_verifier" not in inspect.signature(
        together_module.create_finetune_job
    ).parameters
    with pytest.raises(PaidAuthorizationRejected, match="caller-supplied"):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="fixture",
            budget=object(),
            est_training_tokens=1,
            authorization_verifier=_FakeVerifier(),
        )


@pytest.mark.asyncio
async def test_endpoint_benchmark_rejects_caller_injected_verifier() -> None:
    assert "authorization_verifier" not in inspect.signature(
        together_module.run_temporary_endpoint_benchmark
    ).parameters
    with pytest.raises(PaidAuthorizationRejected, match="caller-supplied"):
        await together_module.run_temporary_endpoint_benchmark(
            {"model": "fixture", "inactive_timeout": 60},
            lambda _: None,
            budget=object(),
            est_endpoint_usd=1.0,
            authorization_verifier=_FakeVerifier(),
        )


def test_self_minted_ledger_record_is_not_trusted(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    authorization = _authorization()
    ledger = PaidAuthorizationLedger(tmp_path / "paid-authorizations.jsonl")
    ledger.record_authorized(authorization)
    (tmp_path / "signed-authorizations.jsonl").write_text("", encoding="utf-8")

    verifier = _verifier(tmp_path, private_key)
    with pytest.raises(PaidAuthorizationRejected, match="unknown signed approval"):
        _consume(verifier, authorization)

    assert ledger.authorization_state(authorization.authorization_id)["event"] == "authorized"


def test_unsigned_registry_record_is_rejected(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    authorization = _authorization()
    _write_registry(
        tmp_path / "signed-authorizations.jsonl",
        {
            "schema_version": SIGNED_AUTHORIZATION_SCHEMA_VERSION,
            "key_id": "mike-offline-v1",
            "authorization": authorization.trusted_receipt_dict(),
        },
    )

    with pytest.raises(PaidAuthorizationRejected, match="missing operator signature"):
        _consume(_verifier(tmp_path, private_key), authorization)


def test_signed_receipt_is_request_bound_and_single_use(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    authorization = _authorization()
    _write_registry(
        tmp_path / "signed-authorizations.jsonl",
        _signed_record(authorization, private_key),
    )
    verifier = _verifier(tmp_path, private_key)

    state = _consume(verifier, authorization)
    assert state.trusted is True
    assert state.consumed is True
    assert state.request_hash == authorization.request_hash
    assert "signature" not in json.dumps(state.to_dict()).lower()
    assert "private" not in json.dumps(state.to_dict()).lower()

    with pytest.raises(PaidAuthorizationRejected, match="already consumed"):
        _consume(verifier, authorization)


def test_altered_signed_field_is_rejected(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    authorization = _authorization()
    _write_registry(
        tmp_path / "signed-authorizations.jsonl",
        _signed_record(authorization, private_key),
    )
    altered = replace(authorization, model="attacker/model")

    with pytest.raises(PaidAuthorizationRejected, match="conflicting signed-registry payload"):
        _consume(_verifier(tmp_path, private_key), altered)


def test_signed_receipt_remains_revocable(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    authorization = _authorization()
    _write_registry(
        tmp_path / "signed-authorizations.jsonl",
        _signed_record(authorization, private_key),
    )
    verifier = _verifier(tmp_path, private_key)
    verifier.ledger.record_revoked(authorization.authorization_id, reason="operator revoked")

    with pytest.raises(PaidAuthorizationRejected, match="revoked"):
        _consume(verifier, authorization)


def test_signed_receipt_consumption_is_atomic(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    authorization = _authorization()
    _write_registry(
        tmp_path / "signed-authorizations.jsonl",
        _signed_record(authorization, private_key),
    )
    verifier = _verifier(tmp_path, private_key)

    def attempt() -> str:
        try:
            _consume(verifier, authorization)
            return "consumed"
        except PaidAuthorizationRejected:
            return "rejected"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))

    assert sorted(results) == ["consumed", "rejected"]


def test_runtime_needs_only_public_key_material(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = Ed25519PrivateKey.generate()
    public_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    monkeypatch.setenv(
        "FACTORYLM_AI_PAID_AUTH_PUBLIC_KEY_B64",
        base64.b64encode(public_raw).decode("ascii"),
    )
    monkeypatch.setenv(
        "FACTORYLM_AI_PAID_AUTH_REGISTRY",
        str(tmp_path / "signed-authorizations.jsonl"),
    )
    monkeypatch.setenv(
        "FACTORYLM_AI_PAID_AUTH_LEDGER",
        str(tmp_path / "paid-authorizations.jsonl"),
    )
    monkeypatch.setenv("FACTORYLM_AI_PAID_AUTH_KEY_ID", "mike-offline-v1")

    verifier = TrustedPaidAuthorizationVerifier.from_environment()
    assert verifier.expected_key_id == "mike-offline-v1"
    assert not hasattr(verifier, "private_key")
