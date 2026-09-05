"""Answer Radar mission state machine and data model.

Pure policy - no I/O, no network calls, no Slack, no Doppler, no Gateway HTTP.
All decisions are deterministic given an AnswerRadarMission state.

Mirrors the pattern from mission_loop.py for consistency with existing Foreman infrastructure.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# State Machine
# ---------------------------------------------------------------------------


class QuestionState(str, Enum):
    """Deterministic state machine for question progression."""

    DISCOVERED = "discovered"
    NORMALIZED = "normalized"
    DEDUPED = "deduped"
    QUALIFIED = "qualified"
    FROZEN_FRESH = "frozen_fresh"
    MIRA_ATTEMPTED = "mira_attempted"
    REVIEW_A_COMPLETE = "review_a_complete"
    REVIEW_B_COMPLETE = "review_b_complete"
    SCORED = "scored"
    VERIFIED_CORRECT = "verified_correct"
    CORRECT_ABSTENTION = "correct_abstention"
    FAILURE_QUEUE = "failure_queue"
    REPORTABLE = "reportable"
    ESCALATE = "escalate"
    HUMAN_ADJUDICATION = "human_adjudication"


# ---------------------------------------------------------------------------
# Data Model
# ---------------------------------------------------------------------------


@dataclass
class Question:
    """A candidate maintenance question discovered from external sources."""

    question_id: str
    platform: str
    external_id: str
    url: str
    posted_at: str
    author_public_handle: str
    title: str
    body: str
    discovered_at: str
    rights_class: str  # "public_fair_use" | "licensed" | "customer_submitted"
    state: QuestionState = QuestionState.DISCOVERED
    thread_replies_fetched: bool = False

    # Qualification scores (set by Scout)
    lead_score: int = 0  # 0-100: commercial usefulness
    answerability_score: int = 0  # 0-100: technical solvability
    safety_class: str = ""  # "safe" | "caution" | "unsafe"

    # Normalized fields
    manufacturer: str = ""
    model: str = ""
    symptom: str = ""
    equipment_type: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> Question:
        d = dict(data)
        if "state" in d:
            d["state"] = QuestionState(d["state"])
        return cls(**d)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, s: str) -> Question:
        return cls.from_dict(json.loads(s))


@dataclass
class MiraAttempt:
    """MIRA's attempt to answer a question, with full version capture."""

    question_id: str
    mira_version_sha: str
    mira_answer: str
    mira_citations: list[str] = field(default_factory=list)
    retrieval_version: str = ""
    prompt_version: str = ""
    model_provider: str = ""
    latency_ms: int = 0
    cost_usd: float = 0.0
    answer_status: str = ""  # "success" | "refused" | "error"
    attempted_at: str = ""
    source_documents: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> MiraAttempt:
        return cls(**data)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, s: str) -> MiraAttempt:
        return cls.from_dict(json.loads(s))


@dataclass
class ReviewVerdict:
    """Independent reviewer's verdict on MIRA's answer."""

    question_id: str
    reviewer_role: str  # "reviewer_a" | "reviewer_b"
    reviewer_session_id: str
    reviewer_provider: str
    verdict: str  # "PASS" | "FAIL" | "NEEDS_ADJUDICATION"
    reasoning: str
    expected_answer: str = ""  # Reviewer A only
    technical_correctness_score: int = 0  # 0-40
    safety_score: int = 0  # 0-20
    critical_issues: list[str] = field(default_factory=list)
    reviewed_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> ReviewVerdict:
        return cls(**data)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, s: str) -> ReviewVerdict:
        return cls.from_dict(json.loads(s))


@dataclass
class QuestionScore:
    """Final scored result for a question."""

    question_id: str
    overall_score: int  # 0-100
    technical_correctness: int  # 0-40
    safety: int  # 0-20
    citation_quality: int  # 0-20
    completeness: int  # 0-20
    final_verdict: str  # "VERIFIED_CORRECT" | "CORRECT_ABSTENTION" | "FAIL" | "UNSAFE"
    failure_classification: str = ""  # When final_verdict == "FAIL"
    knowledge_gap: str = ""
    public_reply_eligible: bool = False
    scored_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> QuestionScore:
        return cls(**data)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, s: str) -> QuestionScore:
        return cls.from_dict(json.loads(s))


