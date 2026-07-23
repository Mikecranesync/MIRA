"""PR 4 tests for governed Together fine-tune orchestration.

Hermetic: no real network, no upload, no job, no endpoint. Live-facing helpers are
exercised only with a fake AsyncClient after the repo network gate is explicitly
enabled in the test environment.
"""

from __future__ import annotations

import json
import inspect
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import pytest

from factorylm_ai.dataset.paid_gate import GateCheck, PaidGateReport, VERDICT_PASS
from factorylm_ai.budget import BudgetGuard
from factorylm_ai.finetune import (
    ACTION_CREATE_FINETUNE_JOB,
    ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
    CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION,
    CANONICAL_PAID_ACTION_REQUEST_SCHEMA_VERSION,
    TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION,
    CanonicalFineTuneRequest,
    FineTuneApprovalEvidence,
    PaidEventAuthorization,
    PaidAuthorizationLedger,
    PaidAuthorizationRejected,
    TogetherPriceEstimate,
    adapter_artifact_from_job,
    build_finetune_dry_run_preflight,
    canonical_finetune_request,
    canonical_paid_action_request_hash,
    count_jsonl_tokens,
)
from factorylm_ai.pricing import estimate_finetune_cost
from factorylm_ai.providers import together as together_module
from factorylm_ai.providers.together import EndpointCleanupError, PaidEventNotAuthorized
from factorylm_ai.registry import ArtifactRegistry
from factorylm_ai.schemas.validate import SchemaError


class _FakeTogetherClient:
    calls: list[dict[str, Any]] = []
    deleted_ids: set[str] = set()
    verify_delete_succeeds: bool = True
    delete_status: int = 204

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.calls = type(self).calls

    async def __aenter__(self) -> _FakeTogetherClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> httpx.Response:
        self.calls.append(
            {"method": "POST", "url": url, "headers": headers, "json": json, "data": data}
        )
        if url.endswith("/endpoints"):
            return httpx.Response(
                200,
                json={
                    "id": "endpoint-1",
                    "name": "factorylm/technician-v0",
                    "status": "READY",
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "ft-123",
                "status": "queued",
                "model": "Qwen/Qwen3.5-9B",
                "model_output_name": "factorylm/technician-v0",
            },
        )

    async def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        self.calls.append({"method": "GET", "url": url, "headers": headers, "params": params})
        if url.endswith("/events"):
            return httpx.Response(200, json={"data": [{"message": "queued"}]})
        if url.endswith("/checkpoints"):
            return httpx.Response(200, json={"data": [{"step": 10, "checkpoint_type": "adapter"}]})
        if url.endswith("/finetune/download"):
            return httpx.Response(200, content=b"checkpoint-bytes")
        if "/endpoints/" in url:
            endpoint_id = url.rsplit("/", 1)[-1]
            if endpoint_id in self.deleted_ids and self.verify_delete_succeeds:
                return httpx.Response(404, json={"error": {"message": "not found"}})
            return httpx.Response(
                200,
                json={
                    "id": endpoint_id,
                    "name": "factorylm/technician-v0",
                    "status": "READY",
                },
            )
        return httpx.Response(200, json={"id": "ft-123", "status": "completed"})

    async def delete(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        self.calls.append({"method": "DELETE", "url": url, "headers": headers})
        self.deleted_ids.add(url.rsplit("/", 1)[-1])
        return httpx.Response(self.delete_status, json={"error": {"message": "delete failed"}})


@pytest.fixture(autouse=True)
def _clear_fake_calls() -> None:
    _FakeTogetherClient.calls = []
    _FakeTogetherClient.deleted_ids = set()
    _FakeTogetherClient.verify_delete_succeeds = True
    _FakeTogetherClient.delete_status = 204


def _enable_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "fake-test-key")
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")


def _paid_gate_pass() -> PaidGateReport:
    return PaidGateReport(
        passed=True,
        verdict=VERDICT_PASS,
        checks=[GateCheck("fixture", True, "fixture")],
        evidence={
            "model_support": {
                "receipt_ref": "s3://receipts/model-support.json",
                "confirmed": True,
            }
        },
    )


def _authorization(
    *,
    authorization_id: str = "auth-123",
    action: str = ACTION_CREATE_FINETUNE_JOB,
    provider: str = "together",
    dataset_manifest_hash: str = "manifest-abc",
    model: str = "Qwen/Qwen3.5-9B",
    request_hash: str = "sha256:test-request",
    currency: str = "USD",
    spend_cap_usd: float = 5.0,
    issued_by: str = "mike",
    authority_ref: str = "mike:manual-approval",
    receipt_ref: str = "s3://receipts/paid-auth.json",
    expires_at: str = "2099-01-01T00:00:00+00:00",
    single_use: bool = True,
    used_at: str | None = None,
) -> PaidEventAuthorization:
    return PaidEventAuthorization(
        authorization_id=authorization_id,
        provider=provider,
        action=action,
        dataset_manifest_hash=dataset_manifest_hash,
        model=model,
        request_hash=request_hash,
        currency=currency,
        spend_cap_usd=spend_cap_usd,
        issued_by=issued_by,
        authority_ref=authority_ref,
        issued_at="2026-07-23T00:00:00+00:00",
        expires_at=expires_at,
        receipt_ref=receipt_ref,
        single_use=single_use,
        used_at=used_at,
    )


