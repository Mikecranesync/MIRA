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
from answer_radar.kb_health import require_kb
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

    # Prove the corpus is reachable BEFORE asking anything. Without this the harness
    # cannot tell "MIRA knew nothing" from "the benchmark could not reach the knowledge
    # base" — both produce uncited answers and honesty directives. Publishing the second
    # as the first is what invalidated the 2026-09-05 VCAD 0/6 scorecard. Raises
    # KBUnreachableError rather than producing a number nobody can attribute.
    health = require_kb()
    print(f"[kb    ] reachable — {health.detail}", file=sys.stderr)

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
                # Recorded per question so a scorecard can never be read without knowing
                # whether the corpus was reachable when it was produced.
                "kb_health": {
                    "reachable": health.reachable,
                    "probe_rows": health.rows,
                    "tenant_id": health.tenant_id,
                    "detail": health.detail,
                },
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
