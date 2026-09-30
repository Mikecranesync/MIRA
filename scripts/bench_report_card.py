#!/usr/bin/env python3
"""Render a school-style report card from a `tests/mira_bench.py` raw run.

One row per graded subject (the judge's six 1-5 dimensions plus the objective
factual-accuracy check), averaged over questions where BOTH answers were graded
— an unreadable judge reply is excluded, never counted as a zero. MIRA is
shown beside the ungrounded LLM so every grade has its control.

Usage:
  python3 scripts/bench_report_card.py path/to/mira-bench-raw.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SUBJECTS: list[tuple[str, str]] = [
    ("correctness", "Correctness — are the technical facts right?"),
    ("factual_accuracy", "Factual accuracy — expected facts present (objective)"),
    ("citation_quality", "Citations — does it show where each fact came from?"),
    ("hallucination_resistance", "Honesty — admits gaps instead of inventing"),
    ("safety", "Safety — warns when the task needs it"),
    ("completeness", "Completeness — covers the whole question"),
    ("usefulness", "Usefulness — could a tech follow it?"),
]

# Letter bands on the percentage of the 5-point scale.
BANDS: list[tuple[float, str]] = [(90, "A"), (80, "B"), (70, "C"), (60, "D"), (0, "F")]


def letter(pct: float) -> str:
    return next(g for floor, g in BANDS if pct >= floor)


def _paired(results: list[dict]) -> list[dict]:
    return [
        r
        for r in results
        if r["grounded_score"].get("total") is not None
        and r["baseline_score"].get("total") is not None
    ]


def _avg(rows: list[dict], side: str, dim: str) -> float:
    vals = [r[side]["scores"].get(dim) for r in rows if r[side]["scores"].get(dim) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def render(raw: dict) -> str:
    meta = raw.get("meta", {})
    results = raw.get("results", [])
    rows = _paired(results)
    n, k = len(results), len(rows)
    out = [
        "# MIRA report card",
        "",
        f"- **Lane:** {meta.get('mira_source', 'harness')}"
        + (f" ({meta['product_base']})" if meta.get("product_base") else ""),
        f"- **Run:** {meta.get('started', '?')} · repeats {meta.get('repeats', 1)} (median)",
        f"- **Judge:** {', '.join(meta.get('judge_models') or ['?'])}",
        f"- **Graded:** {k}/{n} questions had both answers graded",
        "",
    ]
    if not rows:
        out.append("**INCONCLUSIVE — no question had both answers graded.**")
        return "\n".join(out) + "\n"

    out += [
        "| Subject | MIRA | Grade | Plain LLM | Grade |",
        "|---|---|---|---|---|",
    ]
    for dim, label in SUBJECTS:
        m = _avg(rows, "grounded_score", dim)
        b = _avg(rows, "baseline_score", dim)
        out.append(
            f"| {label} | {m:.1f}/5 | **{letter(m / 5 * 100)}** | {b:.1f}/5 | {letter(b / 5 * 100)} |"
        )
    m_tot = sum(r["grounded_score"]["total"] for r in rows)
    b_tot = sum(r["baseline_score"]["total"] for r in rows)
    cap = 35 * k
    m_pct, b_pct = m_tot / cap * 100, b_tot / cap * 100
    out += [
        f"| **Overall** (after fabrication penalty) | {m_tot}/{cap} ({m_pct:.0f}%) "
        f"| **{letter(m_pct)}** | {b_tot}/{cap} ({b_pct:.0f}%) | {letter(b_pct)} |",
        "",
        f"_A = ≥90%, B ≥80, C ≥70, D ≥60, F below. {k} questions is a small sample: "
        "one question moves a subject by up to a full grade — read trends, not one card._",
        "",
    ]
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    raw = json.loads(Path(argv[1]).read_text())
    sys.stdout.write(render(raw))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
