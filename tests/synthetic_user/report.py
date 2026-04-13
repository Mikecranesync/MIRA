"""
Report generator for MIRA synthetic user evaluation results.

Produces a Markdown report and a machine-readable dict from a list of
EvaluatedResults. No external dependencies — stdlib only.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from tests.synthetic_user.evaluator import EvaluatedResult, WeaknessCategory

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _truncate(text: str, max_len: int = 80) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _pass_rate(items: list[EvaluatedResult]) -> float:
    if not items:
        return 0.0
    passes = sum(1 for e in items if e.weakness == WeaknessCategory.PASS)
    return passes / len(items)


def _split_by_path(
    evaluated: list[EvaluatedResult],
) -> tuple[list[EvaluatedResult], list[EvaluatedResult]]:
    """Return (bot_results, sidecar_results)."""
    bot = [e for e in evaluated if e.result.path == "bot"]
    sidecar = [e for e in evaluated if e.result.path == "sidecar"]
    return bot, sidecar


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------


def _section_summary(evaluated: list[EvaluatedResult]) -> str:
    total = len(evaluated)
    bot_results, sidecar_results = _split_by_path(evaluated)

    bot_pass = sum(1 for e in bot_results if e.weakness == WeaknessCategory.PASS)
    sidecar_pass = sum(1 for e in sidecar_results if e.weakness == WeaknessCategory.PASS)

    bot_lat = _avg([e.result.latency_ms for e in bot_results])
    sidecar_lat = _avg([e.result.latency_ms for e in sidecar_results])

    all_pass = sum(1 for e in evaluated if e.weakness == WeaknessCategory.PASS)
    all_fail = total - all_pass

    lines: list[str] = [
        "## Summary",
        "",
        f"- **Total questions evaluated:** {total}",
        f"- **Overall pass:** {all_pass} ({all_pass / total * 100:.1f}%)"
        if total
        else "- **Overall pass:** 0",
        f"- **Overall fail:** {all_fail}",
        "",
        "| Path | Questions | Pass | Fail | Pass Rate | Avg Latency (ms) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        f"| bot | {len(bot_results)} | {bot_pass} | {len(bot_results) - bot_pass}"
        f" | {_pass_rate(bot_results) * 100:.1f}% | {bot_lat:.0f} |",
        f"| sidecar | {len(sidecar_results)} | {sidecar_pass} | {len(sidecar_results) - sidecar_pass}"
        f" | {_pass_rate(sidecar_results) * 100:.1f}% | {sidecar_lat:.0f} |",
        "",
    ]
    return "\n".join(lines)


def _section_weakness_breakdown(evaluated: list[EvaluatedResult]) -> str:
    total = len(evaluated)
    bot_results, sidecar_results = _split_by_path(evaluated)

    # Count by weakness per path.
    bot_counts: dict[WeaknessCategory, int] = defaultdict(int)
    sidecar_counts: dict[WeaknessCategory, int] = defaultdict(int)
    worst_example: dict[WeaknessCategory, str] = {}

    for e in bot_results:
        bot_counts[e.weakness] += 1
        if e.weakness != WeaknessCategory.PASS:
            worst_example.setdefault(e.weakness, e.result.question_text)

    for e in sidecar_results:
        sidecar_counts[e.weakness] += 1
        if e.weakness != WeaknessCategory.PASS:
            worst_example.setdefault(e.weakness, e.result.question_text)

    all_categories = list(WeaknessCategory)

    lines: list[str] = [
        "## Weakness Breakdown",
        "",
        "| Weakness | Bot | Sidecar | % of Total | Worst Example |",
        "| --- | ---: | ---: | ---: | --- |",
    ]

    for cat in all_categories:
        b = bot_counts.get(cat, 0)
        s = sidecar_counts.get(cat, 0)
        pct = (b + s) / total * 100 if total else 0.0
        example = _truncate(worst_example.get(cat, "—"))
        lines.append(f"| {cat.value} | {b} | {s} | {pct:.1f}% | {example} |")

    lines.append("")
    return "\n".join(lines)


def _section_kb_coverage(evaluated: list[EvaluatedResult]) -> str:
    # Group by (equipment_type, topic_category).
    groups: dict[tuple[str, str], list[EvaluatedResult]] = defaultdict(list)
    for e in evaluated:
        key = (e.result.equipment_type, e.result.topic_category)
        groups[key].append(e)

    lines: list[str] = [
        "## KB Coverage Map",
        "",
        "| Equipment Type | Fault Category | Questions Asked | Pass Rate |",
        "| --- | --- | ---: | ---: |",
    ]

    for (equip, topic), items in sorted(groups.items()):
        rate = _pass_rate(items)
        lines.append(f"| {equip} | {topic} | {len(items)} | {rate * 100:.1f}% |")

    lines.append("")
    return "\n".join(lines)


def _section_bot_vs_sidecar(evaluated: list[EvaluatedResult]) -> str:
    # Group by topic_category for each path.
    bot_by_topic: dict[str, list[EvaluatedResult]] = defaultdict(list)
    sidecar_by_topic: dict[str, list[EvaluatedResult]] = defaultdict(list)

    for e in evaluated:
        if e.result.path == "bot":
            bot_by_topic[e.result.topic_category].append(e)
        else:
            sidecar_by_topic[e.result.topic_category].append(e)

    all_topics = sorted(set(list(bot_by_topic.keys()) + list(sidecar_by_topic.keys())))

    lines: list[str] = [
        "## Bot vs Sidecar Comparison",
        "",
        "| Topic Category | Bot Pass Rate | Sidecar Pass Rate | Delta |",
        "| --- | ---: | ---: | ---: |",
    ]

    for topic in all_topics:
        bot_rate = _pass_rate(bot_by_topic.get(topic, []))
        sidecar_rate = _pass_rate(sidecar_by_topic.get(topic, []))
        delta = sidecar_rate - bot_rate
        delta_str = f"+{delta * 100:.1f}%" if delta >= 0 else f"{delta * 100:.1f}%"
        lines.append(
            f"| {topic} | {bot_rate * 100:.1f}% | {sidecar_rate * 100:.1f}% | {delta_str} |"
        )

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_report(evaluated: list[EvaluatedResult]) -> str:
    """Return the full Markdown report as a string."""
    ts = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    header = f"# MIRA Synthetic User Evaluation Report\n\n_Generated: {ts}_\n\n"

    sections = [
        header,
        _section_summary(evaluated),
        _section_weakness_breakdown(evaluated),
        _section_kb_coverage(evaluated),
        _section_bot_vs_sidecar(evaluated),
    ]
    return "\n".join(sections)


def generate_json_report(evaluated: list[EvaluatedResult]) -> dict:
    """Return a machine-readable dict with all metrics."""
    total = len(evaluated)
    bot_results, sidecar_results = _split_by_path(evaluated)

    # Weakness counts across all results.
    weakness_counts: dict[str, dict[str, int]] = {}
    for cat in WeaknessCategory:
        bot_n = sum(1 for e in bot_results if e.weakness == cat)
        sidecar_n = sum(1 for e in sidecar_results if e.weakness == cat)
        weakness_counts[cat.value] = {
            "bot": bot_n,
            "sidecar": sidecar_n,
            "total": bot_n + sidecar_n,
            "pct_of_total": round((bot_n + sidecar_n) / total * 100, 2) if total else 0.0,
        }

    # KB coverage groups.
    kb_groups: dict[tuple[str, str], list[EvaluatedResult]] = defaultdict(list)
    for e in evaluated:
        kb_groups[(e.result.equipment_type, e.result.topic_category)].append(e)

    kb_coverage: list[dict] = []
    for (equip, topic), items in sorted(kb_groups.items()):
        kb_coverage.append(
            {
                "equipment_type": equip,
                "topic_category": topic,
                "questions": len(items),
                "pass_rate": round(_pass_rate(items), 4),
            }
        )

    # Bot vs sidecar by topic.
    bot_by_topic: dict[str, list[EvaluatedResult]] = defaultdict(list)
    sidecar_by_topic: dict[str, list[EvaluatedResult]] = defaultdict(list)
    for e in evaluated:
        if e.result.path == "bot":
            bot_by_topic[e.result.topic_category].append(e)
        else:
            sidecar_by_topic[e.result.topic_category].append(e)

    topic_comparison: list[dict] = []
    for topic in sorted(set(list(bot_by_topic.keys()) + list(sidecar_by_topic.keys()))):
        bot_rate = _pass_rate(bot_by_topic.get(topic, []))
        sidecar_rate = _pass_rate(sidecar_by_topic.get(topic, []))
        topic_comparison.append(
            {
                "topic_category": topic,
                "bot_pass_rate": round(bot_rate, 4),
                "sidecar_pass_rate": round(sidecar_rate, 4),
                "delta": round(sidecar_rate - bot_rate, 4),
            }
        )

    # Per-result detail.
    results_detail: list[dict] = []
    for e in evaluated:
        results_detail.append(
            {
                "question_id": e.result.question_id,
                "question_text": e.result.question_text,
                "path": e.result.path,
                "persona_id": e.result.persona_id,
                "topic_category": e.result.topic_category,
                "equipment_type": e.result.equipment_type,
                "vendor": e.result.vendor,
                "adversarial_category": e.result.adversarial_category,
                "weakness": e.weakness.value,
                "ground_truth_score": e.ground_truth_score,
                "keyword_matches": e.keyword_matches,
                "latency_ms": e.result.latency_ms,
                "details": e.details,
            }
        )

    return {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "summary": {
            "total": total,
            "pass": sum(1 for e in evaluated if e.weakness == WeaknessCategory.PASS),
            "fail": sum(1 for e in evaluated if e.weakness != WeaknessCategory.PASS),
            "pass_rate": round(
                sum(1 for e in evaluated if e.weakness == WeaknessCategory.PASS) / total, 4
            )
            if total
            else 0.0,
            "bot": {
                "total": len(bot_results),
                "pass": sum(1 for e in bot_results if e.weakness == WeaknessCategory.PASS),
                "pass_rate": round(_pass_rate(bot_results), 4),
                "avg_latency_ms": round(_avg([e.result.latency_ms for e in bot_results]), 1),
            },
            "sidecar": {
                "total": len(sidecar_results),
                "pass": sum(1 for e in sidecar_results if e.weakness == WeaknessCategory.PASS),
                "pass_rate": round(_pass_rate(sidecar_results), 4),
                "avg_latency_ms": round(
                    _avg([e.result.latency_ms for e in sidecar_results]), 1
                ),
            },
        },
        "weakness_counts": weakness_counts,
        "kb_coverage": kb_coverage,
        "topic_comparison": topic_comparison,
        "results": results_detail,
    }
