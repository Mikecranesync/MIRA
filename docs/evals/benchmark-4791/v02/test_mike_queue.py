"""Tests for mike_queue.py: who qualifies, and what still goes to Mike. Synthetic labels in a temp dir only.

uv run --no-project --python 3.12 --with pytest python -m pytest -q v02/test_mike_queue.py
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mike_queue as M  # noqa: E402


def setup(
    tmp_path,
    monkeypatch,
    cal_hits: dict[str, int],
    forum_labels: dict[str, list[list[int]]],
    n_cal=10,
    n_safety=3,
):
    bench, here = tmp_path / "bench", tmp_path / "bench" / "v02"
    (bench / "oem-fault").mkdir(parents=True)
    (bench / "human-key").mkdir()
    qs = [{"id": f"c{i}", "accepted": [i + 1]} for i in range(n_cal)]
    (bench / "oem-fault" / "oem-fault-questions.json").write_text(json.dumps(qs))
    forum = [
        {"id": f"f{i}", "pages": [1, 2, 3]} for i in range(len(next(iter(forum_labels.values()))))
    ]
    (bench / "human-key" / "review-data.json").write_text(
        json.dumps({"forum": forum, "safety": [{"id": f"s{i}"} for i in range(n_safety)]})
    )
    for model, hits in cal_hits.items():
        d = here / "labels" / model / "calibration"
        d.mkdir(parents=True)
        for i, q in enumerate(qs):
            (d / f"{q['id']}.json").write_text(
                json.dumps({"answer_pages": q["accepted"] if i < hits else [99], "parsed": True})
            )
        f = here / "labels" / model / "forum-new"
        f.mkdir(parents=True)
        for i, pages in enumerate(forum_labels[model]):
            (f / f"f{i}.json").write_text(json.dumps({"answer_pages": pages, "parsed": True}))
    monkeypatch.setattr(M, "HERE", str(here))
    monkeypatch.setattr(M, "BENCH", str(bench))


def test_qualification_bar_is_ninety_percent(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch, {"a": 9, "b": 8}, {"a": [[1]], "b": [[1]]})
    cal = M.calibrate()
    assert cal["a"]["qualified"] is True and cal["b"]["qualified"] is False


def test_an_incomplete_calibration_never_qualifies(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch, {"a": 10}, {"a": [[1]]})
    os.remove(os.path.join(M.HERE, "labels", "a", "calibration", "c0.json"))
    assert M.calibrate()["a"]["qualified"] is False


def test_queue_holds_disagreements_all_safety_and_a_seeded_audit(tmp_path, monkeypatch):
    agreeing = [[1]] * 14
    labels = {
        "a": agreeing + [[1], [], [2]],
        "b": agreeing + [[2], [1], [2, 3]],
    }  # cases 15, 16 disagree; 17 shares page 2
    setup(tmp_path, monkeypatch, {"a": 10, "b": 10}, labels, n_safety=32)
    q = M.build_queue(M.calibrate())
    mike = {x["id"]: x["why"] for x in q["forum_for_mike"]}
    assert mike["f14"] == "labelers disagree" and mike["f15"] == "labelers disagree"
    assert "f16" not in mike or mike["f16"].startswith("audit")
    assert sum(1 for w in mike.values() if w.startswith("audit")) == 10
    assert len(q["safety_for_mike"]) == 32
    assert len(q["forum_for_mike"]) + len(q["forum_agreed_not_audited"]) == 17
    assert M.build_queue(M.calibrate()) == q  # seeded: same list every time


def test_fewer_than_two_qualified_labelers_sends_every_case_to_mike(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch, {"a": 10, "b": 5}, {"a": [[1]] * 5, "b": [[1]] * 5})
    q = M.build_queue(M.calibrate())
    assert len(q["forum_for_mike"]) == 5 and q["forum_agreed_not_audited"] == []


def test_agreement_rule():
    assert M.agree([{"answer_pages": [1, 2]}, {"answer_pages": [2]}]) is True
    assert M.agree([{"answer_pages": []}, {"answer_pages": []}]) is True
    assert M.agree([{"answer_pages": [1]}, {"answer_pages": []}]) is False
    assert M.agree([{"answer_pages": [1]}, {"answer_pages": [2]}]) is False
