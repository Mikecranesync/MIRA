"""POTD judge readiness tests (requirement 7) — structural + live probe."""

from __future__ import annotations

import sys
import types
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from printsense.print_of_day import judge_readiness as jrd  # noqa: E402


def _router(*, enabled=True, vision=True):
    providers = [
        types.SimpleNamespace(
            name="together", vision_model="google/gemma-3n-E4B-it" if vision else ""
        )
    ]
    return types.SimpleNamespace(enabled=enabled, providers=providers)


def test_structural_ready_when_enabled_with_vision() -> None:
    r = jrd.check_judge_readiness(router=_router())
    assert r["structural_ready"] is True
    assert r["checks"]["import_and_init"] and r["checks"]["keys_enabled"]
    assert r["checks"]["vision_model_available"]
    assert r["blockers"] == []


def test_not_enabled_blocks() -> None:
    r = jrd.check_judge_readiness(router=_router(enabled=False))
    assert r["structural_ready"] is False
    assert any("not enabled" in b for b in r["blockers"])


def test_no_vision_provider_blocks() -> None:
    r = jrd.check_judge_readiness(router=_router(vision=False))
    assert r["structural_ready"] is False
    assert any("vision-capable" in b for b in r["blockers"])


def test_live_probe_valid_passes() -> None:
    def _probe(**kw):
        return {
            "validation_status": "valid",
            "identity_verified": True,
            "self_review": False,
            "judge_model": "google/gemma-3n-E4B-it",
        }

    r = jrd.check_judge_readiness(router=_router(), live=True, probe=_probe)
    assert r["live_ok"] is True and r["ready"] is True


def test_live_probe_self_review_fails() -> None:
    def _probe(**kw):
        return {
            "validation_status": "valid",
            "identity_verified": True,
            "self_review": True,
            "judge_model": "MiniMaxAI/MiniMax-M3",
        }

    r = jrd.check_judge_readiness(router=_router(), live=True, probe=_probe)
    assert r["live_ok"] is False and r["ready"] is False
    assert any("self-review" in b for b in r["blockers"])


def test_live_probe_invalid_verdict_fails() -> None:
    def _probe(**kw):
        return {"validation_status": "invalid", "identity_verified": True, "self_review": False}

    r = jrd.check_judge_readiness(router=_router(), live=True, probe=_probe)
    assert r["live_ok"] is False
    assert any("not valid" in b for b in r["blockers"])


def test_live_probe_pinned_model_mismatch_fails(monkeypatch) -> None:
    monkeypatch.setenv("POTD_JUDGE_MODEL", "google/gemma-3n-E4B-it")

    def _probe(**kw):
        return {
            "validation_status": "valid",
            "identity_verified": True,
            "self_review": False,
            "judge_model": "other-model",
        }

    r = jrd.check_judge_readiness(router=_router(), live=True, probe=_probe)
    assert r["live_ok"] is False
    assert any("pinned" in b for b in r["blockers"])
