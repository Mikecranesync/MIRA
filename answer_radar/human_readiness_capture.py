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

from answer_radar.hub_runner import _citation_label, _cited_passage, _frames, deployed_sha
from answer_radar.runner import classify_answer
from answer_radar.schema import AnswerStatus
from answer_radar.score import answer_identity

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
    if not content and status_frame.get("message"):
        content = str(status_frame["message"])
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

    aid = attempt_id(case["id"], "hub", rep)
    derived: list[str] = []
    if st != 200 or status == "error" or not content.strip():
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
            "basis": (next((f for f in frames if f.get("kind") == "evidence"), {}) or {}).get(
                "basis"
            ),
            "retrieval": {
                k: (packet.get("retrieval") or {}).get(k)
                for k in ("strategy", "executed", "candidate_count")
            },
        },
    }
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


def attach_source_reviews(
    run: dict[str, Any], rows: list[dict[str, Any]], grades_dir: Path
) -> None:
    """Derive each attempt's source_review from real grade files (never asserted)."""
    by_id = {r["question"]["question_id"]: r for r in rows}
    for a in run["attempts"]:
        row = by_id.get(attempt_id(a["case_id"], a["surface"], a["rep"]))
        if row is None:
            continue
        expected = answer_identity(row)
        grades = []
        for slot in ("A", "B"):
            f = grades_dir / f"grade-{slot}-{row['question']['question_id']}.json"
            try:
                grades.append(json.loads(f.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                grades.append({})
        citations = row["evaluation"]["citations"]
        passages = row["evaluation"]["cited_passages"]
        a["source_review"] = {
            "answer_sha256": expected,
            "grade_answer_hashes": [g.get("answer_sha256") for g in grades],
            "independent_providers": [g.get("grader_provider") for g in grades],
            "agree_pass": all(str(g.get("verdict", "")).upper() == "PASS" for g in grades),
            # Passage-bound: every citation's passage was shown and hashed; an
            # uncited turn has no passage to bind, which is only true of a decline.
            "passage_bound": len(passages) == len(citations)
            and all(isinstance(p.get("quote"), str) and p["quote"].strip() for p in passages)
            and (
                bool(citations)
                or row["evaluation"]["answer_status"] in ("abstained", "refused_safety")
            ),
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
