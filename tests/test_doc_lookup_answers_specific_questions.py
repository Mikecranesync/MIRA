"""A specific question with KB coverage gets the answer, not an announcement.

Measured on the synthetic QC run (2026-08-04). Asked four times, escalating, for
the default motor overload trip class on a GS10, MIRA replied every turn with:

    "I have the AutomationDirect GS10 manual indexed."

and nothing else. Scenario `direct_spec` scored 0/4 and `live_diagnosis_vfd` 1/8
on the same shape. This is the **ct-04 withheld-answer class** named in the
Answer Integrity PRD (`docs/prd/2026-08-03-mira-answer-integrity-and-validation-engine.md`
§2.2): the evidence was in hand and the answer was withheld anyway.

Cause: `_do_documentation_lookup`'s KB-hit branch used
`_message_is_specific_question` only to suppress a trailing menu. Its own
docstring says the predicate means "a real question that deserves a real answer"
— so on exactly those turns the reply became the possession claim alone.

Fix: hand off to `_handle_general_question`, whose step 2 already routes
vendor+coverage to the RAG worker so the reply carries citations. Its step 3 is
the mirror handoff (no coverage -> doc lookup), and `from_general` guards
re-entry.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

import pytest  # noqa: E402

from shared.engine import Supervisor  # noqa: E402


class _Recorder:
    """Stands in for `_handle_general_question` so the handoff is observable."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, chat_id, message, state, trace_id, *, tenant_id=None):
        self.calls.append((chat_id, message))
        return {"reply": "ANSWERED", "next_state": "IDLE"}


@pytest.fixture
def engine(monkeypatch, tmp_path):
    eng = Supervisor.__new__(Supervisor)  # no __init__: this test touches one method
    eng.db_path = str(tmp_path / "t.db")
    monkeypatch.setattr(eng, "_clear_diagnostic_carryover", lambda c, s, **k: s)
    monkeypatch.setattr(eng, "_record_exchange", lambda *a, **k: None)
    monkeypatch.setattr(
        eng, "_make_result", lambda reply, conf, tid, st=None, **k: {"reply": reply}
    )
    return eng


def _state() -> dict:
    return {"state": "IDLE", "exchange_count": 0, "context": {}, "asset_identified": ""}


@pytest.mark.asyncio
async def test_a_specific_question_with_coverage_is_answered_not_announced(engine, monkeypatch):
    import shared.engine as eng_mod

    monkeypatch.setattr(eng_mod, "kb_has_coverage", lambda *a, **k: (True, "hit"))
    monkeypatch.setattr(eng_mod, "kb_has_pair_coverage", lambda *a, **k: (True, 5))
    rec = _Recorder()
    monkeypatch.setattr(engine, "_handle_general_question", rec)

    out = await engine._do_documentation_lookup(
        "c1",
        "what is the default motor overload trip class on the GS10?",
        _state(),
        "trace",
        "tenant",
        vendor_override="AutomationDirect",
        model_override="GS10",
    )

    assert rec.calls, "a specific question with KB coverage must reach the answering path"
    assert "manual indexed" not in out.get("reply", "")


@pytest.mark.asyncio
async def test_a_bare_request_still_gets_the_possession_reply(engine, monkeypatch):
    """Both directions — 'got the manual?' is not a specific question, and the
    possession claim plus its menu is the right answer to it."""
    import shared.engine as eng_mod

    monkeypatch.setattr(eng_mod, "kb_has_coverage", lambda *a, **k: (True, "hit"))
    monkeypatch.setattr(eng_mod, "kb_has_pair_coverage", lambda *a, **k: (True, 5))
    rec = _Recorder()
    monkeypatch.setattr(engine, "_handle_general_question", rec)

    out = await engine._do_documentation_lookup(
        "c1", "manual?", _state(), "trace", "tenant", vendor_override="AutomationDirect"
    )

    assert not rec.calls
    assert "documentation indexed" in out.get("reply", "")


@pytest.mark.asyncio
async def test_the_handoff_cannot_re_enter(engine, monkeypatch):
    """`from_general=True` means we were already sent here by the answering path;
    handing back would bounce the turn between the two functions."""
    import shared.engine as eng_mod

    monkeypatch.setattr(eng_mod, "kb_has_coverage", lambda *a, **k: (True, "hit"))
    monkeypatch.setattr(eng_mod, "kb_has_pair_coverage", lambda *a, **k: (True, 5))
    rec = _Recorder()
    monkeypatch.setattr(engine, "_handle_general_question", rec)

    await engine._do_documentation_lookup(
        "c1",
        "what is the default motor overload trip class on the GS10?",
        _state(),
        "trace",
        "tenant",
        vendor_override="AutomationDirect",
        from_general=True,
    )

    assert not rec.calls


@pytest.mark.asyncio
async def test_a_maintenance_gap_question_still_admits_the_gap(engine, monkeypatch):
    """Both directions — the lubrication/PM carve-out is answered honestly by the
    doc-lookup path itself and must stay AHEAD of the handoff."""
    import shared.engine as eng_mod

    monkeypatch.setattr(eng_mod, "kb_has_coverage", lambda *a, **k: (True, "hit"))
    monkeypatch.setattr(eng_mod, "kb_has_pair_coverage", lambda *a, **k: (True, 5))
    rec = _Recorder()
    monkeypatch.setattr(engine, "_handle_general_question", rec)

    out = await engine._do_documentation_lookup(
        "c1",
        "what is the lubrication schedule for this gearbox?",
        _state(),
        "trace",
        "tenant",
        vendor_override="AutomationDirect",
    )

    assert not rec.calls
    assert "KB-gap" in out.get("reply", "")
