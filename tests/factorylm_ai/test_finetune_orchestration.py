"""PR 4 tests for governed Together fine-tune orchestration.

Hermetic: no real network, no upload, no job, no endpoint. Live-facing helpers are
exercised only with a fake AsyncClient after the repo network gate is explicitly
enabled in the test environment.
"""

from __future__ import annotations

import json
import inspect
from pathlib import Path
from typing import Any

import httpx
import pytest

from factorylm_ai.dataset.paid_gate import GateCheck, PaidGateReport, VERDICT_PASS
from factorylm_ai.budget import BudgetGuard
from factorylm_ai.finetune import (
    ACTION_CREATE_FINETUNE_JOB,
    ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
    FineTuneApprovalEvidence,
    PaidEventAuthorization,
    TogetherPriceEstimate,
    adapter_artifact_from_job,
    build_finetune_dry_run_preflight,
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
        return httpx.Response(204)


@pytest.fixture(autouse=True)
def _clear_fake_calls() -> None:
    _FakeTogetherClient.calls = []
    _FakeTogetherClient.deleted_ids = set()
    _FakeTogetherClient.verify_delete_succeeds = True


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
    action: str = ACTION_CREATE_FINETUNE_JOB,
    dataset_manifest_hash: str = "manifest-abc",
    model: str = "Qwen/Qwen3.5-9B",
    spend_cap_usd: float = 5.0,
    issued_by: str = "mike",
    receipt_ref: str = "s3://receipts/paid-auth.json",
    expires_at: str = "2099-01-01T00:00:00+00:00",
    single_use: bool = True,
    used_at: str | None = None,
) -> PaidEventAuthorization:
    return PaidEventAuthorization(
        authorization_id="auth-123",
        action=action,
        dataset_manifest_hash=dataset_manifest_hash,
        model=model,
        spend_cap_usd=spend_cap_usd,
        issued_by=issued_by,
        issued_at="2026-07-23T00:00:00+00:00",
        expires_at=expires_at,
        receipt_ref=receipt_ref,
        single_use=single_use,
        used_at=used_at,
    )


def _together_estimate(
    *,
    total_price: float = 4.0,
    train_tokens: int = 100,
    eval_tokens: int = 0,
    allowed: bool = True,
    receipt_ref: str = "s3://receipts/together-estimate.json",
) -> TogetherPriceEstimate:
    return TogetherPriceEstimate(
        estimated_total_price=total_price,
        allowed_to_proceed=allowed,
        estimated_train_token_count=train_tokens,
        estimated_eval_token_count=eval_tokens,
        receipt_ref=receipt_ref,
        raw={"estimated_total_price": total_price, "allowed_to_proceed": allowed},
    )


def _approval(
    *,
    action: str = ACTION_CREATE_FINETUNE_JOB,
    dataset_manifest_hash: str = "manifest-abc",
    model: str = "Qwen/Qwen3.5-9B",
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
            spend_cap_usd=spend_cap_usd,
        ),
        local_estimate_usd=4.0,
        together_estimate=together_estimate or _together_estimate(),
    )


async def test_create_finetune_job_builds_pr4_payload_and_records_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    guard = BudgetGuard(cap_usd=5.0)

    job = await together_module.create_finetune_job(
        "file-train",
        "Qwen/Qwen3.5-9B",
        suffix="technician-v0",
        budget=guard,
        est_training_tokens=500_000,
        dataset_manifest_hash="manifest-abc",
        approval_evidence=_approval(),
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
        )

    assert _FakeTogetherClient.calls == []
    assert guard.spent_usd == 0.0


async def test_create_finetune_job_rejects_forged_authorization_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)
    forged = _authorization(issued_by="codex")

    with pytest.raises(PaidEventNotAuthorized, match="issuer"):
        await together_module.create_finetune_job(
            "file-train",
            "Qwen/Qwen3.5-9B",
            suffix="technician-v0",
            budget=BudgetGuard(cap_usd=5.0),
            est_training_tokens=500_000,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(authorization=forged),
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

    preflight = build_finetune_dry_run_preflight(
        train,
        budget=BudgetGuard(cap_usd=5.0),
        model="Qwen/Qwen3.5-9B",
        paid_gate_report=_paid_gate_pass(),
        manifest_hash="manifest-abc",
        model_support_receipt_ref="s3://receipts/model-support.json",
        authorization=_authorization(),
        together_estimate=_together_estimate(total_price=4.0, train_tokens=1),
    )

    assert preflight.allowed is True
    assert preflight.blocking == []
    assert preflight.would_upload is True
    assert preflight.would_create_job is True


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

    async def benchmark(_model_name: str) -> None:
        raise RuntimeError("benchmark failed")

    with pytest.raises(RuntimeError, match="benchmark failed"):
        await together_module.run_temporary_endpoint_benchmark(
            {
                "model": "factorylm/technician-v0",
                "name": "technician-v0",
                "inactive_timeout": 60,
            },
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
                model="factorylm/technician-v0",
                authorization=_authorization(
                    action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
                    model="factorylm/technician-v0",
                    spend_cap_usd=3.0,
                ),
                spend_cap_usd=3.0,
            ),
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
            {
                "model": "factorylm/technician-v0",
                "name": "technician-v0",
                "inactive_timeout": 60,
            },
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            poll_interval_seconds=0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=None,
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

    async def benchmark(_model_name: str) -> str:
        return "ok"

    with pytest.raises(EndpointCleanupError, match="not verified"):
        await together_module.run_temporary_endpoint_benchmark(
            {
                "model": "factorylm/technician-v0",
                "name": "technician-v0",
                "inactive_timeout": 60,
            },
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            dataset_manifest_hash="manifest-abc",
            approval_evidence=_approval(
                action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
                model="factorylm/technician-v0",
                authorization=_authorization(
                    action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
                    model="factorylm/technician-v0",
                    spend_cap_usd=3.0,
                ),
                spend_cap_usd=3.0,
            ),
            endpoint_ledger_path=tmp_path / "endpoints.jsonl",
            poll_interval_seconds=0,
        )

    assert "delete_unverified" in (tmp_path / "endpoints.jsonl").read_text(encoding="utf-8")


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
