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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out",
        default="answer_radar/runs",
        help="directory for frozen snapshots and the batch artefact",
    )
    ap.add_argument("--seeds", action="store_true", help="run the six PRS §27 seed questions")
    args = ap.parse_args(argv)

    if not args.seeds:
        ap.error("no question source selected (use --seeds; collectors are Phase 1)")

    questions = seed_questions()
    asyncio.run(run_batch(questions, Path(args.out)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
