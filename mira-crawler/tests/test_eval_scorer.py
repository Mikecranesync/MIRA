"""Tests for the conversation_eval auto-scorer / labeler (Phase 2).

Pure/seam-level — no NeonDB. Covers the deterministic drive-pack labeler, the
LLM-judge path with a mocked router, and fail-open behaviour.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure imports work from repo root (mirrors the other crawler tests).
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-bots"))

from tasks.eval_scorer import (  # noqa: E402
    _DETERMINISTIC_MODEL,
    _coerce_meta,
    is_drive_pack,
    label_drive_pack_row,
    score_row,
)


class _FakeRouter:
    """Minimal stand-in for InferenceRouter."""

    def __init__(self, *, enabled=True, content="", provider="groq"):
        self.enabled = enabled
        self._content = content
        self._provider = provider
        self.calls = 0

    async def complete(self, messages, max_tokens=400, session_id="x", sanitize=True):
        self.calls += 1
        return self._content, {"provider": self._provider}


_JUDGE_JSON = json.dumps(
    {
        "answered_question": 5,
        "no_hallucination": 4,
        "no_redundant_questions": 5,
        "cited_sources_when_claimed": 3,
        "appropriate_tone": 4,
        "overall": 4,
        "reasoning": "Direct, supportable.",
    }
)


# --- is_drive_pack -----------------------------------------------------------


def test_is_drive_pack():
    assert is_drive_pack({"surface": "drive_pack"}) is True
    assert is_drive_pack({"surface": "engine"}) is False
    assert is_drive_pack(None) is False
    assert is_drive_pack({}) is False


# --- deterministic labeler ---------------------------------------------------


def test_label_matched_drive_pack():
    meta = {
        "surface": "drive_pack",
        "pack_id": "durapulse_gs10",
        "matched": True,
        "matched_kind": "fault_code",
        "answer_source": "pack",
    }
    score = label_drive_pack_row(meta)
    assert score["auto_score"] == 5
    assert score["model"] == _DETERMINISTIC_MODEL
    assert score["breakdown"]["no_hallucination"] == 5
    assert "durapulse_gs10" in score["reasoning"]


def test_label_unmatched_drive_pack_is_gap():
    meta = {"surface": "drive_pack", "pack_id": "durapulse_gs10", "matched": False}
    score = label_drive_pack_row(meta)
    assert score["auto_score"] == 3
    # Correct decline: no fabrication, but did not resolve the question.
    assert score["breakdown"]["no_hallucination"] == 5
    assert score["breakdown"]["answered_question"] == 2
    assert score["model"] == _DETERMINISTIC_MODEL
    assert "gap" in score["reasoning"].lower()


def test_score_row_dispatches_drive_pack_without_router():
    row = {"meta": {"surface": "drive_pack", "pack_id": "x", "matched": True}}
    score = score_row(row, router=None)  # no router needed for drive-pack
    assert score is not None
    assert score["auto_score"] == 5
    assert score["model"] == _DETERMINISTIC_MODEL


# --- LLM judge path ----------------------------------------------------------


def test_score_row_engine_uses_router():
    router = _FakeRouter(content=_JUDGE_JSON, provider="groq")
    row = {
        "id": "abc",
        "user_message": "powerflex 525 f004",
        "bot_response": "F004 is undervoltage; check the DC bus.",
        "intent": "industrial",
        "has_citations": True,
        "meta": None,
    }
    score = score_row(row, router=router)
    assert router.calls == 1
    assert score is not None
    assert score["auto_score"] == 4
    assert score["model"] == "groq"
    assert score["breakdown"]["cited_sources_when_claimed"] == 3


def test_score_row_engine_disabled_router_is_fail_open():
    router = _FakeRouter(enabled=False)
    row = {"user_message": "hi", "bot_response": "hello", "meta": None}
    assert score_row(row, router=router) is None
    assert router.calls == 0


def test_score_row_engine_no_router_is_none():
    row = {"user_message": "hi", "bot_response": "hello", "meta": None}
    assert score_row(row, router=None) is None


def test_score_row_engine_unparseable_output_is_fail_open():
    router = _FakeRouter(content="the model rambled, no json here")
    row = {"user_message": "hi", "bot_response": "hello", "meta": None}
    assert score_row(row, router=router) is None


def test_score_row_engine_empty_content_is_fail_open():
    router = _FakeRouter(content="")  # cascade exhausted
    row = {"user_message": "hi", "bot_response": "hello", "meta": None}
    assert score_row(row, router=router) is None


# --- meta coercion -----------------------------------------------------------


def test_coerce_meta_variants():
    assert _coerce_meta(None) is None
    assert _coerce_meta({"surface": "drive_pack"}) == {"surface": "drive_pack"}
    assert _coerce_meta('{"surface": "drive_pack"}') == {"surface": "drive_pack"}
    assert _coerce_meta("not json") is None
    assert _coerce_meta(42) is None
