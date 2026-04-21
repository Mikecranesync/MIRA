"""
report_v2.py — Writes v2 test run reports.
Output: artifacts/v2/latest_run/report_v2.md + results_v2.json
        artifacts/v2/evidence/{case_name}_{request,response,score}.json
"""

import json
import os

# Import v1 standing verdict
import sys
from datetime import datetime, timezone
from pathlib import Path

from agent import Decision

_HERE = Path(__file__).parent
sys.path.insert(0, str(_HERE.parent / "telegram_test_runner"))
from report import _get_standing_verdict  # noqa: E402


def write_report_v2(
    ingest_results: list[dict],
    telegram_results: list[dict] | None,
    heal_log: list[dict],
    fix_cycles: int,
    decision: Decision,
    artifacts_dir: str = "artifacts",
) -> None:
    out_dir = os.path.join(artifacts_dir, "v2", "latest_run")
    evidence_dir = os.path.join(artifacts_dir, "v2", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(evidence_dir, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ts_human = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    total = len(ingest_results)
    passed = sum(1 for r in ingest_results if r.get("passed"))
    failed = total - passed
    pass_rate = round(passed / total, 4) if total > 0 else 0.0
    avg_words = (
        round(sum(r.get("word_count", 0) for r in ingest_results) / total, 1) if total > 0 else 0
    )
    avg_time = (
        round(sum(r.get("elapsed", 0.0) for r in ingest_results) / total, 2) if total > 0 else 0.0
    )

    # --- results_v2.json ---
    payload = {
        "timestamp": ts,
        "version": "v2",
        "summary": {
            "total": total,
            "passed": passed,
            "failed": failed,
            "pass_rate": pass_rate,
            "fix_cycles": fix_cycles,
            "avg_words": avg_words,
            "avg_elapsed": avg_time,
            "decision": decision.action,
            "release_version": decision.version,
        },
        "cases": ingest_results,
        "heal_log": heal_log,
        "telegram": telegram_results,
    }
    json_path = os.path.join(out_dir, "results_v2.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)

    # --- report_v2.md ---
    lines = [
        "# MIRA v2 Autonomous Test Report",
        f"Generated: {ts_human}",
        "",
        "## 1. Summary",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total cases | {total} |",
        f"| Passed | {passed} |",
        f"| Failed | {failed} |",
        f"| Pass rate | {pass_rate:.1%} |",
        f"| Fix cycles | {fix_cycles} |",
        f"| Avg words | {avg_words} |",
        f"| Avg response time | {avg_time:.2f}s |",
        f"| Decision | **{decision.action}** |",
        f"| Release version | {decision.version or '—'} |",
        "",
        f"> {decision.message}",
        "",
    ]

    # 2. Category breakdown
    lines += ["## 2. Category Breakdown", ""]
    lines += _category_breakdown(ingest_results)
    lines.append("")

    # 3. Self-healing summary
    lines += ["## 3. Self-Healing Summary", ""]
    if heal_log:
        lines += _heal_summary_table(heal_log)
    else:
        lines.append("No healing required — all cases passed on first attempt.")
    lines.append("")

    # 4. Telegram comparison
    if telegram_results:
        lines += ["## 4. Telegram Comparison", ""]
        lines += _telegram_comparison_table(ingest_results, telegram_results)
        lines.append("")

    # 5. Fix changelog
    prompt_heals = [h for h in heal_log if h.get("heal_type") == "HEALED_PROMPT"]
    if prompt_heals:
        lines += ["## 5. Fix Changelog", ""]
        for h in prompt_heals:
            lines.append(
                f"- **{h['case']}**: DESCRIBE_SYSTEM patched — added numbered label instruction"
            )
        lines.append("")

    # 6. Case results
    lines += ["## 6. Case Results", ""]
    lines += [
        "| # | Case | Result | Bucket | Words | Healing |",
        "|---|------|--------|--------|-------|---------|",
    ]
    heal_map = {h["case"]: h for h in heal_log}
    for i, r in enumerate(ingest_results, 1):
        icon = "✅" if r.get("passed") else "❌"
        bucket = r.get("failure_bucket") or "—"
        words = r.get("word_count", 0)
        heal = heal_map.get(r["case"], {})
        heal_str = heal.get("heal_type", "—") if heal else "—"
        lines.append(f"| {i} | {r['case']} | {icon} | {bucket} | {words} | {heal_str} |")
    lines.append("")

    lines += ["### Standing Verdicts", ""]
    for r in ingest_results:
        if not r.get("passed"):
            verdict = _standing_verdict(r)
            lines.append(f"**{r['case']}**: {verdict}")
    lines.append("")

    # 7. Release verdict
    lines += [
        "## 7. Release Verdict",
        "",
        f"**Action:** {decision.action}",
        f"**Version:** {decision.version or '—'}",
        f"**Ingest pass rate:** {decision.ingest_rate:.1%}",
    ]
    if decision.tele_rate is not None:
        lines.append(f"**Telegram pass rate:** {decision.tele_rate:.1%}")
    lines.append("")
    lines.append(f"> {decision.message}")

    md_path = os.path.join(out_dir, "report_v2.md")
    with open(md_path, "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Report written: {json_path}")
    print(f"Report written: {md_path}")


def _write_evidence(
    case: dict,
    request_payload: dict,
    reply: str | None,
    result: dict,
    evidence_dir: str,
) -> None:
    name = case.get("name", "unknown")
    os.makedirs(evidence_dir, exist_ok=True)
    with open(os.path.join(evidence_dir, f"{name}_request.json"), "w") as f:
        json.dump(request_payload, f, indent=2)
    with open(os.path.join(evidence_dir, f"{name}_response.json"), "w") as f:
        json.dump({"reply": reply}, f, indent=2)
    with open(os.path.join(evidence_dir, f"{name}_score.json"), "w") as f:
        json.dump(result, f, indent=2)


def _heal_summary_table(heal_log: list[dict]) -> list[str]:
    rows = [
        "| Case | Heal Type | Attempts | Original Bucket |",
        "|------|-----------|----------|----------------|",
    ]
    for h in heal_log:
        rows.append(
            f"| {h.get('case', '?')} | {h.get('heal_type', '?')} | {h.get('attempts', '?')} | {h.get('original_bucket', '?')} |"
        )
    return rows


def _telegram_comparison_table(ingest_r: list[dict], tele_r: list[dict]) -> list[str]:
    tele_map = {r.get("case", ""): r for r in tele_r}
    rows = [
        "| Case | Ingest | Telegram |",
        "|------|--------|----------|",
    ]
    for r in ingest_r[: len(tele_r)]:
        name = r.get("case", "")
        ingest_icon = "✅" if r.get("passed") else "❌"
        t = tele_map.get(name, {})
        tele_icon = "✅" if t.get("passed") else ("⚠️" if t else "—")
        rows.append(f"| {name} | {ingest_icon} | {tele_icon} |")
    return rows


def _category_breakdown(results: list[dict]) -> list[str]:
    cats: dict[str, dict] = {}
    for r in results:
        cat = r.get("failure_bucket") or "PASS"
        # Use fault_category from result if available (won't be — use name prefix)
        # Group by first segment of case name
        prefix = r.get("case", "").split("_")[0].upper()
        if prefix not in cats:
            cats[prefix] = {"total": 0, "passed": 0}
        cats[prefix]["total"] += 1
        if r.get("passed"):
            cats[prefix]["passed"] += 1

    rows = [
        "| Category | Total | Passed | Rate |",
        "|----------|-------|--------|------|",
    ]
    for cat, d in sorted(cats.items()):
        rate = d["passed"] / d["total"] if d["total"] > 0 else 0
        rows.append(f"| {cat} | {d['total']} | {d['passed']} | {rate:.0%} |")
    return rows


def _standing_verdict(result: dict) -> str:
    return _get_standing_verdict(result)
