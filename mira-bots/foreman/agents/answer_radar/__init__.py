"""Answer Radar — Autonomous mission to evaluate and improve MIRA's answers.

This module implements the Answer Radar mission controller for FactoryLM Foreman.
It discovers, evaluates, and scores real industrial maintenance questions through MIRA,
using independent reviewers to verify correctness.

Architecture:
    Discover → Freeze → Qualify → Test MIRA → Verify → Score → Report

Mission State Machine:
    DISCOVERED → NORMALIZED → DEDUPED → QUALIFIED → FROZEN_FRESH →
    MIRA_ATTEMPTED → REVIEW_A_COMPLETE → REVIEW_B_COMPLETE →
    SCORED → REPORTABLE

Primary Metric:
    VCAD (Verified Correct Answers per Day)

Owner: FactoryLM Foreman / Grokbot
System Under Test: MIRA
"""

from __future__ import annotations

__all__ = [
    "QuestionState",
    "Question",
    "MiraAttempt",
    "ReviewVerdict",
    "QuestionScore",
    "AnswerRadarMission",
    "AnswerRadarPolicy",
]

from .mission_state import (
    AnswerRadarMission,
    AnswerRadarPolicy,
    MiraAttempt,
    Question,
    QuestionScore,
    QuestionState,
    ReviewVerdict,
)
