"""Judge-independence classification tests (requirement 5 + 6)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from printsense.print_of_day import judge_independence as ji  # noqa: E402

INTERP = dict(interpreter_provider="together", interpreter_model="MiniMaxAI/MiniMax-M3")


def test_different_provider_and_model_is_independent() -> None:
    r = ji.classify_independence(judge_provider="groq", judge_model="llama-vision", **INTERP)
    assert r["independence"] == ji.DIFFERENT
    assert r["independence_class"] == ji.CLASS_DIFFERENT
    assert r["self_review"] is False and r["identity_verified"] is True
    assert r["gold_blocked"] is False


def test_same_provider_different_model_is_reduced_not_blocking() -> None:
    # the realistic POTD case: Together/gemma judge vs Together/MiniMax interpreter
    r = ji.classify_independence(
        judge_provider="together", judge_model="google/gemma-3n-E4B-it", **INTERP
    )
    assert r["independence"] == ji.REDUCED_SAME
    assert r["independence_class"] == ji.CLASS_REDUCED
    assert r["self_review"] is False
    assert r["gold_blocked"] is False  # reduced independence, but a real different model


def test_same_model_is_self_review_and_blocks_gold() -> None:
    r = ji.classify_independence(
        judge_provider="together", judge_model="MiniMaxAI/MiniMax-M3", **INTERP
    )
    assert r["independence"] == ji.SELF_REVIEW
    assert r["self_review"] is True
    assert r["independence_class"] == ji.CLASS_REDUCED
    assert r["gold_blocked"] is True


def test_missing_identity_blocks_gold() -> None:
    assert (
        ji.classify_independence(judge_provider=None, judge_model=None, **INTERP)["independence"]
        == ji.UNKNOWN_IDENTITY
    )
    r = ji.classify_independence(judge_provider="together", judge_model=None, **INTERP)
    assert r["identity_verified"] is False and r["gold_blocked"] is True


def test_judge_error_is_unavailable() -> None:
    r = ji.classify_independence(
        judge_provider=None, judge_model=None, judge_error="no keys", **INTERP
    )
    assert r["independence"] == ji.UNAVAILABLE
    assert r["independence_class"] == ji.CLASS_UNAVAILABLE
    assert r["gold_blocked"] is True


def test_pinned_model_mismatch_is_identity_failure() -> None:
    # POTD_JUDGE_MODEL pinned to gemma but the cascade returned something else
    r = ji.classify_independence(
        judge_provider="together",
        judge_model="some-other-model",
        expected_model="google/gemma-3n-E4B-it",
        **INTERP,
    )
    assert r["independence"] == ji.UNKNOWN_IDENTITY
    assert r["gold_blocked"] is True


def test_config_defaults_and_env_override(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_PROVIDER", raising=False)
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    monkeypatch.delenv("POTD_JUDGE_POLICY", raising=False)
    c = ji.judge_config()
    assert c == {"provider": "free_cascade", "model": "", "policy": "strict"}
    monkeypatch.setenv("POTD_JUDGE_MODEL", "google/gemma-3n-E4B-it")
    monkeypatch.setenv("POTD_JUDGE_POLICY", "strict")
    assert ji.judge_config()["model"] == "google/gemma-3n-E4B-it"
