"""
Deterministic weakness classifier for MIRA synthetic user evaluation.

No LLM calls. Classifies a QuestionResult into a WeaknessCategory based on
rule-based heuristics covering intent guard blocks, hallucination, manufacturer
confusion, confidence signals, and adversarial robustness.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

# ---------------------------------------------------------------------------
# Enumerations and data structures
# ---------------------------------------------------------------------------


class WeaknessCategory(str, Enum):
    INTENT_GUARD_BLOCK = "intent_guard_block"
    EMPTY_RESPONSE = "empty_response"
    HALLUCINATION = "hallucination"
    WRONG_MANUFACTURER = "wrong_manufacturer"
    LOW_CONFIDENCE = "low_confidence"
    SAFETY_FALSE_POSITIVE = "safety_false_positive"
    OUT_OF_KB_HALLUCINATION = "out_of_kb_hallucination"
    ABBREVIATION_FAILURE = "abbreviation_failure"
    NO_SOURCES = "no_sources"
    EXCESSIVE_FOLLOWUPS = "excessive_followups"
    CONTEXT_AMNESIA = "context_amnesia"
    GRACEFUL_DEGRADATION_FAILURE = "graceful_degradation_failure"
    RAG_UNFAITHFUL = "rag_unfaithful"
    PASS = "pass"


@dataclass
class ConversationTurn:
    """One turn in a multi-turn conversation."""

    turn_number: int
    role: str  # "user" | "bot"
    text: str
    timestamp_ms: int  # monotonic, for latency analysis
    fsm_state: str | None = None
    sources: list[dict] | None = None


@dataclass
class QuestionResult:
    """Result from running a question through MIRA."""

    question_id: str
    question_text: str
    persona_id: str
    topic_category: str
    adversarial_category: str | None
    equipment_type: str
    vendor: str
    expected_intent: str
    expected_weakness: str | None
    ground_truth: dict | None
    path: str  # "bot" | "sidecar"
    reply: str
    confidence: str  # high | medium | low | none
    next_state: str | None  # Bot path only (FSM state)
    sources: list[dict] | None  # Sidecar path only [{file, page, excerpt, brain}]
    latency_ms: int
    error: str | None
    transcript: list[dict] | None = None  # list of ConversationTurn as dicts


@dataclass
class EvaluatedResult:
    result: QuestionResult
    weakness: WeaknessCategory
    ground_truth_score: float  # -1.0 if no GT, else 0.0-1.0
    keyword_matches: list[str] = field(default_factory=list)
    details: str = ""
    faithfulness_score: float = -1.0  # -1.0 = N/A, else 0.0-1.0


# ---------------------------------------------------------------------------
# Internal constants
# ---------------------------------------------------------------------------

# Canned phrases that indicate the intent guard intercepted the message.
_INTENT_GUARD_PHRASES: tuple[str, ...] = (
    "Hey -- I'm MIRA",
    "I help maintenance technicians",
    "I specialize in equipment maintenance",
    "How can I help with your equipment",
)

# Honesty signals indicating the bot admitted it lacks information.
_HONESTY_SIGNALS: tuple[str, ...] = (
    "I don't have",
    "not in my knowledge",
    "I'm not familiar",
    "no matching documentation",
    "I don't have information about",
)

# Confidence inference patterns.
_HIGH_CONF = re.compile(
    r"(replace|fault code|check wiring|part number|disconnect|de-energize|lockout)",
    re.IGNORECASE,
)
_LOW_CONF = re.compile(
    r"(might be|could be|possibly|not sure|uncertain|hard to say|without more info|difficult to determine)",
    re.IGNORECASE,
)

# Vendor name patterns found in source file names.
# Maps a substring found in the source file path → canonical vendor name.
_VENDOR_FILE_PATTERNS: dict[str, str] = {
    "powerflex": "Allen-Bradley",
    "gs10": "AutomationDirect",
    "gs20": "AutomationDirect",
    "sinamics": "Siemens",
    "acs": "ABB",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def keyword_match_score(reply: str, keywords: list[str]) -> tuple[float, list[str]]:
    """Return (score, matched_keywords) for reply against a keyword list."""
    if not keywords:
        return 0.0, []
    reply_lower = reply.lower()
    matched = [kw for kw in keywords if kw.lower() in reply_lower]
    score = len(matched) / len(keywords)
    return score, matched


def _contains_intent_guard_phrase(reply: str) -> bool:
    for phrase in _INTENT_GUARD_PHRASES:
        if phrase.lower() in reply.lower():
            return True
    return False


def _contains_honesty_signal(reply: str) -> bool:
    for signal in _HONESTY_SIGNALS:
        if signal.lower() in reply.lower():
            return True
    return False


def _infer_source_vendor(source_file: str) -> str | None:
    """Return a canonical vendor name if the source file name matches a known pattern."""
    lower = source_file.lower()
    for pattern, vendor in _VENDOR_FILE_PATTERNS.items():
        if pattern in lower:
            return vendor
    return None


# ---------------------------------------------------------------------------
# Individual weakness detectors
# (each returns True when the weakness is detected)
# ---------------------------------------------------------------------------


def _check_intent_guard_block(result: QuestionResult) -> bool:
    """Bot path: FSM returned to IDLE/None AND reply is a canned phrase AND expected industrial."""
    if result.path != "bot":
        return False
    idle_state = result.next_state in ("IDLE", None)
    has_canned = _contains_intent_guard_phrase(result.reply)
    industrial_intent = result.expected_intent == "industrial"
    return idle_state and has_canned and industrial_intent


def _check_empty_response(result: QuestionResult) -> bool:
    """Reply is too short, empty, or an error occurred."""
    if result.error:
        return True
    return len(result.reply.strip()) < 20


def _check_hallucination(result: QuestionResult) -> tuple[bool, float, list[str]]:
    """Ground truth provided, keyword overlap < 0.1, but reply is long enough to be fabricated."""
    if not result.ground_truth:
        return False, -1.0, []
    keywords: list[str] = result.ground_truth.get("keywords", [])
    if not keywords:
        return False, -1.0, []
    score, matched = keyword_match_score(result.reply, keywords)
    if score < 0.1 and len(result.reply) > 100:
        return True, score, matched
    return False, score, matched


def _check_wrong_manufacturer(result: QuestionResult) -> bool:
    """Sidecar path: sources reference a different vendor than the question targets."""
    if result.path != "sidecar":
        return False
    if not result.sources:
        return False
    question_vendor_lower = result.vendor.lower()
    for source in result.sources:
        source_file = source.get("file", "")
        inferred_vendor = _infer_source_vendor(source_file)
        if inferred_vendor and inferred_vendor.lower() != question_vendor_lower:
            return True
    return False


def _check_low_confidence(result: QuestionResult) -> bool:
    """Reply hedges with uncertainty language without any confident actionable terms."""
    has_low = bool(_LOW_CONF.search(result.reply))
    has_high = bool(_HIGH_CONF.search(result.reply))
    return has_low and not has_high


def _check_safety_false_positive(result: QuestionResult) -> bool:
    """Bot path: FSM raised a safety alert but the question was not safety-related."""
    if result.path != "bot":
        return False
    return result.next_state == "SAFETY_ALERT" and result.expected_intent != "safety"


def _check_out_of_kb_hallucination(result: QuestionResult) -> bool:
    """Adversarial out-of-kb question received a long confident reply with no honesty signals."""
    if result.adversarial_category != "out_of_kb":
        return False
    if len(result.reply) <= 100:
        return False
    return not _contains_honesty_signal(result.reply)


def _check_abbreviation_failure(result: QuestionResult) -> bool:
    """Misspelled/abbreviated question got an empty or canned response."""
    if result.adversarial_category != "misspelled":
        return False
    too_short = len(result.reply.strip()) < 20
    canned = _contains_intent_guard_phrase(result.reply)
    return too_short or canned


def _check_no_sources(result: QuestionResult) -> bool:
    """Sidecar path returned no source citations."""
    if result.path != "sidecar":
        return False
    return not result.sources


# ---------------------------------------------------------------------------
# Multi-turn / conversation-level detectors
# ---------------------------------------------------------------------------

_QUESTION_PATTERNS: dict[str, list[str]] = {
    "equipment": [
        "what equipment", "what device", "what model", "which equipment",
        "what machine", "what unit", "which model", "which drive",
    ],
    "symptom": [
        "what symptom", "what's happening", "describe the", "what issue",
        "what problem", "what are you seeing", "what's going on",
    ],
}


def _check_excessive_followups(result: QuestionResult) -> bool:
    """Multi-turn: bot asked too many clarifying questions before diagnosis."""
    if not result.transcript or len(result.transcript) < 2:
        return False
    bot_questions = [
        t for t in result.transcript
        if t.get("role") == "bot" and "?" in t.get("text", "")
    ]
    final_state = result.next_state
    reached_diagnosis = final_state in ("DIAGNOSIS", "FIX_STEP", "RESOLVED")
    return len(bot_questions) > 4 and not reached_diagnosis


def _check_context_amnesia(result: QuestionResult) -> bool:
    """Multi-turn: bot re-asked for info the user already provided."""
    if not result.transcript or len(result.transcript) < 4:
        return False
    user_texts = [
        t["text"].lower() for t in result.transcript if t.get("role") == "user"
    ]
    bot_texts = [
        t["text"].lower() for t in result.transcript if t.get("role") == "bot"
    ]
    if len(bot_texts) < 2:
        return False
    for category, patterns in _QUESTION_PATTERNS.items():
        user_mentioned = any(category in ut for ut in user_texts[:2])
        bot_reasked = any(
            any(p in bt for p in patterns) for bt in bot_texts[1:]
        )
        if user_mentioned and bot_reasked:
            return True
    return False


def _check_graceful_degradation_failure(result: QuestionResult) -> bool:
    """Bot gave a confident answer despite low-relevance sources."""
    if result.adversarial_category == "out_of_kb":
        return False  # already handled by _check_out_of_kb_hallucination
    if result.path != "sidecar" or not result.sources:
        return False
    question_terms = set(re.findall(r"\b\w{4,}\b", result.question_text.lower()))
    _STOP = {
        "this", "that", "with", "from", "have", "been",
        "will", "should", "about", "which", "what", "does",
    }
    question_terms -= _STOP
    source_relevance = 0
    for source in result.sources:
        excerpt = source.get("excerpt", "").lower()
        overlap = len(question_terms & set(re.findall(r"\b\w{4,}\b", excerpt)))
        source_relevance += overlap
    low_relevance = source_relevance < 2
    confident = not _contains_honesty_signal(result.reply)
    long_reply = len(result.reply) > 100
    return low_relevance and confident and long_reply


def _decompose_claims(reply: str) -> list[str]:
    """Split a reply into atomic factual claims (sentence-level)."""
    sentences = re.split(r"(?<=[.!])\s+", reply)
    claims = []
    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) < 20:
            continue
        if _LOW_CONF.search(sentence):
            continue
        if sentence.lower().startswith(("check ", "verify ", "ensure ", "always ")):
            continue
        claims.append(sentence)
    return claims


def _claim_grounded_in_sources(claim: str, sources: list[dict]) -> bool:
    """Check if a claim has keyword overlap with any source excerpt."""
    _STOP = {
        "this", "that", "with", "from", "have", "been",
        "will", "should", "about", "which", "what", "does",
    }
    claim_words = set(re.findall(r"\b\w{4,}\b", claim.lower())) - _STOP
    if not claim_words:
        return True  # no substantive words = vacuously grounded
    for source in sources:
        excerpt = source.get("excerpt", "")
        excerpt_words = set(re.findall(r"\b\w{4,}\b", excerpt.lower()))
        if len(claim_words & excerpt_words) >= 2:
            return True
    return False


def _check_rag_unfaithfulness(result: QuestionResult) -> tuple[bool, float]:
    """Sidecar path: check if answer claims are grounded in source excerpts.

    Returns (is_unfaithful, faithfulness_score).
    """
    if result.path != "sidecar" or not result.sources:
        return False, -1.0
    claims = _decompose_claims(result.reply)
    if not claims:
        return False, -1.0
    grounded = sum(1 for c in claims if _claim_grounded_in_sources(c, result.sources))
    score = grounded / len(claims)
    return score < 0.5, score


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(result: QuestionResult) -> EvaluatedResult:
    """
    Classify a QuestionResult into a WeaknessCategory.

    Checks are applied in priority order; the first matching weakness wins.
    Ground truth scoring is computed independently of weakness classification.
    """
    # Compute ground truth score regardless of which weakness fires.
    gt_score: float = -1.0
    kw_matches: list[str] = []
    if result.ground_truth:
        keywords: list[str] = result.ground_truth.get("keywords", [])
        if keywords:
            gt_score, kw_matches = keyword_match_score(result.reply, keywords)

    # --- Priority-ordered weakness checks ---

    if _check_intent_guard_block(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.INTENT_GUARD_BLOCK,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=(
                f"Bot returned to IDLE/None with canned phrase for industrial question "
                f"(expected_intent={result.expected_intent!r})"
            ),
        )

    if _check_empty_response(result):
        reason = f"error={result.error!r}" if result.error else f"reply_len={len(result.reply.strip())}"
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.EMPTY_RESPONSE,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=f"Reply too short or errored: {reason}",
        )

    hallucinated, hall_score, hall_matches = _check_hallucination(result)
    if hallucinated:
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.HALLUCINATION,
            ground_truth_score=hall_score,
            keyword_matches=hall_matches,
            details=(
                f"Keyword overlap {hall_score:.2f} < 0.10 on a {len(result.reply)}-char reply"
            ),
        )

    if _check_wrong_manufacturer(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.WRONG_MANUFACTURER,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=(
                f"Source files reference vendor different from question vendor={result.vendor!r}"
            ),
        )

    if _check_low_confidence(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.LOW_CONFIDENCE,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details="Reply contains hedging language without actionable diagnostic terms",
        )

    if _check_safety_false_positive(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.SAFETY_FALSE_POSITIVE,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=(
                f"SAFETY_ALERT triggered but expected_intent={result.expected_intent!r}"
            ),
        )

    if _check_out_of_kb_hallucination(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.OUT_OF_KB_HALLUCINATION,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=(
                f"Out-of-KB question produced {len(result.reply)}-char reply with no honesty signals"
            ),
        )

    if _check_abbreviation_failure(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.ABBREVIATION_FAILURE,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details="Misspelled/abbreviated input returned empty or canned response",
        )

    if _check_no_sources(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.NO_SOURCES,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details="Sidecar path returned zero source citations",
        )

    # --- Conversation-level checks (require transcript) ---

    if _check_excessive_followups(result):
        bot_q_count = sum(
            1 for t in (result.transcript or [])
            if t.get("role") == "bot" and "?" in t.get("text", "")
        )
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.EXCESSIVE_FOLLOWUPS,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=f"Bot asked {bot_q_count} follow-up questions without reaching diagnosis",
        )

    if _check_context_amnesia(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.CONTEXT_AMNESIA,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details="Bot re-asked for information the user already provided",
        )

    if _check_graceful_degradation_failure(result):
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.GRACEFUL_DEGRADATION_FAILURE,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details="Confident reply despite low-relevance sources",
        )

    unfaithful, faith_score = _check_rag_unfaithfulness(result)
    if unfaithful:
        return EvaluatedResult(
            result=result,
            weakness=WeaknessCategory.RAG_UNFAITHFUL,
            ground_truth_score=gt_score,
            keyword_matches=kw_matches,
            details=f"Faithfulness score {faith_score:.2f} < 0.50",
            faithfulness_score=faith_score,
        )

    # All checks passed.
    return EvaluatedResult(
        result=result,
        weakness=WeaknessCategory.PASS,
        ground_truth_score=gt_score,
        keyword_matches=kw_matches,
        details="No weakness detected",
    )


def evaluate_batch(results: list[QuestionResult]) -> list[EvaluatedResult]:
    """Evaluate a list of QuestionResults, returning one EvaluatedResult per item."""
    return [evaluate(r) for r in results]
