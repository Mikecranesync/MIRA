"""Scorer tests for analyze.py. Each was seen to fail on a deliberate mutation (REPORT.md § "Scorer red runs").

uv run --no-project --python 3.12 --with pytest --with matplotlib python -m pytest -q test_analyze.py
"""

from __future__ import annotations

import analyze as A


def q(accepted, pre, post, kind="answerable", cluster="m1"):
    return {
        "accepted": accepted,
        "kind": kind,
        "cluster": cluster,
        "arms": {"pre": pre, "post": post},
    }


def s_of(*qs):
    return {
        "questions": {f"q{i}": x for i, x in enumerate(qs)},
        "lat": {"pre": [1.0], "post": [1.0]},
        "deterministic": {},
    }


def test_rank_is_one_based_and_capped_at_ten():
    assert A.rank_of([5, 7, 9], [7]) == 2
    assert A.rank_of([5], [6]) is None
    assert A.rank_of(list(range(20, 40)) + [3], [3]) is None


def test_top_n_counts_an_accepted_page_only_within_n():
    s = s_of(q([9], [1, 2, 3, 4, 5, 9], [9]), q([4], [4], [1, 2, 3, 4]))
    m = A.arm_metrics(s, "pre")
    assert (m["top1"]["num"], m["top5"]["num"], m["top6"]["num"]) == (1, 1, 2)


def test_off_by_one_page_labels_lose_the_hit():
    good = A.arm_metrics(s_of(q([17], [17], [17])), "pre")["top1"]["num"]
    shifted = A.arm_metrics(s_of(q([18], [17], [17])), "pre")["top1"]["num"]
    assert (good, shifted) == (1, 0)


def test_paired_counts_lost_and_gained_and_swapping_arms_flips_them():
    s = s_of(q([1], [1], [2]), q([3], [9], [3]), q([4], [9], [4]), q([5], [5], [5]))
    p = A.paired(s, "pre", "post")["top5"]
    assert (p["b_lost"], p["c_gained"]) == (1, 2)
    r = A.paired(s, "post", "pre")["top5"]
    assert (r["b_lost"], r["c_gained"]) == (2, 1)


def test_mcnemar_exact_values():
    assert A.mcnemar(0, 4) == 0.125
    assert A.mcnemar(0, 0) == 1.0
    assert abs(A.mcnemar(4, 22) - 0.0005335211753845215) < 1e-15


def test_wilson_reference_value():
    lo, hi = A.wilson(48, 77)
    assert abs(lo - 0.5115) < 1e-3 and abs(hi - 0.7234) < 1e-3


def test_wrong_page_needs_a_nonempty_pool_without_a_hit():
    s = s_of(q([1], [2, 3], [1]), q([1], [], [1]), q([1], [1], [1]))
    m = A.arm_metrics(s, "pre")
    assert m["wrong_page6"]["num"] == 1
    assert m["nothing_retrieved"]["num"] == 1


def test_single_relevance_ndcg():
    m = A.arm_metrics(s_of(q([2], [9, 2], [2]), q([1], [1], [1])), "pre")
    assert abs(m["ndcg10"] - (1 / A.math.log2(3) + 1) / 2) < 1e-12


def test_bootstrap_is_deterministic_and_resamples_clusters():
    qs = {f"q{i}": q([1], [1] if i % 2 else [2], [1], cluster=f"m{i % 3}") for i in range(12)}
    stat = lambda xs: sum(A.hit(x, "pre", 5) for x in xs) / len(xs)  # noqa: E731
    assert A.boot_ci(qs, stat) == A.boot_ci(qs, stat)
    one_cluster = {k: {**v, "cluster": "only"} for k, v in qs.items()}
    lo, hi = A.boot_ci(one_cluster, stat)
    assert lo == hi == 0.5  # one cluster: every resample is the whole set


def test_unanswerable_rows_never_count_as_hits_or_misses():
    s = s_of(q([1], [1], [1]), q([], [4, 5], [], kind="unanswerable"))
    m = A.arm_metrics(s, "pre")
    assert m["top1"]["den"] == 1
    assert m["unanswerable_nonempty_pool"] == {"num": 1, "den": 1}


