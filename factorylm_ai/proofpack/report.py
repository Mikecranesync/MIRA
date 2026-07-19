"""Markdown report writer for proofpack runs.

ZTA role: this turns a list of :class:`~factorylm_ai.proofpack.experiments.ExperimentResult`
dicts into the single human-readable artifact a
``python -m factorylm_ai.proofpack`` invocation produces. It is the honesty
layer: a report generated dry-run (the mock provider) always carries an
explicit banner saying so, and a PROMOTION-EVIDENCE block spells out which of
``factorylm_ai.promotion.check_promotion``'s required gate inputs this run
does and does not supply -- so nobody mistakes a $0 fixture-determinism
check for a benchmark pass.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .experiments import ExperimentResult

_DRY_RUN_BANNER = (
    "> **DRY-RUN on the mock provider.** Every number below is a "
    "fixture-determinism check -- it proves the pipeline is wired correctly "
    "and reproducible, **not** that any model is good. Real quality signal "
    "only comes from a `--live` run against `together.py`, budget-capped and "
    "human-reviewed."
)

# Mirrors factorylm_ai.promotion.check_promotion's pinned required-gate list
# (build contract, "Pinned public interfaces" -> promotion.py) as prose, not
# an import -- report.py has no runtime dependency on promotion.py, so a
# proofpack run never needs promotion.py to exist to write its own report.
_PROMOTION_GATE_INPUTS: tuple[tuple[str, str], ...] = (
    (
        "frozen_benchmark_pass",
        "NOT supplied -- a proofpack run is not a frozen, graded benchmark suite.",
    ),
    (
        "json_validity_rate >= 0.98",
        "measured per-experiment below, but only a meaningful signal on a --live run.",
    ),
    (
        "no_evidence_refusal_pass",
        "NOT evaluated -- the M10 answer-contract refusal behavior is out of scope for e01-e04.",
    ),
    (
        "fabricated_coordinates_pass",
        "NOT evaluated -- no geometry/overlay task is exercised by e01-e04.",
    ),
    (
        "tool_call_accuracy (M09)",
        "measured in e04 as tool_choice_accuracy, but only a meaningful signal on a --live run.",
    ),
    ("cost_report_present", "supplied -- see the Summary table below."),
    ("latency_report_present", "supplied -- see the Summary table below."),
    (
        "rollback (previous_default + revert_procedure)",
        "NOT supplied -- proofpack does not decide or record a rollback plan.",
    ),
)


def _timestamp_slug(now: datetime | None = None) -> str:
    dt = now or datetime.now(timezone.utc)
    # No colons/slashes -- must be a valid filename component on Windows too.
    return dt.strftime("%Y%m%dT%H%M%SZ")


def report_filename(experiments: list[str], now: datetime | None = None) -> str:
    """Build the ``<UTC ts>_<experiments>.md`` filename for a proofpack run."""
    exp_slug = "-".join(experiments) if experiments else "none"
    return f"{_timestamp_slug(now)}_{exp_slug}.md"


def _format_metric_value(value: object) -> str:
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value)


def render_report(
    results: list[ExperimentResult],
    *,
    live: bool,
    provider_name: str,
    budget_cap_usd: float,
    budget_spent_usd: float,
    now: datetime | None = None,
) -> str:
    """Render the full markdown report body for one proofpack invocation."""
    dt = now or datetime.now(timezone.utc)
    lines: list[str] = []

    lines.append(f"# factorylm_ai proofpack report -- {dt.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append("")
    lines.append(f"**Mode:** {'LIVE' if live else 'DRY-RUN'}  ")
    lines.append(f"**Provider:** `{provider_name}`  ")
    lines.append(f"**Budget:** ${budget_spent_usd:.4f} spent / ${budget_cap_usd:.4f} cap  ")
    exp_list = ", ".join(r["experiment"] for r in results) or "(none)"
    lines.append(f"**Experiments run:** {exp_list}")
    lines.append("")

    if not live:
        lines.append(_DRY_RUN_BANNER)
        lines.append("")

    total_cost = sum(r["cost_usd"] for r in results)
    total_latency = sum(int(r["metrics"].get("latency_ms_total", 0)) for r in results)
    total_cases = sum(r["cases"] for r in results)
    total_scored = sum(r["scored"] for r in results)

    lines.append("## Summary")
    lines.append("")
    lines.append("| experiment | cases | scored | cost (USD) | latency (ms) | model |")
    lines.append("|---|---|---|---|---|---|")
    for r in results:
        latency = r["metrics"].get("latency_ms_total", 0)
        model_used = r["metrics"].get("model", "n/a")
        lines.append(
            f"| {r['experiment']} | {r['cases']} | {r['scored']} | "
            f"{r['cost_usd']:.5f} | {latency} | `{model_used}` |"
        )
    lines.append(
        f"| **total** | {total_cases} | {total_scored} | {total_cost:.5f} | {total_latency} | -- |"
    )
    lines.append("")

    for r in results:
        lines.append(f"## {r['experiment']}")
        lines.append("")
        lines.append(f"cases={r['cases']} scored={r['scored']} cost_usd={r['cost_usd']:.5f}")
        lines.append("")
        if r["metrics"]:
            lines.append("| metric | value |")
            lines.append("|---|---|")
            for key in sorted(r["metrics"]):
                lines.append(f"| {key} | {_format_metric_value(r['metrics'][key])} |")
            lines.append("")
        if r["notes"]:
            lines.append("Notes:")
            for note in r["notes"]:
                lines.append(f"- {note}")
            lines.append("")

    lines.append("## PROMOTION-EVIDENCE")
    lines.append("")
    lines.append(
        "What this proofpack run does and does not supply toward "
        "`factorylm_ai.promotion.check_promotion`'s required gates "
        "(see `factorylm_ai/promotion.py`):"
    )
    lines.append("")
    lines.append("| gate | this run |")
    lines.append("|---|---|")
    for gate, note in _PROMOTION_GATE_INPUTS:
        lines.append(f"| {gate} | {note} |")
    lines.append("")

    return "\n".join(lines) + "\n"


def write_report(
    results: list[ExperimentResult],
    report_dir: str | Path,
    *,
    live: bool,
    provider_name: str,
    budget_cap_usd: float,
    budget_spent_usd: float,
    now: datetime | None = None,
) -> Path:
    """Render and write the report to ``report_dir``; returns the written path.

    Creates ``report_dir`` (and parents) if it does not exist yet.
    """
    dt = now or datetime.now(timezone.utc)
    text = render_report(
        results,
        live=live,
        provider_name=provider_name,
        budget_cap_usd=budget_cap_usd,
        budget_spent_usd=budget_spent_usd,
        now=dt,
    )
    out_dir = Path(report_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / report_filename([r["experiment"] for r in results], now=dt)
    path.write_text(text, encoding="utf-8")
    return path
