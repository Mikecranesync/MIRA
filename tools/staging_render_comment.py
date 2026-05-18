#!/usr/bin/env python3
"""Render the staging-gate PR comment from tools/staging_results.json.

Called by `.github/workflows/staging-gate.yml`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def render(results: dict, run_url: str) -> str:
    overall = "✅ PASS" if results["overall_pass"] else "❌ FAIL"
    lines = [
        f"### MIRA staging gate — {overall}",
        "",
        "_Engine + NeonDB staging branch + Groq cascade against 10 fixed questions, graded on the 5-dimension rubric in `docs/specs/mira-answer-quality-standard.md`._",
        "",
        f"- mean of means: **{results['mean_of_means']:.2f}** (pass threshold: {results['thresholds']['pass_avg']})",
        f"- questions passed: **{results['passed']} / {results['total']}**",
        f"- below mean 3.0: **{results['below_3']}** (max allowed: {results['thresholds']['max_below_3']})",
        f"- hard fails: **{results['hard_fails']}**",
        f"- [full run logs]({run_url})",
        "",
        "| id | category | g | c | a | s | t | mean | fail |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for q in results["questions"]:
        s = q["scores"]
        fail = ", ".join(q["fail_reasons"]) if q["fail_reasons"] else ""
        emoji = "❌" if q["fail_reasons"] else ("⚠️" if q["mean"] < 3.0 else "✅")
        lines.append(
            f"| {emoji} `{q['id']}` | {q['category']} | {s['grounding']} | {s['context']} | "
            f"{s['actionability']} | {s['safety']} | {s['tone']} | **{q['mean']:.2f}** | {fail} |"
        )
    failing = [q for q in results["questions"] if q["fail_reasons"]]
    if failing:
        lines.extend(["", "<details><summary>Failing question replies (truncated)</summary>", ""])
        for q in failing:
            lines.append(f"**{q['id']}** — {q['judge_reason']}")
            lines.append("")
            lines.append(f"> _user:_ {q['message']}")
            lines.append("")
            lines.append("```")
            lines.append(q["reply_preview"])
            lines.append("```")
            lines.append("")
        lines.append("</details>")
    lines.extend(
        [
            "",
            "_Rubric: `docs/specs/mira-answer-quality-standard.md` · Spec: `docs/specs/staging-environment-spec.md`_",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    ap.add_argument("--run-url", default="")
    args = ap.parse_args()
    if not args.src.exists():
        sys.stderr.write(f"missing input {args.src}\n")
        sys.exit(2)
    data = json.loads(args.src.read_text(encoding="utf-8"))
    args.dst.write_text(render(data, args.run_url), encoding="utf-8")


if __name__ == "__main__":
    main()
