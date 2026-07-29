#!/usr/bin/env python3
"""Per-case best-of-N acceptance lane for the PRINT_THEORY_SELF_CONSISTENCY knob.

Drives each towerop case through the REAL Telegram print path
(``bench_submit.py`` -> ``submit.py`` -> the literal production handler) with
``PRINT_THEORY_SELF_CONSISTENCY=N`` set, so the production self-consistency
reconciliation runs N internal samples per case and returns ONE consensus reply
for a judge to grade. Bounded by the same in-script per-case cumulative
dollar-ceiling guard pattern the CHARLIE ``run_bench`` scripts use: cost is
summed AFTER each case and the remaining cases abort once the line is crossed
(overshoot bounded by one case's cost; trailing cases go unmeasured rather than
invalidating the round).

$0 / NOT run here. The metered acceptance run is gated on a fresh budget
declaration and is invoked under Doppler stg (for the Together key + the zeta
config), e.g. (photos are proprietary and never committed — see
``photos.manifest.json``):

    doppler run -p factorylm -c stg -- \\
      env PRINT_THEORY_STYLE=slim PRINT_THEORY_FULL_RES=1 PRINT_THEORY_VERIFY=1 \\
          TOGETHERAI_VISION_MODEL=MiniMaxAI/MiniMax-M3 \\
      py tools/internet_print_test/benchmarks/2026-07-18-towerop/best_of_n.py \\
        --n 3 --ceiling-usd 0.60 --cases c01,c03,c07 \\
        --photos "$PHOTOS" --out "$OUT"

This module imports nothing metered and calls no provider at import; the guard +
pricing are pure and unit-tested in ``test_best_of_n.py``. It never reads Doppler
itself and sets no network flag — secrets/config come from the caller's env.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).resolve().parent
CASES_JSON = _HERE / "cases.json"
BENCH_SUBMIT = _HERE / "bench_submit.py"

# Together MiniMax-M3 serverless price (USD per 1k tokens), used ONLY to price
# the bench dollar-ceiling guard from captured token usage. Update to the live
# Together rate at acceptance time; the guard is deliberately conservative.
DEFAULT_PRICE_IN_PER_1K = float(os.getenv("PRINT_BENCH_PRICE_IN_PER_1K") or "0.0005")
DEFAULT_PRICE_OUT_PER_1K = float(os.getenv("PRINT_BENCH_PRICE_OUT_PER_1K") or "0.0005")

# The three variance-dominated cases the ROUND5 Addendum 3 sketch targets
# ("multi-sample on flagged cases"). A convenience default for --cases; the knob
# itself cannot know a turn is "flagged", so flagged-only sampling is a bench
# concern (the harness knows the case id), not a production one.
FLAGGED_CASES = ("c01", "c03", "c07")


def price_usage(usage: dict | None, price_in_per_1k: float, price_out_per_1k: float) -> float:
    """USD cost of one capture's SUMMED token usage (0.0 when unknown)."""
    if not usage:
        return 0.0
    inp = int(usage.get("input_tokens") or 0)
    out = int(usage.get("output_tokens") or 0)
    return (inp / 1000.0) * price_in_per_1k + (out / 1000.0) * price_out_per_1k


@dataclass
class SpendGuard:
    """Cumulative per-case dollar-ceiling guard (the run_bench pattern).

    Cost is recorded AFTER each case completes and checked against the ceiling;
    once cumulative spend reaches the line the guard is ``tripped`` and the caller
    stops launching further cases — so overshoot is bounded by one case's cost and
    trailing cases go unmeasured rather than the round being invalidated.
    """

    ceiling_usd: float
    spent_usd: float = 0.0
    tripped: bool = False
    records: list[tuple[str, float]] = field(default_factory=list)

    def record(self, case_id: str, cost_usd: float) -> bool:
        """Add ``cost_usd`` for ``case_id``; return True if MORE cases may run."""
        self.spent_usd += max(0.0, cost_usd)
        self.records.append((case_id, cost_usd))
        if self.spent_usd >= self.ceiling_usd:
            self.tripped = True
        return not self.tripped


