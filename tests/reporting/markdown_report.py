"""Markdown report writer for MIRA evaluation runs.

Extends patterns from mira-bots/telegram_test_runner/report.py with
multi-regime support and the FactoryLM eval banner format.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from tests.scoring.composite import CaseResult, RunResult
from tests.scoring.contains_check import FIX_SUGGESTIONS
from tests.scoring.thresholds import DEFAULT_THRESHOLD


# Standing-at-the-machine verdicts (from report.py)
_STANDING_VERDICTS: dict[str, str] = {
    "OCR_FAILURE": "A tech would be confused -- the response failed to identify the device.",
    "IDENTIFICATION_ONLY": "A tech would know what it is but nothing else -- not useful in the field.",
    "NO_FAULT_CAUSE": "A tech would know what the device is but not why it failed.",
    "NO_NEXT_STEP": "A tech would understand the problem but not know what to do.",
    "TOO_VERBOSE": "A tech standing in a hot panel room would give up reading halfway through.",
    "HALLUCINATION": "A tech would be misled -- the response describes the wrong equipment.",
    "RESPONSE_TOO_GENERIC": "A tech would get generic advice they already know.",
    "JARGON_FAILURE": "A tech would struggle with unexplained technical terms.",
    "TRANSPORT_FAILURE": "No response received -- bot did not reply.",
    "ADVERSARIAL_PARTIAL": "Response succeeded despite challenging image quality.",
}


def get_standing_verdict(result: CaseResult) -> str:
    """Generate plain English verdict for a tech standing at the machine."""
    if result.passed:
        return "A tech would find this immediately useful -- device identified, fault explained, action clear."
    return _STANDING_VERDICTS.get(result.failure_bucket or "", "Unable to determine verdict.")


def write_eval_report(
    runs: list[RunResult],
    output_dir: str | Path,
    version: str = "0.1.0",
    threshold: float = DEFAULT_THRESHOLD,
) -> Path:
    """Write the full FactoryLM eval report in Markdown.

    Returns path to the written report.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc)
    ts_str = ts.strftime("%Y-%m-%d")
    ts_file = ts.strftime("%Y%m%dT%H%M%SZ")

    path = output_dir / f"run_{ts_file}.md"

    # Compute overall stats
    total_cases = sum(r.total_cases for r in runs)
    total_passed = sum(r.passed_cases for r in runs)
    overall_rate = total_passed / total_cases if total_cases > 0 else 0.0
    overall_status = "PASS" if overall_rate >= threshold else "FAIL"

    lines: list[str] = []

    # Banner
    lines.append(f"```")
    lines.append(f"{'=' * 50}")
    lines.append(f"FACTORYLM EVAL -- v{version} -- {ts_str}")
    lines.append(f"{'=' * 50}")

    for run in runs:
        pct = int(run.pass_rate * 100)
        avg = run.avg_latency_ms / 1000 if run.avg_latency_ms else 0.0

        if run.regime == "regime4_synthetic":
            # Special format for tiered questions
            tier_status = run.results[0].metadata.get("tier_summary", "") if run.results else ""
            lines.append(f"Regime 4 Question Evolution: {tier_status}")
        else:
            label = _regime_label(run.regime)
            lines.append(
                f"{label:<35} {run.passed_cases}/{run.total_cases} PASS  ({pct}%)  avg {avg:.1f}s"
            )

    lines.append(f"{'=' * 50}")
    lines.append(
        f"OVERALL: {int(overall_rate * 100)}% | THRESHOLD: {int(threshold * 100)}% | STATUS: {overall_status}"
    )
    lines.append(f"{'=' * 50}")
    lines.append(f"```")
    lines.append("")

    # Per-regime detail sections
    for run in runs:
        lines.append(f"## {_regime_label(run.regime)}")
        lines.append("")
        lines.append(f"| Metric | Value |")
        lines.append(f"|--------|-------|")
        lines.append(f"| Cases | {run.total_cases} |")
        lines.append(f"| Passed | {run.passed_cases} |")
        lines.append(f"| Pass rate | {int(run.pass_rate * 100)}% |")
        lines.append(f"| Avg latency | {run.avg_latency_ms:.0f}ms |")
        lines.append(f"| Duration | {run.duration_seconds:.1f}s |")
        lines.append("")

        # Failure breakdown
        buckets: dict[str, int] = {}
        for r in run.results:
            if not r.passed and r.failure_bucket:
                buckets[r.failure_bucket] = buckets.get(r.failure_bucket, 0) + 1

        if buckets:
            lines.append("### Failure Breakdown")
            lines.append("")
            lines.append("| Bucket | Count | Fix |")
            lines.append("|--------|-------|-----|")
            for bucket, count in sorted(buckets.items(), key=lambda x: -x[1]):
                fix = FIX_SUGGESTIONS.get(bucket, "")
                lines.append(f"| {bucket} | {count} | {fix} |")
            lines.append("")

        # Case details (abbreviated)
        lines.append("### Case Results")
        lines.append("")
        lines.append("| Case | Score | Pass | Bucket | Latency |")
        lines.append("|------|-------|------|--------|---------|")
        for r in run.results:
            icon = "PASS" if r.passed else "FAIL"
            bucket = r.failure_bucket or "--"
            lines.append(
                f"| {r.case_id} | {r.composite_score:.2f} | {icon} | {bucket} | {r.latency_ms}ms |"
            )
        lines.append("")

    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")

    return path


def _regime_label(regime: str) -> str:
    labels = {
        "regime1_telethon": "Regime 1 Telethon Replay:",
        "regime2_rag": "Regime 2 RAG Triplets:",
        "regime3_nameplate": "Regime 3 Nameplate Vision:",
        "regime4_synthetic": "Regime 4 Question Evolution:",
        "regime5_nemotron": "Regime 5 Nemotron Generated:",
    }
    return labels.get(regime, regime)
