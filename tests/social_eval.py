#!/usr/bin/env python3
"""MIRA Social Skills Evaluator.

Tests three dimensions of MIRA's social/communication quality:

  1. Emotional scenarios  — does MIRA acknowledge pressure/downtime before diagnosing?
  2. Persona consistency  — does every response stay in-character (peer tone, no hedging, concise)?
  3. Expertise calibration — do senior vs junior responses differ in depth and vocabulary?

Fires messages directly at the MIRA system prompt via Claude API.
No bot stack involved — tests the prompt itself.

Usage:
    doppler run --project factorylm --config prd -- python3 tests/social_eval.py
    doppler run --project factorylm --config prd -- python3 tests/social_eval.py --category emotional
    doppler run --project factorylm --config prd -- python3 tests/social_eval.py --category calibration
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("social-eval")

SCENARIOS_PATH = Path(__file__).parent / "benchmark" / "social_scenarios.json"
RESULTS_DIR = Path(__file__).parent / "results"
PROMPT_PATH = Path(__file__).parent.parent / "mira-bots" / "prompts" / "diagnose" / "active.yaml"
CLAUDE_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = "claude-sonnet-4-6"
REQUEST_TIMEOUT = 30
DELAY_BETWEEN = 1.5

# Persona rule checks applied to every response
PERSONA_FORBIDDEN = [
    "great question", "certainly!", "of course!", "absolutely!",
    "it is important to note", "please be aware", "it's worth mentioning",
    "allow me to explain", "i understand how frustrating",
    "i can understand", "i appreciate your",
]


def load_system_prompt() -> str:
    try:
        import yaml
        with open(PROMPT_PATH) as f:
            data = yaml.safe_load(f)
        return data.get("system_prompt", "")
    except Exception as e:
        log.warning("Could not load active.yaml: %s — using fallback", e)
        return "You are MIRA, an industrial maintenance assistant."


def call_claude(client: httpx.Client, api_key: str, system: str, user_msg: str) -> str:
    resp = client.post(
        CLAUDE_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": CLAUDE_MODEL,
            "max_tokens": 400,
            "system": system,
            "messages": [{"role": "user", "content": user_msg}],
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def extract_reply(raw: str) -> str:
    """Pull 'reply' field from JSON response, fallback to raw text."""
    try:
        # Find JSON object in response
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            data = json.loads(m.group())
            return data.get("reply", raw)
    except Exception:
        pass
    return raw


def word_count(text: str) -> int:
    return len(text.split())


def count_question_marks(text: str) -> int:
    return text.count("?")


def contains_any(text: str, phrases: list[str]) -> list[str]:
    t = text.lower()
    return [p for p in phrases if p.lower() in t]


# ---------------------------------------------------------------------------
# Scoring functions
# ---------------------------------------------------------------------------

def score_emotional(scenario: dict, reply: str) -> dict:
    """Score an emotional scenario response."""
    ack_expected = scenario.get("expected_acknowledgment", False)
    ack_keywords = scenario.get("ack_keywords", [])
    matched_acks = [k for k in ack_keywords if k.lower() in reply.lower()]
    acknowledged = len(matched_acks) > 0

    # Forward movement: did it ask a diagnostic question?
    forward = "?" in reply and len(reply) > 30

    # Persona: no forbidden phrases
    violations = contains_any(reply, PERSONA_FORBIDDEN)

    # Emotional over-dwelling: acknowledgment should be short (< 12 words before "?")
    # Check if the first sentence before the question is excessively long
    first_sentence = reply.split("?")[0] if "?" in reply else reply
    over_dwell = word_count(first_sentence) > 25 and ack_expected

    passed = (
        (not ack_expected or acknowledged)
        and forward
        and not violations
        and not over_dwell
    )

    return {
        "id": scenario["id"],
        "signal": scenario.get("emotional_signal", ""),
        "ack_expected": ack_expected,
        "acknowledged": acknowledged,
        "ack_keywords_matched": matched_acks,
        "forward_movement": forward,
        "persona_violations": violations,
        "over_dwell": over_dwell,
        "passed": passed,
        "reply_preview": reply[:120],
    }


def score_persona(scenario: dict, reply: str) -> dict:
    """Score a persona consistency response."""
    trait = scenario.get("trait", "")
    violations = []

    if trait in ("peer_not_professor", "no_hedge"):
        forbidden = scenario.get("forbidden_phrases", []) + PERSONA_FORBIDDEN
        violations = contains_any(reply, forbidden)

    max_words = scenario.get("max_words")
    word_over = None
    if max_words:
        wc = word_count(reply)
        if wc > max_words:
            word_over = wc

    max_q = scenario.get("max_question_marks")
    q_over = None
    if max_q is not None:
        qc = count_question_marks(reply)
        if qc > max_q:
            q_over = qc

    passed = not violations and word_over is None and q_over is None

    return {
        "id": scenario["id"],
        "trait": trait,
        "violations": violations,
        "word_count": word_count(reply),
        "word_limit": max_words,
        "word_over": word_over,
        "question_marks": count_question_marks(reply),
        "q_limit": max_q,
        "q_over": q_over,
        "passed": passed,
        "reply_preview": reply[:120],
    }


def score_calibration(scenario: dict, senior_reply: str, junior_reply: str) -> dict:
    """Score expertise calibration — senior response should differ from junior."""
    sw = word_count(senior_reply)
    jw = word_count(junior_reply)
    senior_shorter = sw < jw

    # Senior reply should not contain "let me explain" / scaffolding phrases
    scaffolding = [
        "let me explain", "this means", "in other words", "to clarify",
        "for context", "as a note", "you may not know",
    ]
    senior_scaffolding = contains_any(senior_reply, scaffolding)

    # Junior reply should have at least one grounding sentence (more words before "?")
    junior_has_context = jw > sw + 5  # junior should be materially longer

    passed = senior_shorter and not senior_scaffolding

    return {
        "id": scenario["id"],
        "topic": scenario.get("topic", ""),
        "senior_words": sw,
        "junior_words": jw,
        "senior_shorter": senior_shorter,
        "senior_scaffolding": senior_scaffolding,
        "junior_has_more_context": junior_has_context,
        "passed": passed,
        "senior_preview": senior_reply[:100],
        "junior_preview": junior_reply[:100],
    }


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run(category: str | None) -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        log.error("ANTHROPIC_API_KEY not set")
        sys.exit(1)

    system = load_system_prompt()
    if not system:
        log.error("System prompt empty — check active.yaml")
        sys.exit(1)

    scenarios = json.loads(SCENARIOS_PATH.read_text())
    if category:
        cat_map = {"emotional": "emotional", "persona": "persona_consistency", "calibration": "expertise_calibration"}
        filter_cat = cat_map.get(category, category)
        scenarios = [s for s in scenarios if s["category"] == filter_cat]

    log.info("Running %d scenarios | model: %s", len(scenarios), CLAUDE_MODEL)

    emotional_results = []
    persona_results = []
    calibration_results = []

    with httpx.Client() as client:
        for s in scenarios:
            cat = s["category"]
            sid = s["id"]

            if cat == "emotional":
                print(f"\r{sid} [emotional] {s['emotional_signal']}...    ", end="", flush=True)
                t0 = time.monotonic()
                raw = call_claude(client, api_key, system, s["message"])
                reply = extract_reply(raw)
                ms = int((time.monotonic() - t0) * 1000)
                result = score_emotional(s, reply)
                result["latency_ms"] = ms
                emotional_results.append(result)

            elif cat == "persona_consistency":
                print(f"\r{sid} [persona] {s['trait']}...    ", end="", flush=True)
                raw = call_claude(client, api_key, system, s["message"])
                reply = extract_reply(raw)
                result = score_persona(s, reply)
                persona_results.append(result)

            elif cat == "expertise_calibration":
                print(f"\r{sid} [calibration] {s['topic'][:30]}...    ", end="", flush=True)
                raw_s = call_claude(client, api_key, system, s["senior_message"])
                time.sleep(DELAY_BETWEEN)
                raw_j = call_claude(client, api_key, system, s["junior_message"])
                sr = extract_reply(raw_s)
                jr = extract_reply(raw_j)
                result = score_calibration(s, sr, jr)
                calibration_results.append(result)

            time.sleep(DELAY_BETWEEN)

    print()

    # --- Report ---
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report = build_report(emotional_results, persona_results, calibration_results, ts)
    print(report)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "social_eval_report.txt").write_text(report)
    output = {
        "timestamp": ts, "model": CLAUDE_MODEL,
        "emotional": emotional_results,
        "persona": persona_results,
        "calibration": calibration_results,
    }
    (RESULTS_DIR / "social_eval_results.json").write_text(json.dumps(output, indent=2))
    log.info("Written to tests/results/")


def build_report(
    emotional: list[dict],
    persona: list[dict],
    calibration: list[dict],
    ts: str,
) -> str:
    lines = [
        "=" * 55,
        "MIRA Social Skills Evaluation",
        "=" * 55,
        f"Date: {ts}",
        f"Model: {CLAUDE_MODEL}",
        "",
    ]

    if emotional:
        passed = sum(1 for r in emotional if r["passed"])
        lines += [
            f"--- Emotional Acknowledgment ({passed}/{len(emotional)} passed) ---",
        ]
        for r in emotional:
            icon = "PASS" if r["passed"] else "FAIL"
            ack = "ack" if r["acknowledged"] else "no-ack"
            fwd = "fwd" if r["forward_movement"] else "stalled"
            viols = f" VIOLATIONS:{r['persona_violations']}" if r["persona_violations"] else ""
            lines.append(f"  {icon}  {r['id']} [{r['signal']}] {ack} {fwd}{viols}")
            if not r["passed"]:
                lines.append(f"       >> {r['reply_preview']}")
        lines.append("")

    if persona:
        passed = sum(1 for r in persona if r["passed"])
        lines += [
            f"--- Persona Consistency ({passed}/{len(persona)} passed) ---",
        ]
        for r in persona:
            icon = "PASS" if r["passed"] else "FAIL"
            detail = ""
            if r["violations"]:
                detail += f" forbidden:{r['violations']}"
            if r["word_over"]:
                detail += f" words:{r['word_count']}/{r['word_limit']}"
            if r["q_over"]:
                detail += f" questions:{r['question_marks']}/{r['q_limit']}"
            lines.append(f"  {icon}  {r['id']} [{r['trait']}]{detail}")
            if not r["passed"]:
                lines.append(f"       >> {r['reply_preview']}")
        lines.append("")

    if calibration:
        passed = sum(1 for r in calibration if r["passed"])
        lines += [
            f"--- Expertise Calibration ({passed}/{len(calibration)} passed) ---",
        ]
        for r in calibration:
            icon = "PASS" if r["passed"] else "FAIL"
            delta = r["junior_words"] - r["senior_words"]
            lines.append(
                f"  {icon}  {r['id']} [{r['topic'][:35]}] "
                f"senior={r['senior_words']}w junior={r['junior_words']}w "
                f"delta=+{delta}w"
            )
            if not r["passed"]:
                lines.append(f"       senior: {r['senior_preview']}")
                lines.append(f"       junior: {r['junior_preview']}")
        lines.append("")

    # Overall
    all_results = emotional + persona + calibration
    total = len(all_results)
    total_pass = sum(1 for r in all_results if r.get("passed"))
    pct = total_pass / total * 100 if total else 0
    lines += [
        f"Overall: {total_pass}/{total} ({pct:.0f}%)",
        "=" * 55,
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--category", choices=["emotional", "persona", "calibration"],
        help="Run only one category",
    )
    args = parser.parse_args()
    run(args.category)