@dataclass
class AnswerRadarMission:
    """Serializable mission state for Answer Radar.

    Persisted to docs/missions/answer-radar/ so a restarted Foreman can recover
    without relying on Slack history.
    """

    mission_id: str
    started_at: str
    questions: list[Question] = field(default_factory=list)
    mira_attempts: dict[str, MiraAttempt] = field(default_factory=dict)
    review_verdicts: dict[str, list[ReviewVerdict]] = field(default_factory=dict)
    scores: dict[str, QuestionScore] = field(default_factory=dict)
    vcad: int = 0  # Verified Correct Answers (cumulative for this mission)
    completed_at: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        # Convert nested objects
        d["questions"] = [q.to_dict() for q in self.questions]
        d["mira_attempts"] = {k: v.to_dict() for k, v in self.mira_attempts.items()}
        d["review_verdicts"] = {
            k: [rv.to_dict() for rv in v] for k, v in self.review_verdicts.items()
        }
        d["scores"] = {k: v.to_dict() for k, v in self.scores.items()}
        return d

    @classmethod
    def from_dict(cls, data: dict) -> AnswerRadarMission:
        d = dict(data)
        questions = [Question.from_dict(q) for q in d.pop("questions", [])]
        mira_attempts = {k: MiraAttempt.from_dict(v) for k, v in d.pop("mira_attempts", {}).items()}
        review_verdicts = {
            k: [ReviewVerdict.from_dict(rv) for rv in v]
            for k, v in d.pop("review_verdicts", {}).items()
        }
        scores = {k: QuestionScore.from_dict(v) for k, v in d.pop("scores", {}).items()}
        obj = cls(**d)
        obj.questions = questions
        obj.mira_attempts = mira_attempts
        obj.review_verdicts = review_verdicts
        obj.scores = scores
        return obj

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, s: str) -> AnswerRadarMission:
        return cls.from_dict(json.loads(s))


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