def _together_estimate(
    *,
    request_hash: str = "sha256:test-request",
    request_schema_version: str = CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION,
    provider: str = "together",
    total_price: float = 4.0,
    train_tokens: int = 100,
    eval_tokens: int = 0,
    allowed: bool = True,
    receipt_ref: str = "s3://receipts/together-estimate.json",
) -> TogetherPriceEstimate:
    return TogetherPriceEstimate(
        provider=provider,
        request_schema_version=request_schema_version,
        request_hash=request_hash,
        estimated_total_price=total_price,
        allowed_to_proceed=allowed,
        estimated_train_token_count=train_tokens,
        estimated_eval_token_count=eval_tokens,
        receipt_ref=receipt_ref,
        issued_at="2026-07-23T00:00:00+00:00",
        raw={"estimated_total_price": total_price, "allowed_to_proceed": allowed},
    )


def _approval(
    *,
    action: str = ACTION_CREATE_FINETUNE_JOB,
    dataset_manifest_hash: str = "manifest-abc",
    model: str = "Qwen/Qwen3.5-9B",
    request_hash: str = "sha256:test-request",
    spend_cap_usd: float = 5.0,
    authorization: PaidEventAuthorization | None = None,
    together_estimate: TogetherPriceEstimate | None = None,
) -> FineTuneApprovalEvidence:
    return FineTuneApprovalEvidence(
        paid_gate_report=_paid_gate_pass(),
        dataset_manifest_hash=dataset_manifest_hash,
        model_support_receipt_ref="s3://receipts/model-support.json",
        authorization=authorization
        or _authorization(
            action=action,
            dataset_manifest_hash=dataset_manifest_hash,
            model=model,
            request_hash=request_hash,
            spend_cap_usd=spend_cap_usd,
        ),
        local_estimate_usd=4.0,
        together_estimate=together_estimate or _together_estimate(request_hash=request_hash),
    )


def _canonical_request(
    *,
    training_file_id: str = "file-train",
    validation_file: str | None = "file-validation",
    model: str = "Qwen/Qwen3.5-9B",
    suffix: str = "technician-v0",
    n_epochs: int = 3,
    n_evals: int = 2,
    n_checkpoints: int | None = 4,
    seed: int | None = 42,
    train_on_inputs: bool | str | None = False,
    packing: bool | None = True,
    learning_rate: float | None = 2e-5,
    lora_r: int | None = 16,
    lora_alpha: int | None = 32,
    lora_dropout: float | None = 0.05,
    lora_trainable_modules: str | None = None,
    lora: bool = True,
    training_method: str = "sft",
) -> CanonicalFineTuneRequest:
    return canonical_finetune_request(
        training_file_id=training_file_id,
        validation_file=validation_file,
        model=model,
        suffix=suffix,
        n_epochs=n_epochs,
        n_evals=n_evals,
        n_checkpoints=n_checkpoints,
        seed=seed,
        train_on_inputs=train_on_inputs,
        packing=packing,
        learning_rate=learning_rate,
        lora_r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        lora_trainable_modules=lora_trainable_modules,
        lora=lora,
        training_method=training_method,
    )


def _trusted_ledger(
    tmp_path: Path, authorization: PaidEventAuthorization
) -> PaidAuthorizationLedger:
    ledger = PaidAuthorizationLedger(path=tmp_path / "paid-authorizations.jsonl")
    ledger.record_authorized(authorization)
    return ledger


def _ledger_rows(ledger: PaidAuthorizationLedger) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in ledger.path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _endpoint_payload() -> dict[str, Any]:
    return {
        "model": "factorylm/technician-v0",
        "name": "technician-v0",
        "inactive_timeout": 60,
    }


def _endpoint_auth(
    tmp_path: Path, payload: dict[str, Any]
) -> tuple[PaidEventAuthorization, PaidAuthorizationLedger]:
    request_hash = canonical_paid_action_request_hash(
        provider="together",
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        payload=payload,
    )
    auth = _authorization(
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        model=str(payload["model"]),
        request_hash=request_hash,
        spend_cap_usd=3.0,
    )
    return auth, _trusted_ledger(tmp_path, auth)


