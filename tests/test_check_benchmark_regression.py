"""The weekly benchmark verdict must not be decided by a broken grader.

Exit codes of scripts/check_benchmark_regression.py: 0 pass, 1 regression,
2 operational/inconclusive. A run where the judge could not grade most answers
is inconclusive (2), never a regression (1); and a run is only comparable with
a baseline pinned from the same lane (harness vs the real product).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_benchmark_regression.py"


def _baseline(tmp: Path, mira_source: str = "quickstart", judge_model: str | None = None) -> Path:
    p = tmp / "baseline.json"
    p.write_text(
        json.dumps(
            {
                "mira_source": mira_source,
                **({"judge_model": judge_model} if judge_model else {}),
                "max_total": 350,
                "thresholds": {"mira_total_min": 200, "mira_advantage_min": 0},
                "baseline_run": {"mira_total": 220, "baseline_total": 200, "per_question": {}},
            }
        )
    )
    return p


def _raw(
    tmp: Path,
    pairs: list[tuple],
    mira_source: str = "quickstart",
    judge_models: list[str] | None = None,
) -> Path:
    p = tmp / "raw.json"
    results = [
        {"id": f"Q{i:02d}", "grounded_score": {"total": g}, "baseline_score": {"total": b}}
        for i, (g, b) in enumerate(pairs, 1)
    ]
    meta: dict = {"mira_source": mira_source}
    if judge_models is not None:
        meta["judge_models"] = judge_models
    p.write_text(json.dumps({"meta": meta, "results": results}))
    return p


def _run(tmp: Path, raw: Path, base: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--raw",
            str(raw),
            "--baseline",
            str(base),
            "--issue-out",
            str(tmp / "issue.md"),
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_healthy_run_passes(tmp_path):
    # control: 10 graded pairs, 25 vs 20 each -> 250 vs 200, above floor and advantage
    r = _run(tmp_path, _raw(tmp_path, [(25, 20)] * 10), _baseline(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr


def test_real_regression_still_fails(tmp_path):
    # control in the other direction: graded, and genuinely below the floor
    r = _run(tmp_path, _raw(tmp_path, [(10, 20)] * 10), _baseline(tmp_path))
    assert r.returncode == 1, r.stdout + r.stderr


def test_ungraded_answers_are_not_scored_as_zero(tmp_path):
    # 8 graded pairs at 25/20 plus 2 ungraded questions. Counting the ungraded
    # as 0 would give 200 and fail; paired + scaled gives 250 and passes.
    pairs = [(25, 20)] * 8 + [(None, 20), (25, None)]
    r = _run(tmp_path, _raw(tmp_path, pairs), _baseline(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr


def test_mostly_ungraded_run_is_inconclusive_not_a_regression(tmp_path):
    pairs = [(25, 20)] * 5 + [(None, None)] * 5
    r = _run(tmp_path, _raw(tmp_path, pairs), _baseline(tmp_path))
    assert r.returncode == 2, r.stdout + r.stderr
    assert "INCONCLUSIVE" in (r.stdout + r.stderr)


def test_lane_mismatch_refuses_to_compare(tmp_path):
    raw = _raw(tmp_path, [(25, 20)] * 10, mira_source="harness")
    r = _run(tmp_path, raw, _baseline(tmp_path, mira_source="quickstart"))
    assert r.returncode == 2, r.stdout + r.stderr
    assert "lane" in (r.stdout + r.stderr).lower()


PINNED_JUDGE = "groq/openai/gpt-oss-120b"


def test_judge_swap_is_inconclusive_not_a_regression(tmp_path):
    # 2026-10-14..28: the cascade put openai/gpt-5.4-mini in front of the groq
    # judge the baseline was pinned under. Below-floor scores from a different
    # judge are not comparable with the pin: inconclusive (2), never a regression (1).
    raw = _raw(tmp_path, [(10, 20)] * 10, judge_models=["openai/gpt-5.4-mini"])
    r = _run(tmp_path, raw, _baseline(tmp_path, judge_model=PINNED_JUDGE))
    assert r.returncode == 2, r.stdout + r.stderr
    assert "judge" in (r.stdout + r.stderr).lower()
    assert not (tmp_path / "issue.md").exists()


def test_same_judge_regression_still_fails(tmp_path):
    # control: identical scores, judge matches the pin -> a real regression (1)
    raw = _raw(tmp_path, [(10, 20)] * 10, judge_models=[PINNED_JUDGE])
    r = _run(tmp_path, raw, _baseline(tmp_path, judge_model=PINNED_JUDGE))
    assert r.returncode == 1, r.stdout + r.stderr


def test_same_judge_healthy_run_passes(tmp_path):
    # control: matching judge, healthy scores -> pass (0)
    raw = _raw(tmp_path, [(25, 20)] * 10, judge_models=[PINNED_JUDGE])
    r = _run(tmp_path, raw, _baseline(tmp_path, judge_model=PINNED_JUDGE))
    assert r.returncode == 0, r.stdout + r.stderr
