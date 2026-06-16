"""Report generators — markdown, html, jsonl. Consumes evaluator.ScenarioGrade.

JSONL schema matches tests/eval/runs/*.jsonl so the active-learning ingester
can consume both suites uniformly.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .evaluator import ScenarioGrade
from .runner import ScenarioRun


def _summary(grades: list[ScenarioGrade]) -> dict:
    by_cat: dict[str, dict[str, int]] = defaultdict(lambda: {"pass": 0, "total": 0})
    safety_violations = 0
    hard_failed = 0
    for g in grades:
        by_cat[g.category]["total"] += 1
        if g.passed:
            by_cat[g.category]["pass"] += 1
        if g.hard_failed:
            hard_failed += 1
        for cp in g.checkpoints:
            if cp.name in ("hard_fail_safety", "hard_fail_plc_write") and not cp.passed:
                safety_violations += 1
    return {
        "total": len(grades),
        "passed": sum(1 for g in grades if g.passed),
        "hard_failed": hard_failed,
        "safety_violations": safety_violations,
        "by_category": dict(by_cat),
    }


def render_markdown(
    runs: list[ScenarioRun],
    grades: list[ScenarioGrade],
    *,
    mode: str,
    ts: str | None = None,
) -> str:
    summary = _summary(grades)
    ts = ts or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    lines = [
        f"# MIRA Conversation Suite — {ts} — mode={mode}",
        "",
        f"**Pass rate:** {summary['passed']}/{summary['total']} "
        f"({(summary['passed'] / max(summary['total'], 1)) * 100:.0f}%)",
        f"**Safety violations:** {summary['safety_violations']} "
        f"{'OK' if summary['safety_violations'] == 0 else 'FAIL'}",
        f"**Hard failed scenarios:** {summary['hard_failed']}",
        "",
        "## By category",
        "",
        "| Category | Pass | Total | Pass rate |",
        "|---|---|---|---|",
    ]
    for cat, stats in sorted(summary["by_category"].items()):
        rate = (stats["pass"] / max(stats["total"], 1)) * 100
        lines.append(f"| {cat} | {stats['pass']} | {stats['total']} | {rate:.0f}% |")

    failures = [g for g in grades if not g.passed]
    lines.extend(["", "## Failures", ""])
    if not failures:
        lines.append("_None — every scenario passed._")
    else:
        runs_by_id = {r.fixture_id: r for r in runs}
        for g in failures:
            run = runs_by_id.get(g.fixture_id)
            lines.append(f"### `{g.category}/{g.fixture_id}`")
            if g.error:
                lines.append(f"- **Error:** `{g.error}`")
            for cp in g.checkpoints:
                if not cp.passed:
                    badge = "HARD" if cp.severity == "hard" else "soft"
                    lines.append(f"- ❌ **{cp.name}** ({badge}) — {cp.reason}")
            if run:
                lines.append("")
                lines.append("Last reply:")
                lines.append("```")
                lines.append(run.last_reply[:600])
                lines.append("```")
            lines.append("")
    return "\n".join(lines)


def render_html(
    runs: list[ScenarioRun],
    grades: list[ScenarioGrade],
    *,
    mode: str,
    ts: str | None = None,
) -> str:
    md = render_markdown(runs, grades, mode=mode, ts=ts)
    body = (
        md.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""<!doctype html>
<html><head>
<meta charset="utf-8">
<title>MIRA Conversation Suite — {ts or ''}</title>
<style>
body {{ font: 14px/1.45 -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #222; }}
pre {{ background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }}
table {{ border-collapse: collapse; margin: 8px 0; }}
th, td {{ border: 1px solid #ccc; padding: 4px 10px; }}
h1, h2, h3 {{ color: #111; }}
</style>
</head><body><pre>{body}</pre></body></html>
"""


def render_jsonl(runs: list[ScenarioRun], grades: list[ScenarioGrade]) -> str:
    """One JSON object per scenario — schema-compatible with tests/eval/runs/*.jsonl."""
    runs_by_id = {r.fixture_id: r for r in runs}
    lines = []
    for g in grades:
        run = runs_by_id.get(g.fixture_id)
        record = {
            "scenario_id": g.fixture_id,
            "category": g.category,
            "suite": "conversation_suite",
            "passed": g.passed,
            "hard_failed": g.hard_failed,
            "checkpoints": [asdict(cp) for cp in g.checkpoints],
            "error": g.error,
        }
        if run:
            record.update(
                {
                    "mode": run.mode,
                    "total_turns": len(run.turns),
                    "total_latency_ms": run.total_latency_ms,
                    "final_state": run.final_state,
                    "final_asset": run.final_asset,
                    "turns": [asdict(t) for t in run.turns],
                }
            )
        lines.append(json.dumps(record, default=str))
    return "\n".join(lines) + "\n"


def write_report(
    runs: list[ScenarioRun],
    grades: list[ScenarioGrade],
    *,
    mode: str,
    fmt: str,
    out_dir: Path,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    if fmt == "md":
        path = out_dir / f"{ts}-{mode}.md"
        path.write_text(render_markdown(runs, grades, mode=mode, ts=ts))
    elif fmt == "html":
        path = out_dir / f"{ts}-{mode}.html"
        path.write_text(render_html(runs, grades, mode=mode, ts=ts))
    elif fmt == "jsonl":
        path = out_dir / f"{ts}-{mode}.jsonl"
        path.write_text(render_jsonl(runs, grades))
    else:
        raise ValueError(f"unknown format: {fmt}")
    return path


__all__ = ["render_markdown", "render_html", "render_jsonl", "write_report"]
