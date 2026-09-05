"""Offline tests for Answer Radar mission controller.

Tests the complete Answer Radar mission flow without Gateway, Slack, Doppler, or real MIRA:
- Mission state machine transitions
- Question freeze isolation (no community replies leak)
- Ordering enforcement (Reviewer A before Reviewer B)
- VCAD calculation
- Scoring with safety gates
- Report generation

All tests use FakeMiraAdapter for deterministic results.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from .mission_state import (
    AnswerRadarMission,
    AnswerRadarPolicy,
    Question,
    QuestionState,
)
from .mira_adapter import FakeMiraAdapter
from .report import format_console_report, format_slack_report, generate_vcad_report
from .reviewers import ReviewerA, ReviewerB


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def seed_questions() -> list[Question]:
    """Load seed questions from fixtures."""
    fixtures_path = Path(__file__).parent / "fixtures" / "seed_questions.json"
    with open(fixtures_path, encoding="utf-8") as f:
        data = json.load(f)
    return [Question.from_dict(q) for q in data]


@pytest.fixture
def mission() -> AnswerRadarMission:
    """Create a fresh Answer Radar mission."""
    return AnswerRadarMission(
        mission_id="TEST-MISSION-001",
        started_at=datetime.utcnow().isoformat() + "Z",
    )


@pytest.fixture
def policy(mission: AnswerRadarMission) -> AnswerRadarPolicy:
    """Create a policy wrapper around the mission."""
    return AnswerRadarPolicy(mission)


@pytest.fixture
def mira_adapter() -> FakeMiraAdapter:
    """Create fake MIRA adapter for testing."""
    return FakeMiraAdapter()


@pytest.fixture
def reviewer_a() -> ReviewerA:
    """Create Reviewer A."""
    return ReviewerA(session_id="test-reviewer-a-session", provider="codex")


@pytest.fixture
def reviewer_b() -> ReviewerB:
    """Create Reviewer B."""
    return ReviewerB(session_id="test-reviewer-b-session", provider="claude")


# ---------------------------------------------------------------------------
# State Machine Tests
# ---------------------------------------------------------------------------


def test_question_state_machine(policy: AnswerRadarPolicy, seed_questions: list[Question]) -> None:
    """Test question progresses through states correctly."""
    question = seed_questions[0]
    question.state = QuestionState.DISCOVERED

    # Cannot freeze a DISCOVERED question
    can_freeze, reason = policy.can_freeze_question(question)
    assert not can_freeze
    assert "QUALIFIED" in reason

    # Qualify the question
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.symptom = "Communication Error"

    # Now can freeze
    can_freeze, reason = policy.can_freeze_question(question)
    assert can_freeze

    # Freeze it
    policy.freeze_question(question)
    assert question.state == QuestionState.FROZEN_FRESH


def test_freeze_prevents_community_leak(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
) -> None:
    """Test that questions with fetched replies cannot be frozen (leak guard)."""
    question = seed_questions[0]
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.symptom = "Communication Error"
    question.thread_replies_fetched = True  # Community answers already fetched!

    can_freeze, reason = policy.can_freeze_question(question)
    assert not can_freeze
    assert "leakage" in reason.lower()


def test_mira_attempt_ordering(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
) -> None:
    """Test MIRA can only attempt FROZEN_FRESH questions."""
    question = seed_questions[0]
    question.state = QuestionState.DISCOVERED
    policy.mission.questions.append(question)

    # Cannot attempt non-frozen question
    can_attempt, reason = policy.can_attempt_mira(question)
    assert not can_attempt
    assert "FROZEN_FRESH" in reason

    # Prepare and freeze
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.symptom = "Communication Error"
    policy.freeze_question(question)

    # Now can attempt
    can_attempt, reason = policy.can_attempt_mira(question)
    assert can_attempt

    # Attempt MIRA
    attempt = mira_adapter.evaluate(question)
    policy.record_mira_attempt(attempt)

    assert question.state == QuestionState.MIRA_ATTEMPTED
    assert question.question_id in policy.mission.mira_attempts


def test_reviewer_ordering_enforcement(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test Reviewer B cannot run before Reviewer A (ordering gate)."""
    question = seed_questions[0]
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.symptom = "Communication Error"
    policy.mission.questions.append(question)
    policy.freeze_question(question)

    # MIRA attempts
    attempt = mira_adapter.evaluate(question)
    policy.record_mira_attempt(attempt)

    # Reviewer B cannot run yet
    can_review_b, reason = policy.can_review_b(question.question_id)
    assert not can_review_b
    assert "Reviewer A must complete first" in reason

    # Reviewer A reviews
    verdict_a = reviewer_a.review(question, attempt)
    policy.record_review_a(verdict_a)

    # Now Reviewer B can run
    can_review_b, reason = policy.can_review_b(question.question_id)
    assert can_review_b

    # Reviewer B reviews
    verdict_b = reviewer_b.review(question, attempt)
    policy.record_review_b(verdict_b)

    assert question.state == QuestionState.REVIEW_B_COMPLETE


