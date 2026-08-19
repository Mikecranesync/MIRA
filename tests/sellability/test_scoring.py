"""The benchmark scorer must be able to FAIL for the right reason.

`benchmark.py` produces the number cited in the go/no-go decision, so its scorer
is load-bearing evidence and gets tested like production code.

Its first version accepted any `structured_fault` stream at any rank for a fault
case — never comparing the returned code or model to the one asked about, and
never requiring rank 1. An unrelated F013 row at rank 7 scored a pass, and the
report could truthfully print "8/8" while claiming "at rank 1" on the strength of
neither clause (Codex #3337 F2).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.sellability.benchmark import _score  # noqa: E402

CASE = ("f-01", "fault", "PowerFlex 525 showing F004. What does that fault mean?", "F004")


def _row(content: str, model: str = "PowerFlex 525", structured: bool = True) -> dict:
    return {
        "content": content,
        "model_number": model,
        "manufacturer": "Allen-Bradley",
        "retrieval_streams": ["structured_fault"] if structured else ["bm25"],
    }


def _prose(n: int = 5) -> list[dict]:
    return [_row("some manual prose", structured=False) for _ in range(n)]


def test_correct_row_at_rank_one_passes():
    ok, why = _score(CASE, [_row("FAULT CODE F004 — Undervoltage")] + _prose())
    assert ok, why
    assert "rank 1" in why


def test_wrong_fault_code_at_rank_one_fails():
    """An F013 row does not answer an F004 question."""
    ok, why = _score(CASE, [_row("FAULT CODE F013 — Ground Fault")] + _prose())
    assert not ok
    assert "not F004" in why


def test_correct_code_for_another_model_fails():
    """Right code, wrong machine — the citation would be false."""
    ok, why = _score(
        CASE, [_row("FAULT CODE F004 — Undervoltage", model="PowerFlex 750")] + _prose()
    )
    assert not ok
    assert "not PowerFlex 525" in why


def test_correct_row_below_rank_one_fails():
    """Rank matters: the prompt is truncated, and rank 7 may never be seen."""
    rows = _prose(6) + [_row("FAULT CODE F004 — Undervoltage")]
    ok, why = _score(CASE, rows)
    assert not ok
    assert "rank 7" in why


def test_no_structured_row_fails():
    ok, why = _score(CASE, _prose())
    assert not ok
    assert "falls through to prose" in why


def test_refuse_family_fails_when_a_structured_row_is_asserted():
    """The precision half: a fabricated code must not produce authority."""
    case = ("r-01", "refuse", "PowerFlex 525 showing F999. What is that?", None)
    ok, _ = _score(case, [_row("FAULT CODE F999 — Invented")])
    assert not ok
    ok2, _ = _score(case, _prose())
    assert ok2, "refusing correctly is a pass, not a miss"


def test_prefix_collision_fails():
    """`F0040` is not `F004` — substring matching passed it (round 2 F2)."""
    rows = [_row("FAULT CODE F0040 — Something", model="Model 5250")] + _prose()
    ok, why = _score(CASE, rows)
    assert not ok, why


def test_wrong_manufacturer_fails():
    """Right code, right model string, WRONG vendor — vendor was unchecked."""
    row = _row("FAULT CODE F004 — Undervoltage")
    row["manufacturer"] = "WrongCo"
    ok, why = _score(CASE, [row] + _prose())
    assert not ok
    assert "vendor" in why


def test_code_only_in_unrelated_prose_fails():
    """The code must be in the structured row, not merely mentioned somewhere."""
    rows = [_row("Replacement finger guard for power terminals")] + _prose()
    ok, why = _score(CASE, rows)
    assert not ok


def test_content_cannot_satisfy_the_identity_check():
    """Round 3 F2: prose mentioning the right identity must not rescue wrong fields."""
    row = _row("FAULT CODE F004 — Undervoltage. See Allen-Bradley PowerFlex 525 manual.")
    row["model_number"] = "PowerFlex 750"
    row["manufacturer"] = "WrongCo"
    ok, why = _score(CASE, [row] + _prose())
    assert not ok, why


def test_missing_identity_fields_fail_closed():
    row = _row("FAULT CODE F004 — Undervoltage")
    row["model_number"] = None
    row["manufacturer"] = None
    ok, _ = _score(CASE, [row] + _prose())
    assert not ok
