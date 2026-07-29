"""Tests for factorylm_ai.telemetry.

Hermetic: no network, tmp_path for all JSONL, env via monkeypatch only.

``log_model_run`` lazily imports ``factorylm_ai.schemas.validate`` INSIDE its
own body (see telemetry.py's docstring) because ``factorylm_ai/schemas/`` is
built by a parallel-stage builder in this package's initial construction and
may not exist on disk yet when this file runs. To stay independent of that
timing, every test that exercises ``log_model_run``'s validation path injects
a small fake ``factorylm_ai.schemas.validate`` module directly into
``sys.modules`` (reverted automatically by ``monkeypatch`` at teardown) rather
than depending on the real schema file being present. This deliberately does
NOT test B2's actual JSON-schema validation logic (that's B2's own test
file's job) — it tests that ``telemetry.py`` is wired to call
``load_schema``/``validate_or_raise`` correctly and handles both outcomes.
"""

from __future__ import annotations

import json
import sys
import types
from datetime import datetime
from typing import Any

import pytest

from factorylm_ai.providers.base import ModelResponse
from factorylm_ai.telemetry import ModelRun, log_model_run, model_run_from_response

_VALID_RATINGS = {"accepted", "corrected", "rejected", "unknown"}


def _install_fake_schema_validate_module(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inject a minimal, self-contained fake for factorylm_ai.schemas.validate.

    Guarantees telemetry.log_model_run's lazy
    ``from .schemas.validate import load_schema, validate_or_raise`` succeeds
    regardless of whether the real schemas/ package has landed on disk yet.
    """
    if "factorylm_ai.schemas" not in sys.modules:
        monkeypatch.setitem(
            sys.modules, "factorylm_ai.schemas", types.ModuleType("factorylm_ai.schemas")
        )

    fake = types.ModuleType("factorylm_ai.schemas.validate")

    def _load_schema(name: str) -> dict[str, Any]:
        return {"name": name}

    def _validate_or_raise(instance: object, schema: dict[str, Any]) -> None:
        if not isinstance(instance, dict):
            raise ValueError("model_run payload must be a dict")
        rating = instance.get("human_rating")
        if rating not in _VALID_RATINGS:
            raise ValueError(f"invalid human_rating: {rating!r}")

    fake.load_schema = _load_schema  # type: ignore[attr-defined]
    fake.validate_or_raise = _validate_or_raise  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "factorylm_ai.schemas.validate", fake)


def _make_run(human_rating: str = "unknown") -> ModelRun:
    return ModelRun(
        ts="2026-07-19T00:00:00+00:00",
        provider="mock",
        model="mock/m05",
        adapter=None,
        task="M05",
        input_hash="deadbeef",
        prompt_version="v1",
        schema_version="v1",
        latency_ms=1,
        input_tokens=10,
        output_tokens=5,
        estimated_cost_usd=0.0,
        json_valid=True,
        evidence_required=False,
        evidence_present=False,
        human_rating=human_rating,
    )


# ---------------------------------------------------------------------------
# model_run_from_response — no schema dependency
# ---------------------------------------------------------------------------


def test_model_run_from_response_happy_path() -> None:
    resp = ModelResponse(
        text='{"ok": true}',
        parsed={"ok": True},
        tool_calls=None,
        embeddings=None,
        rerank_scores=None,
        model="mock/m05",
        provider="mock",
        input_tokens=42,
        output_tokens=7,
        latency_ms=1,
        estimated_cost_usd=0.0,
    )
    run = model_run_from_response(
        task_id="M05",
        req_hash="abc123",
        prompt_version="v1",
        schema_version="v1",
        resp=resp,
        json_valid=True,
        evidence_required=False,
        evidence_present=False,
    )
    assert run.provider == "mock"
    assert run.model == "mock/m05"
    assert run.task == "M05"
    assert run.input_hash == "abc123"
    assert run.prompt_version == "v1"
    assert run.schema_version == "v1"
    assert run.latency_ms == 1
    assert run.input_tokens == 42
    assert run.output_tokens == 7
    assert run.estimated_cost_usd == 0.0
    assert run.json_valid is True
    assert run.evidence_required is False
    assert run.evidence_present is False
    assert run.human_rating == "unknown"
    assert run.adapter is None
    datetime.fromisoformat(run.ts)  # must be a parseable ISO-8601 timestamp


def test_model_run_from_response_defaults_evidence_flags_false() -> None:
    resp = ModelResponse(
        text="ok",
        parsed=None,
        tool_calls=None,
        embeddings=None,
        rerank_scores=None,
        model="mock/m12",
        provider="mock",
        input_tokens=1,
        output_tokens=1,
        latency_ms=1,
        estimated_cost_usd=0.0,
    )
    run = model_run_from_response(
        task_id="M12",
        req_hash="h",
        prompt_version="v1",
        schema_version="v1",
        resp=resp,
        json_valid=False,
    )
    assert run.evidence_required is False
    assert run.evidence_present is False
    assert run.json_valid is False


# ---------------------------------------------------------------------------
# log_model_run — JSONL sink + validation gate
# ---------------------------------------------------------------------------


def test_log_model_run_appends_valid_json_lines(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_fake_schema_validate_module(monkeypatch)
    run = _make_run(human_rating="accepted")
    out_path = tmp_path / "runs" / "model_runs.jsonl"

    log_model_run(run, path=str(out_path))
    log_model_run(run, path=str(out_path))

    lines = out_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    for line in lines:
        row = json.loads(line)
        assert row["human_rating"] == "accepted"
        assert row["task"] == "M05"
        assert row["provider"] == "mock"


def test_log_model_run_creates_parent_dir_lazily(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_fake_schema_validate_module(monkeypatch)
    out_path = tmp_path / "nested" / "does" / "not" / "exist" / "model_runs.jsonl"
    assert not out_path.parent.exists()

    log_model_run(_make_run(), path=str(out_path))

    assert out_path.exists()


def test_log_model_run_rejects_invalid_human_rating(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_fake_schema_validate_module(monkeypatch)
    run = _make_run(human_rating="not-a-real-rating")
    out_path = tmp_path / "model_runs.jsonl"

    with pytest.raises(ValueError):
        log_model_run(run, path=str(out_path))

    assert not out_path.exists()


def test_log_model_run_wraps_missing_schema_as_runtime_error(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulates the schema genuinely being absent (independent of whether
    the real file exists on disk right now) by making the injected
    ``load_schema`` raise FileNotFoundError — telemetry.py must translate
    that into a clear RuntimeError, not let it propagate raw.
    """
    fake = types.ModuleType("factorylm_ai.schemas.validate")

    def _load_schema_raises(name: str) -> dict[str, Any]:
        raise FileNotFoundError(f"no such schema: {name}")

    fake.load_schema = _load_schema_raises  # type: ignore[attr-defined]
    fake.validate_or_raise = lambda instance, schema: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "factorylm_ai.schemas.validate", fake)

    with pytest.raises(RuntimeError, match="could not load"):
        log_model_run(_make_run(), path=str(tmp_path / "model_runs.jsonl"))