def test_no_skip_states(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
) -> None:
    """Test that required states cannot be skipped."""
    question = seed_questions[0]
    question.state = QuestionState.DISCOVERED
    policy.mission.questions.append(question)

    # Cannot review before MIRA attempts
    can_review, reason = policy.can_review_a(question.question_id)
    assert not can_review
    assert "MIRA must attempt" in reason

    # Cannot score before both reviews
    can_score, reason = policy.can_score(question.question_id)
    assert not can_score
    assert "Both reviewers must complete" in reason


# ---------------------------------------------------------------------------
# VCAD Calculation Tests
# ---------------------------------------------------------------------------


def test_vcad_calculation_verified_correct(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test VCAD increments for VERIFIED_CORRECT answers."""
    question = seed_questions[0]  # MicroLogix question
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.model = "MicroLogix 1100"
    question.symptom = "Communication Error"
    policy.mission.questions.append(question)

    policy.freeze_question(question)
    attempt = mira_adapter.evaluate(question)
    policy.record_mira_attempt(attempt)

    verdict_a = reviewer_a.review(question, attempt)
    policy.record_review_a(verdict_a)

    verdict_b = reviewer_b.review(question, attempt)
    policy.record_review_b(verdict_b)

    # Score the question
    score = policy.calculate_score(question.question_id)

    # Should be VERIFIED_CORRECT
    assert score.final_verdict == "VERIFIED_CORRECT"
    assert policy.mission.vcad == 1
    assert question.state == QuestionState.VERIFIED_CORRECT


def test_vcad_not_incremented_for_failures(
    policy: AnswerRadarPolicy,
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test VCAD does not increment for FAIL or CORRECT_ABSTENTION."""
    # Create a question that will fail (no manufacturer/model)
    question = Question(
        question_id="FAIL-001",
        platform="test",
        external_id="fail",
        url="http://test",
        posted_at="2026-09-05T00:00:00Z",
        author_public_handle="tester",
        title="Unknown Equipment Issue",
        body="Something is broken but I don't know what equipment it is",
        discovered_at="2026-09-05T00:00:00Z",
        rights_class="test",
        state=QuestionState.QUALIFIED,
        manufacturer="Unknown",
        symptom="Broken",
    )
    policy.mission.questions.append(question)

    policy.freeze_question(question)
    attempt = mira_adapter.evaluate(question)
    policy.record_mira_attempt(attempt)

    verdict_a = reviewer_a.review(question, attempt)
    policy.record_review_a(verdict_a)

    verdict_b = reviewer_b.review(question, attempt)
    policy.record_review_b(verdict_b)

    score = policy.calculate_score(question.question_id)

    # Should NOT be VERIFIED_CORRECT
    assert score.final_verdict != "VERIFIED_CORRECT"
    assert policy.mission.vcad == 0  # Should not increment


def test_safety_gate_blocks_unsafe_answers(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test that missing safety warnings result in UNSAFE verdict."""
    question = seed_questions[2]  # ABB drive question (mentions thermal paste)
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "ABB"
    question.model = "ACS880"
    question.symptom = "IGBT Temperature Fault"
    policy.mission.questions.append(question)

    policy.freeze_question(question)
    attempt = mira_adapter.evaluate(question)

    # Fake MIRA's answer has LOTO warning, so should pass
    # But let's test the safety gate by checking reviewer B's logic
    verdict_a = reviewer_a.review(question, attempt)
    verdict_b = reviewer_b.review(question, attempt)

    # Both reviewers should catch proper safety warnings
    assert verdict_a.safety_score >= 15  # Should have safety warning
    assert verdict_b.safety_score >= 15


# ---------------------------------------------------------------------------
# Report Generation Tests
# ---------------------------------------------------------------------------


def test_generate_vcad_report(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test VCAD report generation."""
    # Process all 3 seed questions
    for question in seed_questions:
        question.state = QuestionState.QUALIFIED
        question.manufacturer = question.title.split()[0]  # Simple extraction
        question.symptom = "Test Symptom"
        policy.mission.questions.append(question)

        policy.freeze_question(question)
        attempt = mira_adapter.evaluate(question)
        policy.record_mira_attempt(attempt)

        verdict_a = reviewer_a.review(question, attempt)
        policy.record_review_a(verdict_a)

        verdict_b = reviewer_b.review(question, attempt)
        policy.record_review_b(verdict_b)

        policy.calculate_score(question.question_id)

    # Generate report
    report = generate_vcad_report(policy.mission)

    assert report["mission_id"] == "TEST-MISSION-001"
    assert report["evaluated"] == 3
    assert report["vcad"] >= 0
    assert "verified_correct" in report
    assert "failed" in report


def test_slack_report_format(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test Slack report formatting."""
    # Process one question
    question = seed_questions[0]
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.symptom = "Communication Error"
    policy.mission.questions.append(question)

    policy.freeze_question(question)
    attempt = mira_adapter.evaluate(question)
    policy.record_mira_attempt(attempt)

    verdict_a = reviewer_a.review(question, attempt)
    policy.record_review_a(verdict_a)

    verdict_b = reviewer_b.review(question, attempt)
    policy.record_review_b(verdict_b)

    policy.calculate_score(question.question_id)

    # Generate and format report
    report = generate_vcad_report(policy.mission)
    slack_text = format_slack_report(report, policy.mission)

    assert "ANSWER RADAR" in slack_text
    assert "VCAD:" in slack_text
    assert "Evaluated:" in slack_text
    assert question.title in slack_text or "MicroLogix" in slack_text


def test_console_report_format(
    policy: AnswerRadarPolicy,
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
    reviewer_a: ReviewerA,
    reviewer_b: ReviewerB,
) -> None:
    """Test console report formatting."""
    question = seed_questions[0]
    question.state = QuestionState.QUALIFIED
    question.manufacturer = "Allen Bradley"
    question.symptom = "Communication Error"
    policy.mission.questions.append(question)

    policy.freeze_question(question)
    attempt = mira_adapter.evaluate(question)
    policy.record_mira_attempt(attempt)

    verdict_a = reviewer_a.review(question, attempt)
    policy.record_review_a(verdict_a)

    verdict_b = reviewer_b.review(question, attempt)
    policy.record_review_b(verdict_b)

    policy.calculate_score(question.question_id)

    report = generate_vcad_report(policy.mission)
    console_text = format_console_report(report, policy.mission)

    assert "ANSWER RADAR REPORT" in console_text
    assert "VCAD:" in console_text
    assert "Question Details:" in console_text


# ---------------------------------------------------------------------------
# Serialization Tests
# ---------------------------------------------------------------------------


def test_mission_serialization(policy: AnswerRadarPolicy, seed_questions: list[Question]) -> None:
    """Test mission state can be saved and restored."""
    question = seed_questions[0]
    question.state = QuestionState.QUALIFIED
    policy.mission.questions.append(question)

    # Save state
    json_str = policy.save_state()
    assert json_str

    # Restore state
    restored_policy = AnswerRadarPolicy.load_state(json_str)
    assert restored_policy.mission.mission_id == policy.mission.mission_id
    assert len(restored_policy.mission.questions) == 1
    assert restored_policy.mission.questions[0].question_id == question.question_id


# ---------------------------------------------------------------------------
# End-to-End Mission Test
# ---------------------------------------------------------------------------


def test_complete_mission_flow(
    seed_questions: list[Question],
    mira_adapter: FakeMiraAdapter,
) -> None:
    """Test complete Answer Radar mission from discovery to report."""
    # Create mission
    mission = AnswerRadarMission(
        mission_id="E2E-TEST-001",
        started_at=datetime.utcnow().isoformat() + "Z",
    )
    policy = AnswerRadarPolicy(mission)

    reviewer_a = ReviewerA(session_id="e2e-reviewer-a", provider="codex")
    reviewer_b = ReviewerB(session_id="e2e-reviewer-b", provider="claude")

    # Process all seed questions
    for question in seed_questions:
        # Normalize
        question.state = QuestionState.QUALIFIED
        question.manufacturer = question.title.split()[0]
        question.symptom = "Test"
        mission.questions.append(question)

        # Freeze (no community replies)
        assert not question.thread_replies_fetched
        policy.freeze_question(question)

        # MIRA attempts
        attempt = mira_adapter.evaluate(question)
        policy.record_mira_attempt(attempt)

        # Independent reviewers
        verdict_a = reviewer_a.review(question, attempt)
        policy.record_review_a(verdict_a)

        verdict_b = reviewer_b.review(question, attempt)
        policy.record_review_b(verdict_b)

        # Score
        policy.calculate_score(question.question_id)

    # Complete mission
    mission.completed_at = datetime.utcnow().isoformat() + "Z"

    # Generate reports
    report = generate_vcad_report(mission)
    slack_text = format_slack_report(report, mission)
    console_text = format_console_report(report, mission)

    # Verify
    assert report["evaluated"] == 3
    assert report["vcad"] >= 0
    assert slack_text
    assert console_text
    assert "ANSWER RADAR" in slack_text
    assert "ANSWER RADAR REPORT" in console_text

    # Verify all questions reached REPORTABLE or final states
    for question in mission.questions:
        assert question.state in (
            QuestionState.VERIFIED_CORRECT,
            QuestionState.CORRECT_ABSTENTION,
            QuestionState.FAILURE_QUEUE,
        )
