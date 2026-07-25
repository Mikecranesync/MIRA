"""PR 4 tests for governed Together fine-tune orchestration.

Hermetic: no real network, no upload, no job, no endpoint. Live-facing helpers are
exercised only with a fake AsyncClient after the repo network gate is explicitly
enabled in the test environment.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from factorylm_ai.budget import BudgetGuard
from factorylm_ai.finetune import (
    adapter_artifact_from_job,
    build_finetune_dry_run_preflight,
    count_jsonl_tokens,
)
from factorylm_ai.pricing import estimate_finetune_cost
from factorylm_ai.providers import together as together_module
from factorylm_ai.providers.together import PaidEventNotAuthorized
from factorylm_ai.registry import ArtifactRegistry
from factorylm_ai.schemas.validate import SchemaError


class _FakeTogetherClient:
    calls: list[dict[str, Any]] = []

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
            return httpx.Response(
                200,
                json={
                    "id": "endpoint-1",
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
        return httpx.Response(204)


@pytest.fixture(autouse=True)
def _clear_fake_calls() -> None:
    _FakeTogetherClient.calls = []


def _enable_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "fake-test-key")
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")


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
        paid_event_authorization_ref="mike-approved-dry-run-package:pr4-local",
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
        )

    assert _FakeTogetherClient.calls == []
    assert guard.spent_usd == 0.0


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
        epochs=3,
        n_evals=1,
    )

    assert preflight.allowed is False
    assert "budget" in preflight.blocking
    assert preflight.would_upload is False
    assert preflight.would_create_job is False


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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)

    async def benchmark(_model_name: str) -> None:
        raise RuntimeError("benchmark failed")

    with pytest.raises(RuntimeError, match="benchmark failed"):
        await together_module.run_temporary_endpoint_benchmark(
            {"model": "factorylm/technician-v0", "name": "technician-v0"},
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            paid_event_authorization_ref="mike-approved-temporary-eval:pr4-local",
            poll_interval_seconds=0,
        )

    assert any(
        c["method"] == "DELETE" and c["url"].endswith("/endpoints/endpoint-1")
        for c in _FakeTogetherClient.calls
    )


async def test_temporary_endpoint_requires_paid_authorization_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_network(monkeypatch)
    monkeypatch.setattr(together_module.httpx, "AsyncClient", _FakeTogetherClient)

    async def benchmark(_model_name: str) -> None:
        return None

    with pytest.raises(PaidEventNotAuthorized):
        await together_module.run_temporary_endpoint_benchmark(
            {"model": "factorylm/technician-v0", "name": "technician-v0"},
            benchmark,
            budget=BudgetGuard(cap_usd=3.0),
            est_endpoint_usd=2.0,
            poll_interval_seconds=0,
        )

    assert _FakeTogetherClient.calls == []


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