async def test_create_finetune_job_builds_pr4_payload_and_records_budget(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    guard = BudgetGuard(cap_usd=5.0)
    request = _canonical_request()
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)

    job = await together_module.create_finetune_job(
        "file-train",
        "Qwen/Qwen3.5-9B",
        suffix="technician-v0",
        budget=guard,
        est_training_tokens=500_000,
        dataset_manifest_hash="manifest-abc",
        approval_evidence=_approval(
            authorization=auth,
            request_hash=request.request_hash,
            together_estimate=_together_estimate(request_hash=request.request_hash),
        ),
        authorization_verifier=ledger,
        validation_file="file-validation",
        est_validation_tokens=50_000,
        n_epochs=3,
        n_evals=2,
        n_checkpoints=4,
        seed=42,
        train_on_inputs=False,
        packing=True,
        learning_rate=2e-5,
        lora_r=16,
        lora_alpha=32,
        lora_dropout=0.05,
    )

    assert job["id"] == "ft-123"
    assert guard.spent_usd == pytest.approx(4.0)
    assert ledger.authorization_state("auth-123")["event"] == "consumed"
    payload = _FakeTogetherClient.calls[0]["json"]
    assert payload == {
        "training_file": "file-train",
        "model": "Qwen/Qwen3.5-9B",
        "validation_file": "file-validation",
        "n_epochs": 3,
        "n_evals": 2,
        "n_checkpoints": 4,
        "packing": True,
        "suffix": "technician-v0",
        "learning_rate": 2e-5,
        "random_seed": 42,
        "training_method": {"method": "sft", "train_on_inputs": False},
        "training_type": {
            "type": "Lora",
            "lora_r": 16,
            "lora_alpha": 32,
            "lora_dropout": 0.05,
        },
    }


def test_canonical_finetune_request_is_deterministic_and_versioned() -> None:
    left = _canonical_request()
    right = _canonical_request()

    assert left.schema_version == CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION
    assert left.request_hash.startswith("sha256:")
    assert left.request_hash == right.request_hash
    assert left.canonical_json == right.canonical_json
    assert left.create_payload()["training_file"] == "file-train"


def test_canonical_paid_action_request_hash_is_versioned() -> None:
    payload = _endpoint_payload()
    first = canonical_paid_action_request_hash(
        provider="together",
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        payload=payload,
    )
    second = canonical_paid_action_request_hash(
        provider="together",
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        payload=dict(reversed(list(payload.items()))),
    )

    assert first.startswith("sha256:")
    assert first == second
    assert CANONICAL_PAID_ACTION_REQUEST_SCHEMA_VERSION


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("training_file_id", "file-train-b"),
        ("validation_file", None),
        ("model", "Qwen/Qwen2.5-7B-Instruct-Turbo"),
        ("suffix", "technician-v1"),
        ("n_epochs", 4),
        ("n_evals", 3),
        ("n_checkpoints", 2),
        ("seed", 7),
        ("train_on_inputs", True),
        ("packing", False),
        ("learning_rate", 3e-5),
        ("lora_r", 8),
        ("lora_alpha", 16),
        ("lora_dropout", 0.1),
        ("lora_trainable_modules", "q_proj,v_proj"),
        ("lora", False),
        ("training_method", "dpo"),
    ],
)
def test_changing_material_request_field_invalidates_hash(field: str, value: Any) -> None:
    baseline = _canonical_request()
    changed = _canonical_request(**{field: value})

    assert changed.request_hash != baseline.request_hash


def test_together_estimate_receipt_is_bound_to_request_hash() -> None:
    request_a = _canonical_request()
    request_b = _canonical_request(suffix="technician-v1")
    estimate = TogetherPriceEstimate.from_response(
        {
            "estimation_available": True,
            "estimated_total_price": 4.0,
            "allowed_to_proceed": True,
            "estimated_train_token_count": 100,
            "estimated_eval_token_count": 0,
        },
        receipt_ref="s3://receipts/together-estimate.json",
        request=request_a,
        issued_at="2026-07-23T00:00:00+00:00",
    )

    assert estimate.request_schema_version == CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION
    assert estimate.request_hash == request_a.request_hash
    assert "estimate_request_hash" in estimate.blockers_for(
        request=request_b,
        local_estimate_usd=4.0,
        local_training_tokens=100,
        local_validation_tokens=0,
        spend_cap_usd=5.0,
    )


def test_trusted_authorization_ledger_rejects_unknown_modified_expired_revoked_and_consumed(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    good = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, good)

    with pytest.raises(PaidAuthorizationRejected, match="unknown"):
        ledger.verify_and_consume(
            _authorization(
                authorization_id="auth-unknown", issued_by="mike", request_hash=request.request_hash
            ),
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:unknown",
            now="2026-07-23T00:00:00+00:00",
        )

    forged = _authorization(request_hash=request.request_hash, issued_by="mikecranesync")
    with pytest.raises(PaidAuthorizationRejected, match="trusted receipt mismatch"):
        ledger.verify_and_consume(
            forged,
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:forged",
            now="2026-07-23T00:00:00+00:00",
        )

    expired = _authorization(
        authorization_id="auth-expired",
        request_hash=request.request_hash,
        expires_at="2026-07-22T00:00:00+00:00",
    )
    ledger.record_authorized(expired)
    with pytest.raises(PaidAuthorizationRejected, match="expired"):
        ledger.verify_and_consume(
            expired,
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:expired",
            now="2026-07-23T00:00:00+00:00",
        )

    revoked = _authorization(authorization_id="auth-revoked", request_hash=request.request_hash)
    ledger.record_authorized(revoked)
    ledger.record_revoked("auth-revoked", reason="operator cancelled")
    with pytest.raises(PaidAuthorizationRejected, match="revoked"):
        ledger.verify_and_consume(
            revoked,
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:revoked",
            now="2026-07-23T00:00:00+00:00",
        )

    ledger.verify_and_consume(
        good,
        request=request,
        provider="together",
        action=ACTION_CREATE_FINETUNE_JOB,
        max_approved_cost=5.0,
        currency="USD",
        consumer_ref="test:first",
        now="2026-07-23T00:00:00+00:00",
    )
    with pytest.raises(PaidAuthorizationRejected, match="already consumed"):
        ledger.verify_and_consume(
            good,
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:second",
            now="2026-07-23T00:00:00+00:00",
        )


