"""The weekly benchmark's judge must never turn its own failure into a zero.

2026-09-27 (run 36310765032): 5 of 20 grades were scored 0 because the judge's
512-token reply was cut off mid-`notes`, so the JSON never closed and the parse
failed — even though all six 1-5 scores had already been emitted. A broken
grader is "ungraded", not "the answer is worthless".
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mira_bench_scorer as scorer  # noqa: E402

TRUNCATED = (
    '{\n  "correctness": 2,\n  "citation_quality": 2,\n  "completeness": 4,\n'
    '  "safety": 5,\n  "hallucination_resistance": 2,\n  "usefulness": 3,\n'
    '  "notes": "The answer gets the function code and resolution right but misid'
)
COMPLETE = (
    '{"correctness": 4, "citation_quality": 3, "completeness": 4, "safety": 5,'
    ' "hallucination_resistance": 4, "usefulness": 4, "notes": "ok"}'
)


class FakeRouter:
    def __init__(self, content: str, model: str = "groq/some-model"):
        self.content = content
        self.model = model
        self.max_tokens_seen: list[int] = []

    async def complete(self, messages, max_tokens=0, session_id=None, **kw):
        self.max_tokens_seen.append(max_tokens)
        return self.content, {"provider": "groq", "model": self.model}


def _score(content: str) -> tuple[dict, FakeRouter]:
    router = FakeRouter(content)
    out = asyncio.run(scorer.score_answer(router, "q", ["fact a"], "answer text", "MIRA-grounded"))
    return out, router


def test_truncated_judge_output_is_salvaged_not_zeroed():
    out, _ = _score(TRUNCATED)
    assert out["graded"] is True
    assert out["salvaged"] is True
    assert out["llm_total"] == 2 + 2 + 4 + 5 + 2 + 3
    assert out["total"] is not None and out["total"] >= 18


def test_complete_judge_output_is_graded_and_not_marked_salvaged():
    out, _ = _score(COMPLETE)
    assert out["graded"] is True
    assert out["salvaged"] is False
    assert out["llm_total"] == 24


def test_unparseable_judge_output_is_ungraded_with_no_numeric_total():
    # Only one dimension survived: nothing trustworthy to score. The failing
    # direction the old code took was total=0 — that must be impossible now.
    out, _ = _score('{"correctness": 3, "citat')
    assert out["graded"] is False
    assert out["total"] is None
    assert out["error"]


def test_judge_gets_room_to_finish_and_model_is_recorded():
    out, router = _score(COMPLETE)
    assert router.max_tokens_seen and min(router.max_tokens_seen) >= 1024
    assert out["judge_model"] == "groq/some-model"


def test_salvage_rejects_out_of_range_scores():
    # A regex salvage must not invent a grade from "correctness": 9.
    bad = TRUNCATED.replace('"correctness": 2', '"correctness": 9')
    out, _ = _score(bad)
    assert out["graded"] is False
    assert out["total"] is None


def _run(g, b, tag="x"):
    return {
        "grounded_score": {"total": g, "judge_model": "m"},
        "baseline_score": {"total": b},
        "grounded_answer": f"g{tag}{g}",
        "baseline_answer": f"b{tag}{b}",
        "retrieval": {"n_chunks": 5, "tag": g},
    }


def test_combine_repeats_takes_the_median_run_per_side_and_keeps_answers_consistent():
    rec = scorer.combine_repeats([_run(2, 30), _run(29, 10), _run(20, None)])
    assert rec["grounded_score"]["total"] == 20
    assert rec["grounded_answer"] == "gx20"
    assert rec["retrieval"]["tag"] == 20
    # baseline: graded runs are 30 and 10 -> low median 10; the ungraded run is ignored
    assert rec["baseline_score"]["total"] == 10
    assert rec["baseline_answer"] == "bx10"
    assert [r["grounded"] for r in rec["repeats"]] == [2, 29, 20]


def test_combine_repeats_all_ungraded_stays_ungraded():
    rec = scorer.combine_repeats([_run(None, 5), _run(None, 7)])
    assert rec["grounded_score"]["total"] is None


def test_graded_pair_totals_excludes_a_question_if_either_side_is_ungraded():
    res = [_run(20, 10), _run(None, 30), _run(10, None), _run(30, 20)]
    t = scorer.graded_pair_totals(res)
    assert (t["graded_pairs"], t["mira"], t["baseline"]) == (2, 50, 30)
    assert (t["scaled_mira"], t["scaled_baseline"]) == (100, 60)
