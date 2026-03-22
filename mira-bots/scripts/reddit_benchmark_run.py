#!/usr/bin/env python3
"""Reddit Benchmark Runner — Feed harvested questions through Supervisor.

Usage:
    doppler run --project factorylm --config prd -- python mira-bots/scripts/reddit_benchmark_run.py

Env vars:
    MIRA_DB_PATH           — SQLite path
    BENCHMARK_LIMIT        — max questions to process (default: all)
    OPENWEBUI_BASE_URL     — Open WebUI endpoint
    OPENWEBUI_API_KEY      — API key for Open WebUI
    KNOWLEDGE_COLLECTION_ID — KB collection UUID
"""

import asyncio
import logging
import os
import re
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("reddit-benchmark-run")

# Add mira-bots to path for shared imports
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.engine import Supervisor  # noqa: E402

# Confidence inference — self-contained so we don't depend on engine version
_HIGH_CONF = re.compile(
    r"(replace|fault code|check wiring|the .+ is .+(failed|tripped|open|shorted|overloaded)"
    r"|part number|order number|disconnect|de-energize|lockout)",
    re.IGNORECASE,
)
_LOW_CONF = re.compile(
    r"(might be|could be|possibly|not sure|uncertain|hard to say"
    r"|without more info|i'?d need|difficult to determine)",
    re.IGNORECASE,
)


def _infer_confidence(reply: str) -> str:
    if not reply or len(reply) < 20:
        return "none"
    has_high = bool(_HIGH_CONF.search(reply))
    has_low = bool(_LOW_CONF.search(reply))
    if has_high and not has_low:
        return "high"
    if has_low and not has_high:
        return "low"
    if has_high and has_low:
        return "medium"
    return "medium" if len(reply) > 60 else "none"


from shared.benchmark_db import (  # noqa: E402
    ensure_tables,
    list_questions,
    create_run,
    finish_run,
    insert_result,
    count_questions,
)


def _build_supervisor() -> Supervisor:
    """Construct a Supervisor using env vars."""
    db_path = os.getenv("MIRA_DB_PATH", "./data/mira.db")
    openwebui_url = os.getenv("OPENWEBUI_BASE_URL", "http://mira-core:8080")
    api_key = os.getenv("OPENWEBUI_API_KEY", "")
    collection_id = os.getenv("KNOWLEDGE_COLLECTION_ID", "")
    vision_model = os.getenv("VISION_MODEL", "qwen2.5vl:7b")

    return Supervisor(
        db_path=db_path,
        openwebui_url=openwebui_url,
        api_key=api_key,
        collection_id=collection_id,
        vision_model=vision_model,
    )


async def run_benchmark(db_path: str | None = None) -> dict:
    """Run all harvested questions through the Supervisor.

    Returns {"run_id": int, "processed": int, "errors": int}.
    """
    db_path = db_path or os.getenv("MIRA_DB_PATH", "./data/mira.db")
    ensure_tables(db_path)

    limit_str = os.getenv("BENCHMARK_LIMIT", "0")
    limit = int(limit_str) if limit_str else 0

    total = count_questions(db_path)
    if total == 0:
        logger.warning("No questions in DB — run reddit_harvest.py first")
        return {"run_id": 0, "processed": 0, "errors": 0, "error": "no questions"}

    questions = list_questions(limit=limit or total, db_path=db_path)
    logger.info("Starting benchmark run with %d questions", len(questions))

    supervisor = _build_supervisor()
    run_id = create_run(
        metadata={"question_count": len(questions), "limit": limit},
        db_path=db_path,
    )

    processed = 0
    errors = 0

    for q in questions:
        qid = q["id"]
        # Combine title + body as the user message
        message = q["title"]
        if q.get("body"):
            message += "\n\n" + q["body"][:500]

        # Use a unique chat_id per question to avoid state leaking
        chat_id = f"benchmark-{run_id}-q{qid}"

        t0 = time.monotonic()
        try:
            reply = await supervisor.process(chat_id, message)
            latency_ms = int((time.monotonic() - t0) * 1000)
            confidence = _infer_confidence(reply)

            insert_result(
                run_id=run_id,
                question_id=qid,
                reply=reply,
                confidence=confidence,
                latency_ms=latency_ms,
                db_path=db_path,
            )
            processed += 1
            logger.info(
                "  [%d/%d] q=%d confidence=%s latency=%dms",
                processed, len(questions), qid,
                confidence, latency_ms,
            )
        except Exception as exc:
            latency_ms = int((time.monotonic() - t0) * 1000)
            insert_result(
                run_id=run_id,
                question_id=qid,
                error=str(exc),
                latency_ms=latency_ms,
                db_path=db_path,
            )
            errors += 1
            logger.error("  [%d/%d] q=%d ERROR: %s", processed + errors, len(questions), qid, exc)
        finally:
            # Reset conversation state to avoid cross-question contamination
            supervisor.reset(chat_id)

    status = "completed" if errors == 0 else "completed_with_errors"
    finish_run(run_id, status=status, question_count=processed + errors, db_path=db_path)
    logger.info("Benchmark run %d finished: %d processed, %d errors", run_id, processed, errors)

    return {"run_id": run_id, "processed": processed, "errors": errors}


if __name__ == "__main__":
    result = asyncio.run(run_benchmark())
    print(f"Result: {result}")
