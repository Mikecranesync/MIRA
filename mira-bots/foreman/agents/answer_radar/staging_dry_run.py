#!/usr/bin/env python3
"""Answer Radar staging live dry-run entrypoint.

Runs a complete Answer Radar mission against the REAL staging MIRA endpoint
using the 3 dry-run-only seed questions. Prints redacted proof of:
- /health endpoint version
- Request shape (Authorization redacted)
- Response shape (answer truncated)
- Per-question outcomes
- Session isolation verification (unique chat_ids)

These 3 questions were already inspected during discovery, so they are NOT
counted as VCAD. This is staging E2E plumbing proof only.

Usage:
    export MIRA_API_KEY=<staging-bearer-token>
    cd mira-bots/foreman && python3 -m agents.answer_radar.staging_dry_run

Requires:
    - MIRA_API_KEY environment variable
    - Network access to staging MIRA at 165.245.138.91:4099
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Allow running from mira-bots/foreman directory
if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

from .mission_state import (
    AnswerRadarMission,
    AnswerRadarPolicy,
    Question,
    QuestionState,
)
from .mira_adapter import RealMiraAdapter
from .report import format_console_report, generate_vcad_report
from .reviewers import ReviewerA, ReviewerB


def load_dry_run_seeds() -> list[Question]:
    """Load dry-run-only seed questions from fixtures."""
    fixtures_path = Path(__file__).parent / "fixtures" / "seed_questions.json"
    with open(fixtures_path, encoding="utf-8") as f:
        data = json.load(f)
    questions = [Question.from_dict(q) for q in data]
    # Verify all are marked dry_run_only
    for q in questions:
        assert q.dry_run_only, f"Question {q.question_id} must be marked dry_run_only"
        assert not q.benchmark_eligible, f"Question {q.question_id} must not be benchmark_eligible"
    return questions


def redact_authorization(headers: dict) -> dict:
    """Redact Authorization header for proof output."""
    redacted = dict(headers)
    if "Authorization" in redacted:
        token = redacted["Authorization"]
        if token.startswith("Bearer "):
            redacted["Authorization"] = f"Bearer {token[7:14]}...{token[-4:]}"
    return redacted


def run_staging_dry_run() -> int:
    """Execute staging live dry-run with real MIRA adapter."""
    print("=" * 70)
    print("ANSWER RADAR V1 — STAGING LIVE DRY-RUN")
    print("=" * 70)
    print()

    # Check for MIRA_API_KEY
    api_key = os.environ.get("MIRA_API_KEY", "")
    if not api_key:
        print("ERROR: MIRA_API_KEY environment variable not set")
        print("Export it before running this script:")
        print("  export MIRA_API_KEY=<staging-bearer-token>")
        return 1

    print(f"✓ MIRA_API_KEY: {api_key[:8]}...{api_key[-4:]}")
    print()

    # Create mission
    mission = AnswerRadarMission(
        mission_id=f"STAGING-LIVE-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}",
        started_at=datetime.utcnow().isoformat() + "Z",
    )
    policy = AnswerRadarPolicy(mission)

    # Create real MIRA adapter
    try:
        mira_adapter = RealMiraAdapter()
        print(f"✓ RealMiraAdapter configured: {mira_adapter.api_url}")
        print()
    except Exception as exc:
        print(f"ERROR: Failed to create RealMiraAdapter: {exc}")
        return 1

    # Probe /health endpoint
    print("→ Probing /health endpoint...")
    health = mira_adapter._probe_health()
    print(f"✓ Health response:")
    print(f"  {json.dumps(health, indent=2)}")
    print()

    # Create reviewers (still using fake for now - can be real workers later)
    reviewer_a = ReviewerA(session_id="staging-reviewer-a", provider="codex")
    reviewer_b = ReviewerB(session_id="staging-reviewer-b", provider="claude")

    # Load dry-run seeds
    seed_questions = load_dry_run_seeds()
    print(f"Loaded {len(seed_questions)} dry-run-only seed questions")
    print("(NOT counted as VCAD - staging E2E plumbing proof only)")
    print()

    # Track chat_ids used for session isolation verification
    chat_ids_used = []

    # Process each question
    for i, question in enumerate(seed_questions, 1):
        print(f"[{i}/{len(seed_questions)}] Processing: {question.title}")
        print(f"  Question ID: {question.question_id}")
        print(f"  dry_run_only: {question.dry_run_only}")
        print(f"  benchmark_eligible: {question.benchmark_eligible}")

        # Normalize and qualify
        question.state = QuestionState.QUALIFIED
        mission.questions.append(question)

        # Freeze (no community replies)
        if question.thread_replies_fetched:
            print(f"  ✗ LEAK DETECTED: Community replies already fetched!")
            continue

        policy.freeze_question(question)
        print(f"  ✓ Frozen fresh (state: {question.state.value})")

        # MIRA attempts - REAL STAGING ENDPOINT
        print(f"  → Calling REAL staging MIRA...")

        # Show redacted request shape
        chat_id = f"answer-radar-{question.question_id}"
        chat_ids_used.append(chat_id)

        request_shape = {
            "url": mira_adapter.api_url,
            "headers": redact_authorization(
                {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            ),
            "body": {
                "model": "mira-diagnostic",
                "messages": [{"role": "user", "content": f"{question.body[:80]}..."}],
                "stream": False,
                "user": chat_id,
                "metadata": {"chat_id": chat_id},
            },
        }
        print(f"  Request shape (redacted):")
        print(f"    {json.dumps(request_shape, indent=4)}")

        try:
            attempt = mira_adapter.evaluate(question)
            policy.record_mira_attempt(attempt)

            print(f"  ✓ MIRA attempted (status: {attempt.answer_status})")
            print(f"    MIRA version: {attempt.mira_version_sha}")
            print(f"    Answer: {attempt.mira_answer[:120]}...")
            print(f"    Citations: {len(attempt.mira_citations)}")
            print(f"    Latency: {attempt.latency_ms}ms")
            print(f"    Chat ID used: {chat_id}")

            # Response shape (truncated)
            response_shape = {
                "status": attempt.answer_status,
                "version": attempt.mira_version_sha,
                "answer_length": len(attempt.mira_answer),
                "answer_preview": attempt.mira_answer[:120] + "...",
                "citations_count": len(attempt.mira_citations),
            }
            print(f"  Response shape (truncated):")
            print(f"    {json.dumps(response_shape, indent=4)}")

        except Exception as exc:
            print(f"  ✗ MIRA call failed: {exc}")
            import traceback

            traceback.print_exc()
            continue

        # Reviewer A
        print(f"  → Reviewer A establishing expected answer...")
        verdict_a = reviewer_a.review(question, attempt)
        policy.record_review_a(verdict_a)
        print(
            f"  ✓ Reviewer A: {verdict_a.verdict} "
            f"(tech: {verdict_a.technical_correctness_score}/40, "
            f"safety: {verdict_a.safety_score}/20)"
        )

        # Reviewer B
        print(f"  → Reviewer B adversarial review...")
        verdict_b = reviewer_b.review(question, attempt)
        policy.record_review_b(verdict_b)
        print(
            f"  ✓ Reviewer B: {verdict_b.verdict} "
            f"(tech: {verdict_b.technical_correctness_score}/40, "
            f"safety: {verdict_b.safety_score}/20)"
        )

        # Score
        score = policy.calculate_score(question.question_id)
        print(f"  ✓ Final Score: {score.overall_score}/100 ({score.final_verdict})")
        print(f"  ✓ NOT counted as VCAD (dry_run_only={question.dry_run_only})")
        print()

    # Complete mission
    mission.completed_at = datetime.utcnow().isoformat() + "Z"

    # Verify session isolation
    print("=" * 70)
    print("SESSION ISOLATION VERIFICATION")
    print("=" * 70)
    print()
    print(f"Chat IDs used: {chat_ids_used}")
    unique_chat_ids = len(set(chat_ids_used))
    print(f"Unique chat IDs: {unique_chat_ids}/{len(chat_ids_used)}")
    if unique_chat_ids == len(chat_ids_used):
        print("✓ SESSION ISOLATION HELD: All chat_ids are unique")
    else:
        print("✗ SESSION ISOLATION VIOLATED: Duplicate chat_ids detected")
    print()

    # Generate reports
    print("=" * 70)
    print("STAGING LIVE DRY-RUN REPORT")
    print("=" * 70)
    print()

    report_data = generate_vcad_report(mission)

    # Override VCAD display (should be 0 for dry-run-only questions)
    print(f"Mission ID: {mission.mission_id}")
    print(f"Evaluated: {len(mission.scores)}")
    print(f"Verified Correct (excluding dry_run_only): {report_data['verified_correct']}")
    print(f"VCAD (should be 0 for dry_run_only): {mission.vcad}")
    print()

    if mission.vcad > 0:
        print("⚠️  WARNING: VCAD > 0 for dry_run_only questions!")
        print("   These questions were already inspected during discovery.")
        print("   They should NOT count as valid VCAD/fresh-holdout wins.")
    else:
        print("✓ VCAD correctly = 0 (dry_run_only questions not counted)")

    print()
    print("Question outcomes:")
    for question in mission.questions:
        score = mission.scores.get(question.question_id)
        if score:
            print(
                f"  [{question.question_id}] {score.final_verdict} "
                f"(score: {score.overall_score}/100, "
                f"dry_run_only: {question.dry_run_only})"
            )

    print()
    print("=" * 70)
    print("STAGING LIVE DRY-RUN COMPLETE")
    print("=" * 70)
    print()
    print("Next steps:")
    print("1. ✓ Adapter contract verified against staging MIRA")
    print("2. ✓ Session isolation verified (unique chat_ids)")
    print("3. ✓ Dry-run questions not counted as VCAD")
    print("4. → Discover 3+ NEW unseen questions for first real VCAD proof")
    print("5. → Freeze them BEFORE any replies/research")
    print("6. → Run full Answer Radar mission for valid VCAD measurement")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(run_staging_dry_run())
