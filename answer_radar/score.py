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
import dataclasses
import hashlib
import json
from pathlib import Path

from answer_radar.report import build_report
from answer_radar.rubric import check_grade, evaluate
from answer_radar.schema import (
    AnswerStatus,
    EvaluationRecord,
    EvidenceTier,
    GraderVerdict,
    IndependenceClass,
    SafetyClass,
)


def _claims_checkable(item: dict) -> bool:
    """Could the graders check this answer's claims against what they were shown?"""
    e = item["evaluation"]
    citations = list(e.get("citations") or [])
    passages = list(e.get("cited_passages") or [])
    if citations:
        return len(passages) == len(citations) and all(
            isinstance(p, dict) and isinstance(p.get("quote"), str) and p["quote"].strip()
            for p in passages
        )
    # An uncited answer is checkable only as a decline the SERVER certified:
    # hub.turn_status "insufficient_evidence" is emitted with the route's own
    # fixed decline copy, and it is part of answer_identity. The runner's text
    # classifier (answer_status) is NOT enough — "Set P041 to 12 s … send me the
    # fault log" reads as an abstention to it (#4106 review F1).
    # ...and only when its text IS that fixed copy: it arrived as the status
    # frame's message, not as model prose the server labelled a refusal
    # (#4106 review round 3).
    hub = item.get("hub") or {}
    return (
        hub.get("turn_status") == "insufficient_evidence"
        and hub.get("answer_origin") == "server_status_message"
    )