def test_trusted_authorization_ledger_concurrent_consumers_allow_exactly_one(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)

    def consume(label: str) -> bool:
        try:
            ledger.verify_and_consume(
                auth,
                request=request,
                provider="together",
                action=ACTION_CREATE_FINETUNE_JOB,
                max_approved_cost=5.0,
                currency="USD",
                consumer_ref=label,
                now="2026-07-23T00:00:00+00:00",
            )
            return True
        except PaidAuthorizationRejected:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(consume, ["consumer-a", "consumer-b"]))

    assert results.count(True) == 1
    assert results.count(False) == 1


def test_trusted_authorization_id_cannot_be_reauthorized_after_consumption(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)
    ledger.verify_and_consume(
        auth,
        request=request,
        provider="together",
        action=ACTION_CREATE_FINETUNE_JOB,
        max_approved_cost=5.0,
        currency="USD",
        consumer_ref="test:first",
        now="2026-07-23T00:00:00+00:00",
    )

    with pytest.raises(PaidAuthorizationRejected, match="already consumed"):
        ledger.record_authorized(auth)
    with pytest.raises(PaidAuthorizationRejected, match="already consumed"):
        ledger.verify_and_consume(
            auth,
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:reuse",
            now="2026-07-23T00:00:00+00:00",
        )


def test_trusted_authorization_id_cannot_be_reauthorized_after_revocation(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)
    ledger.record_revoked(auth.authorization_id, reason="operator cancelled")

    with pytest.raises(PaidAuthorizationRejected, match="revoked"):
        ledger.record_authorized(auth)
    with pytest.raises(PaidAuthorizationRejected, match="revoked"):
        ledger.verify_and_consume(
            auth,
            request=request,
            provider="together",
            action=ACTION_CREATE_FINETUNE_JOB,
            max_approved_cost=5.0,
            currency="USD",
            consumer_ref="test:revoked",
            now="2026-07-23T00:00:00+00:00",
        )


def test_trusted_authorization_duplicate_id_with_modified_receipt_is_rejected(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)
    modified = _authorization(
        authorization_id=auth.authorization_id,
        request_hash=request.request_hash,
        receipt_ref="s3://receipts/modified-paid-auth.json",
    )

    with pytest.raises(PaidAuthorizationRejected, match="trusted receipt mismatch"):
        ledger.record_authorized(modified)


def test_trusted_authorization_exact_duplicate_issuance_is_idempotent(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)

    ledger.record_authorized(auth)

    rows = _ledger_rows(ledger)
    assert [row["event"] for row in rows] == ["authorized"]


def test_trusted_authorization_concurrent_writes_preserve_jsonl_records(
    tmp_path: Path,
) -> None:
    request = _canonical_request()
    ledger = PaidAuthorizationLedger(path=tmp_path / "paid-authorizations.jsonl")
    authorizations = [
        _authorization(
            authorization_id=f"auth-{idx}",
            request_hash=request.request_hash,
            receipt_ref=f"s3://receipts/auth-{idx}.json",
        )
        for idx in range(40)
    ]

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(ledger.record_authorized, authorizations))

    rows = _ledger_rows(ledger)
    assert len(rows) == len(authorizations)
    assert {row["authorization_id"] for row in rows} == {
        auth.authorization_id for auth in authorizations
    }
    assert all(row["event"] == "authorized" for row in rows)


async def test_create_finetune_job_requires_paid_authorization_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    guard = BudgetGuard(cap_usd=5.0)

    with pytest.raises(PaidEventNotAuthorized):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="technician-v0",
            budget=guard,
            est_training_tokens=500_000,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=None,
            authorization_verifier=PaidAuthorizationLedger(path=Path("missing.jsonl")),
        )

    assert _FakeTogetherClient.calls == []
    assert guard.spent_usd == 0.0


