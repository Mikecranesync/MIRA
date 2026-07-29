"""Funnel analytics — taxonomy, content-leak prevention, qualification (PR-4)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense.funnel import EVENTS, Funnel, Survey, qualify_pilot  # noqa: E402


def _survey(**over):
    base = dict(saved_time=True, identified_useful=True,
                would_trust_troubleshooting=True,
                has_complete_package=True, consider_paid_pilot=True)
    base.update(over)
    return Survey(**base)


def test_event_taxonomy_enforced(tmp_path):
    f = Funnel(tmp_path)
    for e in EVENTS:
        f.emit(e, "t1", "i1")
    with pytest.raises(ValueError):
        f.emit("made_up_event", "t1", "i1")
    assert f.counts()["report_delivered"] == 1


def test_analytics_cannot_carry_content(tmp_path):
    f = Funnel(tmp_path)
    with pytest.raises(ValueError):
        f.emit("upload_completed", "t1", "i1",
               props={"question_text": "why does K01 trip"})
    with pytest.raises(ValueError):
        f.emit("upload_completed", "t1", "i1",
               props={"files": "the whole confidential filename.pdf"})
    ok = f.emit("upload_completed", "t1", "i1",
                props={"files": 3, "pages": 5, "failed_stage": "ocr"})
    assert ok["props"] == {"files": 3, "pages": 5, "failed_stage": "ocr"}
    text = f.path.read_text(encoding="utf-8")
    assert "confidential" not in text and "K01" not in text


def test_survey_schema_strict():
    with pytest.raises(Exception):
        Survey(saved_time=True, identified_useful=True,
               would_trust_troubleshooting=True, has_complete_package=True,
               consider_paid_pilot=True, free_text="not allowed here")


def test_pilot_qualification_truth_table():
    assert qualify_pilot(_survey(), True, True) == (
        True, "interest+package+reviewer_suitable")
    assert qualify_pilot(_survey(), False, True)[0] is True  # survey interest
    assert qualify_pilot(_survey(consider_paid_pilot=False), False, True) == (
        False, "no_pilot_interest_expressed")
    assert qualify_pilot(_survey(has_complete_package=False), True, True) == (
        False, "no_complete_package_available")
    assert qualify_pilot(_survey(), True, False) == (
        False, "reviewer_did_not_mark_suitable")
