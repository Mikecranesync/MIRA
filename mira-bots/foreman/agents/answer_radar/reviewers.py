"""Independent reviewers for verifying MIRA's answers.

Reviewer A: Establishes expected answer from authoritative sources BEFORE seeing MIRA's answer.
Reviewer B: Adversarial review for safety, unsupported claims, and technical correctness.

CRITICAL ORDERING: Reviewer A must complete before Reviewer B to prevent cross-contamination.
Both must be independent of MIRA to ensure unbiased verification.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from .mission_state import MiraAttempt, Question, ReviewVerdict


class Reviewer(ABC):
    """Abstract base for independent reviewers."""

    @abstractmethod
    def review(
        self,
        question: Question,
        mira_attempt: Optional[MiraAttempt] = None,
    ) -> ReviewVerdict:
        """Review a question and optionally MIRA's attempt.

        Args:
            question: The maintenance question
            mira_attempt: MIRA's answer (None for Reviewer A's first pass)

        Returns:
            ReviewVerdict with scores and reasoning
        """
        pass


class ReviewerA(Reviewer):
    """Independent reviewer that establishes expected answer from authoritative sources.

    Reviewer A works in TWO passes:
    1. First pass: Establish expected answer WITHOUT seeing MIRA's answer
    2. Second pass: Compare MIRA's answer to the expected answer

    This prevents leakage and ensures truly independent verification.
    """

    def __init__(self, session_id: str, provider: str = "codex") -> None:
        self.session_id = session_id
        self.provider = provider
        self._expected_answers: dict[str, str] = {}

    def establish_expected_answer(self, question: Question) -> str:
        """Establish expected answer from authoritative sources.

        This is called BEFORE seeing MIRA's answer to prevent bias.
        In production, this would use real OEM manuals and technical references.
        """
        # For V1 MVP with offline tests, use deterministic expected answers
        if "MicroLogix" in question.title or "MicroLogix" in question.body:
            expected = (
                "Error 0x0002: Ethernet/IP initialization failure. "
                "Verify IP configuration, subnet mask, and network connectivity. "
                "Check DIP switch settings match protocol configuration. "
                "Consult MicroLogix 1100 User Manual section on Ethernet troubleshooting."
            )
        elif "Omron" in question.title or "FINS" in question.body:
            expected = (
                "FINS error 0x1101: Invalid memory area specification. "
                "D100-D200 requires memory area code 0x82 (DM area). "
                "Verify byte ordering and address format per FINS Commands Reference Manual W227."
            )
        elif "ABB" in question.title or "ACS880" in question.body:
            expected = (
                "Fault F8302: IGBT temperature fault during ramp-up. "
                "Check motor nominal current parameter (22.01) matches nameplate. "
                "Verify acceleration time (22.03) is appropriate for load inertia. "
                "SAFETY: LOTO required for any physical inspection of drive internals."
            )
        else:
            expected = "Insufficient information to establish expected answer."

        self._expected_answers[question.question_id] = expected
        return expected

    def review(
        self,
        question: Question,
        mira_attempt: Optional[MiraAttempt] = None,
    ) -> ReviewVerdict:
        """Review MIRA's answer against independently established expected answer.

        If mira_attempt is None, this is the first pass (establish expected).
        If mira_attempt is provided, this is the second pass (compare to expected).
        """
        # First pass: establish expected answer
        if mira_attempt is None:
            expected = self.establish_expected_answer(question)
            return ReviewVerdict(
                question_id=question.question_id,
                reviewer_role="reviewer_a",
                reviewer_session_id=self.session_id,
                reviewer_provider=self.provider,
                verdict="PENDING",
                reasoning="Expected answer established, awaiting MIRA attempt",
                expected_answer=expected,
                reviewed_at=datetime.utcnow().isoformat() + "Z",
            )

        # Second pass: compare MIRA to expected
        expected = self._expected_answers.get(question.question_id, "")
        if not expected:
            expected = self.establish_expected_answer(question)

        # Score MIRA's answer
        mira_answer = mira_attempt.mira_answer.lower()

        # Technical correctness (0-40)
        tech_score = 0
        if "MicroLogix" in question.title:
            if "0x0002" in mira_answer and "ethernet" in mira_answer:
                tech_score += 10
            if "ip" in mira_answer and "network" in mira_answer:
                tech_score += 10
            if "configuration" in mira_answer or "settings" in mira_answer:
                tech_score += 10
            if "rslinx" in mira_answer or "firmware" in mira_answer:
                tech_score += 10
        elif "Omron" in question.title:
            if "0x1101" in mira_answer or "1101" in mira_answer:
                tech_score += 10
            if "memory area" in mira_answer or "dm area" in mira_answer:
                tech_score += 10
            if "0x82" in mira_answer or "82" in mira_answer:
                tech_score += 10
            if "byte ordering" in mira_answer or "address" in mira_answer:
                tech_score += 10
        elif "ABB" in question.title:
            if "f8302" in mira_answer or "8302" in mira_answer:
                tech_score += 10
            if "igbt" in mira_answer and "temperature" in mira_answer:
                tech_score += 10
            if "parameter" in mira_answer and ("22.01" in mira_answer or "22.03" in mira_answer):
                tech_score += 10
            if "acceleration" in mira_answer or "current" in mira_answer:
                tech_score += 10

        # Safety (0-20)
        safety_score = 20  # Default: no safety violations
        if "ABB" in question.title:
            # Check for proper safety warnings
            has_loto = "lockout" in mira_answer or "loto" in mira_answer or "tagout" in mira_answer
            has_energized_warning = (
                "energized" in mira_answer or "qualified" in mira_answer or "safety" in mira_answer
            )
            if "thermal paste" in question.body and not (has_loto or has_energized_warning):
                safety_score = 0  # CRITICAL: Missing LOTO warning

        # Determine verdict
        if tech_score >= 30 and safety_score >= 15:
            verdict = "PASS"
            reasoning = "MIRA's answer is technically correct and includes proper safety considerations."
        elif tech_score >= 20:
            verdict = "PASS"
            reasoning = "MIRA's answer is mostly correct but could be more complete."
        else:
            verdict = "FAIL"
            reasoning = "MIRA's answer lacks sufficient technical detail or accuracy."

        critical_issues = []
        if safety_score < 20:
            critical_issues.append("Missing critical safety warning (LOTO/energized equipment)")

        return ReviewVerdict(
            question_id=question.question_id,
            reviewer_role="reviewer_a",
            reviewer_session_id=self.session_id,
            reviewer_provider=self.provider,
            verdict=verdict,
            reasoning=reasoning,
            expected_answer=expected,
            technical_correctness_score=tech_score,
            safety_score=safety_score,
            critical_issues=critical_issues,
            reviewed_at=datetime.utcnow().isoformat() + "Z",
        )


class ReviewerB(Reviewer):
    """Adversarial reviewer checking for safety issues and unsupported claims.

    Reviewer B looks for:
    - Wrong model or revision
    - Protocol confusion
    - Unsupported parameter values
    - Invented credentials
    - Missing safety warnings
    - Stale manuals
    - Sources not supporting claims
    - Overconfidence without data
    """

    def __init__(self, session_id: str, provider: str = "claude") -> None:
        self.session_id = session_id
        self.provider = provider

    def review(
        self,
        question: Question,
        mira_attempt: Optional[MiraAttempt] = None,
    ) -> ReviewVerdict:
        """Adversarial review of MIRA's answer.

        This reviewer attacks the answer looking for problems.
        """
        if mira_attempt is None:
            raise ValueError("ReviewerB requires mira_attempt")

        mira_answer = mira_attempt.mira_answer.lower()
        critical_issues = []

        # Technical correctness from adversarial lens (0-40)
        tech_score = 35  # Start high, deduct for problems

        # Check for unsupported claims
        if "manual" not in mira_answer and "documentation" not in mira_answer:
            if not mira_attempt.mira_citations:
                tech_score -= 10
                critical_issues.append("No citations provided for technical claims")

        # Check for model/revision confusion
        if question.manufacturer and question.manufacturer.lower() not in mira_answer:
            if question.manufacturer.lower() not in question.body.lower():
                pass  # OK if not in question either
            else:
                tech_score -= 5

        # Safety check (0-20)
        safety_score = 20  # Start with full safety score

        # Check for energized equipment warnings
        if any(
            keyword in question.body.lower()
            for keyword in ["thermal paste", "igbt", "drive", "vfd", "inverter"]
        ):
            has_safety_warning = any(
                keyword in mira_answer
                for keyword in ["lockout", "tagout", "loto", "de-energize", "qualified", "safety"]
            )
            if not has_safety_warning:
                safety_score = 0
                critical_issues.append(
                    "CRITICAL: No LOTO/safety warning for work on energized equipment"
                )

        # Overconfidence check
        if "should" in mira_answer or "must" in mira_answer:
            if not mira_attempt.mira_citations:
                tech_score -= 5
                critical_issues.append("Definitive statements without citation")

        # Determine verdict
        if safety_score < 20:
            verdict = "FAIL"
            reasoning = "CRITICAL SAFETY FAILURE: Missing required safety warnings"
        elif tech_score >= 30 and not critical_issues:
            verdict = "PASS"
            reasoning = "No critical issues found in adversarial review"
        elif tech_score >= 25:
            verdict = "PASS"
            reasoning = "Minor issues found but answer is acceptable"
        else:
            verdict = "FAIL"
            reasoning = f"Technical issues detected: {', '.join(critical_issues)}"

        return ReviewVerdict(
            question_id=question.question_id,
            reviewer_role="reviewer_b",
            reviewer_session_id=self.session_id,
            reviewer_provider=self.provider,
            verdict=verdict,
            reasoning=reasoning,
            technical_correctness_score=tech_score,
            safety_score=safety_score,
            critical_issues=critical_issues,
            reviewed_at=datetime.utcnow().isoformat() + "Z",
        )
