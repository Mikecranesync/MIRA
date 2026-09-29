"""Capture #4101 human-readiness attempts from the deployed staging Hub.

Fills the MACHINE-observable half of each attempt record `human_readiness.score`
reads — build SHA, trace/turn ids, rendered answer, status, first-meaningful and
total latency, cited passages, Jev's post-answer verdict — through the one staging
Hub client (`hub_runner`) and the Turn Evidence Packet (diagnostics endpoint). It
never fills the human half: scores, score reasons, the signed review, UI action
receipts and hard-blocker review stay empty, so an unreviewed run HOLDs.

`source_review` is derived, never asserted: `attach_source_reviews` recomputes
`score.answer_identity` for the captured row and requires both independent grades
to carry that exact hash (#4097 binds the cited passages into it).

Only `surfaces == ["hub"]` single-turn cases are captured here. Web/Pixel cases
need action receipts from a real browser or device; they stay missing (HOLD).
"""

from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path
from typing import Any

from answer_radar.hub_runner import (
    TERMINAL_STATUSES,
    _citation_label,
    _cited_passage,
    _frames,
    deployed_sha,
)
from answer_radar.rubric import check_grade
from answer_radar.runner import classify_answer
from answer_radar.schema import AnswerStatus, IndependenceClass
from answer_radar.score import _claims_checkable, _independence, answer_identity

JEV_SIGNALS = (
    "over_specificity",
    "wrong_family_grounding",
    "contradicts_observations",
    "unsupported_numerics",
)
#: Cases the Hub API alone can run: one typed turn, no photo, no identity proposal.
HUB_TURN_CASES = frozenset(
    {
        "general-vfd",
        "ambiguous-machine",
        "rtd-definition",
        "unknown-torque",
        "isolation",
        "letter-consistency",
    }
)


def attempt_id(case_id: str, surface: str, rep: int) -> str:
    return f"{case_id}__{surface}__r{rep}"


def _jev(packet: dict[str, Any]) -> dict[str, Any]:
    d = packet.get("jev_decision")
    if not isinstance(d, dict):
        return {"skipped_reason": "jev_decision_absent_from_packet"}
    if d.get("skipped_reason"):
        return {"skipped_reason": str(d["skipped_reason"])}
    signals = d.get("signals") or {}
    return {
        "signals": {k: signals.get(k) for k in JEV_SIGNALS},
        "failure_class": d.get("failure_class"),
        "latency_ms": d.get("latency_ms"),
        "input_tokens": d.get("input_tokens"),
        "model": d.get("model"),
        "question_set_version": d.get("question_set_version"),
    }


