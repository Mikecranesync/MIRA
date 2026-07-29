"""Tests for factorylm_ai.registry — the append-only ZTA artifact ledger.

Every test writes to a tmp_path JSONL file; nothing touches the real
factorylm_ai/data/registry.jsonl. No network.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from factorylm_ai.registry import ArtifactRegistry, PromotionBlocked, ZtaArtifact
from factorylm_ai.schemas.validate import SchemaError


def _artifact(**overrides: Any) -> ZtaArtifact:
    base: dict[str, Any] = {
        "artifact_id": "art_0001",
        "artifact_type": "prompt_version",
        "version": "1",
        "source_interaction_ids": ["int_0001"],
        "source_file_hashes": [],
        "tenant_id": None,
        "created_at": "2026-07-19T00:00:00Z",
        "created_by": "claude",
        "review_status": "draft",
        "benchmark_status": "untested",
        "runtime_allowed": False,
    }
    base.update(overrides)
    return ZtaArtifact(**base)


@pytest.fixture
def registry(tmp_path: Path) -> ArtifactRegistry:
    return ArtifactRegistry(path=str(tmp_path / "registry.jsonl"))


# ---------------------------------------------------------------------------
# register()
# ---------------------------------------------------------------------------


def test_register_draft_ok(registry: ArtifactRegistry):
    registry.register(_artifact())
    got = registry.get("art_0001")
    assert got is not None
    assert got.review_status == "draft"
    assert got.runtime_allowed is False


def test_register_runtime_allowed_with_benchmark_untested_is_blocked(
    registry: ArtifactRegistry,
):
    a = _artifact(runtime_allowed=True, review_status="approved", benchmark_status="untested")
    with pytest.raises(PromotionBlocked):
        registry.register(a)
    assert registry.get("art_0001") is None  # fail closed: nothing written


def test_register_runtime_allowed_with_review_not_approved_is_blocked(
    registry: ArtifactRegistry,
):
    a = _artifact(runtime_allowed=True, review_status="draft", benchmark_status="pass")
    with pytest.raises(PromotionBlocked):
        registry.register(a)
    assert registry.get("art_0001") is None


def test_register_runtime_allowed_with_benchmark_fail_is_blocked(registry: ArtifactRegistry):
    a = _artifact(runtime_allowed=True, review_status="approved", benchmark_status="fail")
    with pytest.raises(PromotionBlocked):
        registry.register(a)


def test_register_runtime_allowed_with_both_gates_passing_succeeds(
    registry: ArtifactRegistry,
):
    a = _artifact(runtime_allowed=True, review_status="approved", benchmark_status="pass")
    registry.register(a)
    got = registry.get("art_0001")
    assert got is not None
    assert got.runtime_allowed is True


def test_register_invalid_enum_raises_schema_error(registry: ArtifactRegistry):
    a = _artifact(review_status="pending")  # not one of draft|approved|rejected|superseded
    with pytest.raises(SchemaError):
        registry.register(a)


def test_register_appends_one_jsonl_line(registry: ArtifactRegistry, tmp_path: Path):
    registry.register(_artifact())
    lines = (tmp_path / "registry.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1


# ---------------------------------------------------------------------------
# get() / list() — latest-row-wins
# ---------------------------------------------------------------------------


def test_get_missing_returns_none(registry: ArtifactRegistry):
    assert registry.get("nope") is None


def test_get_returns_latest_row(registry: ArtifactRegistry):
    registry.register(_artifact(version="1"))
    registry.register(_artifact(version="2", created_by="mike"))
    got = registry.get("art_0001")
    assert got is not None
    assert got.version == "2"
    assert got.created_by == "mike"


def test_list_no_filter_returns_all_latest(registry: ArtifactRegistry):
    registry.register(_artifact(artifact_id="a1"))
    registry.register(_artifact(artifact_id="a2"))
    registry.register(_artifact(artifact_id="a1", version="2"))
    artifacts = {a.artifact_id: a for a in registry.list()}
    assert set(artifacts) == {"a1", "a2"}
    assert artifacts["a1"].version == "2"


def test_list_filters_by_artifact_type(registry: ArtifactRegistry):
    registry.register(_artifact(artifact_id="a1", artifact_type="prompt_version"))
    registry.register(
        _artifact(
            artifact_id="a2",
            artifact_type="adapter",
            source_file_hashes=["manifest-hash"],
            metadata={
                "job_id": "ft-123",
                "base_model": "Qwen/Qwen3.5-9B",
                "output_model": "factorylm/tech",
                "dataset_version": "v0.1",
                "dataset_manifest_hash": "manifest-hash",
                "hyperparams": {"n_epochs": 3},
            },
        )
    )
    registry.register(_artifact(artifact_id="a3", artifact_type="prompt_version"))

    prompts = registry.list(artifact_type="prompt_version")
    assert {a.artifact_id for a in prompts} == {"a1", "a3"}

    everything = registry.list()
    assert {a.artifact_id for a in everything} == {"a1", "a2", "a3"}


def test_list_collapses_to_one_row_per_id(registry: ArtifactRegistry):
    registry.register(_artifact(artifact_id="a1", version="1"))
    registry.register(_artifact(artifact_id="a1", version="2"))
    registry.register(_artifact(artifact_id="a1", version="3"))
    artifacts = registry.list()
    assert len(artifacts) == 1
    assert artifacts[0].version == "3"


# ---------------------------------------------------------------------------
# allow_runtime() — the human-invoked promotion action
# ---------------------------------------------------------------------------


def test_allow_runtime_unknown_artifact_is_blocked(registry: ArtifactRegistry):
    with pytest.raises(PromotionBlocked):
        registry.allow_runtime("nope")


def test_allow_runtime_blocked_when_gates_not_met(registry: ArtifactRegistry):
    registry.register(_artifact(review_status="draft", benchmark_status="untested"))
    with pytest.raises(PromotionBlocked):
        registry.allow_runtime("art_0001")
    got = registry.get("art_0001")
    assert got is not None
    assert got.runtime_allowed is False


def test_allow_runtime_blocked_when_only_review_approved(registry: ArtifactRegistry):
    registry.register(_artifact(review_status="approved", benchmark_status="untested"))
    with pytest.raises(PromotionBlocked):
        registry.allow_runtime("art_0001")


def test_allow_runtime_blocked_when_only_benchmark_pass(registry: ArtifactRegistry):
    registry.register(_artifact(review_status="draft", benchmark_status="pass"))
    with pytest.raises(PromotionBlocked):
        registry.allow_runtime("art_0001")


def test_allow_runtime_flips_when_both_gates_pass(registry: ArtifactRegistry, tmp_path: Path):
    registry.register(_artifact(review_status="approved", benchmark_status="pass"))
    got_before = registry.get("art_0001")
    assert got_before is not None
    assert got_before.runtime_allowed is False

    promoted = registry.allow_runtime("art_0001")
    assert promoted.runtime_allowed is True

    got_after = registry.get("art_0001")
    assert got_after is not None
    assert got_after.runtime_allowed is True

    # Append-only: the flip is a NEW row, not a mutation of the old one.
    lines = (tmp_path / "registry.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2


def test_allow_runtime_blocked_after_benchmark_regresses(registry: ArtifactRegistry):
    registry.register(_artifact(review_status="approved", benchmark_status="pass"))
    registry.register(_artifact(review_status="approved", benchmark_status="regression"))
    with pytest.raises(PromotionBlocked):
        registry.allow_runtime("art_0001")


def test_allow_runtime_blocks_legacy_adapter_without_metadata(tmp_path: Path):
    path = tmp_path / "registry.jsonl"
    legacy_adapter = {
        "artifact_id": "adapter:legacy",
        "artifact_type": "adapter",
        "version": "ft-legacy",
        "source_interaction_ids": [],
        "source_file_hashes": [],
        "tenant_id": None,
        "created_at": "2026-07-19T00:00:00Z",
        "created_by": "mike",
        "review_status": "approved",
        "benchmark_status": "pass",
        "runtime_allowed": False,
    }
    path.write_text(json.dumps(legacy_adapter) + "\n", encoding="utf-8")
    registry = ArtifactRegistry(path=str(path))

    with pytest.raises(PromotionBlocked, match="adapter metadata"):
        registry.allow_runtime("adapter:legacy")


# ---------------------------------------------------------------------------
# Default path resolution — or-form env parsing (compose delivers "").
# ---------------------------------------------------------------------------


def test_default_path_honors_data_dir_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "custom_data"))
    reg = ArtifactRegistry()
    assert reg.path == tmp_path / "custom_data" / "registry.jsonl"


def test_default_path_falls_back_when_env_is_empty_string(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", "")  # compose ${VAR:-} delivers ""
    reg = ArtifactRegistry()
    assert reg.path == Path("factorylm_ai/data") / "registry.jsonl"


def test_explicit_path_overrides_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "ignored"))
    explicit = tmp_path / "explicit" / "registry.jsonl"
    reg = ArtifactRegistry(path=str(explicit))
    assert reg.path == explicit
