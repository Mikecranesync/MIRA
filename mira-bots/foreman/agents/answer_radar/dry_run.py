#!/usr/bin/env python3
"""Answer Radar dry-run entrypoint.

Runs a complete Answer Radar mission using the FakeMiraAdapter and seed questions,
then prints a VCAD report. No Gateway, no Slack, no Doppler, no real MIRA.

Usage:
    python -m mira-bots.foreman.agents.answer_radar.dry_run
    cd mira-bots/foreman && python -m agents.answer_radar.dry_run
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

# Allow running from mira-bots/foreman directory
if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

# Import from local package using relative imports
from .mission_state import (
    AnswerRadarMission,
    AnswerRadarPolicy,
    Question,
    QuestionState,
)
from .mira_adapter import FakeMiraAdapter
from .report import (
    format_console_report,
    format_slack_report,
    generate_vcad_report,
)
from .reviewers import ReviewerA, ReviewerB


def load_seed_questions() -> list[Question]:
    """Load seed questions from fixtures."""
    import json

    fixtures_path = Path(__file__).parent / "fixtures" / "seed_questions.json"
    with open(fixtures_path, encoding="utf-8") as f:
        data = json.load(f)
    return [Question.from_dict(q) for q in data]


def run_dry_run() -> int:
    """Execute a complete Answer Radar mission with fake data."""
    print("=" * 70)
    print("ANSWER RADAR V1 — DRY RUN")
    print("=" * 70)
    print()

    # Create mission
    mission = AnswerRadarMission(
        mission_id=f"DRY-RUN-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}",
        started_at=datetime.utcnow().isoformat() + "Z",
    )
    policy = AnswerRadarPolicy(mission)

    # Create adapters and reviewers
    mira_adapter = FakeMiraAdapter()
    reviewer_a = ReviewerA(session_id="dry-run-reviewer-a", provider="codex")
    reviewer_b = ReviewerB(session_id="dry-run-reviewer-b", provider="claude")

    # Load seed questions
    seed_questions = load_seed_questions()
    print(f"Loaded {len(seed_questions)} seed questions")
    print()

    # Process each question
    for i, question in enumerate(seed_questions, 1):
        print(f"[{i}/{len(seed_questions)}] Processing: {question.title}")

        # Normalize and qualify
        question.state = QuestionState.QUALIFIED
        question.manufacturer = question.title.split()[0]  # Simple extraction
        question.model = question.title.split()[1] if len(question.title.split()) > 1 else ""
        question.symptom = "Test Symptom"
        mission.questions.append(question)

        print(f"  ✓ Normalized: {question.manufacturer} {question.model}")

        # Freeze (CRITICAL: No community replies)
        if question.thread_replies_fetched:
            print(f"  ✗ LEAK DETECTED: Community replies already fetched!")
            continue

        policy.freeze_question(question)
        print(f"  ✓ Frozen fresh (state: {question.state.value})")

        # MIRA attempts
        attempt = mira_adapter.evaluate(question)
        policy.record_mira_attempt(attempt)
        print(f"  ✓ MIRA attempted (status: {attempt.answer_status})")
        print(f"    Answer: {attempt.mira_answer[:80]}...")
        print(f"    Citations: {len(attempt.mira_citations)}")

        # Reviewer A: Establish expected answer independently
        print(f"  → Reviewer A establishing expected answer...")
        verdict_a = reviewer_a.review(question, attempt)
        policy.record_review_a(verdict_a)
        print(
            f"  ✓ Reviewer A: {verdict_a.verdict} "
            f"(tech: {verdict_a.technical_correctness_score}/40, "
            f"safety: {verdict_a.safety_score}/20)"
        )

        # Reviewer B: Adversarial review
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
        print()

    # Complete mission
    mission.completed_at = datetime.utcnow().isoformat() + "Z"

    # Generate reports
    print("=" * 70)
    print("GENERATING REPORTS")
    print("=" * 70)
    print()

    report_data = generate_vcad_report(mission)

    # Console report
    console_report = format_console_report(report_data, mission)
    print(console_report)
    print()

    # Slack report
    print("=" * 70)
    print("SLACK REPORT (not auto-posted)")
    print("=" * 70)
    print()
    slack_report = format_slack_report(report_data, mission)
    print(slack_report)
    print()

    # Summary
    print("=" * 70)
    print("DRY RUN COMPLETE")
    print("=" * 70)
    print()
    print(f"Mission ID: {mission.mission_id}")
    print(f"VCAD: {mission.vcad}")
    print(f"Evaluated: {len(mission.scores)}")
    print()
    print("Next steps:")
    print("1. Run pytest: pytest mira-bots/foreman/agents/answer-radar/test_answer_radar.py")
    print("2. Set MIRA_API_URL to enable real MIRA evaluation")
    print("3. Configure Fleet Gateway to launch this mission via Foreman")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(run_dry_run())
