"""Aggregate Print Translator benchmark judge grades into a report skeleton.

Reads `docs/eval/print-translator-benchmark/grades/*.json` (produced by judge subagents
following `JUDGE_PROTOCOL.md`, conforming to `grade_schema.json`) plus
`before_after_classifier.json`, and emits: overall stats, scores by category, hallucination
counts (from deductions), and a judge-disagreement list (pass1 vs pass2).

This script does NOT judge anything — it only reads grade files that already exist. It is safe
to run before any grading has happened: with an empty `grades/` directory it reports "0 grades
yet" and still emits the before/after classifier headline (which does not depend on grading).

Grade file naming convention (see JUDGE_PROTOCOL.md "Grade file naming for multiple passes"):
    grades/<case_id>.json          primary pass (judge_pass: 1)
    grades/<case_id>.pass2.json    escalated second pass (judge_pass: 2)

Usage (from repo root):
    python tools/print_translator_eval/benchmark/aggregate.py
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_BENCH_DIR = _REPO_ROOT / "docs" / "eval" / "print-translator-benchmark"
_GRADES_DIR = _BENCH_DIR / "grades"
_BEFORE_AFTER_PATH = _BENCH_DIR / "before_after_classifier.json"
_OUT_PATH = _BENCH_DIR / "report.json"

CATEGORY_KEYS = [
    "classification_answerability",
    "component_label_recognition",
    "power_control_flow",
    "sequence_interlocks_logic",
    "evidence_grounding_unsupported_claims",
    "technician_usefulness_clarity",
]


def _load_grades(grades_dir: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return (pass1_by_case_id, pass2_by_case_id)."""
    pass1: dict[str, dict] = {}
    pass2: dict[str, dict] = {}
    if not grades_dir.exists():
        return pass1, pass2
    for path in sorted(grades_dir.glob("*.json")):
        try:
            grade = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        case_id = grade.get("case_id") or path.stem.replace(".pass2", "")
        if path.name.endswith(".pass2.json") or grade.get("judge_pass") == 2:
            pass2[case_id] = grade
        else:
            pass1[case_id] = grade
    return pass1, pass2


def _overall_stats(grades: list[dict]) -> dict:
    if not grades:
        return {
            "n": 0,
            "mean_total": None,
            "median_total": None,
            "hard_failure_rate": None,
            "refusal_rate": None,
            "answerable_rate": None,
        }
    totals = [g["total"] for g in grades if "total" in g]
    hard_failures = [g for g in grades if g.get("hard_failure")]
    refusals = [g for g in grades if g.get("refusal")]
    answerable = [g for g in grades if g.get("answerable")]
    n = len(grades)
    return {
        "n": n,
        "mean_total": round(statistics.mean(totals), 2) if totals else None,
        "median_total": round(statistics.median(totals), 2) if totals else None,
        "hard_failure_rate": round(len(hard_failures) / n, 4),
        "hard_failure_ids": [g["case_id"] for g in hard_failures],
        "refusal_rate": round(len(refusals) / n, 4),
        "refusal_ids": [g["case_id"] for g in refusals],
        "answerable_rate": round(len(answerable) / n, 4),
    }


def _by_category(grades: list[dict]) -> dict:
    out: dict[str, dict] = {}
    for key in CATEGORY_KEYS:
        values = [
            g["category_scores"][key]
            for g in grades
            if "category_scores" in g and key in g["category_scores"]
        ]
        out[key] = {
            "n": len(values),
            "mean": round(statistics.mean(values), 2) if values else None,
            "max_possible": {
                "classification_answerability": 10,
                "component_label_recognition": 20,
                "power_control_flow": 20,
                "sequence_interlocks_logic": 20,
                "evidence_grounding_unsupported_claims": 20,
                "technician_usefulness_clarity": 10,
            }[key],
        }
    return out


def _hallucination_report(grades: list[dict]) -> dict:
    reason_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {}
    deduction_count_by_case: dict[str, int] = {}
    for g in grades:
        case_id = g.get("case_id", "?")
        deductions = g.get("deductions", [])
        deduction_count_by_case[case_id] = len(deductions)
        for d in deductions:
            sev = d.get("severity", "unknown")
            severity_counts[sev] = severity_counts.get(sev, 0) + 1
        for reason in g.get("hard_failure_reasons", []):
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    return {
        "hard_failure_reason_counts": reason_counts,
        "deduction_severity_counts": severity_counts,
        "deduction_count_by_case": deduction_count_by_case,
        "total_deductions": sum(deduction_count_by_case.values()),
    }


def _disagreement_report(pass1: dict[str, dict], pass2: dict[str, dict]) -> list[dict]:
    disagreements = []
    for case_id, g2 in pass2.items():
        g1 = pass1.get(case_id)
        if g1 is None:
            disagreements.append(
                {
                    "case_id": case_id,
                    "note": "pass2 grade exists with no matching pass1 grade — data issue, not a real disagreement",
                }
            )
            continue
        score_gap = abs(g1.get("total", 0) - g2.get("total", 0))
        hard_failure_disagreement = bool(g1.get("hard_failure")) != bool(g2.get("hard_failure"))
        disagreements.append(
            {
                "case_id": case_id,
                "pass1_total": g1.get("total"),
                "pass2_total": g2.get("total"),
                "score_gap": score_gap,
                "pass1_hard_failure": g1.get("hard_failure"),
                "pass2_hard_failure": g2.get("hard_failure"),
                "hard_failure_disagreement": hard_failure_disagreement,
                "escalation_warranted": score_gap > 15 or hard_failure_disagreement,
                "technician_review_queue": hard_failure_disagreement,
            }
        )
    return disagreements


def main() -> int:
    pass1, pass2 = _load_grades(_GRADES_DIR)
    grades = list(pass1.values())

    if not grades:
        print(f"0 grades yet in {_GRADES_DIR} — nothing to aggregate from judging.")
    else:
        print(f"{len(grades)} pass-1 grade(s) found, {len(pass2)} pass-2 (escalation) grade(s).")

    report = {
        "schema_version": 1,
        "judge_version": "benchmark-judge-v1",
        "overall": _overall_stats(grades),
        "by_category": _by_category(grades),
        "hallucination_report": _hallucination_report(grades),
        "judge_disagreement": _disagreement_report(pass1, pass2),
    }

    if _BEFORE_AFTER_PATH.exists():
        before_after = json.loads(_BEFORE_AFTER_PATH.read_text(encoding="utf-8"))
        report["before_after_classifier"] = before_after["aggregate"]
    else:
        report["before_after_classifier"] = None
        print(f"NOTE: {_BEFORE_AFTER_PATH} not found — run before_after_classifier.py first.")

    _BENCH_DIR.mkdir(parents=True, exist_ok=True)
    _OUT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {_OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