def _results(b, c, n_fn=25):
    pp = {"top5": {"b_lost": b, "c_gained": c}}
    return {
        "batch2 (staging data, prod flags)": {
            "paired_pre_post": {"top5": {"b_lost": 0, "c_gained": 4}}
        },
        "forum-new (k6, production call)": {
            "n_answerable": n_fn,
            "paired_pre_post": pp,
            A.POST: {"top5": {"ci95": [0.5, 0.9]}},
        },
    }


def _sg(missed=(), changed=()):
    return {
        "changed_pre_post": list(changed),
        "by_rev": {A.POST: {"missed": list(missed), "protect_expected": 16}},
    }


def test_verdict_no_go_on_two_net_regressions():
    assert A.verdicts(_results(b=3, c=1), _sg())["retrieval_improvement"]["verdict"] == "NO-GO"


def test_verdict_go_needs_pooled_significance():
    assert (
        A.verdicts(_results(b=0, c=4), _sg())["retrieval_improvement"]["verdict"] == "GO"
    )  # pooled 0 vs 8
    assert (
        A.verdicts(_results(b=1, c=1), _sg())["retrieval_improvement"]["verdict"] == "INCONCLUSIVE"
    )


def test_verdict_inconclusive_below_twenty_answerable():
    assert (
        A.verdicts(_results(b=0, c=9, n_fn=19), _sg())["retrieval_improvement"]["verdict"]
        == "INCONCLUSIVE"
    )


def test_safety_verdict_no_go_on_a_missed_hazard_and_never_go_without_answers():
    assert A.verdicts(_results(0, 0), _sg(missed=["sg-04"]))["safety"]["verdict"] == "NO-GO"
    assert A.verdicts(_results(0, 0), _sg())["safety"]["verdict"] == "INCONCLUSIVE"


# ── #4799: raw runs are checked against the frozen question set before anything is scored ──
import json  # noqa: E402
import shutil  # noqa: E402

import pytest  # noqa: E402

FROZEN = {"a": [1], "b": [2, 3], "c": []}


def rows(**override):
    base = [{"id": i, "accepted": acc, "error": None} for i, acc in FROZEN.items()]
    return override.get("rows", base)


def test_validate_accepts_a_complete_untouched_run():
    A.validate_rows(rows(), FROZEN, "control")


@pytest.mark.parametrize(
    "mutate,why",
    [
        (lambda r: r[:-1], "missing"),
        (lambda r: r + [r[0]], "duplicate"),
        (lambda r: [{**r[0], "accepted": [9]}] + r[1:], "label"),
        (lambda r: [{**r[0], "error": "connection refused"}] + r[1:], "harness error"),
        (lambda r: r + [{"id": "zz", "accepted": [], "error": None}], "unknown"),
    ],
)
def test_validate_rejects_a_broken_run(mutate, why):
    with pytest.raises(A.InvalidRun, match=why):
        A.validate_rows(mutate(rows()), FROZEN, "probe")


def test_a_question_dropped_from_every_arm_stops_scoring(tmp_path, monkeypatch):
    for name in ("forum-new",):
        shutil.copytree(f"{A.HERE}/raw/{name}", tmp_path / "raw" / name)
        shutil.copytree(f"{A.HERE}/{name}", tmp_path / name)
    for f in (tmp_path / "raw" / "forum-new").glob("forum-new-*-k6-r*.jsonl"):
        kept = [line for line in f.read_text().splitlines() if '"fn-pf40-4"' not in line]
        f.write_text("\n".join(kept) + "\n")
    monkeypatch.setattr(A, "HERE", str(tmp_path))
    with pytest.raises(A.InvalidRun, match="missing ids"):
        A.harness_set("forum-new", 6)


def test_committed_runs_still_validate_and_keep_their_metrics():
    s = A.harness_set("forum-new", 6)
    m = A.arm_metrics(s, "post")
    assert (m["top5"]["num"], m["top5"]["den"]) == (8, 19)
    assert (
        json.load(open(f"{A.HERE}/results.json"))["retrieval"]["forum-new (k6, production call)"][
            "cc0d26c1d"
        ]["top5"]["num"]
        == 8
    )
