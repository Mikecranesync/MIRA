#!/usr/bin/env python3
"""Compare a `tests/mira_bench.py` raw run against the locked baseline.

Reads `.github/baselines/mira-bench.json` (locked) and a fresh
`mira-bench-raw.json` produced by `tests/mira_bench.py`. Emits a one-line
verdict and, on regression, writes `benchmark_regression_issue.md` for the
workflow to file as a GitHub issue.

Exit codes:
  0 — within tolerance (no regression)
  1 — regression detected (see `benchmark_regression_issue.md`)
  2 — operational failure (missing file, schema drift, etc.)

The bar is:
  - MIRA grounded total >= `thresholds.mira_total_min` (default 260)
  - MIRA grounded total - ungrounded baseline >= `thresholds.mira_advantage_min`
    (default 15)

Per-question deltas are surfaced in the issue body so the failure surface
points at the questions that slid, not just the headline. This is the input
the eventual `identify-KB-gap` self-improvement loop will consume.

Usage:
  python3 scripts/check_benchmark_regression.py \\
      --raw docs/evaluations/runs/2026-05-23-v2/mira-bench-raw.json \\
      --baseline .github/baselines/mira-bench.json \\
      --issue-out benchmark_regression_issue.md
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _load(p: Path) -> dict:
    with p.open() as f:
        return json.load(f)


def _totals(raw: dict) -> tuple[int, int, dict[str, dict[str, int]]]:
    mira = 0
    baseline = 0
    per_q: dict[str, dict[str, int]] = {}
    for r in raw.get("results", []):
        m = int(r.get("grounded_score", {}).get("total", 0))
        b = int(r.get("baseline_score", {}).get("total", 0))
        mira += m
        baseline += b
        per_q[r.get("id", "?")] = {"mira": m, "baseline": b}
    return mira, baseline, per_q


def _delta_row(qid: str, current: dict[str, int], pinned: dict[str, int]) -> str:
    cm, cb = current["mira"], current["baseline"]
    pm, pb = pinned["mira"], pinned["baseline"]
    dm, db = cm - pm, cb - pb
    flag = ""
    if dm <= -5:
        flag = " 🔴"
    elif dm <= -2:
        flag = " 🟡"
    return f"| {qid} | {cm} | {pm} | {dm:+d}{flag} | {cb} | {pb} | {db:+d} |"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="path to mira-bench-raw.json")
    ap.add_argument(
        "--baseline",
        default=".github/baselines/mira-bench.json",
        help="path to pinned baseline json",
    )
    ap.add_argument(
        "--issue-out",
        default="benchmark_regression_issue.md",
        help="where to write the issue body (on regression)",
    )
    ap.add_argument(
        "--run-url",
        default="",
        help="GitHub Actions run URL, embedded in the issue body if regression",
    )
    args = ap.parse_args()

    try:
        raw = _load(Path(args.raw))
        base = _load(Path(args.baseline))
    except FileNotFoundError as exc:
        print(f"::error::missing file: {exc}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"::error::bad json: {exc}", file=sys.stderr)
        return 2

    mira, baseline, per_q = _totals(raw)
    if mira == 0 and baseline == 0:
        print(
            "::error::raw json had zero totals — bench likely never produced "
            "a real result (missing secrets? empty retrieval? cascade dead?)",
            file=sys.stderr,
        )
        return 2

    thresholds = base.get("thresholds", {})
    mira_floor = int(thresholds.get("mira_total_min", 260))
    advantage_floor = int(thresholds.get("mira_advantage_min", 15))
    pinned_mira = int(base.get("baseline_run", {}).get("mira_total", 282))
    pinned_baseline = int(base.get("baseline_run", {}).get("baseline_total", 255))
    pinned_per_q: dict[str, dict[str, int]] = (
        base.get("baseline_run", {}).get("per_question", {})
    )

    advantage = mira - baseline
    failures: list[str] = []
    if mira < mira_floor:
        failures.append(
            f"MIRA total {mira} is below the floor of {mira_floor} "
            f"(pinned baseline: {pinned_mira})."
        )
    if advantage < advantage_floor:
        failures.append(
            f"MIRA advantage over ungrounded LLM is only {advantage} "
            f"(must be ≥ {advantage_floor}; pinned advantage: "
            f"{pinned_mira - pinned_baseline})."
        )

    summary = (
        f"MIRA={mira}/{base.get('max_total', 350)}  "
        f"baseline={baseline}/{base.get('max_total', 350)}  "
        f"advantage={advantage:+d}  "
        f"(pinned MIRA={pinned_mira}, advantage={pinned_mira - pinned_baseline:+d})"
    )

    if not failures:
        print(f"PASS  {summary}")
        return 0

    print(f"REGRESSION  {summary}")
    for f_ in failures:
        print(f"  - {f_}")

    # Build issue body — focused so the next-loop "identify KB gap" step can
    # parse the per-question table without re-reading raw json.
    body_lines: list[str] = []
    body_lines.append("## Benchmark regression detected")
    body_lines.append("")
    body_lines.append(f"- **Run:** {args.run_url or '(local)'}")
    body_lines.append(f"- **Run id:** {raw.get('meta', {}).get('run_id', '?')}")
    body_lines.append(
        f"- **Cascade:** {raw.get('meta', {}).get('cascade', '?')}"
    )
    body_lines.append("")
    body_lines.append("### Headline")
    body_lines.append("")
    body_lines.append(
        f"| Metric | This run | Pinned baseline | Δ |\n"
        f"|---|---|---|---|\n"
        f"| MIRA total | {mira} | {pinned_mira} | {mira - pinned_mira:+d} |\n"
        f"| Baseline total | {baseline} | {pinned_baseline} | "
        f"{baseline - pinned_baseline:+d} |\n"
        f"| MIRA advantage | {advantage} | {pinned_mira - pinned_baseline} | "
        f"{advantage - (pinned_mira - pinned_baseline):+d} |"
    )
    body_lines.append("")
    body_lines.append("### Failures")
    for f_ in failures:
        body_lines.append(f"- {f_}")
    body_lines.append("")
    body_lines.append("### Per-question deltas (vs pinned baseline)")
    body_lines.append("")
    body_lines.append(
        "| Q | MIRA now | MIRA pinned | Δ | Baseline now | Baseline pinned | Δ |"
    )
    body_lines.append("|---|---|---|---|---|---|---|")
    for qid in sorted(per_q.keys()):
        pinned = pinned_per_q.get(qid, {"mira": 0, "baseline": 0})
        body_lines.append(_delta_row(qid, per_q[qid], pinned))
    body_lines.append("")
    body_lines.append("### What to investigate")
    body_lines.append("")
    body_lines.append(
        "1. Questions flagged 🔴 (≥5-point MIRA drop): check the run's "
        "`mira-bench-results.md` for that question. The grounded-answer + "
        "retrieved chunks tell you whether (a) retrieval missed seeded "
        "chunks (`equipment` re-rank broken), (b) the cascade lost a "
        "provider (Groq quota?), or (c) the KB shrank (chunks deleted)."
    )
    body_lines.append(
        "2. If the ungrounded baseline rose meaningfully, the LLM-judge may "
        "be drifting — the v1→v2 fix added objective `factual_accuracy` for "
        "this reason; if judge dimensions are the only ones moving, that's "
        "judge noise, not a MIRA regression."
    )
    body_lines.append(
        "3. If multiple questions regressed in lockstep, suspect an infra "
        "change — staging Neon branch drift, embed-sidecar down, "
        "`recall_knowledge` early-return (see `project_recall_embedding_gate`)."
    )
    body_lines.append("")
    body_lines.append(
        "### How to update the baseline (only after a confirmed improvement)"
    )
    body_lines.append("")
    body_lines.append(
        "Edit `.github/baselines/mira-bench.json` in the PR that lands the "
        "improvement: bump `baseline_run.mira_total`, `baseline_run.baseline_total`, "
        "and the per-question scores. Do **not** raise `thresholds.mira_total_min` "
        "in lockstep — keep the floor below the headline so single-question LLM-judge "
        "variance doesn't fail CI."
    )

    Path(args.issue_out).write_text("\n".join(body_lines) + "\n")
    print(f"  -> wrote issue body to {args.issue_out}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
