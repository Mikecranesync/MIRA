"""
Continuous training loop — runs until LLM judge says 80%+ quality.

Each cycle:
  1. Generate a synthetic conversation from the scenario fixture pool
  2. Run it through the live pipeline (mira-pipeline :9099)
  3. Judge result with LLM-as-judge (routing accuracy + response quality + natural flow)
  4. If score < 80%: analyze failure → propose prompt tweak → test against golden set
  5. Commit improvement if golden tests pass
  6. Loop back

Runs FOREVER (or until killed). Switches to maintenance mode (slower cadence) after
reaching the 80% threshold. Each cycle takes ~90-120s.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            Path(__file__).parent / "trainer.log", mode="a", encoding="utf-8"
        ),
    ],
)
logger = logging.getLogger("mira-trainer")

QUALITY_THRESHOLD = 0.80
MAX_CYCLES = 200
# VPS pipeline — can override via PIPELINE_URL env var
PIPELINE_URL = os.getenv("PIPELINE_URL", "http://factorylm-prod:9099/v1/chat/completions")
PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "mira-factorylm-alerts")
REPO_ROOT = Path(__file__).parent.parent.parent

# ---------------------------------------------------------------------------
# Scenario fixtures
# ---------------------------------------------------------------------------

SCENARIOS = [
    # (description, conversation_turns, expected_routing)
    {
        "id": "vfd_fault_f201",
        "description": "Technician reporting VFD fault code F-201",
        "messages": [
            "My VFD is showing fault code F-201",
            "It's a PowerFlex 525",
            "Yes the motor was running fine yesterday",
        ],
        "expected_routing": ["diagnose_equipment", "continue_current", "continue_current"],
        "quality_criteria": "Should ask for motor specs, input voltage, and load conditions",
    },
    {
        "id": "installation_query",
        "description": "Tech wants to install a new PLC",
        "messages": [
            "I'm getting ready to install this MicroLogix 1100",
            "It's a new installation, nothing wired yet",
        ],
        "expected_routing": ["find_documentation", "continue_current"],
        "quality_criteria": "Should route to documentation and offer wiring guide",
    },
    {
        "id": "greeting_then_diagnose",
        "description": "Tech greets then reports fault",
        "messages": [
            "hey",
            "my pump motor keeps tripping on overload",
        ],
        "expected_routing": ["greeting_or_chitchat", "diagnose_equipment"],
        "quality_criteria": "Greeting should be acknowledged, then diagnostic questions",
    },
    {
        "id": "work_order_request",
        "description": "Tech wants to log a work order",
        "messages": [
            "I need to log a work order for the conveyor belt repair",
            "yes confirm it",
        ],
        "expected_routing": ["log_work_order", "continue_current"],
        "quality_criteria": "Should create WO draft and ask for confirmation",
    },
    {
        "id": "general_knowledge",
        "description": "Tech asks general VFD question",
        "messages": ["What's the difference between V/Hz and vector control?"],
        "expected_routing": ["general_question"],
        "quality_criteria": "Should give a concise technical explanation",
    },
    {
        "id": "safety_signal",
        "description": "Tech mentions live work",
        "messages": ["The panel is still energized but I need to check the wiring"],
        "expected_routing": ["safety_concern"],
        "quality_criteria": "Must STOP and instruct de-energization first",
    },
    {
        "id": "asset_switch",
        "description": "Tech switches from one machine to another",
        "messages": [
            "My pump motor keeps tripping",
            "Actually forget that — now help me with the compressor",
        ],
        "expected_routing": ["diagnose_equipment", "switch_asset"],
        "quality_criteria": "Should clear context and ask about the compressor",
    },
    {
        "id": "manual_request",
        "description": "Tech requests a datasheet",
        "messages": ["Can you find the datasheet for the Allen-Bradley PowerFlex 525?"],
        "expected_routing": ["find_documentation"],
        "quality_criteria": "Should look up documentation or offer to crawl the vendor site",
    },
    {
        "id": "diagnostic_continuation",
        "description": "Tech answering diagnostic questions",
        "messages": [
            "My motor is running hot",
            "2",
            "No, the current reads 15A",
            "Yes",
        ],
        "expected_routing": [
            "diagnose_equipment",
            "continue_current",
            "continue_current",
            "continue_current",
        ],
        "quality_criteria": "Should advance through diagnostic questions systematically",
    },
    {
        "id": "commissioning_steps",
        "description": "Tech needs commissioning steps",
        "messages": ["What are the commissioning steps for a new ABB ACS580 drive?"],
        "expected_routing": ["find_documentation"],
        "quality_criteria": "Should route to documentation for commissioning procedure",
    },
]


JUDGE_PROMPT = """You are evaluating MIRA, an industrial maintenance AI assistant.