def ask_hub_case(
    hub, case: dict[str, Any], rep: int, build: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """One blank-chat attempt. Returns (attempt record, batch row for the graders)."""
    # Named "General" — the notebook the home screen's blank chat uses — so the
    # run measures the product's own condition (#4099: names can move answers).
    nb = hub.create_notebook("General")
    body = {
        "message": case["question"],
        "sourceDocIds": [],
        "mode": "general",
        "clientRequestId": str(uuid.uuid4()),
    }
    st, hd, raw, first_ms, total_ms = hub.stream(
        "POST",
        f"/api/equipment-notebooks/{nb['id']}/chat/",
        json.dumps(body).encode(),
        {"Content-Type": "application/json"},
    )
    frames = _frames(raw)
    content = "".join(f.get("content", "") for f in frames if f.get("kind") == "content")
    status_frame = next((f for f in frames if f.get("kind") == "status"), {})
    # Where the text came from, as hub_runner records it: the route's fixed
    # decline copy arrives only as the status frame's message (#4109 review F2).
    answer_origin = "content_frames" if content else None
    if not content and status_frame.get("message"):
        content = str(status_frame["message"])
        answer_origin = "server_status_message"
    sources = next((f for f in frames if f.get("kind") == "sources"), {})
    raw_citations = sources.get("citations") or []
    trace_id = hd.get("x-mira-trace-id")
    diag: dict[str, Any] = {}
    try:
        diag = hub.diagnostics(nb["id"], trace_id)
    except RuntimeError as exc:  # evidence about the run, never a gate on it
        diag = {"error": str(exc)[:200]}
    packet = diag.get("packet") or {}
    gate = packet.get("answer_gate") or {}
    status = status_frame.get("status")
    answer_status = classify_answer(content, st)
    if status == "insufficient_evidence" and answer_status is AnswerStatus.ANSWERED:
        answer_status = AnswerStatus.ABSTAINED
    # #4109 review F3, same rule as hub_runner: a 200 stream must end in exactly
    # one recognised terminal status; an error status or a cut-off stream is an
    # engine error, never a graded answer.
    terminal = [f.get("status") for f in frames if f.get("kind") == "status"]
    if status == "error" or (
        st == 200 and (len(terminal) != 1 or terminal[0] not in TERMINAL_STATUSES)
    ):
        answer_status = AnswerStatus.ERROR

    aid = attempt_id(case["id"], "hub", rep)
    derived: list[str] = []
    if st != 200 or answer_status is AnswerStatus.ERROR or not content.strip():
        derived.append("app could not complete the turn (no rendered answer or an error status)")
    attempt = {
        "case_id": case["id"],
        "surface": "hub",
        "rep": rep,
        "build_sha": build,
        "trace_id": trace_id,
        "turn_id": diag.get("turnId"),
        "rendered_answer": content,
        "turn_status": status,
        "latency_ms": {"first_meaningful": first_ms, "total": total_ms},
        "cited_passages": [_cited_passage(c) for c in raw_citations],
        "jev": _jev(packet),
        "packet_summary": {
            "retrieval_strategy": (packet.get("retrieval") or {}).get("strategy"),
            "gate_decision": gate.get("decision"),
            "gate_reason": gate.get("reason"),
            "gate_match": gate.get("gate_match"),
            "identity_state": (packet.get("identity") or {}).get("state"),
        },
        # Machine-derived blockers only; a reviewer must still sign the full list.
        "derived_hard_blockers": derived,
        # Human half — deliberately empty so an unreviewed run HOLDs.
        "hard_blockers": None,
        "scores": {},
        "score_reasons": {},
        "human_review": {},
        "action_receipts": {},
        "source_review": {},
    }
    row = {
        "question": {
            "question_id": aid,
            "normalized_question": case["question"],
            "manufacturer": "",
            "model": "",
            "safety_class": "none",
        },
        "evaluation": {
            "mira_run_id": f"hr-{aid}",
            "mira_version": build,
            "prompt_version": "hub-chat:new_chat",
            "retrieval_version": str((packet.get("retrieval") or {}).get("strategy") or "unknown"),
            "answer_text": content,
            "answer_status": answer_status.value,
            "retrieved_chunk_count": (packet.get("retrieval") or {}).get("candidate_count"),
            "citations": [_citation_label(c) for c in raw_citations],
            "cited_passages": attempt["cited_passages"],
            "source_documents": [],
            "best_evidence_tier": "trusted_independent" if raw_citations else "none",
            "total_answer_time_ms": total_ms,
        },
        "hub": {
            "condition": "new_chat",
            "turn_status": status,
            "answer_origin": answer_origin,
            "basis": (next((f for f in frames if f.get("kind") == "evidence"), {}) or {}).get(
                "basis"
            ),
            "retrieval": {
                k: (packet.get("retrieval") or {}).get(k)
                for k in ("strategy", "executed", "candidate_count")
            },
        },
    }
    # #4109 review F1: the attempt carries the exact row its graders see, so the
    # scorer can recompute the graded identity from the attempt it scores.
    attempt["grading_row"] = row
    return attempt, row


def capture(hub, manifest: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Every hub-surface single-turn attempt on one pinned build; aborts on a mid-run deploy."""
    build = deployed_sha(hub)
    attempts, rows = [], []
    for case in manifest["cases"]:
        if case["surfaces"] != ["hub"] or case["id"] not in HUB_TURN_CASES:
            continue
        for rep in range(case["repeats"]):
            a, r = ask_hub_case(hub, case, rep, build)
            attempts.append(a)
            rows.append(r)
    if deployed_sha(hub) != build:
        raise SystemExit("staging deployed a new build during the capture; rerun on one SHA")
    return {"build_sha": build, "attempts": attempts}, rows


def _bound_row(a: dict[str, Any], row: dict[str, Any]) -> str | None:
    """Why `row` is not the grading row of attempt `a`, or None when it is."""
    if answer_identity(row) != answer_identity(a.get("grading_row") or {}):
        return "batch row is not this attempt's grading row"
    ev = row["evaluation"]
    if ev.get("answer_text") != a.get("rendered_answer"):
        return "graded answer differs from the rendered answer"
    if (ev.get("cited_passages") or []) != (a.get("cited_passages") or []):
        return "graded passages differ from the attempt's passages"
    return None


def attach_source_reviews(
    run: dict[str, Any],
    rows: list[dict[str, Any]],
    grades_dir: Path,
    references: dict[str, Any] | None = None,
) -> None:
    """Derive each attempt's source_review from real grade files (never asserted).

    #4109 review: the batch row must be the attempt's own grading row (F1); each
    grade must pass the canonical rubric check (F4); independence is the class
    score.py derives from recorded provider AND model identities (F4); and an
    uncited answer is passage-bound only as a server-certified decline (F2).

    `references` must be the same {seed_id: notes} the grader packet was built
    with: the packet binds the notes into `answer_sha256`, so the notes the
    graders were shown are part of the identity every grade must match.
    """
    by_id = {r["question"]["question_id"]: r for r in rows}
    for a in run["attempts"]:
        sid = attempt_id(a["case_id"], a["surface"], a["rep"])
        row = by_id.get(sid)
        if row is None:
            continue
        unbound = _bound_row(a, row)
        if unbound:
            a["source_review"] = {"error": unbound}
            continue
        notes = (references or {}).get(sid)
        expected = answer_identity(row, notes)
        grades, valid = [], True
        for slot in ("A", "B"):
            f = grades_dir / f"grade-{slot}-{sid}.json"
            try:
                g = json.loads(f.read_text(encoding="utf-8"))
                check_grade(g)
            except (OSError, json.JSONDecodeError, ValueError):
                g, valid = {}, False
            grades.append(g)
        independent = (
            valid
            and _independence(grades_dir, sid, expected)
            is IndependenceClass.INDEPENDENT_PROVIDER_MODEL
        )
        a["source_review"] = {
            "answer_sha256": expected,
            "reference_notes": notes,
            "grade_answer_hashes": [g.get("answer_sha256") for g in grades],
            # Only a proven independent-provider pair names providers at all.
            "independent_providers": [g.get("grader_provider") for g in grades]
            if independent
            else [],
            "agree_pass": valid
            and all(str(g.get("verdict", "")).upper() == "PASS" for g in grades),
            "passage_bound": _claims_checkable(row),
        }


def main(argv: list[str] | None = None) -> int:
    from answer_radar.hub_runner import assert_staging, load_hub_client

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True, help="directory for run.json + batch.json")
    ap.add_argument("--base", required=True)
    ap.add_argument("--cookie", required=True)
    args = ap.parse_args(argv)
    assert_staging(args.base)
    hub = load_hub_client()(args.base, args.cookie)
    run, rows = capture(hub, json.loads(args.manifest.read_text(encoding="utf-8")))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "run.json").write_text(
        json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.out / "batch.json").write_text(
        json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{len(run['attempts'])} attempts on {run['build_sha']} -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
