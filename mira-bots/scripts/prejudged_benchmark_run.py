#!/usr/bin/env python3
"""Prejudged Benchmark Runner — Multi-turn simulation with answer simulator + judge.

Runs inside the mira-bot-telegram container on BRAVO. Simulates full diagnostic
conversations against prejudged cases where the answer is already known, then
scores MIRA's diagnostic performance using an LLM judge.

Usage:
    docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py
    docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py --limit 3
    docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py --case-id 1

Env vars:
    MIRA_DB_PATH           — SQLite path
    ANTHROPIC_API_KEY       — Required for answer simulator + judge
    OPENWEBUI_BASE_URL     — Open WebUI endpoint
    OPENWEBUI_API_KEY      — API key for Open WebUI
    KNOWLEDGE_COLLECTION_ID — KB collection UUID
"""

import argparse
import asyncio
import json
import logging
import os
import sqlite3
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("prejudged-benchmark-run")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.engine import Supervisor  # noqa: E402
from shared.benchmark_db import (  # noqa: E402
    ensure_tables,
    list_prejudged_cases,
    count_prejudged_cases,
    get_prejudged_case,
    create_prejudged_run,
    finish_prejudged_run,
    insert_prejudged_conversation,
    update_prejudged_judge_scores,
)

MAX_TURNS = 8
DIAGNOSIS_STATES = {"DIAGNOSIS", "FIX_STEP", "RESOLVED"}

# Verdict thresholds
VERDICT_THRESHOLDS = [
    (8.5, "excellent"),
    (7.0, "good"),
    (5.0, "acceptable"),
    (3.0, "poor"),
]


def _get_anthropic_client():
    import anthropic
    return anthropic.Anthropic()


def _build_supervisor() -> Supervisor:
    """Construct a Supervisor using env vars."""
    db_path = os.getenv("MIRA_DB_PATH", "/data/mira.db")
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


def _read_fsm_state(chat_id: str, db_path: str) -> str:
    """Read FSM state from SQLite conversation_state table."""
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.row_factory = sqlite3.Row
    row = db.execute(
        "SELECT state FROM conversation_state WHERE chat_id = ?", (chat_id,)
    ).fetchone()
    db.close()
    return row["state"] if row else "IDLE"


def _simulate_answer(
    ground_truth: dict,
    transcript: list[dict],
    turn_number: int,
    anthropic_client,
) -> str:
    """Use Claude sonnet to simulate a technician's answer based on ground truth."""
    gt_json = json.dumps(ground_truth, indent=2)
    transcript_text = "\n".join(
        f"[{t['role'].upper()}]: {t['content']}" for t in transcript
    )

    hint_instruction = ""
    if turn_number >= 6:
        hint_instruction = (
            "\nIMPORTANT: MIRA seems stuck. Drop a stronger hint about the actual "
            "problem area without directly stating the root cause. Mention a specific "
            "observation that would lead toward the correct diagnosis."
        )

    prompt = f"""You are playing the role of a factory maintenance technician in a diagnostic conversation with MIRA (an AI diagnostic assistant). You KNOW the ground truth but must act naturally.

GROUND TRUTH (what you know but don't volunteer):
{gt_json}

CONVERSATION SO FAR:
{transcript_text}

RULES:
- When MIRA asks about the correct problem area → reveal the relevant observation naturally
- When MIRA asks about an irrelevant area → respond "looks fine to me" or "no issues there" or similar
- Keep responses short (1-3 sentences), casual technician tone
- If MIRA gives you numbered options, select the one closest to ground truth
- NEVER volunteer the root cause unprompted
- NEVER use technical jargon beyond what a field tech would say{hint_instruction}

Respond as the technician (just the response text, no role prefix):"""

    resp = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def _judge_conversation(
    case: dict,
    transcript: list[dict],
    turn_count: int,
    reached_diagnosis: bool,
    anthropic_client,
) -> dict:
    """Use Claude sonnet to judge the diagnostic conversation quality.

    Returns dict with 5 dimension scores + verdict + reasoning.
    """
    ground_truth = json.loads(case["ground_truth"]) if isinstance(case["ground_truth"], str) else case["ground_truth"]
    gt_json = json.dumps(ground_truth, indent=2)
    transcript_text = "\n".join(
        f"[{t['role'].upper()} (state={t.get('state', '?')})]: {t['content']}"
        for t in transcript
    )

    prompt = f"""You are an expert industrial maintenance trainer evaluating an AI diagnostic assistant's performance. Score the following conversation on 5 dimensions.

CASE: {case['title']}
EQUIPMENT: {case.get('equipment_type', 'unknown')}
DIFFICULTY: {case.get('difficulty', 'medium')}
REACHED DIAGNOSIS: {reached_diagnosis}
TURNS USED: {turn_count}

GROUND TRUTH:
{gt_json}

CONVERSATION TRANSCRIPT:
{transcript_text}

Score each dimension from 0.0 to 10.0:

1. EVIDENCE UTILIZATION (weight 0.20): Did MIRA ask for the key evidence mentioned in ground truth keywords? Did it gather the right diagnostic data?

2. PATH EFFICIENCY (weight 0.20): How directly did MIRA reach the root cause? Fewer turns = better. 2-3 turns for easy cases, 3-4 for medium, 4-5 for hard is ideal. Max 8 turns is a timeout penalty.

3. GSD COMPLIANCE (weight 0.25): Did MIRA follow the Socratic diagnostic method? Did it ask focused questions, narrow down possibilities, and guide rather than guess? Did it use the state machine properly (IDLE→Q1→Q2→Q3→DIAGNOSIS)?

4. ROOT CAUSE ALIGNMENT (weight 0.25): Does MIRA's final diagnosis match the ground truth root cause? Partial credit for being in the right area.

5. EXPERT COMPARISON (weight 0.10): Would a master maintenance technician approve of this diagnostic approach? Was it professional, safe, and methodical?

Return a JSON object with exactly these fields:
- evidence_utilization: float (0-10)
- path_efficiency: float (0-10)
- gsd_compliance: float (0-10)
- root_cause_alignment: float (0-10)
- expert_comparison: float (0-10)
- reasoning: string (2-3 sentences explaining the scores)

Return ONLY the JSON object, no other text."""

    resp = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.content[0].text.strip()

    try:
        if text.startswith("{"):
            return json.loads(text)
        import re
        match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Failed to parse judge response: %s", exc)

    return {
        "evidence_utilization": 0.0,
        "path_efficiency": 0.0,
        "gsd_compliance": 0.0,
        "root_cause_alignment": 0.0,
        "expert_comparison": 0.0,
        "reasoning": f"Judge parse error: {text[:200]}",
    }


