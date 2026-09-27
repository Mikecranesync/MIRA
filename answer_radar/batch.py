"""The daily benchmark batch (PRS §20).

Freeze → run MIRA blind → grade → report. Grading itself is not here: independent graders
are dispatched outside this process (PRS §13, §23) precisely so they cannot share MIRA's
context. This module runs the deterministic half and writes an artefact the graders consume.

Why the MIRA run is NOT parallelised
------------------------------------
It would be easy to fan questions out across workers. It is also wrong: the engine keeps
per-chat FSM state in one SQLite file, and the version triple recorded on every evaluation
(`mira_version`/`prompt_version`/`retrieval_version`) only means something if the run is
reproducible. Graders parallelise; the system under test does not.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from answer_radar.freeze import freeze_question
from answer_radar.runner import run_question
from answer_radar.schema import QuestionRecord
from answer_radar.seeds import seed_questions


async def run_batch(
    questions: list[QuestionRecord],
    out_dir: Path,
    *,
    pipeline=None,
) -> list[dict]:
    """Freeze every question, then answer each one blind, in order."""
    out_dir.mkdir(parents=True, exist_ok=True)
    frozen_dir = out_dir / "frozen"

    results: list[dict] = []
    for q in questions:
        frozen_path = freeze_question(q, frozen_dir)
        print(f"[freeze] {q.question_id}  {frozen_path.name}", file=sys.stderr)

        print(f"[mira  ] {q.question_id}  asking…", file=sys.stderr, flush=True)
        record = await run_question(q, pipeline=pipeline)
        print(
            f"[mira  ] {q.question_id}  {record.answer_status.value} "
            f"({record.total_answer_time_ms} ms, {record.retrieved_chunk_count} chunks)",
            file=sys.stderr,
            flush=True,
        )

        results.append(
            {
                "question": q.to_dict(),
                "frozen_snapshot": str(frozen_path),
                "evaluation": record.to_dict(),
            }
        )

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    path = out_dir / f"batch-{stamp}.json"
    path.write_text(json.dumps(results, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"\n[batch ] wrote {path}", file=sys.stderr)
    return results


def run_hub_batch(questions: list[QuestionRecord], out_dir: Path, hub, condition: str) -> Path:
    """Ask the deployed Hub every question under one condition, in order (hub_runner)."""
    from answer_radar.hub_runner import deployed_sha, run_question_hub

    out_dir.mkdir(parents=True, exist_ok=True)
    frozen_dir = out_dir / "frozen"
    sha = deployed_sha(hub)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    results: list[dict] = []
    for q in questions:
        frozen_path = freeze_question(q, frozen_dir)
        print(f"[hub   ] {q.question_id}  {condition}  asking…", file=sys.stderr, flush=True)
        record, summary = run_question_hub(
            q, hub, condition=condition, mira_version=sha, stamp=stamp
        )
        print(
            f"[hub   ] {q.question_id}  {record.answer_status.value} "
            f"({record.total_answer_time_ms} ms, {record.retrieved_chunk_count} candidates, "
            f"{len(record.citations)} citations, {summary['retrieval'].get('strategy')})",
            file=sys.stderr,
            flush=True,
        )
        results.append(
            {
                "question": q.to_dict(),
                "frozen_snapshot": str(frozen_path),
                "evaluation": record.to_dict(),
                "hub": summary,
            }
        )
    # Codex #4063 F7: never overwrite an earlier run's evidence — seconds plus a
    # run id, created exclusively.
    run_stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    path = out_dir / f"batch-hub-{condition}-{run_stamp}-{uuid.uuid4().hex[:6]}.json"
    with path.open("x", encoding="utf-8") as fh:
        fh.write(json.dumps(results, indent=2, default=str) + "\n")
    print(f"\n[batch ] wrote {path}  (deployed {sha})", file=sys.stderr)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out",
        default="answer_radar/runs",
        help="directory for frozen snapshots and the batch artefact",
    )
    ap.add_argument("--seeds", action="store_true", help="run the six PRS §27 seed questions")
    ap.add_argument(
        "--target",
        choices=("engine", "hub"),
        default="engine",
        help="engine = in-process Python engine; hub = the deployed staging Hub chat route "
        "(the path the Hub web app and the phone app use). hub reads ANSWER_RADAR_BASE and "
        "ANSWER_RADAR_COOKIE and refuses any non-staging base.",
    )
    ap.add_argument(
        "--condition",
        choices=("new_chat", "machine_selected", "both"),
        default="both",
        help="hub only: a blank chat, a chat bound to the named machine, or both",
    )
    args = ap.parse_args(argv)

    if not args.seeds:
        ap.error("no question source selected (use --seeds; collectors are Phase 1)")

    questions = seed_questions()
    if args.target == "engine":
        asyncio.run(run_batch(questions, Path(args.out)))
        return 0

    import os

    from answer_radar.hub_runner import CONDITIONS, assert_staging, load_hub_client

    base = os.environ.get("ANSWER_RADAR_BASE", "https://app-staging.factorylm.com")
    cookie = os.environ.get("ANSWER_RADAR_COOKIE", "")
    assert_staging(base)
    if not cookie:
        ap.error("ANSWER_RADAR_COOKIE is required for --target hub")
    hub = load_hub_client()(base, cookie)
    conditions = CONDITIONS if args.condition == "both" else (args.condition,)
    for condition in conditions:
        run_hub_batch(questions, Path(args.out), hub, condition)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
