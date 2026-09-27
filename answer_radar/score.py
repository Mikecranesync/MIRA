"""Turn a batch artefact plus grader verdicts into the daily VCAD scorecard (PRS §6.3).

Graders run outside this process — as independent sessions that never share MIRA's context
(PRS §13) — and each writes one JSON verdict. This module joins those verdicts to the batch,
applies the rubric, and renders the report.

Kept separate from `batch.py` on purpose: the run and the judgement of the run are different
acts, and a module that could both produce and grade an answer is one refactor away from
grading itself.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from answer_radar.report import build_report
from answer_radar.rubric import evaluate
from answer_radar.schema import (
    AnswerStatus,
    EvaluationRecord,
    EvidenceTier,
    GraderVerdict,
    IndependenceClass,
    SafetyClass,
)


def _verdict_from(path: Path, grader_id: str) -> GraderVerdict | None:
    """Load one grader's JSON. Returns None for a malformed file rather than guessing.

    A grader that returned the wrong shape is *missing*, not passing. Coercing a partial
    verdict into a score would let a broken grader silently certify an answer.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    required = ("correctness", "evidence", "safety", "actionability", "uncertainty", "verdict")
    if not all(k in raw for k in required):
        return None
    return GraderVerdict(
        grader_id=grader_id,
        # Provisional: score() sets the class it can PROVE from the recorded models
        # (#4062 F2). Two sessions of one model are self-consistency, not independence.
        independence_class=IndependenceClass.SAME_MODEL_DIFFERENT_RUN,
        correctness=int(raw["correctness"]),
        evidence=int(raw["evidence"]),
        safety=int(raw["safety"]),
        actionability=int(raw["actionability"]),
        uncertainty=int(raw["uncertainty"]),
        verdict=str(raw["verdict"]).upper(),
        critical_unsupported_claim=bool(raw.get("critical_unsupported_claim", False)),
        unsafe_specificity=bool(raw.get("unsafe_specificity", False)),
        failure_class=raw.get("failure_class"),
        notes=str(raw.get("notes", ""))[:2000],
    )


def _independence(grades_dir: Path, sid: str) -> IndependenceClass:
    """The strongest class the recorded grader identities actually prove.

    Missing or identical `grader_model` values prove only a different run of the
    same model (non-promoting). Distinct models from one provider prove
    DIFFERENT_MODEL_SAME_PROVIDER; distinct providers prove INDEPENDENT_PROVIDER_MODEL.
    """
    ids = []
    for prefix in ("grade-A-", "grade-B-"):
        try:
            raw = json.loads((grades_dir / f"{prefix}{sid}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return IndependenceClass.SAME_MODEL_DIFFERENT_RUN
        ids.append((raw.get("grader_provider"), raw.get("grader_model")))
    (pa, ma), (pb, mb) = ids
    if not ma or not mb or ma == mb:
        return IndependenceClass.SAME_MODEL_DIFFERENT_RUN
    if pa and pb and pa != pb:
        return IndependenceClass.INDEPENDENT_PROVIDER_MODEL
    return IndependenceClass.DIFFERENT_MODEL_SAME_PROVIDER


def score(batch_path: Path, grades_dir: Path) -> tuple[str, list[dict]]:
    """Join grades to the batch, apply the rubric, render the report."""
    batch = json.loads(batch_path.read_text(encoding="utf-8"))
    # Codex #4063 F2: a scorecard measures ONE deployment. A rerun from another
    # build is scored in its own batch, never spliced into this one.
    versions = sorted({str(item["evaluation"]["mira_version"]) for item in batch})
    if len(versions) > 1:
        raise SystemExit(
            f"{batch_path.name} mixes deployments {versions}; score each build's rows separately"
        )
    graded: list[tuple[EvaluationRecord, object]] = []
    rows: list[dict] = []
    gaps: list[str] = []

    for item in batch:
        q, e = item["question"], item["evaluation"]
        sid = q["question_id"]

        rec = EvaluationRecord(
            question_id=sid,
            mira_run_id=e["mira_run_id"],
            mira_version=e["mira_version"],
            prompt_version=e["prompt_version"],
            retrieval_version=e["retrieval_version"],
            answer_text=e["answer_text"],
            answer_status=AnswerStatus(e["answer_status"]),
            retrieved_chunk_count=e["retrieved_chunk_count"],
            best_evidence_tier=EvidenceTier(e["best_evidence_tier"]),
            total_answer_time_ms=e["total_answer_time_ms"],
        )
        for gid, prefix in (("A", "grade-A-"), ("B", "grade-B-")):
            v = _verdict_from(grades_dir / f"{prefix}{sid}.json", gid)
            if v:
                rec.grader_verdicts.append(v)

        independence = _independence(grades_dir, sid)
        for v in rec.grader_verdicts:
            v.independence_class = independence
        if rec.grader_verdicts:
            rec.failure_class = rec.grader_verdicts[0].failure_class

        result = evaluate(rec, safety_class=SafetyClass(q["safety_class"]))
        graded.append((rec, result))
        rows.append(
            {
                "seed_id": sid,
                "status": rec.answer_status.value,
                "chunks": rec.retrieved_chunk_count,
                "graders": len(rec.grader_verdicts),
                "independence": independence.value,
                "scores": [v.total for v in rec.grader_verdicts],
                "outcome": result.outcome,
                "verified_correct": result.verified_correct,
                "failure_class": rec.failure_class,
                "reasons": result.reasons,
            }
        )
        if rec.retrieved_chunk_count == 0:  # None (unknown) is not a gap
            gaps.append(f"{q['manufacturer']} {q['model']} — 0 retrieved chunks")

    report = build_report(
        graded,
        discovered=len(batch),
        unique_after_dedupe=len(batch),
        qualified=len(batch),
        knowledge_gaps=sorted(set(gaps)),
    )
    return report.render(), rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--batch", required=True, help="batch-*.json produced by answer_radar.batch")
    ap.add_argument("--grades", required=True, help="directory holding grade-A-*/grade-B-* JSON")
    ap.add_argument("--out", default=None, help="write the scorecard here as well as stdout")
    args = ap.parse_args(argv)

    rendered, rows = score(Path(args.batch), Path(args.grades))
    print(rendered)
    print("\nPER-QUESTION\n")
    for r in rows:
        mark = "OK " if r["verified_correct"] else "-- "
        print(
            f"{mark}{r['seed_id']}  {r['outcome']:18s} scores={r['scores']} {r['failure_class'] or ''}"
        )
        for reason in r["reasons"]:
            print(f"      · {reason}")

    if args.out:
        Path(args.out).write_text(
            rendered + "\n\nPER-QUESTION\n" + json.dumps(rows, indent=2) + "\n", encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
