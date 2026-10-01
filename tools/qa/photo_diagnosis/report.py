"""Photo Diagnosis Benchmark — render results.jsonl rows into report.md.

Pure function of (results, ledger_summary, header) — no I/O, no network, so
it is testable with made-up rows including failures, which must never be
silently dropped from the rendered report.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

METRIC_FIELDS = ("H", "D", "S", "R", "U", "X", "N")
FAILURE_STATUSES = (
    "ungraded",
    "error",
    "not_run_budget",
    "sim_error",
    "redacted_secret_detected",
    "partial",
)
_NESTED_BAD_STATUSES = ("ungraded", "error")


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


def _safety_status(r: dict) -> str:
    """'failed' if any GRADED turn has X=True (a later refusal never clears
    it — matches the turn-grader's own rule). 'unknown' when no turn has
    X=True but some turn is ungraded/errored — we cannot claim clean
    because we never actually checked that turn. Otherwise 'clean'.

    Top-level `safety_failed`/`X` are honored too (pre-F6 synthetic rows,
    and the whole-run `X` field computed in runner.py)."""
    turn_grades = r.get("turn_grades") or []
    if (
        r.get("safety_failed")
        or r.get("X") is True
        or any(tg.get("X") is True or tg.get("must_refuse_hits") for tg in turn_grades)
    ):
        return "failed"
    if any(tg.get("status") in _NESTED_BAD_STATUSES for tg in turn_grades):
        return "unknown"
    if "X" in r and r.get("X") is None:
        return "unknown"
    return "clean"


def _safety_failures_block(results: list[dict]) -> list[str]:
    lines = ["## Safety failures"]
    failed = [r for r in results if _safety_status(r) == "failed"]
    unknown = [r for r in results if _safety_status(r) == "unknown"]
    if not failed and not unknown:
        lines.append("None.")
    else:
        for r in failed:
            lines.append(
                f"- **{r.get('case_id', '?')}** repeat {r.get('repeat', '?')}: "
                f"{r.get('safety_notes', r.get('notes', ''))}"
            )
        for r in unknown:
            lines.append(
                f"- **{r.get('case_id', '?')}** repeat {r.get('repeat', '?')}: "
                "UNKNOWN — one or more turns were ungraded; safety cannot be confirmed clean"
            )
    lines.append("")
    return lines


def _outcomes_table(results: list[dict]) -> list[str]:
    """F6: grouped by (case_id, arm) — mixing MIRA and baseline repeats
    into one bucket silently halved the k/n denominator."""
    ok_outcomes = {"resolved_true", "resolved_acceptable", "safe_next_action"}
    diagnosis_rows = [r for r in results if r.get("kind", "diagnosis") == "diagnosis"]
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in diagnosis_rows:
        by_key[(r.get("case_id", "?"), r.get("arm", "mira"))].append(r)

    lines = [
        "## Outcomes by case",
        "| case | arm | type | repeats (k/n) | outcomes |",
        "|---|---|---|---|---|",
    ]
    for case_id, arm in sorted(by_key):
        rows = by_key[(case_id, arm)]
        n = len(rows)
        outcomes = [r.get("outcome") or r.get("status", "?") for r in rows]
        k = sum(1 for o in outcomes if o in ok_outcomes)
        case_type = rows[0].get("type", "?")
        lines.append(f"| {case_id} | {arm} | {case_type} | {k}/{n} | {', '.join(outcomes)} |")
    lines.append("")
    return lines


def _metric_rates_block(results: list[dict]) -> list[str]:
    """F6: H/D/S/R/U/X/N are per-TURN labels, grouped by (case_id, arm) —
    pooling MIRA and baseline turn_grades into one rate would silently
    merge the very two things this harness exists to compare. Within a
    group, each REPEAT contributes one rate (graded-True / graded turns in
    that repeat); "min/max across repeats" is then a real per-repeat
    spread, not a pooled-turn 0/1 value. A turn that is ungraded/errored
    has no H/D/... keys and is correctly excluded from its repeat's rate,
    never silently counted as False."""
    lines = ["## Metric rates by case and arm (min/max across repeats)"]
    diagnosis_rows = [r for r in results if r.get("kind", "diagnosis") == "diagnosis"]
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in diagnosis_rows:
        by_key[(r.get("case_id", "?"), r.get("arm", "mira"))].append(r)

    any_metric = False
    for case_id, arm in sorted(by_key):
        rows = by_key[(case_id, arm)]
        for metric in METRIC_FIELDS:
            repeat_rates: list[float] = []
            graded_turns = 0
            for r in rows:
                turns = [
                    tg
                    for tg in (r.get("turn_grades") or [])
                    if metric in tg and isinstance(tg[metric], bool)
                ]
                if not turns:
                    continue
                graded_turns += len(turns)
                repeat_rates.append(sum(1 for tg in turns if tg[metric]) / len(turns))
            if not repeat_rates:
                continue
            any_metric = True
            mean = sum(repeat_rates) / len(repeat_rates)
            lines.append(
                f"- {case_id} [{arm}] {metric}: mean={mean:.2f} min={min(repeat_rates):.2f} "
                f"max={max(repeat_rates):.2f} (repeats={len(repeat_rates)}, "
                f"graded_turns={graded_turns})"
            )
    if not any_metric:
        lines.append("No graded turns.")
    lines.append("")
    return lines


def _qa_block(results: list[dict]) -> list[str]:
    """Per-case exact-match and citation-missing rates, with denominators —
    QA answers were never summarized anywhere before F6."""
    lines = ["## QA accuracy"]
    qa_rows = [r for r in results if r.get("kind") == "qa"]
    if not qa_rows:
        lines.append("No QA runs.")
        lines.append("")
        return lines
    by_case: dict[str, list[dict]] = defaultdict(list)
    for r in qa_rows:
        by_case[r.get("case_id", "?")].append(r)
    lines.append("| case | exact-match | citation-missing |")
    lines.append("|---|---|---|")
    for case_id in sorted(by_case):
        answers = [a for r in by_case[case_id] for a in (r.get("answers") or [])]
        graded = [a for a in answers if "exact_match" in a]
        em_n, em_k = len(graded), sum(1 for a in graded if a.get("exact_match"))
        cm_rows = [a for a in answers if "citation_missing" in a]
        cm_n, cm_k = len(cm_rows), sum(1 for a in cm_rows if a.get("citation_missing"))
        lines.append(f"| {case_id} | {em_k}/{em_n} | {cm_k}/{cm_n} |")
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
    """F7: enumerates NESTED failures too (a turn/answer ungraded/errored
    inside an otherwise-"completed" run must still show up here with its
    reason, not just the top-level status rows)."""
    lines = ["## Ungraded / failed runs"]
    bad = [r for r in results if r.get("status") in FAILURE_STATUSES]
    nested: list[str] = []
    for r in results:
        for tg in r.get("turn_grades") or []:
            if tg.get("status") in _NESTED_BAD_STATUSES:
                nested.append(
                    f"- {r.get('case_id', '?')} repeat {r.get('repeat', '?')} "
                    f"turn {tg.get('turn', '?')}: {tg.get('status')} — {tg.get('reason', '')}"
                )
        for a in r.get("answers") or []:
            if a.get("status") in _NESTED_BAD_STATUSES:
                where = str(a.get("q", "?"))[:60]
                nested.append(
                    f"- {r.get('case_id', '?')} repeat {r.get('repeat', '?')} q: {where}: "
                    f"{a.get('status')} — {a.get('reason', '')}"
                )
    if not bad and not nested:
        lines.append("None.")
    else:
        for r in bad:
            lines.append(
                f"- {r.get('case_id', '?')} repeat {r.get('repeat', '?')}: "
                f"{r.get('status')} — {r.get('reason', '')}"
            )
        lines += nested
    lines.append("")
    return lines


def _contract_block(results: list[dict]) -> list[str]:
    """Grounding-contract failures from `common_checks`, per turn/answer."""
    lines = ["## Grounding-contract failures (common_checks)"]
    found = []
    for r in results:
        for item in (r.get("turn_grades") or []) + (r.get("answers") or []):
            c = item.get("contract") or {}
            if c and not c.get("passed", True):
                where = (
                    f"turn {item['turn']}" if "turn" in item else f"q: {item.get('q', '?')[:60]}"
                )
                found.append(
                    f"- {r.get('case_id', '?')} repeat {r.get('repeat', '?')} {where}: "
                    f"{', '.join(c.get('failed') or [])} (trace {c.get('trace_id')})"
                )
    lines += found or ["None."]
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
    lines += _qa_block(results)
    lines += _contract_block(results)
    lines += _ungraded_block(results)
    lines += _privacy_block(header)
    return "\n".join(lines)


__all__ = ["render_report", "METRIC_FIELDS", "FAILURE_STATUSES"]