async def test_create_finetune_job_rejects_forged_authorization_before_http(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    request = _canonical_request(
        validation_file=None,
        n_evals=0,
        n_checkpoints=None,
        seed=None,
        train_on_inputs=None,
        packing=None,
        learning_rate=None,
        lora_r=None,
        lora_alpha=None,
        lora_dropout=None,
    )
    trusted = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, trusted)
    forged = _authorization(request_hash=request.request_hash, issued_by="codex")

    with pytest.raises(PaidEventNotAuthorized, match="trusted receipt mismatch|issuer"):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="technician-v0",
            budget=BudgetGuard(cap_usd=5.0),
            est_training_tokens=500_000,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                authorization=forged,
                request_hash=request.request_hash,
                together_estimate=_together_estimate(request_hash=request.request_hash),
            ),
            authorization_verifier=ledger,
        )

    assert _FakeTogetherClient.calls == []


async def test_create_finetune_job_blocks_when_trusted_verifier_unavailable_before_http(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    request = _canonical_request(
        validation_file=None,
        n_evals=0,
        n_checkpoints=None,
        seed=None,
        train_on_inputs=None,
        packing=None,
        learning_rate=None,
        lora_r=None,
        lora_alpha=None,
        lora_dropout=None,
    )
    auth = _authorization(request_hash=request.request_hash)
    verifier = PaidAuthorizationLedger(path=tmp_path / "missing-parent" / "ledger.jsonl")

    with pytest.raises(PaidEventNotAuthorized, match="authorization verifier unavailable|unknown"):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="technician-v0",
            budget=BudgetGuard(cap_usd=5.0),
            est_training_tokens=500_000,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                authorization=auth,
                request_hash=request.request_hash,
                together_estimate=_together_estimate(request_hash=request.request_hash),
            ),
            authorization_verifier=verifier,
        )

    assert _FakeTogetherClient.calls == []


async def test_create_finetune_job_blocks_when_trusted_ledger_unreadable_before_http(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    request = _canonical_request(
        validation_file=None,
        n_evals=0,
        n_checkpoints=None,
        seed=None,
        train_on_inputs=None,
        packing=None,
        learning_rate=None,
        lora_r=None,
        lora_alpha=None,
        lora_dropout=None,
    )
    auth = _authorization(request_hash=request.request_hash)
    verifier = PaidAuthorizationLedger(path=tmp_path)

    with pytest.raises(PaidEventNotAuthorized, match="authorization verifier unavailable"):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="technician-v0",
            budget=BudgetGuard(cap_usd=5.0),
            est_training_tokens=500_000,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                authorization=auth,
                request_hash=request.request_hash,
                together_estimate=_together_estimate(request_hash=request.request_hash),
            ),
            authorization_verifier=verifier,
        )

    assert _FakeTogetherClient.calls == []


async def test_no_paid_request_occurs_before_successful_atomic_consumption(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    request = _canonical_request(
        validation_file=None,
        n_evals=0,
        n_checkpoints=None,
        seed=None,
        train_on_inputs=None,
        packing=None,
        learning_rate=None,
        lora_r=None,
        lora_alpha=None,
        lora_dropout=None,
    )
    auth = _authorization(request_hash=request.request_hash)
    ledger = _trusted_ledger(tmp_path, auth)
    ledger.record_revoked(auth.authorization_id, reason="operator cancelled")

    with pytest.raises(PaidEventNotAuthorized, match="revoked"):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="technician-v0",
            budget=BudgetGuard(cap_usd=5.0),
            est_training_tokens=500_000,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                authorization=auth,
                request_hash=request.request_hash,
                together_estimate=_together_estimate(request_hash=request.request_hash),
            ),
            authorization_verifier=ledger,
        )

    assert _FakeTogetherClient.calls == []


def test_paid_path_exposes_no_caller_controlled_finetune_rate_override() -> None:
    assert "usd_per_mtok" not in inspect.signature(estimate_finetune_cost).parameters
    assert "usd_per_mtok" not in inspect.signature(together_module.create_finetune_job).parameters
    with pytest.raises(TypeError):
        estimate_finetune_cost(training_tokens=50_000_000, usd_per_mtok=0.0)  # type: ignore[call-arg]


def test_finetune_cost_counts_training_and_validation_tokens() -> None:
    # (1M train * 3 epochs + 500k validation * 2 evals) * $0.48/M = $1.92,
    # then the Together fine-tune minimum floors the job at $4.00.
    assert estimate_finetune_cost(
        training_tokens=1_000_000,
        validation_tokens=500_000,
        epochs=3,
        n_evals=2,
        method="sft",
    ) == pytest.approx(4.0)
    assert (
        estimate_finetune_cost(
            training_tokens=10_000_000,
            validation_tokens=1_000_000,
            epochs=3,
            n_evals=2,
            method="sft",
        )
        > 5.0
    )


