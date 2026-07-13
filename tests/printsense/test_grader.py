"""Tests for the deterministic PrintSense grader (no LLM, no network).

The grader is the measuring instrument for the D->A work, so it must itself be
trustworthy: a clean read scores A, the documented Response-A confident misreads
(``-WK902`` for ``-W5497`` etc.) drop F1 and cap the letter, digit drift is never a
hit, and a self-promoted `trust` fails hard. These fixtures inject exactly those
errors and assert the grader reacts.
"""

import json
from pathlib import Path

import pytest

from printsense import grader  # noqa: E402

_RUBRIC = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "printsense/benchmarks/scu2_sheet20/rubric.json"
    ).read_text(encoding="utf-8")
)


def _perfect_graph() -> dict:
    """A clean, upright read of SCU2 sheet 20 — every expected tag present, all
    proposed, nothing misread."""
    return {
        "package": {"drawing_no": "AP31971", "cabinet": "+SCU2", "sheet": "20"},
        "devices": [
            {
                "tag": "-21/A13",
                "type": "ITS.LWL-K-01.2",
                "detail": "Occupied Upstream opto-coupler; LWL IN, DIG OUT",
                "connects": ["-W5497", "15.7", "-X3.9", "X24V.41", "X0V.41", "20.9", "+SCU2-BEL"],
                "trust": "proposed",
            },
            {
                "tag": "-21/A14",
                "type": "ITS.LWL-K-01.2",
                "detail": "Occupied Downstream opto-coupler; LWL OUT, DIG IN",
                "connects": ["-W5469", "16.6", "-X4.6", "X24V.41", "X0V.41", "20.9", "+SCU1-BEL"],
                "trust": "proposed",
            },
        ],
        "cables": [
            {"tag": "-W5497", "type": "POF fiber", "trust": "proposed"},
            {"tag": "-W5469", "type": "POF fiber", "trust": "proposed"},
        ],
        "off_page_references": [
            {"tag": "-X3.9", "connects": ["15.7"], "trust": "proposed"},
            {"tag": "-X4.6", "connects": ["16.6"], "trust": "proposed"},
            {"tag": "+SCU1/21.2", "trust": "proposed"},
            {"tag": "+SD3/0/21.7", "trust": "proposed"},
        ],
        "unresolved": [],
    }


def _response_a_graph() -> dict:
    """The documented D-grade run: -21 misread as J1, wire numbers misread as
    -WK902/-WK901, +SCU-BEL as 24VDC-BEL, 15.7/-X3.9 as 157/X3.5, title block missed."""
    return {
        "package": {},  # title block missed entirely
        "devices": [
            {
                "tag": "-21/J1",
                "detail": "sensed A13/A14 but the -21 prefix misread; Occupied Upstream/Downstream",
                "trust": "proposed",
            }
        ],
        "cables": [
            {"tag": "-WK902", "trust": "proposed"},
            {"tag": "-WK901", "trust": "proposed"},
            {"tag": "24VDC-BEL", "trust": "proposed"},
        ],
        "off_page_references": [
            {"tag": "157", "connects": ["X3.5"], "trust": "proposed"},
            {"tag": "16.1", "connects": ["X4.6"], "trust": "proposed"},
        ],
        "unresolved": [{"item": "red continuation arrows", "status": "unresolved"}],
    }


def test_perfect_read_is_A():
    r = grader.grade(_perfect_graph(), _RUBRIC)
    assert r["is_A"] is True, grader.format_report(r)
    assert r["overall"] >= grader.A_OVERALL
    assert r["confident_misreads"] == 0
    assert r["trust_violations"] == 0
    assert r["device"]["f1"] == 1.0 and r["wire"]["f1"] == 1.0
    assert r["letter"] == "A"


def test_response_a_has_confident_misreads_and_is_not_A():
    r = grader.grade(_response_a_graph(), _RUBRIC)
    assert r["is_A"] is False
    # J1 (device), WK902 + WK901 + 24VDC-BEL (wire), 157 (xref) were all asserted.
    assert r["confident_misreads"] >= 4
    assert r["device"]["f1"] < grader.A_TAG_F1
    assert r["wire"]["f1"] < grader.A_TAG_F1
    assert r["scores"]["package"] == 0.0  # title block missed
    # The deterministic grader is harsher than the holistic 43%/D human read in
    # the .md — it scores near-zero because almost every specific tag was misread.
    # The letter is at most C (the misread cap); a mostly-wrong read lands D/F.
    assert r["letter"] in ("C", "D", "F")


def test_one_confident_misread_caps_an_otherwise_A_read():
    """The load-bearing rule: overall can be >=90 but a SINGLE confident misread
    caps the letter at C and fails the A gate. Perfect read + one bad wire tag."""
    g = _perfect_graph()
    g["cables"].append({"tag": "-WK902", "trust": "proposed"})  # one confident misread
    r = grader.grade(g, _RUBRIC)
    assert r["confident_misreads"] == 1
    assert r["overall"] >= grader.A_OVERALL  # still a high total...
    assert r["letter"] == "C"  # ...but capped at C
    assert r["is_A"] is False  # and the gate fails (misread + wire F1 < 0.85)
    assert r["gates"]["zero_confident_misreads"] is False


def test_digit_drift_is_not_a_hit():
    """157 must not satisfy expected 15.7, and it must count as a misread."""
    r = grader.grade(_response_a_graph(), _RUBRIC)
    assert "15.7" in r["xref"]["missed"]
    assert "157" in r["xref"]["misreads"]


def test_confidence_gated_unreadable_is_not_a_misread():
    """A guess demoted to UNREADABLE (tag rewritten, guess parked in evidence) must
    NOT be scored as a confident misread — the honesty term must not punish honesty."""
    g = {
        "package": {"drawing_no": "AP31971", "cabinet": "+SCU2", "sheet": "20"},
        "cables": [
            # the interpreter's confidence gate rewrote a low-conf -WK902 guess:
            {"tag": "UNREADABLE", "evidence": "low-confidence guess: -WK902", "trust": "unresolved"},
        ],
    }
    r = grader.grade(g, _RUBRIC)
    assert r["confident_misreads"] == 0  # the parked guess in evidence is not counted
    assert r["trust_violations"] == 0


def test_trust_violation_fails_hard():
    """A fresh interpretation that self-promotes to machine_verified/human_verified
    zeroes honesty and fails the gate."""
    g = _perfect_graph()
    g["devices"][0]["trust"] = "human_verified"
    r = grader.grade(g, _RUBRIC)
    assert r["trust_violations"] == 1
    assert r["scores"]["honesty"] == 0.0
    assert r["gates"]["zero_trust_violations"] is False
    assert r["is_A"] is False
    assert r["letter"] == "F"


def test_machine_verified_is_not_a_trust_violation():
    """machine_verified is a legitimate Phase-3 state (earned by independent
    agreement) — NOT a machine trust violation; only human_verified is."""
    g = _perfect_graph()
    g["devices"][0]["trust"] = "machine_verified"
    r = grader.grade(g, _RUBRIC)
    assert r["trust_violations"] == 0
    assert r["scores"]["honesty"] > 0
    assert r["gates"]["zero_trust_violations"] is True
    assert r["letter"] != "F"


def test_missing_pydantic_not_required():
    """Grader operates on plain dicts/JSON — no pydantic import needed."""
    r = grader.grade(json.dumps(_perfect_graph()), _RUBRIC)
    assert r["overall"] >= grader.A_OVERALL


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
