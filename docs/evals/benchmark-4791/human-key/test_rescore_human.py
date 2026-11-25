"""Tests for rescore_human.py. Every answer below is a SYNTHETIC TEST FIXTURE built in a temp dir, never a human
judgment, and nothing here writes into the benchmark's results.

    uv run --no-project --python 3.12 --with pytest --with matplotlib python -m pytest -q human-key/test_rescore_human.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rescore_human as R  # noqa: E402

REVIEW = json.load(open(os.path.join(HERE, "review-data.json")))
POST = {
    r["id"]: r["ranked_pages"]
    for r in map(
        json.loads,
        open(os.path.join(R.BENCH, "raw", "forum-new", "forum-new-cc0d26c1d-k6-r1.jsonl")),
    )
}


def export(tmp_path, answers=None, hazards=None, source=R.LIVE_URL, manifest=True):
    d = tmp_path / "export"
    (d / "answers").mkdir(parents=True)
    (d / "hazards").mkdir()
    if manifest:
        (d / "export-manifest.json").write_text(
            json.dumps(
                {"source_url": source, "exported_at": "2026-10-27T00:00:00Z", "exported_by": "test"}
            )
        )
    for k, v in (answers or {}).items():
        (d / "answers" / f"{k}.json").write_text(
            json.dumps({**v, "key": k, "savedAt": "2026-10-27T00:00:00Z"})
        )
    for k, v in (hazards or {}).items():
        (d / "hazards" / f"{k}.json").write_text(
            json.dumps({"id": k, "text": v, "writtenAt": "2026-10-27T00:00:00Z"})
        )
    return str(d)


def forum_rec(f, yes_page=None, overall="answered", label="no"):
    pages = {str(p): ("yes" if p == yes_page else label) for p in f["pages"]}
    return {"pages": pages, "overall": overall}


def run(exp, out, *extra):
    p = subprocess.run(
        [
            sys.executable,
            os.path.join(HERE, "rescore_human.py"),
            "--export",
            exp,
            "--out",
            str(out),
            *extra,
        ],
        capture_output=True,
        text=True,
    )
    res = (
        json.load(open(out / "human-key-results.json"))
        if (out / "human-key-results.json").exists()
        else None
    )
    return p, res


def test_preview_export_is_refused(tmp_path):
    p, res = run(export(tmp_path, source=R.PREVIEW_URL), tmp_path / "out")
    assert p.returncode == 1 and "PREVIEW" in p.stdout and res is None


def test_export_without_provenance_is_refused(tmp_path):
    p, res = run(export(tmp_path, manifest=False), tmp_path / "out")
    assert p.returncode == 1 and "export-manifest" in p.stdout and res is None


def test_documents_the_page_never_writes_are_refused(tmp_path):
    p, res = run(export(tmp_path, answers={"probe-admin": {"probe": True}}), tmp_path / "out")
    assert p.returncode == 1 and "never writes" in p.stdout and res is None


def test_a_case_counts_only_when_every_page_and_overall_are_answered(tmp_path):
    f0, f1 = REVIEW["forum"][0], REVIEW["forum"][1]
    half = {"pages": {str(f1["pages"][0]): "yes"}, "overall": "answered"}  # one page missing
    p, res = run(
        export(
            tmp_path,
            answers={
                "forum-" + f0["id"]: forum_rec(f0, yes_page=f0["pages"][0]),
                "forum-" + f1["id"]: half,
            },
        ),
        tmp_path / "out",
    )
    assert p.returncode == 0, p.stdout
    assert res["status"] == "PARTIAL"
    assert res["coverage"]["forum_complete"] == 1
    assert res["key"][f1["id"]]["complete"] is False
    assert res["retrieval_strict"]["n"] == 1  # never filled in from AI labels


def test_scoring_matches_the_frozen_run(tmp_path):
    f = next(
        x for x in REVIEW["forum"] if POST[x["id"]] and POST[x["id"]][0] in x["pages"]
    )  # a case whose top page was a candidate
    g = next(
        x
        for x in REVIEW["forum"]
        if x is not f
        and not set(POST[x["id"]][:6]) & set(x["pages"][:1])
        and x["pages"][0] not in POST[x["id"]][:6]
    )
    answers = {
        "forum-" + f["id"]: forum_rec(f, yes_page=POST[f["id"]][0]),
        "forum-" + g["id"]: forum_rec(g, yes_page=g["pages"][0]),
    }
    p, res = run(export(tmp_path, answers=answers), tmp_path / "out")
    post = res["retrieval_strict"]["arms"]["post"]
    assert (post["top1"]["num"], post["top1"]["den"]) == (1, 2)


def test_label_choices_map_to_kinds_and_unsure_is_never_guessed(tmp_path):
    f0, f1 = REVIEW["forum"][0], REVIEW["forum"][1]
    s0, s1, s2 = REVIEW["safety"][:3]
    answers = {
        "forum-" + f0["id"]: forum_rec(f0, overall="not-in-manual"),
        "forum-" + f1["id"]: forum_rec(f1, overall="unclear", label="unsure"),
        "safety-" + s0["id"]: {"choice": "stop"},
        "safety-" + s1["id"]: {"choice": "unsure"},
        "safety-" + s2["id"]: {"choice": "answer"},
    }
    p, res = run(export(tmp_path, answers=answers), tmp_path / "out")
    assert res["key"][f0["id"]]["kind"] == "unanswerable"
    assert res["key"][f1["id"]]["kind"] == "excluded_unclear"
    rows = {r["id"]: r for r in res["safety"]["rows"]}
    assert rows[s0["id"]]["mike_expected_gate"] == "protect"
    assert rows[s1["id"]]["mike_expected_gate"] is None
    assert rows[s2["id"]]["mike_expected_gate"] == "none"


def test_final_only_when_every_mission_is_complete(tmp_path):
    answers = {"forum-" + f["id"]: forum_rec(f, overall="unclear") for f in REVIEW["forum"]}
    answers.update({"safety-" + s["id"]: {"choice": "warn"} for s in REVIEW["safety"]})
    hz = {f"h{i}": f"synthetic hazard {i}" for i in range(9)}
    p, res = run(export(tmp_path, answers=answers, hazards=hz), tmp_path / "out")
    assert res["status"] == "PARTIAL"  # 9 hazards < 10
    hz["h9"] = "synthetic hazard 9"
    p, res = run(export(tmp_path / "b", answers=answers, hazards=hz), tmp_path / "out2")
    assert res["status"] == "FINAL"
    assert json.load(open(tmp_path / "out2" / "mike-hazard-cases.json"))[0]["id"].startswith("mh-")


def test_results_json_is_never_written(tmp_path):
    before = open(os.path.join(R.BENCH, "results.json"), "rb").read()
    run(export(tmp_path, answers={}), tmp_path / "out")
    assert open(os.path.join(R.BENCH, "results.json"), "rb").read() == before


def test_frozen_review_data_is_checked(tmp_path, monkeypatch):
    monkeypatch.setattr(R, "REVIEW_DATA_SHA256", "0" * 64)
    with pytest.raises(SystemExit):
        sys.argv = ["rescore_human.py", "--export", export(tmp_path), "--out", str(tmp_path / "o")]
        R.main()


@pytest.mark.parametrize("breakage", ["error", "duplicate", "missing"])
def test_rescore_refuses_an_invalid_raw_run(tmp_path, monkeypatch, breakage):
    """Codex F4: the human rescorer applies the main scorer's raw-run validation before using any human label."""
    import shutil

    bench = tmp_path / "bench"
    bench.mkdir()
    for entry in os.listdir(R.BENCH):
        if entry not in ("raw", "human-key"):
            os.symlink(os.path.join(R.BENCH, entry), bench / entry)
    shutil.copytree(os.path.join(R.BENCH, "raw"), bench / "raw")
    f = bench / "raw" / "forum-new" / "forum-new-cc0d26c1d-k6-r1.jsonl"
    rows = [json.loads(line) for line in f.read_text().splitlines() if line.strip()]
    if breakage == "error":
        rows[0] = {**rows[0], "error": "connection refused", "ranked_pages": []}
    elif breakage == "duplicate":
        rows.append(rows[0])
    else:
        rows = rows[1:]
    f.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    monkeypatch.setattr(R, "BENCH", str(bench))
    key = {
        x["id"]: {
            "complete": True,
            "kind": "answerable",
            "yes": [x["pages"][0]],
            "yes_or_partly": [x["pages"][0]],
            "flag": False,
            "note": "",
        }
        for x in REVIEW["forum"][:2]
    }
    with pytest.raises(R.Refused, match="raw run invalid"):
        R.score_retrieval(key, "yes")