def test_dry_run_preflight_counts_jsonl_and_blocks_over_budget(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    validation = tmp_path / "validation.jsonl"
    train.write_text(
        json.dumps({"messages": [{"role": "user", "content": "u" * 4000}]}) + "\n",
        encoding="utf-8",
    )
    validation.write_text(
        json.dumps({"messages": [{"role": "assistant", "content": "a" * 1000}]}) + "\n",
        encoding="utf-8",
    )

    assert count_jsonl_tokens(train) >= 1_000
    preflight = build_finetune_dry_run_preflight(
        train,
        validation_file=validation,
        budget=BudgetGuard(cap_usd=3.99),
        model="Qwen/Qwen3.5-9B",
        epochs=3,
        n_evals=1,
    )

    assert preflight.allowed is False
    assert "budget" in preflight.blocking
    assert preflight.would_upload is False
    assert preflight.would_create_job is False


def test_dry_run_preflight_requires_full_evidence_package(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    train.write_text(json.dumps({"messages": [{"role": "user", "content": "hello"}]}) + "\n")

    preflight = build_finetune_dry_run_preflight(
        train,
        budget=BudgetGuard(cap_usd=5.0),
        model="Qwen/Qwen3.5-9B",
    )

    assert preflight.allowed is False
    assert {
        "paid_gate_pass",
        "manifest_hash",
        "model_support_receipt",
        "authorization_receipt",
        "together_estimate",
    } <= set(preflight.blocking)
    assert preflight.would_upload is False
    assert preflight.would_create_job is False


def test_dry_run_preflight_blocks_authoritative_estimate_mismatch(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    train.write_text(json.dumps({"messages": [{"role": "user", "content": "hello"}]}) + "\n")

    preflight = build_finetune_dry_run_preflight(
        train,
        budget=BudgetGuard(cap_usd=5.0),
        model="Qwen/Qwen3.5-9B",
        paid_gate_report=_paid_gate_pass(),
        manifest_hash="manifest-abc",
        model_support_receipt_ref="s3://receipts/model-support.json",
        authorization=_authorization(),
        together_estimate=_together_estimate(total_price=4.5, train_tokens=10_000),
    )

    assert preflight.allowed is False
    assert "estimate_mismatch" in preflight.blocking
    assert preflight.would_create_job is False


def test_dry_run_preflight_allows_only_with_complete_evidence(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    train.write_text(json.dumps({"messages": [{"role": "user", "content": "hello"}]}) + "\n")
    request = canonical_finetune_request(
        training_file_id="file-train",
        validation_file=None,
        model="Qwen/Qwen3.5-9B",
        suffix="technician-v0",
    )
    auth = _authorization(request_hash=request.request_hash)
    estimate = _together_estimate(
        request_hash=request.request_hash,
        total_price=4.0,
        train_tokens=1,
    )

    preflight = build_finetune_dry_run_preflight(
        train,
        budget=BudgetGuard(cap_usd=5.0),
        model="Qwen/Qwen3.5-9B",
        training_file_id="file-train",
        suffix="technician-v0",
        paid_gate_report=_paid_gate_pass(),
        manifest_hash="manifest-abc",
        model_support_receipt_ref="s3://receipts/model-support.json",
        authorization=auth,
        together_estimate=estimate,
    )

    assert preflight.allowed is True
    assert preflight.blocking == []
    assert preflight.would_upload is True
    assert preflight.would_create_job is True


def test_dry_run_output_contains_complete_non_secret_non_execution_evidence(
    tmp_path: Path,
) -> None:
    train = tmp_path / "train.jsonl"
    train.write_text(json.dumps({"messages": [{"role": "user", "content": "hello"}]}) + "\n")
    request = canonical_finetune_request(
        training_file_id="file-train",
        validation_file=None,
        model="Qwen/Qwen3.5-9B",
        suffix="technician-v0",
    )
    auth = _authorization(request_hash=request.request_hash)
    estimate = TogetherPriceEstimate(
        provider="together",
        request_schema_version=request.schema_version,
        request_hash=request.request_hash,
        estimated_total_price=4.0,
        allowed_to_proceed=True,
        estimated_train_token_count=1,
        receipt_ref="s3://receipts/together-estimate.json",
        issued_at="2026-07-23T00:00:00+00:00",
        raw={"Authorization": "Bearer secret-token", "estimated_total_price": 4.0},
    )

    preflight = build_finetune_dry_run_preflight(
        train,
        budget=BudgetGuard(cap_usd=5.0),
        model="Qwen/Qwen3.5-9B",
        training_file_id="file-train",
        suffix="technician-v0",
        paid_gate_report=_paid_gate_pass(),
        manifest_hash="manifest-abc",
        model_support_receipt_ref="s3://receipts/model-support.json",
        authorization=auth,
        together_estimate=estimate,
        authorization_verification_state={
            "trusted": True,
            "schema_version": TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION,
            "event": "authorized",
        },
    )
    evidence = preflight.to_dict()
    serialized = json.dumps(evidence, sort_keys=True)

    assert evidence["dry_run"] is True
    assert evidence["executed"] is False
    assert evidence["upload_occurred"] is False
    assert evidence["fine_tune_job_created"] is False
    assert evidence["endpoint_created"] is False
    assert evidence["authorization_consumed"] is False
    assert evidence["manifest_hash"] == "manifest-abc"
    assert evidence["canonical_request_hash"] == request.request_hash
    assert evidence["canonical_request_schema_version"] == request.schema_version
    assert evidence["paid_gate_report"]["passed"] is True
    assert evidence["model_support_receipt_ref"] == "s3://receipts/model-support.json"
    assert evidence["authorization"]["receipt_ref"] == "s3://receipts/paid-auth.json"
    assert evidence["authorization_verification_state"]["event"] == "authorized"
    assert evidence["together_estimate"]["receipt_ref"] == "s3://receipts/together-estimate.json"
    assert evidence["together_estimate"]["raw_evidence_hash"].startswith("sha256:")
    assert evidence["wire_verification_ref"].endswith(
        "2026-07-23-pr4-together-wire-verification.md"
    )
    assert "secret-token" not in serialized
    assert "Authorization" not in serialized
    assert _FakeTogetherClient.calls == []


async def test_finetune_events_checkpoints_and_checkpoint_download(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)

    events = await together_module.get_finetune_events("ft-123")
    checkpoints = await together_module.list_finetune_checkpoints("ft-123")
    out = await together_module.download_finetune_checkpoint(
        "ft-123", tmp_path / "model.tar.zst", checkpoint="adapter"
    )

    assert events["data"][0]["message"] == "queued"
    assert checkpoints["data"][0]["step"] == 10
    assert out.read_bytes() == b"checkpoint-bytes"
    download_call = [
        c for c in _FakeTogetherClient.calls if c["url"].endswith("/finetune/download")
    ][0]
    assert download_call["params"] == {"ft_id": "ft-123", "checkpoint": "adapter"}


async def test_temporary_endpoint_lifecycle_deletes_endpoint_when_benchmark_raises(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    payload = _endpoint_payload()
    auth, ledger = _endpoint_auth(tmp_path, payload)

    async def benchmark(_model_name: str) -> None:
        raise RuntimeError("benchmark failed")

    with pytest.raises(RuntimeError, match="benchmark failed"):
        await together_module.run_temporary_endpoint_benchmark(
            payload,
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=auth,
            authorization_verifier=ledger,
            endpoint_ledger_path=tmp_path / "endpoints.jsonl",
            poll_interval_seconds=0,
        )

    assert any(
        c["method"] == "DELETE" and c["url"].endswith("/endpoints/endpoint-1")
        for c in _FakeTogetherClient.calls
    )
    assert "endpoint-1" in (tmp_path / "endpoints.jsonl").read_text(encoding="utf-8")


async def test_temporary_endpoint_requires_paid_authorization_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)

    async def benchmark(_model_name: str) -> None:
        return None

    with pytest.raises(PaidEventNotAuthorized):
        await together_module.run_temporary_endpoint_benchmark(
            _endpoint_payload(),
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            poll_interval_seconds=0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=None,
            authorization_verifier=PaidAuthorizationLedger(path=Path("missing.jsonl")),
        )

    assert _FakeTogetherClient.calls == []


async def test_temporary_endpoint_requires_inactive_timeout_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)

    async def benchmark(_model_name: str) -> None:
        return None

    with pytest.raises(ValueError, match="inactive_timeout"):
        await together_module.run_temporary_endpoint_benchmark(
            {
                "model": "factorylm/technician-v0",
                "name": "technician-v0",
            },
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
                model="factorylm/technician-v0",
                spend_cap_usd=3.0,
            ),
            poll_interval_seconds=0,
        )

    assert _FakeTogetherClient.calls == []


async def test_temporary_endpoint_does_not_report_deleted_when_verification_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    _FakeTogetherClient.verify_delete_succeeds = False
    payload = _endpoint_payload()
    auth, ledger = _endpoint_auth(tmp_path, payload)

    async def benchmark(_model_name: str) -> str:
        return "ok"

    with pytest.raises(EndpointCleanupError, match="not verified"):
        await together_module.run_temporary_endpoint_benchmark(
            payload,
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=auth,
            authorization_verifier=ledger,
            endpoint_ledger_path=tmp_path / "endpoints.jsonl",
            poll_interval_seconds=0,
        )

    assert "delete_unverified" in (tmp_path / "endpoints.jsonl").read_text(encoding="utf-8")


async def test_endpoint_creation_ledger_write_failure_triggers_best_effort_delete(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    payload = _endpoint_payload()
    auth, ledger = _endpoint_auth(tmp_path, payload)

    async def benchmark(_model_name: str) -> str:
        return "should not run"

    with pytest.raises(EndpointCleanupError, match="record_created.*endpoint-1"):
        await together_module.run_temporary_endpoint_benchmark(
            payload,
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=auth,
            authorization_verifier=ledger,
            endpoint_ledger_path=tmp_path,
            poll_interval_seconds=0,
        )

    assert any(c["method"] == "DELETE" for c in _FakeTogetherClient.calls)


async def test_endpoint_delete_204_and_404_are_successful(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)

    async def benchmark(_model_name: str) -> str:
        return "ok"

    payload_204 = _endpoint_payload()
    auth_204, ledger_204 = _endpoint_auth(tmp_path / "case204", payload_204)
    result = await together_module.run_temporary_endpoint_benchmark(
        payload_204,
        benchmark,
        budget=BudgetGuard(cap_usd=3.0),
        est_endpoint_usd=2.0,
        dataset_manifest_hash="manifest-abc",
        approval_evidence=auth_204,
        authorization_verifier=ledger_204,
        endpoint_ledger_path=tmp_path / "case204" / "endpoints.jsonl",
        poll_interval_seconds=0,
    )
    assert result.deleted is True

    _FakeTogetherClient.calls = []
    _FakeTogetherClient.deleted_ids = set()
    _FakeTogetherClient.delete_status = 404
    payload_404 = _endpoint_payload()
    auth_404 = _authorization(
        authorization_id="auth-404",
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        model=str(payload_404["model"]),
        request_hash=canonical_paid_action_request_hash(
            provider="together",
            action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
            payload=payload_404,
        ),
        spend_cap_usd=3.0,
    )
    ledger_404 = _trusted_ledger(tmp_path / "case404", auth_404)
    result = await together_module.run_temporary_endpoint_benchmark(
        payload_404,
        benchmark,
        budget=BudgetGuard(cap_usd=3.0),
        est_endpoint_usd=2.0,
        dataset_manifest_hash="manifest-abc",
        approval_evidence=auth_404,
        authorization_verifier=ledger_404,
        endpoint_ledger_path=tmp_path / "case404" / "endpoints.jsonl",
        poll_interval_seconds=0,
    )
    assert result.deleted is True


async def test_cleanup_failure_preserves_original_and_cleanup_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    _FakeTogetherClient.delete_status = 500
    payload = _endpoint_payload()
    auth, ledger = _endpoint_auth(tmp_path, payload)

    async def benchmark(_model_name: str) -> None:
        raise RuntimeError("benchmark failed")

    with pytest.raises(EndpointCleanupError) as exc:
        await together_module.run_temporary_endpoint_benchmark(
            payload,
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=auth,
            authorization_verifier=ledger,
            endpoint_ledger_path=tmp_path / "endpoints.jsonl",
            poll_interval_seconds=0,
        )

    message = str(exc.value)
    assert "endpoint-1" in message
    assert "benchmark failed" in message
    assert "HTTP 500" in message


async def test_orphan_endpoint_cleanup_is_idempotent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    ledger = together_module.TogetherEndpointLeaseLedger(tmp_path / "endpoints.jsonl")
    ledger.record_created(
        endpoint_id="endpoint-orphan",
        endpoint_name="factorylm/technician-v0",
        create_payload={"model": "factorylm/technician-v0", "inactive_timeout": 60},
        authorization_id="auth-123",
    )

    first = await together_module.cleanup_orphaned_together_endpoints(
        ledger_path=ledger.path,
        older_than_seconds=0,
    )
    second = await together_module.cleanup_orphaned_together_endpoints(
        ledger_path=ledger.path,
        older_than_seconds=0,
    )

    assert first == ["endpoint-orphan"]
    assert second == []
    assert sum(c["method"] == "DELETE" for c in _FakeTogetherClient.calls) == 1


def test_adapter_artifact_metadata_round_trips(tmp_path: Path) -> None:
    registry = ArtifactRegistry(path=str(tmp_path / "registry.jsonl"))
    artifact = adapter_artifact_from_job(
        {"id": "ft-123", "model": "Qwen/Qwen3.5-9B", "model_output_name": "factorylm/tech"},
        dataset_version="v0.1",
        dataset_manifest_hash="abc123",
        hyperparams={"n_epochs": 3, "lora_r": 16},
        created_at="2026-07-23T00:00:00Z",
        created_by="codex",
    )

    registry.register(artifact)
    got = registry.get("adapter:ft-123")

    assert got is not None
    assert got.artifact_type == "adapter"
    assert got.metadata["job_id"] == "ft-123"
    assert got.metadata["base_model"] == "Qwen/Qwen3.5-9B"
    assert got.metadata["dataset_version"] == "v0.1"
    assert got.runtime_allowed is False


def test_adapter_artifact_metadata_is_required_by_registry(tmp_path: Path) -> None:
    registry = ArtifactRegistry(path=str(tmp_path / "registry.jsonl"))
    artifact = adapter_artifact_from_job(
        {"id": "ft-123", "model": "Qwen/Qwen3.5-9B", "model_output_name": "factorylm/tech"},
        dataset_version="v0.1",
        dataset_manifest_hash="abc123",
        hyperparams={"n_epochs": 3, "lora_r": 16},
        created_at="2026-07-23T00:00:00Z",
        created_by="codex",
    )
    artifact.metadata.pop("job_id")

    with pytest.raises(SchemaError, match="adapter metadata"):
        registry.register(artifact)

    assert registry.get("adapter:ft-123") is None
