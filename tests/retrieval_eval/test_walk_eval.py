"""walk_eval scoring rules and the sealed-set guarantee (#4576), on synthetic runs."""

from __future__ import annotations

import json
from pathlib import Path

from retrieval_eval import walk_eval

REFUSAL = "The supplied manual does not cover that torque value."
ANSWER = "The fault means over-current during acceleration [1]."


def _row(qid, cls, page=None, reason="", safety=False, red=None):
    return {
        "id": qid,
        "manual": qid.split("-")[0],
        "classification": cls,
        "citedPage": page,
        "reason": reason,
        "safetyRelevant": safety,
        "safetyRedLine": red,
    }


def _run(tmp: Path, name: str, rows: list[dict], answers: dict[str, str], booked=1.0) -> str:
    d = tmp / name
    d.mkdir()
    (d / "scored.json").write_text(
        json.dumps({"rows": rows, "bookedUsd": booked, "meta": {"gitSha": "abc"}})
    )
    obs = [
        {
            "id": r["id"],
            "elapsedMs": 1000 * (i + 1),
            "streamStatus": "answered",
            "rendered": json.dumps({"answer": answers.get(r["id"], ANSWER)}),
        }
        for i, r in enumerate(rows)
    ]
    (d / "observations.json").write_text(json.dumps(obs))
    return str(d)


def test_refusal_classes_separate_cited_refusals():
    clean = _row("m-q1", "ABSTAINED")
    clean["_obs"] = {"rendered": json.dumps({"answer": REFUSAL})}
    cited = _row("m-q2", "WRONG_PAGE", page=4)
    cited["_obs"] = {"rendered": json.dumps({"answer": REFUSAL})}
    answered = _row("m-q3", "WRONG_PAGE", page=4)
    answered["_obs"] = {"rendered": json.dumps({"answer": ANSWER})}
    assert walk_eval.refusal_class(clean) == "refused_clean"
    assert walk_eval.refusal_class(cited) == "refused_cited"
    assert walk_eval.refusal_class(answered) == "answered"


def test_right_page_rejects_wrong_document_even_on_an_accepted_page():
    right = _row("m-q1", "WRONG_PAGE", page=10, reason="cited p.10, expected p.30")
    wrong_doc = _row(
        "m-q1", "WRONG_PAGE", page=10, reason='wrong_doc: first citation is "other.pdf"'
    )
    assert walk_eval.right_page(right, [10], 1)
    assert not walk_eval.right_page(wrong_doc, [10], 1)
    assert walk_eval.right_page(right, [11], 1)
    assert not walk_eval.right_page(right, [12], 1)


def test_later_directory_wins_for_rows_it_observed(tmp_path):
    first = _run(tmp_path, "pass1", [_row("m-q1", "BROKEN"), _row("m-q2", "CORRECT", 3)], {})
    second = tmp_path / "pass2"
    second.mkdir()
    (second / "scored.json").write_text(
        json.dumps({"rows": [_row("m-q1", "CORRECT", 5)], "bookedUsd": 0.5})
    )
    (second / "observations.json").write_text(json.dumps([{"id": "m-q1", "rendered": "{}"}]))
    rows, meta = walk_eval.load_arm([first, str(second)])
    assert rows["m-q1"]["classification"] == "CORRECT"
    assert rows["m-q2"]["classification"] == "CORRECT"
    assert meta["bookedUsd"] == 1.5


def test_sealed_mode_prints_no_question_ids(tmp_path, capsys):
    rows = [_row("sx-q1", "CORRECT", 7), _row("sx-q2", "ABSTAINED"), _row("sx-q3", "WRONG_PAGE", 2)]
    key = {"sx-q1": [7], "sx-q2": [], "sx-q3": [9]}
    kf = tmp_path / "key.json"
    kf.write_text(json.dumps(key))
    a = _run(tmp_path, "a", rows, {"sx-q2": REFUSAL})
    b = _run(tmp_path, "b", rows, {"sx-q2": ANSWER})
    corpus = tmp_path / "corpus.json"
    corpus.write_text(
        json.dumps(
            {
                "questions": [{"id": i, "manual": "sx"} for i in key],
                "manuals": [{"id": "sx", "oem": "Acme", "family": "vfd"}],
            }
        )
    )
    walk_eval.main(
        [
            "--arm",
            f"a={a}",
            "--arm",
            f"b={b}",
            "--key",
            str(kf),
            "--sealed",
            "--corpus",
            str(corpus),
        ]
    )
    out = capsys.readouterr().out
    assert "sx-q" not in out
    assert "by_oem" not in out and "changed" not in out
    report = json.loads(out)
    assert report["arms"]["a"]["unanswerable"]["refused_clean"] == 1
    assert report["arms"]["b"]["unanswerable"]["answered"] == 1
    assert report["paired"]["a->b"]["a_only"] == 1


def test_unsealed_mode_reports_changes_and_breakdowns(tmp_path, capsys):
    a = _run(tmp_path, "a", [_row("m-q1", "CORRECT", 3), _row("m-q2", "WRONG_PAGE", 9)], {})
    b = _run(tmp_path, "b", [_row("m-q1", "WRONG_PAGE", 8), _row("m-q2", "CORRECT", 4)], {})
    corpus = tmp_path / "corpus.json"
    corpus.write_text(
        json.dumps(
            {
                "questions": [{"id": "m-q1", "manual": "m"}, {"id": "m-q2", "manual": "m"}],
                "manuals": [{"id": "m", "oem": "Acme", "family": "vfd"}],
            }
        )
    )
    walk_eval.main(["--arm", f"a={a}", "--arm", f"b={b}", "--corpus", str(corpus)])
    report = json.loads(capsys.readouterr().out)
    p = report["paired"]["a->b"]
    assert (p["a_only"], p["b_only"]) == (1, 1)
    assert p["by_oem"]["Acme"] == {"n": 2, "a": 1, "b": 1}
    assert {c["id"] for c in p["changed"]} == {"m-q1", "m-q2"}
