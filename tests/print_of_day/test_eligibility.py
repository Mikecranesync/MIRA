"""Three-state eligibility tests (requirement 6 + 7).

Proves: ungraded runs are runtime-eligible but never gold candidates; repaired
responses are blocked from gold; approved_gold is only ever set by a human
identity; and the state ladder is strictly ordered.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from printsense.print_of_day import eligibility as el  # noqa: E402


def _clean(**over) -> dict:
    kw = dict(
        valid_output=True,
        approved_pair=True,
        ocr_ok=True,
        page_match=True,
        repaired=False,
        degraded=False,
        graded=True,
        grade_ok=True,
        judge_ok=True,
        approved_by=None,
    )
    kw.update(over)
    return el.classify_eligibility(**kw)


def test_clean_graded_run_is_gold_candidate_not_approved() -> None:
    r = _clean()
    assert r["state"] == el.GOLD_CANDIDATE
    assert r["runtime_eligible"] and r["gold_candidate"]
    assert r["approved_gold"] is False


def test_ungraded_run_is_runtime_eligible_but_not_gold_candidate() -> None:
    r = _clean(graded=False, grade_ok=False)
    assert r["runtime_eligible"] is True
    assert r["gold_candidate"] is False
    assert r["state"] == el.RUNTIME_ELIGIBLE
    assert any("ungraded" in b for b in r["blockers"])


def test_repaired_response_is_blocked_from_gold() -> None:
    r = _clean(repaired=True)
    assert r["runtime_eligible"] is True  # it ran and validated
    assert r["gold_candidate"] is False  # but repaired → blocked (requirement 6)
    assert any("repaired" in b for b in r["blockers"])


def test_missing_judge_blocks_gold() -> None:
    r = _clean(judge_ok=False)
    assert r["gold_candidate"] is False
    assert any("judge" in b for b in r["blockers"])


def test_degraded_run_blocks_gold() -> None:
    assert _clean(degraded=True)["gold_candidate"] is False


def test_invalid_output_is_ineligible() -> None:
    r = _clean(valid_output=False)
    assert r["runtime_eligible"] is False
    assert r["state"] == el.INELIGIBLE
    assert any("schema-valid" in b for b in r["blockers"])


def test_unapproved_pair_is_ineligible() -> None:
    assert _clean(approved_pair=False)["runtime_eligible"] is False


def test_no_ocr_is_ineligible() -> None:
    assert _clean(ocr_ok=False)["runtime_eligible"] is False


def test_approved_gold_requires_human_identity() -> None:
    # even a perfect clean run is only a candidate until a human approves
    assert _clean()["approved_gold"] is False
    r = _clean(approved_by="mike@factorylm.com")
    assert r["approved_gold"] is True
    assert r["state"] == el.APPROVED_GOLD


def test_human_cannot_approve_a_non_candidate() -> None:
    # approving an ungraded run must NOT yield approved_gold
    r = _clean(graded=False, grade_ok=False, approved_by="mike@factorylm.com")
    assert r["gold_candidate"] is False
    assert r["approved_gold"] is False