def answer_identity(item: dict, reference_notes: object = None) -> str:
    """The identity a grade is bound to, computed from one batch row.

    Covers everything a grader is shown about the case: the question, the asset
    (manufacturer + model), the condition, the retrieval context, the exact
    answer, and the evidence shown with it. Change any of them and an old grade
    no longer applies (#4092 Codex post-cap F1, r2 F1, r3 F1). The grader
    packet builder stamps this on every entry, so every grader — Claude or
    gpt-5.5 — records the same value (r3 F2). The server turn status, answer
    basis and reference notes are shown to the grader too, so they are bound
    as well (post-cap r4 F1); `reference_notes` is whatever the packet shows
    for this seed (None when no references were supplied).
    """
    q, e, hub = item["question"], item["evaluation"], item.get("hub") or {}
    fields = {
        "question": q.get("normalized_question") or "",
        "manufacturer": q.get("manufacturer") or "",
        "model": q.get("model") or "",
        "condition": hub.get("condition") or "",
        "retrieval": hub.get("retrieval") or {},
        "answer_text": e.get("answer_text") or "",
        "citations": list(e.get("citations") or []),
        "source_documents": list(e.get("source_documents") or []),
        "cited_passages": list(e.get("cited_passages") or []),
        # #4106 review F2: the scorer consults the status, so a grade binds to it.
        "answer_status": e.get("answer_status"),
        "answer_origin": hub.get("answer_origin"),
        "server_turn_status": hub.get("turn_status"),
        "answer_basis": hub.get("basis"),
        "reference_notes": reference_notes,
    }
    payload = json.dumps(fields, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _bound_to(raw: dict, condition: str | None, answer_hash: str | None) -> bool:
    """A grade that names a different condition or answer is not this answer's grade.

    #4092 Codex round 3 F1: grades from another condition, or for an earlier
    answer to the same seed, must never be scored against this row.
    """
    if condition is not None and raw.get("condition") not in (None, condition):
        return False
    if answer_hash is not None and raw.get("answer_sha256") not in (None, answer_hash):
        return False
    return True


def _verdict_from(
    path: Path,
    grader_id: str,
    condition: str | None = None,
    answer_hash: str | None = None,
) -> GraderVerdict | None:
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
    if not _bound_to(raw, condition, answer_hash):
        return None
    # The same score/flag/verdict rules every OpenAI grade passes, applied to
    # every grade whoever wrote it (#4092 post-cap r6 F1).
    try:
        check_grade(raw)
    except ValueError:
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


def _independence(grades_dir: Path, sid: str, answer_hash: str | None = None) -> IndependenceClass:
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
        # A promoting class needs BOTH grades bound to this exact answer; a grade
        # without an answer hash could have judged a different answer (#4092 r3 F1).
        if answer_hash is not None and raw.get("answer_sha256") != answer_hash:
            return IndependenceClass.SAME_MODEL_DIFFERENT_RUN
    (pa, ma), (pb, mb) = ids
    if not ma or not mb or ma == mb:
        return IndependenceClass.SAME_MODEL_DIFFERENT_RUN
    if pa and pb and pa != pb:
        return IndependenceClass.INDEPENDENT_PROVIDER_MODEL
    return IndependenceClass.DIFFERENT_MODEL_SAME_PROVIDER


def score(
    batch_path: Path, grades_dir: Path, references: dict | None = None
) -> tuple[str, list[dict]]:
    """Join grades to the batch, apply the rubric, render the report.

    `references` must be the same {seed_id: notes} the grader packet was built
    with; a grade shown different notes does not bind to this row.
    """
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
    skipped: list[str] = []

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
            citations=list(e.get("citations") or []),
            best_evidence_tier=EvidenceTier(e["best_evidence_tier"]),
            total_answer_time_ms=e["total_answer_time_ms"],
        )
        condition = (item.get("hub") or {}).get("condition")
        answer_hash = answer_identity(item, (references or {}).get(sid))
        for gid, prefix in (("A", "grade-A-"), ("B", "grade-B-")):
            v = _verdict_from(grades_dir / f"{prefix}{sid}.json", gid, condition, answer_hash)
            if v:
                rec.grader_verdicts.append(v)

        independence = _independence(grades_dir, sid, answer_hash)
        for v in rec.grader_verdicts:
            v.independence_class = independence
        if rec.grader_verdicts:
            rec.failure_class = rec.grader_verdicts[0].failure_class

        result = evaluate(rec, safety_class=SafetyClass(q["safety_class"]))
        if result.verified_correct and not _claims_checkable(item):
            # #4097: graders may only verify what they could check. A cited answer
            # needs the passage behind EVERY citation (shown to the graders and
            # bound in answer_identity); an answer with no structured citations
            # can verify only as an honest decline (no source claims to check).
            # Anything else — an uncited answer, inline "p.72" citations with an
            # empty list, a citation whose passage is missing — stays unverified.
            result = dataclasses.replace(
                result,
                verified_correct=False,
                reasons=result.reasons
                + [
                    "graders were not shown source passages — claims cannot be verified yet (#4097)"
                ],
            )
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
        # Pass 5 F1: a knowledge gap needs a search that RAN and came back empty.
        # A skipped search (new chat: skipped_general_mode) is its own finding.
        executed = ((item.get("hub") or {}).get("retrieval") or {}).get("executed")
        if executed is False:
            skipped.append(f"{q['manufacturer']} {q['model']}")
            rows[-1]["retrieval"] = "skipped"
        elif rec.retrieved_chunk_count == 0:  # None (unknown) is not a gap
            gaps.append(f"{q['manufacturer']} {q['model']} — 0 retrieved chunks")

    report = build_report(
        graded,
        discovered=len(batch),
        unique_after_dedupe=len(batch),
        qualified=len(batch),
        knowledge_gaps=sorted(set(gaps)),
    )
    rendered = report.render()
    if skipped:
        rendered += "\n\nSEARCH SKIPPED (no manual search ran — not a knowledge gap)\n" + "\n".join(
            f"  - {m}" for m in sorted(set(skipped))
        )
    return rendered, rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--batch", required=True, help="batch-*.json produced by answer_radar.batch")
    ap.add_argument("--grades", required=True, help="directory holding grade-A-*/grade-B-* JSON")
    ap.add_argument(
        "--references",
        default=None,
        help="the same references JSON the grader packet was built with (if any)",
    )
    ap.add_argument("--out", default=None, help="write the scorecard here as well as stdout")
    args = ap.parse_args(argv)

    refs = (
        json.loads(Path(args.references).read_text(encoding="utf-8")) if args.references else None
    )
    rendered, rows = score(Path(args.batch), Path(args.grades), refs)
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