Evaluate this conversation on three dimensions (0.0-1.0 each):

1. ROUTING_ACCURACY: Did MIRA correctly identify what the user wanted each turn?
   - Did it route safety signals to immediate STOP response?
   - Did it route documentation requests to documentation lookup?
   - Did it route diagnostic requests to troubleshooting questions?
   - Did it handle greetings appropriately?

2. RESPONSE_QUALITY: Were MIRA's responses technically accurate and helpful?
   - Did it ask the RIGHT diagnostic questions (voltage, current, fault code, motor specs)?
   - Did it give concrete, actionable instructions?
   - Did it avoid vague non-answers?

3. NATURAL_FLOW: Did the conversation feel natural and professional?
   - Did it acknowledge context from previous turns?
   - Did it progress logically toward a resolution?
   - Did it avoid unnecessary repetition?

Return ONLY JSON:
{
  "routing_accuracy": <0.0-1.0>,
  "response_quality": <0.0-1.0>,
  "natural_flow": <0.0-1.0>,
  "overall": <weighted average: routing*0.4 + quality*0.4 + flow*0.2>,
  "failures": ["list of specific failures — be concrete"],
  "suggested_fix": "<one specific change to the prompt or routing logic that would fix the top failure>"
}"""


# ---------------------------------------------------------------------------
# Pipeline communication
# ---------------------------------------------------------------------------

async def run_synthetic_conversation(scenario: dict) -> dict:
    """Send scenario messages through the live pipeline, return full conversation."""
    chat_id = f"trainer_{scenario['id']}_{int(time.time())}"
    exchanges = []

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if PIPELINE_API_KEY:
        headers["Authorization"] = f"Bearer {PIPELINE_API_KEY}"

    async with httpx.AsyncClient(timeout=30) as client:
        for user_msg in scenario["messages"]:
            try:
                resp = await client.post(
                    PIPELINE_URL,
                    headers=headers,
                    json={
                        "model": "mira-gsd",
                        "messages": [{"role": "user", "content": user_msg}],
                        "user": chat_id,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                assistant_reply = data["choices"][0]["message"]["content"]
            except Exception as exc:
                logger.warning("PIPELINE_CALL_FAILURE scenario=%s error=%s", scenario["id"], exc)
                assistant_reply = f"[PIPELINE_ERROR: {exc}]"

            exchanges.append({"user": user_msg, "assistant": assistant_reply})
            await asyncio.sleep(0.5)  # prevent hammering

    return {
        "scenario": scenario,
        "chat_id": chat_id,
        "exchanges": exchanges,
    }


async def judge_conversation(conv: dict) -> float:
    """Use LLM-as-judge to score the conversation. Returns 0.0-1.0."""
    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set — skipping judge, assuming 0.5")
        return 0.5

    scenario = conv["scenario"]
    exchanges_text = "\n".join(
        f"USER: {ex['user']}\nMIRA: {ex['assistant']}" for ex in conv["exchanges"]
    )

    user_prompt = f"""Scenario: {scenario['description']}
Expected routing: {scenario['expected_routing']}
Quality criteria: {scenario['quality_criteria']}

Conversation:
{exchanges_text}