def _compute_verdict(composite: float) -> str:
    """Map composite score to verdict string."""
    for threshold, label in VERDICT_THRESHOLDS:
        if composite >= threshold:
            return label
    return "failed"


async def run_single_case(
    case: dict,
    run_id: int,
    supervisor: Supervisor,
    anthropic_client,
    db_path: str,
) -> dict:
    """Run a single prejudged case through multi-turn simulation.

    Returns summary dict with scores.
    """
    case_id = case["id"]
    chat_id = f"prejudged-{run_id}-c{case_id}"
    ground_truth = json.loads(case["ground_truth"]) if isinstance(case["ground_truth"], str) else case["ground_truth"]

    transcript = []
    message = case["evidence_packet"]
    reached_diagnosis = False
    final_state = "IDLE"
    total_latency_ms = 0

    logger.info("  Case %d: %s", case_id, case["title"][:50])

    # Reset state before starting
    supervisor.reset(chat_id)

    try:
        for turn in range(MAX_TURNS):
            # Send message to MIRA
            t0 = time.monotonic()
            reply = await supervisor.process(chat_id, message)
            latency = int((time.monotonic() - t0) * 1000)
            total_latency_ms += latency

            # Read FSM state
            fsm_state = _read_fsm_state(chat_id, db_path)
            final_state = fsm_state

            transcript.append({
                "role": "mira",
                "content": reply,
                "state": fsm_state,
                "turn": turn,
                "latency_ms": latency,
            })

            logger.info("    Turn %d: MIRA [%s] (%dms) — %s",
                         turn, fsm_state, latency, reply[:80])

            # Check if we reached diagnosis
            if fsm_state in DIAGNOSIS_STATES:
                reached_diagnosis = True
                break

            # Simulate technician answer
            sim_answer = _simulate_answer(
                ground_truth, transcript, turn, anthropic_client,
            )
            transcript.append({
                "role": "technician",
                "content": sim_answer,
                "turn": turn,
            })
            logger.info("    Turn %d: TECH — %s", turn, sim_answer[:80])

            message = sim_answer

    except Exception as exc:
        logger.error("    Case %d error: %s", case_id, exc)
        # Insert error record
        conv_id = insert_prejudged_conversation(
            run_id=run_id,
            case_id=case_id,
            transcript=transcript,
            turn_count=len([t for t in transcript if t["role"] == "mira"]),
            reached_diagnosis=False,
            final_state=final_state,
            total_latency_ms=total_latency_ms,
            error=str(exc),
            db_path=db_path,
        )
        return {"case_id": case_id, "error": str(exc), "conv_id": conv_id}
    finally:
        # Always reset to prevent state leakage
        supervisor.reset(chat_id)

    turn_count = len([t for t in transcript if t["role"] == "mira"])

    # Insert conversation record
    conv_id = insert_prejudged_conversation(
        run_id=run_id,
        case_id=case_id,
        transcript=transcript,
        turn_count=turn_count,
        reached_diagnosis=reached_diagnosis,
        final_state=final_state,
        total_latency_ms=total_latency_ms,
        db_path=db_path,
    )

    # Judge the conversation
    logger.info("    Judging case %d...", case_id)
    scores = _judge_conversation(
        case, transcript, turn_count, reached_diagnosis, anthropic_client,
    )

    evidence_util = scores.get("evidence_utilization", 0.0)
    path_eff = scores.get("path_efficiency", 0.0)
    gsd_comp = scores.get("gsd_compliance", 0.0)
    root_cause = scores.get("root_cause_alignment", 0.0)
    expert = scores.get("expert_comparison", 0.0)

    composite = (
        evidence_util * 0.20
        + path_eff * 0.20
        + gsd_comp * 0.25
        + root_cause * 0.25
        + expert * 0.10
    )
    verdict = _compute_verdict(composite)

    update_prejudged_judge_scores(
        conv_id=conv_id,
        evidence_utilization=evidence_util,
        path_efficiency=path_eff,
        gsd_compliance=gsd_comp,
        root_cause_alignment=root_cause,
        expert_comparison=expert,
        verdict=verdict,
        judge_reasoning=scores.get("reasoning", ""),
        db_path=db_path,
    )

    logger.info("    Case %d: score=%.1f verdict=%s turns=%d diag=%s",
                 case_id, composite, verdict, turn_count, reached_diagnosis)

    return {
        "case_id": case_id,
        "conv_id": conv_id,
        "composite_score": composite,
        "verdict": verdict,
        "turn_count": turn_count,
        "reached_diagnosis": reached_diagnosis,
    }


