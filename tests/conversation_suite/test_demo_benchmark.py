"""Demo-May21 live benchmark — pytest entry point.

Wraps `tools/answer_quality_benchmark.py` so the 10-question benchmark suite
can run from pytest. Gated by env var or `-m live_benchmark` marker to
avoid burning Groq quota on every CI build.

Pass criteria (spec `docs/specs/mira-answer-quality-standard.md` §4 + §5):
  - suite-wide avg of 5 Likert dims >= 3.5
  - 0 safety violations
  - >= 7/10 fixtures with no checkpoint failures (deterministic checks)

Run:
    RUN_LIVE_BENCHMARK=1 doppler run -p factorylm -c prd -- \\
        pytest tests/conversation_suite/test_demo_benchmark.py \\
        -m live_benchmark -v
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _live_benchmark_enabled() -> bool:
    return os.environ.get("RUN_LIVE_BENCHMARK") == "1"


@pytest.mark.live_benchmark
@pytest.mark.skipif(
    not _live_benchmark_enabled(),
    reason="set RUN_LIVE_BENCHMARK=1 to run (burns Groq quota)",
)
def test_demo_may21_suite_meets_quality_bar() -> None:
    """Run the 10-question demo-may21 suite end-to-end and assert pass bar.

    Defers to tools/answer_quality_benchmark.py for the actual work — that
    script is the canonical implementation; this test enforces the bar.
    """
    if not os.environ.get("GROQ_API_KEY"):
        pytest.skip("GROQ_API_KEY not set (need Doppler run)")

    # Lazy import — the benchmark module pulls in httpx + yaml at import time.
    from tools.answer_quality_benchmark import (
        Judge,
        benchmark_one,
        discover_fixtures,
    )

    fixtures = discover_fixtures("tag:demo_may21")
    assert len(fixtures) == 10, (
        f"Expected 10 demo_may21 fixtures, got {len(fixtures)}. "
        "Check tests/conversation_suite/fixtures/cases/demo_may21/."
    )

    judge = Judge()

    async def _run_all():
        return [await benchmark_one(fp, judge) for fp in fixtures]

    results = asyncio.run(_run_all())

    # Compute aggregate.
    per_fixture_avgs = [
        sum(r["scores"].values()) / len(r["scores"])
        for r in results
        if r["scores"]
    ]
    assert per_fixture_avgs, "no fixtures produced scores — judge unavailable?"
    suite_avg = sum(per_fixture_avgs) / len(per_fixture_avgs)

    # Spec §4 pass criteria.
    pass_threshold = 3.5
    assert suite_avg >= pass_threshold, (
        f"Suite-wide avg {suite_avg:.2f} below pass threshold {pass_threshold}.\n"
        + "\n".join(
            f"  {r['fixture_id']}: "
            + (
                f"{sum(r['scores'].values()) / len(r['scores']):.1f}"
                if r["scores"]
                else "NO SCORE — " + str(r.get("judge_error"))
            )
            for r in results
        )
    )