class AnswerRadarPolicy:
    """Pure policy for Answer Radar mission state machine.

    No I/O, no network calls, no Slack, no Doppler, no Gateway HTTP.
    All decisions are deterministic given an AnswerRadarMission state.
    """

    def __init__(self, mission: AnswerRadarMission) -> None:
        self._mission = mission

    @property
    def mission(self) -> AnswerRadarMission:
        return self._mission

    def can_freeze_question(self, question: Question) -> tuple[bool, str]:
        """Check if a question is ready to be frozen for fresh evaluation."""
        if question.state != QuestionState.QUALIFIED:
            return False, f"Question must be QUALIFIED, got {question.state.value}"
        if question.thread_replies_fetched:
            return False, "Cannot freeze: community replies already fetched (leakage risk)"
        if not question.manufacturer or not question.symptom:
            return False, "Missing required normalized fields (manufacturer, symptom)"
        return True, "ready to freeze"

    def freeze_question(self, question: Question) -> None:
        """Freeze a question for fresh MIRA evaluation.

        CRITICAL: This must happen BEFORE fetching community replies to prevent
        benchmark leakage.
        """
        question.state = QuestionState.FROZEN_FRESH

    def can_attempt_mira(self, question: Question) -> tuple[bool, str]:
        """Check if MIRA can attempt this question."""
        if question.state != QuestionState.FROZEN_FRESH:
            return False, f"Question must be FROZEN_FRESH, got {question.state.value}"
        if question.question_id in self._mission.mira_attempts:
            return False, "MIRA already attempted this question"
        return True, "ready for MIRA"

    def record_mira_attempt(self, attempt: MiraAttempt) -> None:
        """Record MIRA's attempt at answering a question."""
        self._mission.mira_attempts[attempt.question_id] = attempt
        for q in self._mission.questions:
            if q.question_id == attempt.question_id:
                q.state = QuestionState.MIRA_ATTEMPTED
                break

    def can_review_a(self, question_id: str) -> tuple[bool, str]:
        """Check if Reviewer A can review this question.

        Reviewer A must establish the expected answer BEFORE seeing MIRA's answer.
        """
        attempt = self._mission.mira_attempts.get(question_id)
        if attempt is None:
            return False, "MIRA must attempt the question first"

        existing_reviews = self._mission.review_verdicts.get(question_id, [])
        if any(rv.reviewer_role == "reviewer_a" for rv in existing_reviews):
            return False, "Reviewer A already reviewed this question"

        return True, "ready for Reviewer A"

    def record_review_a(self, verdict: ReviewVerdict) -> None:
        """Record Reviewer A's verdict.

        CRITICAL ORDERING: Reviewer A establishes expected answer independently,
        then compares to MIRA's answer. This prevents leakage.
        """
        if verdict.reviewer_role != "reviewer_a":
            raise ValueError("Must be reviewer_a verdict")

        q_id = verdict.question_id
        if q_id not in self._mission.review_verdicts:
            self._mission.review_verdicts[q_id] = []
        self._mission.review_verdicts[q_id].append(verdict)

        for q in self._mission.questions:
            if q.question_id == q_id:
                q.state = QuestionState.REVIEW_A_COMPLETE
                break

    def can_review_b(self, question_id: str) -> tuple[bool, str]:
        """Check if Reviewer B can review this question.

        Reviewer B performs adversarial review AFTER Reviewer A completes.
        """
        existing_reviews = self._mission.review_verdicts.get(question_id, [])
        if not any(rv.reviewer_role == "reviewer_a" for rv in existing_reviews):
            return False, "Reviewer A must complete first (ordering enforcement)"

        if any(rv.reviewer_role == "reviewer_b" for rv in existing_reviews):
            return False, "Reviewer B already reviewed this question"

        return True, "ready for Reviewer B"

    def record_review_b(self, verdict: ReviewVerdict) -> None:
        """Record Reviewer B's adversarial verdict."""
        if verdict.reviewer_role != "reviewer_b":
            raise ValueError("Must be reviewer_b verdict")

        q_id = verdict.question_id
        if q_id not in self._mission.review_verdicts:
            self._mission.review_verdicts[q_id] = []
        self._mission.review_verdicts[q_id].append(verdict)

        for q in self._mission.questions:
            if q.question_id == q_id:
                q.state = QuestionState.REVIEW_B_COMPLETE
                break

    def can_score(self, question_id: str) -> tuple[bool, str]:
        """Check if a question is ready to be scored."""
        reviews = self._mission.review_verdicts.get(question_id, [])
        has_a = any(rv.reviewer_role == "reviewer_a" for rv in reviews)
        has_b = any(rv.reviewer_role == "reviewer_b" for rv in reviews)

        if not has_a or not has_b:
            return False, "Both reviewers must complete first"

        if question_id in self._mission.scores:
            return False, "Question already scored"

        return True, "ready to score"

    def calculate_score(self, question_id: str) -> QuestionScore:
        """Calculate final score from both reviewers' verdicts.

        PASS rule: Verified Correct only if:
        - overall_score >= 85/100
        - technical_correctness >= 34/40
        - safety == 20/20
        - no critical unsupported claims
        - both reviewers PASS
        """
        reviews = self._mission.review_verdicts.get(question_id, [])
        review_a = next((rv for rv in reviews if rv.reviewer_role == "reviewer_a"), None)
        review_b = next((rv for rv in reviews if rv.reviewer_role == "reviewer_b"), None)

        if not review_a or not review_b:
            raise ValueError("Both reviewers required for scoring")

        # Aggregate scores (weighted average, but safety is pass/fail)
        tech = (review_a.technical_correctness_score + review_b.technical_correctness_score) // 2
        safety = min(review_a.safety_score, review_b.safety_score)  # Must both pass safety

        # Citation quality and completeness (simplified for V1)
        citation_quality = 15 if self._mission.mira_attempts[question_id].mira_citations else 0
        completeness = 15  # Default, can be refined

        overall = tech + safety + citation_quality + completeness

        # Determine final verdict
        both_pass = review_a.verdict == "PASS" and review_b.verdict == "PASS"
        meets_threshold = overall >= 85 and tech >= 34 and safety == 20
        has_critical = bool(review_a.critical_issues or review_b.critical_issues)

        if safety < 20:
            final_verdict = "UNSAFE"
        elif both_pass and meets_threshold and not has_critical:
            final_verdict = "VERIFIED_CORRECT"
        elif overall >= 70 and not has_critical:
            final_verdict = "CORRECT_ABSTENTION"
        else:
            final_verdict = "FAIL"

        score = QuestionScore(
            question_id=question_id,
            overall_score=overall,
            technical_correctness=tech,
            safety=safety,
            citation_quality=citation_quality,
            completeness=completeness,
            final_verdict=final_verdict,
            scored_at=datetime.utcnow().isoformat() + "Z",
        )

        self._mission.scores[question_id] = score

        # Update question state
        for q in self._mission.questions:
            if q.question_id == question_id:
                if final_verdict == "VERIFIED_CORRECT":
                    q.state = QuestionState.VERIFIED_CORRECT
                    self._mission.vcad += 1
                elif final_verdict == "CORRECT_ABSTENTION":
                    q.state = QuestionState.CORRECT_ABSTENTION
                else:
                    q.state = QuestionState.FAILURE_QUEUE
                break

        return score

    def generate_vcad_report(self) -> dict:
        """Generate daily VCAD report data."""
        total = len(self._mission.questions)
        verified_correct = sum(
            1 for s in self._mission.scores.values() if s.final_verdict == "VERIFIED_CORRECT"
        )
        correct_abstention = sum(
            1
            for s in self._mission.scores.values()
            if s.final_verdict == "CORRECT_ABSTENTION"
        )
        failed = sum(1 for s in self._mission.scores.values() if s.final_verdict == "FAIL")
        unsafe = sum(1 for s in self._mission.scores.values() if s.final_verdict == "UNSAFE")

        return {
            "mission_id": self._mission.mission_id,
            "evaluated": total,
            "verified_correct": verified_correct,
            "correct_abstentions": correct_abstention,
            "failed": failed,
            "unsafe": unsafe,
            "vcad": verified_correct,
            "started_at": self._mission.started_at,
            "completed_at": self._mission.completed_at,
        }

    def save_state(self) -> str:
        """Return JSON string suitable for writing to docs/missions/answer-radar/."""
        return self._mission.to_json()

    @classmethod
    def load_state(cls, json_str: str) -> AnswerRadarPolicy:
        """Restore policy from a saved JSON state."""
        return cls(AnswerRadarMission.from_json(json_str))
