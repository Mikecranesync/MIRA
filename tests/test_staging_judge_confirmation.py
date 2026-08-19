"""Offline tests for the staging-gate judge confirmation re-draw (#3195).

A single judge draw is not deterministic even at temperature=0: one spurious
per-dim 1 on any of 15 questions hard-failed the whole required check on
engine code byte-identical to main. The fix: a hard-failing draw needs a
second independent draw to agree before the hard fail counts.

These tests run fully offline with stubbed draws — no model, no network.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

# Loaded by path: tools/ is not a package. The module imports shared.engine at
# top level (it patches sys.path itself); if that import breaks in this env the
# tests ERROR loudly rather than silently skipping — that is deliberate.
_SPEC_PATH = Path(__file__).resolve().parents[1] / "tools" / "staging_test.py"
_spec = importlib.util.spec_from_file_location("staging_test", _SPEC_PATH)
assert _spec is not None and _spec.loader is not None
st = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("staging_test", st)
_spec.loader.exec_module(st)


def make_score(g=5, c=5, a=5, s=5, t=5, reason="stub"):
    return st.Score(
        grounding=g, context=c, actionability=a, safety=s, tone=t, judge_reason=reason
    )


def drawer(*scores):
    """Async draw stub yielding the given scores in order; counts calls."""
    calls = {"n": 0}

    async def draw():
        idx = min(calls["n"], len(scores) - 1)
        calls["n"] += 1
        return scores[idx]

    return draw, calls


@pytest.mark.asyncio
async def test_clean_draw_passes_without_redraw():
    draw, calls = drawer(make_score())
    score, reasons = await st.judge_with_confirmation(draw, "q1")
    assert reasons == []
    assert calls["n"] == 1  # no score-shopping on passing draws


@pytest.mark.asyncio
async def test_spurious_hard_fail_cleared_by_confirmation():
    noisy = make_score(g=1, c=1, a=2, reason="override ignored")
    clean = make_score(g=5, c=5, a=5, reason="asks needed clarification")
    draw, calls = drawer(noisy, clean)
    score, reasons = await st.judge_with_confirmation(draw, "session-followup")
    assert reasons == []
    assert calls["n"] == 2
    assert "[redraw-cleared" in score.judge_reason


@pytest.mark.asyncio
async def test_genuine_hard_fail_confirmed_by_both_draws():
    bad1 = make_score(g=1, c=2, a=1, reason="invented plant facts")
    bad2 = make_score(g=1, c=1, a=2, reason="fabricated WO status")
    draw, calls = drawer(bad1, bad2)
    score, reasons = await st.judge_with_confirmation(draw, "cmms-context")
    assert f"dim_below_{st.HARD_FAIL_BELOW}" in reasons
    assert calls["n"] == 2
    assert "[redraw-confirmed]" in score.judge_reason


@pytest.mark.asyncio
async def test_safety_hard_fail_requires_confirmation_too():
    unsafe = make_score(s=1, reason="no LOTO callout")
    draw, calls = drawer(unsafe, unsafe)
    score, reasons = await st.judge_with_confirmation(draw, "safety-arc-flash")
    assert "safety_hard_fail" in reasons
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_safety_flake_cleared_but_not_shopped():
    """A one-off safety=1 clears on a clean confirmation; the cleared draw's
    dims are preserved in the reason string for the artifact."""
    unsafe = make_score(s=1)
    safe = make_score(s=5)
    draw, calls = drawer(unsafe, safe)
    score, reasons = await st.judge_with_confirmation(draw, "safety-loto")
    assert reasons == []
    assert score.safety == 5
    assert "[redraw-cleared" in score.judge_reason


def test_judge_effort_is_medium_for_gpt_oss():
    """#3195 calibration: the gpt-oss judge runs at medium effort with 1024-cap
    (the #3190 DeepEval precedent). Guard against silent regression to low/400."""
    src = _SPEC_PATH.read_text(encoding="utf-8")
    assert '"reasoning_effort"] = "medium"' in src
    assert '"max_tokens": 1024' in src


# ---------------------------------------------------------------------------
# Confirmation must agree on WHICH dimension is deficient (2026-08-19).
#
# The old logic confirmed a hard fail whenever the second draw ALSO hard-failed
# on *something*. With five dimensions and a noisy judge, two independent draws
# frequently both dip below the floor on DIFFERENT dimensions — which says the
# judge is unstable, not that the reply is bad. That failed `staging-gate`, a
# REQUIRED check, on a PR whose diff could not reach the graded path at all.
# ---------------------------------------------------------------------------


def test_hard_fail_reasons_name_the_specific_dimension():
    reasons = st._hard_fail_reasons(make_score(g=1, c=2, a=4, s=5, t=5))
    assert reasons == ["dim_below_2:grounding"]


def test_hard_fail_reasons_lists_every_deficient_dimension():
    reasons = st._hard_fail_reasons(make_score(g=1, c=5, a=1, s=5, t=5))
    assert reasons == ["dim_below_2:grounding", "dim_below_2:actionability"]


@pytest.mark.asyncio
async def test_disagreeing_draws_do_not_confirm_a_hard_fail():
    """The exact draw pair observed on the 2026-08-19 staging-gate failure.

    draw 1  grounding=1 context=2 actionability=4 safety=1 tone=5
    draw 2  grounding=2 context=2 actionability=1 safety=5 tone=3

    Draw 1 indicts grounding and safety; draw 2 rates those 2 and 5 and indicts
    actionability instead. No dimension is agreed on, so this is judge noise and
    must NOT fail the gate.
    """
    draw, calls = drawer(
        make_score(g=1, c=2, a=4, s=1, t=5),
        make_score(g=2, c=2, a=1, s=5, t=3),
    )
    score, reasons = await st.judge_with_confirmation(draw, "oem-model-fault-powerflex-f004")
    assert reasons == [], f"judge noise confirmed as a hard fail: {reasons}"
    assert calls["n"] == 2, "confirmation draw must still be taken"
    assert "redraw-cleared" in score.judge_reason


@pytest.mark.asyncio
async def test_agreeing_draws_still_confirm_a_hard_fail():
    """A genuinely bad reply reproduces the SAME deficiency — must still fail."""
    draw, calls = drawer(
        make_score(g=1, c=5, a=5, s=5, t=5),
        make_score(g=1, c=4, a=5, s=5, t=4),
    )
    score, reasons = await st.judge_with_confirmation(draw, "q")
    assert reasons == ["dim_below_2"], f"real hard fail was cleared: {reasons}"
    assert calls["n"] == 2
    assert "redraw-confirmed" in score.judge_reason


@pytest.mark.asyncio
async def test_partial_agreement_confirms_only_the_agreed_dimension():
    """Draw 1 indicts two dims, draw 2 agrees on one. That one counts."""
    draw, _ = drawer(
        make_score(g=1, c=5, a=1, s=5, t=5),
        make_score(g=1, c=5, a=5, s=5, t=5),
    )
    score, reasons = await st.judge_with_confirmation(draw, "q")
    assert reasons == ["dim_below_2"]
    assert "dim_below_2:grounding" in score.judge_reason


@pytest.mark.asyncio
async def test_safety_hard_fail_still_requires_agreement():
    """safety<=1 is its own reason and is dimension-specific already."""
    draw, _ = drawer(
        make_score(g=5, c=5, a=5, s=1, t=5),
        make_score(g=5, c=5, a=5, s=5, t=5),
    )
    _, reasons = await st.judge_with_confirmation(draw, "q")
    assert reasons == [], "a lone safety draw must not fail the gate alone"

    draw2, _ = drawer(
        make_score(g=5, c=5, a=5, s=1, t=5),
        make_score(g=5, c=5, a=5, s=1, t=5),
    )
    _, reasons2 = await st.judge_with_confirmation(draw2, "q")
    assert "safety_hard_fail" in reasons2, "a REPRODUCED safety failure must still fail"


def test_reported_reasons_stay_report_compatible():
    """The scorecard's `fail` column keeps its historical labels."""
    assert st._reported_reasons(
        ["dim_below_2:grounding", "dim_below_2:safety", "safety_hard_fail"]
    ) == ["dim_below_2", "safety_hard_fail"]


@pytest.mark.asyncio
async def test_clean_first_draw_is_never_redrawn():
    """Negative control — scores must not be shopped for."""
    draw, calls = drawer(make_score(), make_score(g=1))
    _, reasons = await st.judge_with_confirmation(draw, "q")
    assert reasons == []
    assert calls["n"] == 1, "a clean draw must not trigger a second judge call"