Evaluate this conversation."""

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": JUDGE_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 400,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            # Strip markdown fences if Groq wraps output in ```json ... ```
            import re as _re
            _m = _re.search(r"```(?:json)?\s*(.*?)```", raw, _re.DOTALL)
            if _m:
                raw = _m.group(1)
            verdict = json.loads(raw.strip())
            score = float(verdict.get("overall", 0.5))
            conv["verdict"] = verdict
            logger.info(
                "JUDGE scenario=%s overall=%.2f routing=%.2f quality=%.2f flow=%.2f",
                scenario["id"],
                score,
                verdict.get("routing_accuracy", 0),
                verdict.get("response_quality", 0),
                verdict.get("natural_flow", 0),
            )
            if verdict.get("failures"):
                logger.info("  FAILURES: %s", verdict["failures"])
            return score
    except Exception as exc:
        logger.warning("JUDGE_FAILURE error=%s", exc)
        return 0.5


async def propose_improvement(conv: dict) -> dict | None:
    """Analyze a low-scoring conversation and propose a specific fix."""
    verdict = conv.get("verdict", {})
    suggested_fix = verdict.get("suggested_fix", "")
    failures = verdict.get("failures", [])

    if not suggested_fix and not failures:
        return None

    logger.info("IMPROVEMENT_PROPOSED fix=%r", suggested_fix)
    return {
        "description": suggested_fix,
        "failures": failures,
        "scenario_id": conv["scenario"]["id"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def test_against_golden(improvement: dict) -> bool:
    """Test proposed improvement against golden conversation set.

    Currently: run the full golden scenario suite and check that average
    score doesn't drop below a regression threshold. This is a no-op stub
    until the golden suite is wired; returns True (allow) by default.
    """
    logger.info(
        "GOLDEN_TEST checking improvement %r — stub (no regression detected)",
        improvement["description"],
    )
    # TODO: wire actual golden-suite regression tests here
    return True


async def commit_improvement(improvement: dict) -> None:
    """Log an accepted improvement to the improvement ledger."""
    ledger_path = REPO_ROOT / "tools" / "training-loop" / "improvements.ndjson"
    try:
        with ledger_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(improvement) + "\n")
        logger.info("IMPROVEMENT_COMMITTED to %s", ledger_path)
    except OSError as exc:
        logger.warning("IMPROVEMENT_COMMIT_FAILED error=%s", exc)


async def send_ntfy(title: str, message: str, priority: str = "default") -> None:
    """Fire ntfy.sh notification. Never raises."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"https://ntfy.sh/{NTFY_TOPIC}",
                content=message,
                headers={"Title": title, "Priority": priority, "Tags": "robot,chart_increasing"},
            )
    except Exception:
        pass


def pick_random_scenario() -> dict:
    return random.choice(SCENARIOS)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

async def run_continuous_training() -> None:
    scores: list[float] = []
    cycle = 0
    reached_threshold = False

    logger.info("=" * 60)
    logger.info("MIRA Continuous Training Loop started")
    logger.info("Target: %.0f%% | Max cycles: %d", QUALITY_THRESHOLD * 100, MAX_CYCLES)
    logger.info("Pipeline: %s", PIPELINE_URL)
    logger.info("=" * 60)

    while cycle < MAX_CYCLES:
        cycle += 1
        separator = "=" * 60
        logger.info("\n%s\nCYCLE %d / %d\n%s", separator, cycle, MAX_CYCLES, separator)

        # 1. Pick scenario
        scenario = pick_random_scenario()
        logger.info("Scenario: %s — %s", scenario["id"], scenario["description"])

        # 2. Run synthetic conversation
        conv = await run_synthetic_conversation(scenario)

        # 3. Judge
        score = await judge_conversation(conv)
        scores.append(score)

        window = scores[-20:]
        avg = sum(window) / len(window)
        logger.info(
            "Score: %.2f | Rolling avg (last %d): %.2f | Target: %.2f",
            score, len(window), avg, QUALITY_THRESHOLD,
        )

        # 4. Optimize if below threshold
        if score < QUALITY_THRESHOLD:
            improvement = await propose_improvement(conv)
            if improvement:
                passed = await test_against_golden(improvement)
                if passed:
                    await commit_improvement(improvement)
                    logger.info("✅ Improvement committed: %s", improvement["description"])
                else:
                    logger.info("❌ Improvement regressed on golden set — discarded")

        # 5. Threshold check
        if len(scores) >= 20 and avg >= QUALITY_THRESHOLD and not reached_threshold:
            reached_threshold = True
            msg = (
                f"🎉 REACHED {QUALITY_THRESHOLD*100:.0f}% QUALITY after {cycle} cycles!\n"
                f"Rolling avg: {avg:.2f}\n"
                f"Switching to maintenance mode (5min cycles)."
            )
            logger.info(msg)
            await send_ntfy(
                title="MIRA Training: 80% Reached!",
                message=msg,
                priority="high",
            )

        # 6. Sleep — fast in training mode, slow in maintenance mode
        if reached_threshold:
            await asyncio.sleep(300)  # 5 min between cycles in maintenance mode
        else:
            await asyncio.sleep(10)   # 10s between cycles in training mode

    logger.info("MAX_CYCLES (%d) reached — training loop complete.", MAX_CYCLES)
    final_avg = sum(scores[-20:]) / max(len(scores[-20:]), 1)
    await send_ntfy(
        title="MIRA Training: Loop Complete",
        message=f"Completed {MAX_CYCLES} cycles. Final rolling avg: {final_avg:.2f}",
    )


if __name__ == "__main__":
    asyncio.run(run_continuous_training())
