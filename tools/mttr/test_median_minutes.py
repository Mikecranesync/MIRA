"""Tests for the failure-penalized median-minutes tool (Pain 3 metric).

A completed session is outcome "resolved" with a non-null first_cited_step_at;
elapsed = first_cited_step_at - fault_asked_at in minutes. Every other session
ranks at +infinity for the median. Percentiles use completed sessions only.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import median_minutes as mm
import pytest

T0 = "2026-10-31T10:00:00+00:00"


def _at(minutes: float) -> str:
    """ISO timestamp `minutes` after T0 (UTC)."""
    from datetime import datetime, timedelta

    base = datetime.fromisoformat(T0)
    return (base + timedelta(minutes=minutes)).isoformat()


def done(sid: str, minutes: float, arm: str | None = "A") -> dict:
    s = {
        "session_id": sid,
        "fault_asked_at": T0,
        "first_cited_step_at": _at(minutes),
        "outcome": "resolved",
    }
    if arm is not None:
        s["arm"] = arm
    return s


def failed(sid: str, arm: str | None = "A", cited: bool = True) -> dict:
    s = {
        "session_id": sid,
        "fault_asked_at": T0,
        "first_cited_step_at": _at(4) if cited else None,
        "outcome": "failed",
    }
    if arm is not None:
        s["arm"] = arm
    return s


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return path


# --- control cases: all completed, all failed, odd/even n, mixed arms ---


def test_all_completed_odd_n_median_is_middle_value():
    rows = [done("a", 2), done("b", 8), done("c", 5)]
    stats = mm.summarize(rows)["overall"]
    assert stats["n"] == 3
    assert stats["completed"] == 3
    assert stats["completion_rate"] == pytest.approx(1.0)
    assert stats["median_minutes"] == pytest.approx(5.0)
    assert stats["median_is_inf"] is False


def test_all_completed_even_n_median_is_mean_of_two_middle_values():
    rows = [done("a", 1), done("b", 2), done("c", 4), done("d", 10)]
    stats = mm.summarize(rows)["overall"]
    assert stats["n"] == 4
    assert stats["median_minutes"] == pytest.approx(3.0)


def test_all_failed_median_is_infinite_and_completion_is_zero():
    rows = [failed("a"), failed("b"), failed("c", cited=False)]
    stats = mm.summarize(rows)["overall"]
    assert stats["n"] == 3
    assert stats["completed"] == 0
    assert stats["completion_rate"] == pytest.approx(0.0)
    assert stats["median_is_inf"] is True
    assert stats["median_minutes"] is None
    assert stats["p25_minutes"] is None
    assert stats["p75_minutes"] is None


def test_mixed_even_n_failures_in_upper_half_keep_finite_median():
    # 5 completed + 3 failed: sorted penalized = 1,2,3,4,5,inf,inf,inf; n=8, middles 4 and 5.
    rows = [done("a", 1), done("b", 2), done("c", 3), done("d", 4), done("e", 5)]
    rows += [failed("f"), failed("g"), failed("h")]
    stats = mm.summarize(rows)["overall"]
    assert stats["n"] == 8
    assert stats["completed"] == 5
    assert stats["completion_rate"] == pytest.approx(5 / 8)
    assert stats["median_minutes"] == pytest.approx(4.5)
    assert stats["median_is_inf"] is False


def test_failures_majority_makes_median_infinite():
    rows = [done("a", 1), done("b", 2), failed("c"), failed("d"), failed("e")]
    stats = mm.summarize(rows)["overall"]
    # sorted penalized: 1,2,inf,inf,inf; median is the middle inf.
    assert stats["median_is_inf"] is True
    assert stats["median_minutes"] is None
    # percentiles still describe completed sessions only.
    assert stats["p25_minutes"] == pytest.approx(1.25)
    assert stats["p75_minutes"] == pytest.approx(1.75)


def test_even_n_with_one_infinite_middle_is_infinite():
    # 2 completed + 2 failed: sorted 1,2,inf,inf; middles are 2 and inf.
    rows = [done("a", 1), done("b", 2), failed("c"), failed("d")]
    stats = mm.summarize(rows)["overall"]
    assert stats["median_is_inf"] is True
    assert stats["median_minutes"] is None


def test_mixed_arms_are_reported_separately_and_overall():
    rows = [
        done("a1", 2, arm="control"),
        done("a2", 6, arm="control"),
        failed("a3", arm="control"),
        done("b1", 3, arm="mira"),
        done("b2", 5, arm="mira"),
        done("b3", 7, arm="mira"),
    ]
    out = mm.summarize(rows)
    assert set(out["arms"]) == {"control", "mira"}
    control = out["arms"]["control"]
    assert control["n"] == 3
    assert control["completed"] == 2
    assert control["completion_rate"] == pytest.approx(2 / 3)
    # penalized: 2, 6, inf -> median 6
    assert control["median_minutes"] == pytest.approx(6.0)
    mira = out["arms"]["mira"]
    assert mira["n"] == 3
    assert mira["completion_rate"] == pytest.approx(1.0)
    assert mira["median_minutes"] == pytest.approx(5.0)
    overall = out["overall"]
    assert overall["n"] == 6
    assert overall["completed"] == 5
    # penalized sorted: 2,3,5,6,7,inf -> even n, middles 5 and 6.
    assert overall["median_minutes"] == pytest.approx(5.5)


def test_missing_arm_is_grouped_as_unlabeled():
    rows = [done("a", 4, arm=None), done("b", 6, arm="x")]
    out = mm.summarize(rows)
    assert set(out["arms"]) == {"unlabeled", "x"}
    assert out["arms"]["unlabeled"]["median_minutes"] == pytest.approx(4.0)


# --- classification rules ---


def test_resolved_without_cited_step_counts_as_unsuccessful():
    row = {
        "session_id": "x",
        "fault_asked_at": T0,
        "first_cited_step_at": None,
        "outcome": "resolved",
    }
    assert mm.penalized_minutes(row) == math.inf


def test_abandoned_with_cited_step_counts_as_unsuccessful():
    row = done("x", 3)
    row["outcome"] = "abandoned"
    assert mm.penalized_minutes(row) == math.inf


def test_completed_session_elapsed_minutes_fractional():
    row = {
        "session_id": "x",
        "fault_asked_at": "2026-10-31T10:00:00Z",
        "first_cited_step_at": "2026-10-31T10:02:30Z",
        "outcome": "resolved",
    }
    assert mm.penalized_minutes(row) == pytest.approx(2.5)


# --- percentiles (completed only, linear interpolation) ---


def test_percentiles_use_linear_interpolation_on_completed_only():
    rows = [done("a", 1), done("b", 2), done("c", 3), done("d", 4)]
    stats = mm.summarize(rows)["overall"]
    assert stats["p25_minutes"] == pytest.approx(1.75)
    assert stats["p75_minutes"] == pytest.approx(3.25)


def test_single_completed_session_percentiles_equal_value():
    stats = mm.summarize([done("a", 9)])["overall"]
    assert stats["p25_minutes"] == pytest.approx(9.0)
    assert stats["p75_minutes"] == pytest.approx(9.0)


# --- input validation fails loudly ---


def test_unknown_outcome_raises(tmp_path):
    bad = done("a", 1)
    bad["outcome"] = "maybe"
    with pytest.raises(ValueError):
        mm.penalized_minutes(bad)


def test_cited_before_asked_raises():
    bad = done("a", 1)
    bad["first_cited_step_at"] = _at(-5)
    with pytest.raises(ValueError):
        mm.penalized_minutes(bad)


def test_naive_timestamp_raises():
    bad = done("a", 1)
    bad["fault_asked_at"] = "2026-10-31T10:00:00"
    with pytest.raises(ValueError):
        mm.penalized_minutes(bad)


def test_empty_input_raises(tmp_path):
    empty = write_jsonl(tmp_path / "empty.jsonl", [])
    with pytest.raises(ValueError):
        mm.summarize(mm.load_sessions(str(empty)))


# --- CLI: table plus one JSON line ---


def test_main_prints_table_and_single_json_line(tmp_path, capsys):
    src = write_jsonl(tmp_path / "in.jsonl", [done("a", 2), failed("b"), failed("c")])
    rc = mm.main([str(src)])
    assert rc == 0
    lines = capsys.readouterr().out.strip().splitlines()
    json_lines = [ln for ln in lines if ln.startswith("{")]
    assert len(json_lines) == 1
    payload = json.loads(json_lines[0])
    assert payload["overall"]["n"] == 3
    assert payload["overall"]["median_minutes"] is None
    assert payload["overall"]["median_is_inf"] is True
    assert any("inf" in ln for ln in lines if not ln.startswith("{"))


def test_main_exit_code_2_on_invalid_row(tmp_path, capsys):
    bad = done("a", 1)
    bad["outcome"] = "nope"
    src = write_jsonl(tmp_path / "in.jsonl", [bad])
    assert mm.main([str(src)]) == 2