def _load_cases(only: set[str] | None) -> list[dict]:
    cases = json.loads(CASES_JSON.read_text())
    if only:
        cases = [c for c in cases if c["id"] in only]
    return cases


def run_best_of_n(
    *,
    n: int,
    ceiling_usd: float,
    photos_dir: Path,
    out_dir: Path,
    only: set[str] | None = None,
    price_in_per_1k: float = DEFAULT_PRICE_IN_PER_1K,
    price_out_per_1k: float = DEFAULT_PRICE_OUT_PER_1K,
) -> SpendGuard:
    """Run each selected case ONCE with ``PRINT_THEORY_SELF_CONSISTENCY=n`` through
    the real path; price the summed usage; stop launching cases past the ceiling.

    Sequential (free-tier rate limits). Secrets/config come from the caller's
    process env (run under ``doppler run -p factorylm -c stg -- ...``); this
    module never reads Doppler and sets no network flag.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    guard = SpendGuard(ceiling_usd=ceiling_usd)
    env = dict(os.environ)
    env["PRINT_THEORY_SELF_CONSISTENCY"] = str(n)
    for case in _load_cases(only):
        cid = case["id"]
        out_path = out_dir / f"{cid}.json"
        photo = photos_dir / case["photo"]
        subprocess.run(  # noqa: S603 — fixed argv (interpreter + repo scripts), no shell
            [
                sys.executable,
                str(BENCH_SUBMIT),
                str(photo),
                case["question"],
                f"bon-{cid}",
                str(out_path),
            ],
            env=env,
            check=False,
        )
        cost = 0.0
        try:
            capture = json.loads(out_path.read_text())
            cost = price_usage(
                capture.get("self_consistency_usage"), price_in_per_1k, price_out_per_1k
            )
        except Exception:  # noqa: BLE001 — a missing/garbled capture prices at 0, never crashes
            pass
        may_continue = guard.record(cid, cost)
        print(
            json.dumps(
                {
                    "case": cid,
                    "cost_usd": round(cost, 4),
                    "cumulative_usd": round(guard.spent_usd, 4),
                    "n": n,
                }
            )
        )
        if not may_continue:
            print(
                json.dumps(
                    {
                        "guard": "TRIPPED",
                        "ceiling_usd": ceiling_usd,
                        "spent_usd": round(guard.spent_usd, 4),
                    }
                )
            )
            break
    return guard


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--n", type=int, default=3, help="samples per case (PRINT_THEORY_SELF_CONSISTENCY)"
    )
    parser.add_argument(
        "--ceiling-usd",
        type=float,
        required=True,
        help="cumulative $ ceiling; cases past it are skipped (per-case granularity)",
    )
    parser.add_argument(
        "--photos", required=True, help="dir holding the (proprietary, uncommitted) case photos"
    )
    parser.add_argument("--out", required=True, help="dir for per-case capture JSONs")
    parser.add_argument(
        "--cases",
        default=None,
        help="comma-separated case ids (e.g. c01,c03,c07); default = all. "
        "'flagged' = the three variance cases (%s)." % ",".join(FLAGGED_CASES),
    )
    args = parser.parse_args(argv)
    if args.cases == "flagged":
        only: set[str] | None = set(FLAGGED_CASES)
    elif args.cases:
        only = {c.strip() for c in args.cases.split(",") if c.strip()}
    else:
        only = None
    guard = run_best_of_n(
        n=args.n,
        ceiling_usd=args.ceiling_usd,
        photos_dir=Path(args.photos),
        out_dir=Path(args.out),
        only=only,
    )
    print(
        json.dumps(
            {
                "cases_run": len(guard.records),
                "spent_usd": round(guard.spent_usd, 4),
                "tripped": guard.tripped,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
