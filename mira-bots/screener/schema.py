"""Data models for MIRA interaction screener.

Schema derived from:
  - Amazon Lex: intent confidence thresholds, slot fill, session outcomes
  - Amazon Connect Contact Lens: sentiment -5→+5, frustration signals, non-talk time
  - Dialogflow CX: containment rate, FSM progress rate, escalation labels
  - Rasa CDD: annotation schema, fix category taxonomy
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

# Amazon Lex-inspired confidence mapping (string → 0.0–1.0 float)
CONFIDENCE_MAP: dict[str, float] = {
    "high": 0.90,
    "medium": 0.65,
    "low": 0.40,
    "none": 0.10,
    "": 0.10,
}

# Thresholds (Contact Lens + Dialogflow CX inspired)
LATENCY_P95_THRESHOLD_MS = 5_000
FSM_LOOP_THRESHOLD = 3       # same state N consecutive turns → loop
REPETITION_RATIO = 0.70      # Levenshtein-style similarity for repetition detection
MISSING_SLOTS_MIN_EXCHANGES = 6
LOW_CONFIDENCE_TURN_RATIO = 0.50  # >50% turns low/none → persistent
HALLUCINATION_FAST_THRESHOLD_MS = 800  # fast + none confidence = likely no RAG hit

FIX_CATEGORIES = Literal[
    "nlu_training",
    "fsm_redesign",
    "guardrail_rule",
    "benchmark_case",
    "rag_tuning",
    "prompt_edit",
    "threshold_adjustment",
]

SESSION_OUTCOMES = Literal["resolved", "abandoned", "escalated", "loop", "invalid"]

SEVERITY = Literal["P0", "P1", "P2", "P3"]


@dataclass
class TurnQuality:
    """Per-turn quality record built from the interactions table or NDJSON."""

    turn_id: int
    chat_id: str
    timestamp: datetime
    user_message: str
    bot_response: str
    fsm_state: str
    intent: str
    confidence_raw: str       # "high"|"medium"|"low"|"none"
    confidence_numeric: float  # mapped via CONFIDENCE_MAP
    response_time_ms: int
    has_photo: bool

    # Computed signals (set by Scorer)
    repetition_detected: bool = False   # similar to previous user message
    frustration_signal: bool = False    # short/negating reply after bot question
    fsm_advanced: bool = False          # state changed vs previous turn


@dataclass
class QualityFlag:
    """A detected quality problem in a session."""

    code: str
    severity: SEVERITY
    description: str
    turns_affected: list[int] = field(default_factory=list)


@dataclass
class SessionQuality:
    """Session-level quality record (Amazon Lex / Contact Lens / Dialogflow CX schema)."""

    session_id: str            # "{chat_id}:{started_at.isoformat()}"
    chat_id: str
    platform: str
    started_at: datetime
    ended_at: datetime | None
    total_turns: int

    # Dialogflow CX outcome labels
    outcome: SESSION_OUTCOMES

    # Dialogflow CX: containment rate (1.0 = fully bot-resolved)
    containment_rate: float

    # Dialogflow CX: proportion of turns that advanced FSM state
    fsm_progress_rate: float

    # Amazon Lex: average intent confidence (numeric)
    avg_confidence: float

    # Rasa CDD: repeat-question detection
    repetition_count: int

    # Amazon Contact Lens: frustration level
    frustration_level: Literal["low", "medium", "high"]

    # Latency metrics
    avg_response_time_ms: int
    p95_response_time_ms: int

    # Amazon Lex: slot fill success proxy (asset_identified + fault_category set)
    slot_fill_success: bool

    # From existing judge.py
    judge_scores: dict | None

    # From feedback_log
    feedback_rating: str | None

    quality_flags: list[QualityFlag] = field(default_factory=list)


@dataclass
class FixProposal:
    """A concrete, diff-level fix proposal for a quality flag.

    fix_category maps to the exact file/function that needs changing.
    proposed_change is specific enough to guide an Edit tool call.
    """

    flag_code: str
    fix_category: str
    severity: SEVERITY
    title: str
    description: str
    affected_file: str
    proposed_change: str  # specific: line references + what to add/change
    confidence: float     # 0.0–1.0: how likely this fix resolves the flag
