"""The report card grades only what was graded, and its letters mean what they say."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "bench_report_card", Path(__file__).resolve().parents[1] / "scripts" / "bench_report_card.py"
)
card = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(card)


def _side(total, v):
    dims = [d for d, _ in card.SUBJECTS]
    return {"total": total, "scores": {d: (None if total is None else v) for d in dims}}


def test_letter_bands():
    assert [card.letter(p) for p in (95, 90, 85, 72, 61, 10)] == ["A", "A", "B", "C", "D", "F"]


def test_ungraded_question_is_excluded_not_averaged_as_zero():
    raw = {
        "meta": {"mira_source": "quickstart"},
        "results": [
            {"grounded_score": _side(30, 5), "baseline_score": _side(20, 3)},
            {"grounded_score": _side(None, None), "baseline_score": _side(20, 3)},
        ],
    }
    text = card.render(raw)
    assert "1/2 questions had both answers graded" in text
    # correctness row: only the graded question counts -> MIRA 5.0/5 = A
    assert "| Correctness — are the technical facts right? | 5.0/5 | **A** | 3.0/5 | D |" in text


def test_nothing_graded_is_inconclusive():
    raw = {
        "meta": {},
        "results": [{"grounded_score": _side(None, None), "baseline_score": _side(None, None)}],
    }
    assert "INCONCLUSIVE" in card.render(raw)
