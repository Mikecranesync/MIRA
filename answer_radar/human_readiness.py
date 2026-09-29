"""Fail-closed pilot scorecard for MIRA technician journeys (#4101).

The runner and reviewers supply observations. This module only validates and
scores their signed records; Jev signals are diagnostic and cannot promote one.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

DIMENSIONS = ("task", "support", "identity", "next_step", "ui", "clarity")
SHA = re.compile(r"^[0-9a-f]{12,40}$")
HASH = re.compile(r"^[0-9a-f]{64}$")
# A turn that reached one of these ended with an answer or MIRA's own decline;
# anything else ("error", a missing terminal frame) is an app failure (#4109 F3).
COMPLETED_STATUSES = ("answered", "insufficient_evidence")


def _graded_row_mismatch(attempt: dict, case: dict, answer_hash: str) -> str | None:
    """Why the graded identity is NOT this attempt's answer, or None (#4109 F1).

    The grades bind `answer_hash`; it counts only if it is recomputed from the
    attempt's own grading row, and that row shows the graders exactly the
    question, answer text and passages this attempt rendered.
    """
    from answer_radar.score import answer_identity

    row = attempt.get("grading_row")
    if not isinstance(row, dict) or not isinstance(row.get("evaluation"), dict):
        return "grading row missing"
    if answer_identity(row) != answer_hash:
        return "grades bind a different answer"
    ev = row["evaluation"]
    if ev.get("answer_text") != attempt.get("rendered_answer"):
        return "graded answer text differs from the rendered answer"
    if (ev.get("cited_passages") or []) != (attempt.get("cited_passages") or []):
        return "graded passages differ from the attempt's passages"
    if (row.get("question") or {}).get("normalized_question") != case.get("question"):
        return "graded question differs from the case"
    return None


def _percentile(values: list[int], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * q
    low = math.floor(rank)
    high = math.ceil(rank)
    return round(ordered[low] + (ordered[high] - ordered[low]) * (rank - low), 1)


def score(manifest: dict, run: dict) -> dict:
    """Return a reviewable GO/HOLD scorecard, never guessing missing evidence."""
    reasons: list[str] = []
    if manifest.get("version") != 1:
        raise ValueError("manifest version must be 1")
    build = run.get("build_sha", "")
    if not isinstance(build, str) or not SHA.fullmatch(build):
        raise ValueError("run needs a pinned deployed build SHA")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("manifest needs cases")
    expected: dict[tuple[str, str, int], dict] = {}
    for case in cases:
        cid, surfaces, repeats = case["id"], case["surfaces"], case["repeats"]
        if case.get("fixture") and not (
            isinstance(case.get("fixture_sha256"), str) and HASH.fullmatch(case["fixture_sha256"])
        ):
            reasons.append(f"{cid}: photo fixture hash not pinned")
        if not isinstance(repeats, int) or isinstance(repeats, bool) or repeats < 1:
            raise ValueError(f"invalid repeats for {cid}")
        if not surfaces or len(set(surfaces)) != len(surfaces):
            raise ValueError(f"invalid surfaces for {cid}")
        for surface in surfaces:
            for rep in range(repeats):
                key = (cid, surface, rep)
                if key in expected:
                    raise ValueError(f"duplicate manifest attempt {key}")
                expected[key] = case

    attempts = run.get("attempts")
    if not isinstance(attempts, list):
        raise ValueError("run attempts must be a list")
    seen: set[tuple[str, str, int]] = set()
    rows: list[dict] = []
    first_ms: list[int] = []
    total_ms: list[int] = []
    noncritical_good = 0
    noncritical_total = 0
    hard_blockers: list[str] = []
    for attempt in attempts:
        key = (attempt.get("case_id"), attempt.get("surface"), attempt.get("rep"))
        if key not in expected:
            raise ValueError(f"unexpected attempt {key}")
        if key in seen:
            raise ValueError(f"duplicate run attempt {key}")
        seen.add(key)
        label = f"{key[0]}/{key[1]}/{key[2]}"
        if attempt.get("build_sha") != build:
            reasons.append(f"{label}: mixed or missing deployed SHA")
        blockers = attempt.get("hard_blockers")
        if not isinstance(blockers, list) or not all(isinstance(x, str) for x in blockers):
            reasons.append(f"{label}: hard-blocker review missing")
            blockers = []
        hard_blockers.extend(f"{label}: {' '.join(x.split())}" for x in blockers)
        # #4109 review F3: what the capture observed blocks regardless of review.
        derived = attempt.get("derived_hard_blockers") or []
        if not isinstance(derived, list):
            derived = [str(derived)]
        hard_blockers.extend(f"{label}: {' '.join(str(x).split())}" for x in derived)

        scores = attempt.get("scores") or {}
        notes = attempt.get("score_reasons") or {}
        for dim in DIMENSIONS:
            val = scores.get(dim)
            if type(val) is not int or val not in (0, 1, 2) or not notes.get(dim):
                reasons.append(f"{label}: missing/invalid {dim} score and reason")
        human = attempt.get("human_review") or {}
        if not human.get("reviewer") or not human.get("signed_at"):
            reasons.append(f"{label}: human review not signed")
        if not attempt.get("trace_id") or not attempt.get("turn_id"):
            reasons.append(f"{label}: trace/turn evidence missing")
        if not attempt.get("rendered_answer") or not attempt.get("turn_status"):
            reasons.append(f"{label}: rendered answer/status missing")
        elif attempt.get("turn_status") not in COMPLETED_STATUSES:
            reasons.append(f"{label}: turn did not complete ({attempt.get('turn_status')})")
        case = expected[key]
        receipts = attempt.get("action_receipts") or {}
        for action in case.get("required_receipts", []):
            if not receipts.get(action):
                reasons.append(f"{label}: {action} action receipt missing")
        source = attempt.get("source_review") or {}
        if case.get("requires_source_review"):
            providers = source.get("independent_providers") or []
            answer_hash = source.get("answer_sha256")
            if (
                source.get("passage_bound") is not True
                or not all(isinstance(x, str) and x.strip() for x in providers)
                or len(set(providers)) < 2
                or source.get("agree_pass") is not True
                or not isinstance(answer_hash, str)
                or not HASH.fullmatch(answer_hash)
                or source.get("grade_answer_hashes") != [answer_hash, answer_hash]
            ):
                reasons.append(f"{label}: independent passage-bound source review missing")
            elif _graded_row_mismatch(attempt, case, answer_hash):
                reasons.append(
                    f"{label}: source review is not bound to this attempt "
                    f"({_graded_row_mismatch(attempt, case, answer_hash)})"
                )
        jev = attempt.get("jev")
        if not isinstance(jev, dict) or not (jev.get("signals") or jev.get("skipped_reason")):
            # A disabled shadow is a recorded skip, not a missing observation.
            reasons.append(f"{label}: Jev verdict or explicit skip reason missing")

        latency = attempt.get("latency_ms") or {}
        first, total = latency.get("first_meaningful"), latency.get("total")
        if type(first) is not int or type(total) is not int or first < 0 or total < first:
            reasons.append(f"{label}: latency evidence missing/invalid")
        elif case.get("latency_class") == "answer_only":
            first_ms.append(first)
            total_ms.append(total)
        elif case.get("latency_class") != "discovery":
            raise ValueError(f"invalid latency class in manifest for {label}")

        critical = bool(case["critical"])
        good = all(scores.get(dim) == 2 for dim in DIMENSIONS)
        if critical and not good:
            reasons.append(f"{label}: critical flow incomplete")
        if not critical:
            noncritical_total += 1
            noncritical_good += good
        rows.append(
            {
                "case_id": key[0],
                "surface": key[1],
                "rep": key[2],
                "critical": critical,
                "scores": scores,
                "hard_blockers": blockers,
                "trace_id": attempt.get("trace_id"),
                "jev": attempt.get("jev"),
            }
        )

    for key in expected.keys() - seen:
        reasons.append(f"{key[0]}/{key[1]}/{key[2]}: attempt missing")
    if hard_blockers:
        reasons.append(f"{len(hard_blockers)} hard blocker(s)")
    quality = noncritical_good / noncritical_total if noncritical_total else None
    if quality is None or quality < 0.90:
        reasons.append("noncritical full-quality rate below 90% or unmeasured")
    median_first = _percentile(first_ms, 0.5)
    p95_total = _percentile(total_ms, 0.95)
    if median_first is None or median_first > 5000:
        reasons.append("answer-only median first meaningful response above 5 s or unmeasured")
    if p95_total is None or p95_total > 12000:
        reasons.append("answer-only p95 completion above 12 s or unmeasured")
    return {
        "decision": "HOLD" if reasons else "GO",
        "build_sha": build,
        "expected_attempts": len(expected),
        "observed_attempts": len(seen),
        "hard_blockers": hard_blockers,
        "reasons": sorted(reasons),
        "noncritical_full_quality_rate": quality,
        "answer_only_median_first_ms": median_first,
        "answer_only_p95_total_ms": p95_total,
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("run", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        report = score(
            json.loads(args.manifest.read_text(encoding="utf-8")),
            json.loads(args.run.read_text(encoding="utf-8")),
        )
    except (OSError, json.JSONDecodeError, ValueError, KeyError, TypeError) as exc:
        sys.stderr.write(f"human-readiness input error: {exc}\n")
        raise SystemExit(2) from None
    output = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    raise SystemExit(0 if report["decision"] == "GO" else 1)


if __name__ == "__main__":
    main()
