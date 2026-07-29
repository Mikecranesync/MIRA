"""POTD judge runtime tests — identity, validation, independence, gold blocking.

Hermetic: a fake router feeds canned (raw, usage) with no network. Covers
missing keys, unavailable/wrong model, empty/malformed output, self-review,
valid different-model judging, and the gold-blocking decision (requirement 9).
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from printsense.print_of_day import judge_runtime as jr  # noqa: E402

VALID_VERDICT = json.dumps(
    {
        "letter": "B",
        "criteria": {"sheet_identity": {"score": 80}},
        "summary": "ok",
        "hard_failures": {},
    }
)


class FakeRouter:
    def __init__(
        self, *, enabled=True, raw=VALID_VERDICT, usage=None, raise_exc=None, providers=None
    ):
        self.enabled = enabled
        self._raw = raw
        self._usage = (
            usage
            if usage is not None
            else {"provider": "together", "model": "google/gemma-3n-E4B-it"}
        )
        self._raise = raise_exc
        self.providers = providers or [
            types.SimpleNamespace(name="together", vision_model="google/gemma-3n-E4B-it")
        ]

    async def complete(self, messages, max_tokens=4000, session_id="x", sanitize=True):
        if self._raise:
            raise self._raise
        return self._raw, self._usage


def _run(router, **over):
    kw = dict(
        image_bytes=b"\x89PNG\r\n",
        response_text="the assistant read terminals X1-X4",
        source_meta={"title": "t"},
        interpreter_provider="together",
        interpreter_model="MiniMaxAI/MiniMax-M3",
        media_type="image/png",
        router=router,
    )
    kw.update(over)
    return jr.run_judge(**kw)


def test_valid_different_model_judging(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter())
    assert r["validation_status"] == "valid"
    assert r["judge_provider"] == "together" and r["judge_model"] == "google/gemma-3n-E4B-it"
    assert r["independence"] == "reduced_same_cascade"
    assert r["self_review"] is False and r["identity_verified"] is True
    assert r["gold_blocked"] is False
    assert r["verdict"]["letter"] == "B"
    assert len(r["prompt_sha256"]) == 64 and len(r["raw_sha256"]) == 64
    assert r["provisional"] is True


def test_fully_independent_provider(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter(usage={"provider": "groq", "model": "llama-vision"}))
    assert r["independence"] == "different_provider_model"
    assert r["independence_class"] == "different"
    assert r["gold_blocked"] is False


def test_self_review_blocks_gold(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter(usage={"provider": "together", "model": "MiniMaxAI/MiniMax-M3"}))
    assert r["self_review"] is True
    assert r["independence"] == "same_model"
    assert r["gold_blocked"] is True


def test_missing_keys_is_unavailable_and_blocks_gold(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter(enabled=False))
    assert r["validation_status"] == "unavailable"
    assert r["independence"] == "unavailable"
    assert r["gold_blocked"] is True
    assert "not enabled" in (r["judge_error"] or "")


def test_empty_output_blocks_gold(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter(raw=""))
    assert r["validation_status"] == "empty"
    assert r["gold_blocked"] is True


def test_malformed_output_blocks_gold(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter(raw="the sheet looks fine, no JSON here at all"))
    assert r["validation_status"] == "invalid"
    assert r["gold_blocked"] is True


def test_router_exception_is_error_and_blocks_gold(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(FakeRouter(raise_exc=RuntimeError("provider exploded")))
    assert r["validation_status"] == "error"
    assert "provider exploded" in (r["judge_error"] or "")
    assert r["gold_blocked"] is True


def test_wrong_pinned_model_is_identity_failure(monkeypatch) -> None:
    monkeypatch.setenv("POTD_JUDGE_MODEL", "google/gemma-3n-E4B-it")
    # returned a DIFFERENT model than pinned → identity failure → gold blocked
    r = _run(FakeRouter(usage={"provider": "together", "model": "meta-llama/other"}))
    assert r["independence"] == "unknown_identity"
    assert r["gold_blocked"] is True


def test_usage_tokens_recorded(monkeypatch) -> None:
    monkeypatch.delenv("POTD_JUDGE_MODEL", raising=False)
    r = _run(
        FakeRouter(
            usage={
                "provider": "together",
                "model": "google/gemma-3n-E4B-it",
                "input_tokens": 900,
                "output_tokens": 300,
            }
        )
    )
    assert r["judge_usage"] == {"input_tokens": 900, "output_tokens": 300}
