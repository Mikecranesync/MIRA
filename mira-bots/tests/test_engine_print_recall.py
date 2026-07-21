"""Engine seam wiring: ``_interpret_print_anthropic_pages`` routes the paid
interpret through the production recall gate when enabled, else the current direct
call.

Behavior-preserving + $0: the paid boundary (``interpret.interpret_print``) is
mocked. Verifies one paid call on identical turns (enabled), two on a different
question / context, the unchanged direct-call path when disabled or the recall
module is unavailable, byte-identical rendered replies fresh vs recalled, and no
user-facing recall marker.
"""

from __future__ import annotations

import base64
import sys
from unittest.mock import MagicMock

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

pytest.importorskip("pydantic")

from printsense import interpret  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402
from shared import print_recall  # noqa: E402
from shared.engine import Supervisor  # noqa: E402


def _b64(payload: bytes) -> str:
    return base64.b64encode(payload).decode()


def _graph(tag: str = "-3/F1") -> PrintSynthGraph:
    return PrintSynthGraph(devices=[Entity(tag=tag, type="fuse", evidence=tag, confidence=0.9)])


async def _run(*, photo_b64s, question="what is F1", package_context=None):
    return await Supervisor._interpret_print_anthropic_pages(
        MagicMock(),
        photo_b64s=photo_b64s,
        question=question,
        package_context=package_context if package_context is not None else {"drawing_type": "sch"},
    )


@pytest.fixture
def paid(monkeypatch):
    """Mock the paid boundary + is_configured; return the call counter."""
    calls = {"n": 0}

    def fake(pages, **kw):
        calls["n"] += 1
        return _graph()

    monkeypatch.setattr(interpret, "is_configured", lambda: True)
    monkeypatch.setattr(interpret, "interpret_print", fake)
    return calls


@pytest.fixture
def recall_on(tmp_path, monkeypatch):
    monkeypatch.setenv("PRINT_RECALL_ENABLED", "1")
    monkeypatch.setenv("PRINT_RECALL_DIR", str(tmp_path / "pr"))
    print_recall._cas_singleton = None
    print_recall._imports_ok_cache = None


async def test_enabled_identical_turns_pay_once(paid, recall_on):
    b = [_b64(b"page-A")]
    r1 = await _run(photo_b64s=b)
    r2 = await _run(photo_b64s=b)
    assert paid["n"] == 1  # the second turn was recalled — no model call
    assert r1 and r2  # non-empty rendered replies


async def test_enabled_different_question_pays_twice(paid, recall_on):
    b = [_b64(b"page-A")]
    await _run(photo_b64s=b, question="what is F1")
    await _run(photo_b64s=b, question="trace the estop")
    assert paid["n"] == 2  # behavior-preserving: a different question recomputes


async def test_enabled_different_context_pays_twice(paid, recall_on):
    b = [_b64(b"page-A")]
    await _run(photo_b64s=b, package_context={"drawing_type": "sch"})
    await _run(photo_b64s=b, package_context={"drawing_type": "panel"})
    assert paid["n"] == 2


async def test_disabled_uses_direct_call(paid, monkeypatch):
    monkeypatch.delenv("PRINT_RECALL_ENABLED", raising=False)
    b = [_b64(b"page-A")]
    await _run(photo_b64s=b)
    await _run(photo_b64s=b)
    assert paid["n"] == 2  # no recall -> the current direct-call behavior is preserved


async def test_recall_unavailable_uses_direct_call(paid, monkeypatch):
    monkeypatch.setenv("PRINT_RECALL_ENABLED", "1")
    monkeypatch.setattr(print_recall, "_imports_ok", lambda: False)
    b = [_b64(b"page-A")]
    await _run(photo_b64s=b)
    await _run(photo_b64s=b)
    assert paid["n"] == 2


async def test_rendered_reply_identical_fresh_vs_recalled(paid, recall_on):
    b = [_b64(b"page-A")]
    fresh = await _run(photo_b64s=b)
    recalled = await _run(photo_b64s=b)
    assert recalled == fresh  # byte-for-byte identical technician reply


async def test_no_user_facing_recall_marker(paid, recall_on):
    b = [_b64(b"page-A")]
    await _run(photo_b64s=b)
    reply = await _run(photo_b64s=b)  # recalled turn
    assert "recall" not in reply.lower()
    assert "cached" not in reply.lower()
