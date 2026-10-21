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
    assert report["arms"]["a"]["unanswerable"]["refused"] == 1
    assert report["arms"]["b"]["unanswerable"]["refused"] == 0
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


def test_unanswerable_outcome_counts_text_refusals_with_or_without_a_citation():
    def r(cls, page, text):
        row = _row("m-q9", cls, page)
        row["_obs"] = {"rendered": json.dumps({"answer": text})}
        return row

    assert walk_eval.outcome(r("ABSTAINED", None, REFUSAL), [], 1) == 1
    assert walk_eval.outcome(r("WRONG_PAGE", 4, REFUSAL), [], 1) == 1
    assert walk_eval.outcome(r("WRONG_PAGE", 4, ANSWER), [], 1) == 0


def test_lane_summary_later_file_wins_and_skips_unasked_rows():
    rows = [
        {"id": "m-q1", "lane": "no_trace"},
        {"id": "m-q2", "lane": "skipped_timeout", "retrieval_latency_s": 7.0},
        {"id": "m-q1", "lane": "ran", "retrieval_latency_s": 1.0},
        {"id": "m-q2", "lane": "ran", "retrieval_latency_s": 2.0},
        {"id": "other", "lane": "ran", "retrieval_latency_s": 9.0},
    ]
    s = walk_eval.lane_summary(rows, {"m-q1", "m-q2"})
    assert s["lanes"] == {"ran": 2}
    assert s["vector_ran_fraction"] == 1.0
    assert s["retrieval_latency_s"]["p95"] == 2.0


def test_lane_of_reads_expanded_and_flags_truncated_metadata():
    from retrieval_eval import lanes

    span = {"name": "retrieval.execute", "latency": 3.2}
    expanded = {**span, "metadata": {"attributes": {"mira.retrieval.vector_lane": "ran"}}}
    truncated = {**span, "metadata": {"attributes": '{"mira.retrieval.strategy":"notebook_sour'}}
    assert lanes.lane_of([expanded]) == {"lane": "ran", "retrieval_latency_s": 3.2}
    assert lanes.lane_of([truncated])["lane"] == "attrs_truncated"
    assert lanes.lane_of([])["lane"] == "trace_not_found"
    assert lanes.lane_of([{"name": "other"}])["lane"] == "no_retrieval_span"


def test_key_can_be_read_from_gold_jsonl(tmp_path):
    gold = tmp_path / "gold.jsonl"
    gold.write_text(
        json.dumps({"qid": "a", "accepted_pages": [3, 4], "question": "x"})
        + "\n"
        + json.dumps({"qid": "b", "accepted_pages": None})
        + "\n"
    )
    assert walk_eval.load_key(str(gold)) == {"a": [3, 4], "b": []}


def test_lane_fraction_counts_untraced_questions_as_missing_not_absent():
    rows = [{"id": "q1", "lane": "ran"}, {"id": "q2", "lane": "no_trace"}]
    s = walk_eval.lane_summary(rows, {"q1", "q2", "q3", "q4"})
    assert s["vector_ran_fraction"] == 0.25
    assert s["lanes"] == {"ran": 1, "missing": 3}


def test_validity_fails_on_a_missing_or_broken_question():
    a = {"q1": _row("m-q1", "CORRECT", 3), "q2": _row("m-q2", "CORRECT", 3)}
    b = {"q1": _row("m-q1", "CORRECT", 3)}
    v = walk_eval.validity(a, b, {"q1", "q2"})
    assert not v["v6_pass"] and v["missing_from_an_arm"] == 1
    b["q2"] = _row("m-q2", "BROKEN")
    v = walk_eval.validity(a, b, {"q1", "q2"})
    assert not v["v6_pass"] and v["broken"] == 1
    b["q2"] = _row("m-q2", "WRONG_PAGE", 9)
    assert walk_eval.validity(a, b, {"q1", "q2"})["v6_pass"]


def test_cli_reports_validity_and_hides_ids_when_sealed(tmp_path, capsys):
    rows_a = [_row("sx-q1", "CORRECT", 7), _row("sx-q2", "CORRECT", 2)]
    rows_b = [_row("sx-q1", "CORRECT", 7)]
    kf = tmp_path / "key.json"
    kf.write_text(json.dumps({"sx-q1": [7], "sx-q2": [2]}))
    a, b = _run(tmp_path, "a", rows_a, {}), _run(tmp_path, "b", rows_b, {})
    walk_eval.main(["--arm", f"a={a}", "--arm", f"b={b}", "--key", str(kf), "--sealed"])
    out = capsys.readouterr().out
    v = json.loads(out)["paired"]["a->b"]["validity"]
    assert v["v6_pass"] is False and v["missing_from_an_arm"] == 1
    assert "sx-q" not in out


def test_v4_requires_90_percent_for_a_declared_vector_arm():
    lanes = {"off": {"vector_ran_fraction": 0.3}, "on": {"vector_ran_fraction": 0.2}}
    v = walk_eval.v4_check(lanes, ["off", "on"], {"on"})
    assert v["v4_pass"] is False and "20%" in v["reasons"][0]
    good = {"off": {"vector_ran_fraction": 0.95}, "on": {"vector_ran_fraction": 0.92}}
    assert walk_eval.v4_check(good, ["off", "on"], {"off", "on"})["v4_pass"] is True


def test_v4_fails_a_declared_arm_without_lane_evidence_and_a_lopsided_pair():
    assert walk_eval.v4_check({}, ["off", "on"], {"on"})["v4_pass"] is False
    lopsided = {"off": {"vector_ran_fraction": 0.95}, "on": {"vector_ran_fraction": 0.80}}
    assert walk_eval.v4_check(lopsided, ["off", "on"], set())["v4_pass"] is False
    assert walk_eval.v4_check({}, ["off", "on"], set())["v4_pass"] is None


def test_validity_fails_on_an_unexpected_question():
    row = _row("m-q1", "CORRECT", 3)
    a = {"q1": row, "extra": row}
    b = {"q1": row, "extra": row}
    v = walk_eval.validity(a, b, {"q1"})
    assert not v["v6_pass"] and v["unexpected"] == 1
