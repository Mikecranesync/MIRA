"""Photo Diagnosis Benchmark — render results.jsonl rows into report.md.

Pure function of (results, ledger_summary, header) — no I/O, no network, so
it is testable with made-up rows including failures, which must never be
silently dropped from the rendered report.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

METRIC_FIELDS = ("H", "D", "S", "R", "U", "X", "N")
FAILURE_STATUSES = ("ungraded", "error", "not_run_budget", "sim_error", "redacted_secret_detected")


def _header_block(header: dict[str, Any], ledger_summary: dict[str, Any]) -> list[str]:
    lines = [
        f"# Photo Diagnosis Benchmark — {header.get('base', 'unknown base')}",
        "",
        f"- staging gitSha: {header.get('staging_git_sha', 'unknown')}",
        f"- judge: {header.get('judge_provider', '?')}/{header.get('judge_model', '?')}",
        f"- baseline model: {header.get('baseline_model', 'none')}",
        f"- spend: ${ledger_summary.get('spent_usd', 0):.4f} of ${ledger_summary.get('cap_usd', 0):.2f} cap",
        (
            "- manual-search queries: "
            f"{ledger_summary.get('manual_search_queries', 0)} / "
            f"{ledger_summary.get('manual_search_cap', 0)}"
        ),
        "",
    ]
    return lines


def _safety_failures_block(results: list[dict]) -> list[str]:
    lines = ["## Safety failures"]
    failures = [r for r in results if r.get("safety_failed") or r.get("X")]
    if not failures:
        lines.append("None.")
    else:
        for r in failures:
            lines.append(
                f"- **{r.get('case_id', '?')}** repeat {r.get('repeat', '?')}: "
                f"{r.get('safety_notes', r.get('notes', ''))}"
            )
    lines.append("")
    return lines


def _outcomes_table(results: list[dict]) -> list[str]:
    ok_outcomes = {"resolved_true", "resolved_acceptable", "safe_next_action"}
    by_case: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_case[r.get("case_id", "?")].append(r)

    lines = [
        "## Outcomes by case",
        "| case | type | repeats (k/n) | outcomes |",
        "|---|---|---|---|",
    ]
    for case_id in sorted(by_case):
        rows = by_case[case_id]
        n = len(rows)
        outcomes = [r.get("outcome", r.get("status", "?")) for r in rows]
        k = sum(1 for o in outcomes if o in ok_outcomes)
        case_type = rows[0].get("type", "?")
        lines.append(f"| {case_id} | {case_type} | {k}/{n} | {', '.join(outcomes)} |")
    lines.append("")
    return lines


def _metric_rates_block(results: list[dict]) -> list[str]:
    lines = ["## Metric rates (min/max across repeats)"]
    any_metric = False
    for metric in METRIC_FIELDS:
        present = [r for r in results if metric in r and r[metric] is not None]
        if not present:
            continue
        any_metric = True
        rates = [1.0 if r[metric] else 0.0 for r in present]
        mean = sum(rates) / len(rates)
        lines.append(
            f"- {metric}: mean={mean:.2f} min={min(rates):.2f} max={max(rates):.2f} (n={len(rates)})"
        )
    if not any_metric:
        lines.append("No graded turns.")
    lines.append("")
    return lines


def _comparator_block(results: list[dict]) -> list[str]:
    mira_rows = [r for r in results if r.get("arm", "mira") == "mira"]
    baseline_rows = [r for r in results if r.get("arm") == "baseline"]
    lines = [
        "## MIRA vs baseline",
        f"- MIRA runs: {len(mira_rows)}",
        f"- baseline runs: {len(baseline_rows)}",
        "",
    ]
    return lines


def _ungraded_block(results: list[dict]) -> list[str]:
    lines = ["## Ungraded / failed runs"]
    bad = [r for r in results if r.get("status") in FAILURE_STATUSES]
    if not bad:
        lines.append("None.")
    else:
        for r in bad:
            lines.append(
                f"- {r.get('case_id', '?')} repeat {r.get('repeat', '?')}: "
                f"{r.get('status')} — {r.get('reason', '')}"
            )
    lines.append("")
    return lines


def _privacy_block(header: dict[str, Any]) -> list[str]:
    destinations = header.get(
        "privacy_destinations",
        ["the staging tenant", "the pinned judge provider", "the baseline provider"],
    )
    return [
        "## Privacy destinations",
        "Transcripts and photos reach: " + ", ".join(destinations) + ".",
    ]


def render_report(
    results: list[dict], ledger_summary: dict[str, Any], header: dict[str, Any]
) -> str:
    """Order: safety failures first; per-case outcome table with repeats
    (k/n); metric rates with min/max across repeats; MIRA vs baseline
    table; ungraded/failed runs listed; privacy destinations line."""
    lines: list[str] = []
    lines += _header_block(header, ledger_summary)
    lines += _safety_failures_block(results)
    lines += _outcomes_table(results)
    lines += _metric_rates_block(results)
    lines += _comparator_block(results)
    lines += _ungraded_block(results)
    lines += _privacy_block(header)
    return "\n".join(lines)


__all__ = ["render_report", "METRIC_FIELDS", "FAILURE_STATUSES"]
