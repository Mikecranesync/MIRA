"""
Report writer for MIRA Telegram vision test harness.
Writes artifacts/latest_run/results.json and artifacts/latest_run/report.md
"""

import json
import os
from datetime import datetime, timezone


def _get_standing_verdict(result: dict) -> str:
    """Generate plain English verdict for a tech standing at the machine."""
    if result["passed"]:
        return "A tech would find this immediately useful — device identified, fault explained, action clear."
    bucket = result.get("failure_bucket", "")
    verdicts = {
        "OCR_FAILURE": "A tech would be confused — the response failed to identify the device.",
        "IDENTIFICATION_ONLY": "A tech would know what it is but nothing else — not useful in the field.",
        "NO_FAULT_CAUSE": "A tech would know what the device is but not why it failed.",
        "NO_NEXT_STEP": "A tech would understand the problem but not know what to do.",
        "TOO_VERBOSE": "A tech standing in a hot panel room would give up reading halfway through.",
        "HALLUCINATION": "A tech would be misled — the response describes the wrong equipment.",
        "RESPONSE_TOO_GENERIC": "A tech would get generic advice they already know — not actionable for this specific device.",
        "JARGON_FAILURE": "A tech would struggle with unexplained technical terms.",
        "TRANSPORT_FAILURE": "No response received — bot did not reply.",
        "ADVERSARIAL_PARTIAL": "Response succeeded despite challenging image quality.",
    }
    return verdicts.get(bucket, "Unable to determine verdict.")


def write_report(
    results: list[dict],
    bot_username: str,
    dry_run: bool,
    artifacts_dir: str = "artifacts",
    run_changelog: str = "",
    output_prefix: str = "",
) -> None:
    """Write JSON + Markdown report to artifacts/latest_run/.

    Args:
        results: list of result dicts from judge.score()
        bot_username: e.g. "@MIRABot"
        dry_run: whether this was a dry run
        artifacts_dir: base artifacts directory path
        run_changelog: optional changelog from previous runs
    """
    out_dir = os.path.join(artifacts_dir, "latest_run")
    os.makedirs(out_dir, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ts_human = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    pass_rate = round(passed / total, 2) if total > 0 else 0.0

    by_bucket: dict[str, int] = {}
    for r in results:
        if r["failure_bucket"]:
            by_bucket[r["failure_bucket"]] = by_bucket.get(r["failure_bucket"], 0) + 1

    summary = {
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": pass_rate,
        "by_bucket": by_bucket,
    }

    # --- results.json ---
    payload = {
        "timestamp": ts,
        "bot_username": bot_username,
        "version": "2.0.0",
        "dry_run": dry_run,
        "cases": results,
        "summary": summary,
    }
    suffix = f"_{output_prefix}" if output_prefix else ""
    json_path = os.path.join(out_dir, f"results{suffix}.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)

    # --- report.md ---
    lines = [
        "# MIRA Telegram Vision Test Report",
        f"Generated: {ts_human}",
        f"Bot: {bot_username}",
        "",
        "## Summary",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total cases | {total} |",
        f"| Passed | {passed} |",
        f"| Failed | {failed} |",
        f"| Pass rate | {int(pass_rate * 100)}% |",
        "",
    ]

    if dry_run:
        lines.append("> **DRY RUN** — no real Telegram messages were sent.\n")

    # Case summary table
    lines += [
        "## Case Results Summary",
        "| Case | Result | Conditions | Bucket |",
        "|------|--------|------------|--------|",
    ]
    for r in results:
        result_icon = "✅" if r["passed"] else "❌"
        cond_str = " ".join("✅" if v else "❌" for v in r["conditions"].values())
        bucket = r["failure_bucket"] or "—"
        lines.append(f"| {r['case']} | {result_icon} | {cond_str} | {bucket} |")
    lines.append("")

    # Detailed case analysis
    lines.append("## Detailed Results")
    lines.append("")

    for i, r in enumerate(results, 1):
        result_icon = "✅ PASS" if r["passed"] else "❌ FAIL"
        lines += [
            f"### Case {i}: {r['case']}",
            f"**Result:** {result_icon}",
            "",
            "#### Conditions",
            "| Condition | Pass? | Evidence |",
            "|---|---|---|",
        ]

        # Build condition table
        conds = r.get("conditions", {})
        facts = r.get("extracted_facts", {})
        lines.append(
            f"| IDENTIFICATION | {'✅' if conds.get('IDENTIFICATION') else '❌'} | {', '.join(facts.get('identification_terms_found', []) or ['—'])} |"
        )
        lines.append(
            f"| FAULT_CAUSE | {'✅' if conds.get('FAULT_CAUSE') else '❌'} | {', '.join(facts.get('fault_cause_found', []) or ['—'])} |"
        )
        lines.append(
            f"| NEXT_STEP | {'✅' if conds.get('NEXT_STEP') else '❌'} | {', '.join(facts.get('next_step_found', []) or ['—'])} |"
        )
        lines.append(
            f"| READABILITY | {'✅' if conds.get('READABILITY') else '❌'} | {r.get('word_count', 0)} words ≤ 150 |"
        )
        lines.append(
            f"| SPEED | {'✅' if conds.get('SPEED') else '❌'} | {r.get('elapsed', 0):.1f}s < 30s |"
        )
        lines.append(
            f"| ACTIONABILITY | {'✅' if conds.get('ACTIONABILITY') else '❌'} | ID + Next Step |"
        )
        lines += [""]

        # Violations
        violations = facts.get("must_not_contain_violated", [])
        if violations:
            lines.append(f"**Hallucination detected:** {', '.join(violations)}")
            lines.append("")

        # Standing at the machine verdict
        lines.append("#### Standing at the Machine")
        lines.append(f"> {_get_standing_verdict(r)}")
        lines.append("")

        # Fix suggestion
        if r.get("fix_suggestion"):
            lines.append("#### Fix Recommendation")
            lines.append(f"> {r['fix_suggestion']}")
            lines.append("")

    # Suggested next actions
    lines.append("## Recommended Next Actions")
    lines.append("")

    # Group failures by bucket
    bucket_counts: dict[str, int] = {}
    for r in results:
        if not r["passed"] and r["failure_bucket"]:
            bucket = r["failure_bucket"]
            bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1

    if bucket_counts:
        # Top 3 by count
        top_buckets = sorted(bucket_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        for bucket, count in top_buckets:
            fix = r.get("fix_suggestion", "")
            lines.append(f"**{bucket}** ({count} case{'s' if count != 1 else ''}): {fix}")
            lines.append("")
    else:
        lines.append("All cases passed! No actions needed.")
        lines.append("")

    # Changelog
    if run_changelog:
        lines.append("## What Was Fixed")
        lines.append(run_changelog)
        lines.append("")

    md_path = os.path.join(out_dir, f"report{suffix}.md")
    with open(md_path, "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Report written: {json_path}")
    print(f"Report written: {md_path}")