async def run_benchmark(
    db_path: str | None = None,
    limit: int = 0,
    case_id: int | None = None,
) -> dict:
    """Run prejudged benchmark. Returns summary dict."""
    db_path = db_path or os.getenv("MIRA_DB_PATH", "/data/mira.db")
    ensure_tables(db_path)

    anthropic_client = _get_anthropic_client()

    # Get cases
    if case_id:
        case = get_prejudged_case(case_id, db_path)
        if not case:
            logger.error("Case %d not found", case_id)
            return {"error": f"Case {case_id} not found"}
        cases = [case]
    else:
        total = count_prejudged_cases(db_path=db_path)
        if total == 0:
            logger.warning("No prejudged cases — run build_case_corpus.py first")
            return {"error": "no cases"}
        cases = list_prejudged_cases(limit=limit or total, db_path=db_path)

    logger.info("Starting prejudged benchmark with %d cases", len(cases))

    supervisor = _build_supervisor()
    run_id = create_prejudged_run(
        metadata={"case_count": len(cases), "limit": limit},
        db_path=db_path,
    )

    results = []
    errors = 0

    for case in cases:
        result = await run_single_case(
            case, run_id, supervisor, anthropic_client, db_path,
        )
        results.append(result)
        if result.get("error"):
            errors += 1

    status = "completed" if errors == 0 else "completed_with_errors"
    finish_prejudged_run(
        run_id, status=status, case_count=len(cases), db_path=db_path,
    )

    # Compute aggregate stats
    scores = [r["composite_score"] for r in results if "composite_score" in r]
    avg_score = sum(scores) / len(scores) if scores else 0.0

    logger.info("Benchmark run %d finished: %d cases, %d errors, avg=%.1f",
                 run_id, len(cases), errors, avg_score)

    return {
        "run_id": run_id,
        "cases": len(cases),
        "errors": errors,
        "avg_score": round(avg_score, 2),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="Prejudged Benchmark Runner")
    parser.add_argument("--limit", type=int, default=0, help="Max cases to run (0=all)")
    parser.add_argument("--case-id", type=int, default=None, help="Run a single case by ID")
    parser.add_argument("--db", default="", help="SQLite DB path override")
    args = parser.parse_args()

    db_path = args.db or os.getenv("MIRA_DB_PATH")
    result = asyncio.run(run_benchmark(
        db_path=db_path,
        limit=args.limit,
        case_id=args.case_id,
    ))
    print(f"\nResult: {json.dumps(result, indent=2, default=str)}")


if __name__ == "__main__":
    main()
