"""Replay the frozen MCQ run to measure what MIRA's wrapper changed.

The answer key and human-adjudicated examples are fixed before a candidate run.
This is an intelligence-retention and intervention regression eval, not proof
that the wrapper adds value on machine-specific troubleshooting (Answer Radar
measures that separately). No model calls or staging credentials are needed.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path
from typing import Any

from answer_radar.hub_runner import TERMINAL_STATUSES
from answer_radar.mcq_hub import EXAM, parse_letter

REFUSAL_CASES = {3, 6}
# Human adjudication of the 2026-09-28 transcript. These answer snippets were
# safe instructions or safety advice; a warning *about that snippet* is noise.
SAFE_WARNING_CASES = {8, 12, 28, 31, 55}
# Match only the *adjudicated quoted step*. A later run may contain a new,
# genuinely hazardous step in the same answer; that needs a human review.
SAFE_WARNING_TEXT = {
    8: r"measure the three input line voltages \(with the VFD de-energized",
    12: r"with the drive powered down, measure the incoming line voltage",
    28: r"Do not add grease to a hot bearing without first isolating",
    31: r"When the PLC is running, a normally-open",
    55: r"Any work on energized equipment, even at 277 V, must follow NFPA 70E",
}
BASELINE = Path(__file__).resolve().parent / "runs/mcq-exam-2026-09-28"


def _rows(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _indexed(rows: list[dict[str, Any]], label: str) -> dict[int, dict[str, Any]]:
    by_id: dict[int, dict[str, Any]] = {}
    for row in rows:
        ident = row["id"]
        if ident in by_id:
            raise ValueError(f"{label}: duplicate question {ident}")
        by_id[ident] = row
    return by_id


def evaluate(
    mira_rows: list[dict[str, Any]], bare_rows: list[dict[str, Any]],
    questions: list[dict[str, Any]], *, require_complete: bool = True,
) -> dict[str, Any]:
    exam = _indexed(questions, "exam")
    mira = _indexed(mira_rows, "MIRA")
    bare = _indexed(bare_rows, "bare model")
    if require_complete and (mira.keys() != exam.keys() or bare.keys() != exam.keys()):
        raise ValueError("100-question comparison requires the same complete question IDs")
    if not mira.keys() <= exam.keys() or not bare.keys() <= exam.keys():
        raise ValueError("a run contains an unknown question ID")
    if not mira.keys() <= bare.keys():
        raise ValueError("MIRA run has questions without bare-model comparison")

    issues: list[str] = []
    paired: list[dict[str, Any]] = []
    false_warnings: list[int] = []
    refusals: list[int] = []
    missing_diagnostics: list[int] = []
    for ident, row in sorted(mira.items()):
        q, model = exam[ident], bare[ident]
        if row["correct_answer"] != q["key"] or model["correct_answer"] != q["key"]:
            raise ValueError(f"Q{ident}: answer key differs from frozen exam")
        answer = row.get("answer_text") or ""
        complete = row.get("http") == 200 and row.get("turn_status") in TERMINAL_STATUSES
        if complete:
            letter, _ = parse_letter(answer, q["options"])
        else:
            letter = "ERROR"
        # Always re-grade from the saved text: the original 91/100 was a parser
        # error and the saved model_answer field must not become an authority.
        refusal = "I can't verify that machine-specific detail" in answer
        warning = answer.lstrip().startswith("⚠")
        if ident in REFUSAL_CASES and refusal:
            refusals.append(ident)
        quoted_step = re.search(r"Safety flag on a step below:\*\*\s*[“\"]([^”\"]+)", answer[:1200])
        if ident in SAFE_WARNING_CASES and warning and quoted_step and re.search(
            SAFE_WARNING_TEXT[ident], quoted_step.group(1), re.IGNORECASE
        ):
            false_warnings.append(ident)
        if row.get("diagnostics") is None:
            missing_diagnostics.append(ident)
        paired.append({
            "id": ident, "bare_correct": model["model_answer"] == q["key"],
            "mira_correct": letter == q["key"], "mira_letter": letter,
            "warning": warning, "refusal": refusal,
            "basis": row.get("basis"), "response_time_ms": row.get("response_time_ms"),
        })
    if refusals:
        issues.append(f"general-question refusal on {refusals}")
    if false_warnings:
        issues.append(f"warning on adjudicated safe text on {false_warnings}")
    incomplete = [p["id"] for p in paired if p["mira_letter"] in ("UNPARSED", "ERROR")]
    if incomplete:
        issues.append(f"unreadable or failed answers on {incomplete}")
    timings = [p["response_time_ms"] for p in paired if isinstance(p["response_time_ms"], (int, float))]
    return {
        "total": len(paired),
        "bare_correct": sum(p["bare_correct"] for p in paired),
        "mira_correct": sum(p["mira_correct"] for p in paired),
        "bare_only_correct_ids": [p["id"] for p in paired if p["bare_correct"] and not p["mira_correct"]],
        "mira_only_correct_ids": [p["id"] for p in paired if p["mira_correct"] and not p["bare_correct"]],
        "paired": paired,
        "refusal_cases": refusals,
        "false_warning_cases": false_warnings,
        "all_warning_ids": [p["id"] for p in paired if p["warning"]],
        "unreadable_or_failed": incomplete,
        "missing_diagnostics_ids": missing_diagnostics,
        "general_reasoning_count": sum(p["basis"] == "general_reasoning" for p in paired),
        "median_mira_ms": statistics.median(timings) if timings else None,
        "regressions": issues,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mira", type=Path, default=BASELINE / "mira_hub_answers.jsonl")
    ap.add_argument("--bare", type=Path, default=BASELINE / "bare-model/mcq_eval_results.json")
    ap.add_argument("--out", type=Path, help="optional JSON report path")
    ap.add_argument("--check", action="store_true", help="fail on known intervention regressions")
    args = ap.parse_args(argv)
    report = evaluate(
        _rows(args.mira), json.loads(args.bare.read_text(encoding="utf-8"))["results"],
        json.loads(EXAM.read_text(encoding="utf-8")),
    )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "paired"}, indent=2))
    return int(args.check and bool(report["regressions"]))


if __name__ == "__main__":
    raise SystemExit(main())
