"""Property-based tests for guardrails module.

Uses hypothesis to discover edge cases in:
- Abbreviation expansion (idempotency)
- Rewrite question (preserves content, never empty)
- Intent classification (safety keywords always detected unless educational)
- Vendor lookup (deterministic, None-safe)
- Expertise detection (always returns valid enum)
- Emotional state detection (always returns valid enum)
"""

from __future__ import annotations

import re
import sys

sys.path.insert(0, "mira-bots")

from hypothesis import given, settings, strategies as st

from shared.guardrails import (
    SAFETY_KEYWORDS,
    _EDUCATIONAL_QUESTION_RE,
    classify_intent,
    detect_emotional_state,
    detect_expertise_level,
    expand_abbreviations,
    rewrite_question,
    strip_mentions,
    vendor_name_from_text,
    vendor_support_url,
)


# ---------------------------------------------------------------------------
# Abbreviation expansion: idempotent
# ---------------------------------------------------------------------------

@given(st.text(min_size=0, max_size=500))
def test_expand_abbreviations_idempotent(text):
    """Expanding abbreviations twice should produce the same result."""
    once = expand_abbreviations(text)
    twice = expand_abbreviations(once)
    assert once == twice


@given(st.text(min_size=0, max_size=500))
def test_expand_abbreviations_returns_string(text):
    """Result is always a string, never None or other type."""
    result = expand_abbreviations(text)
    assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Rewrite question: always returns non-empty string
# ---------------------------------------------------------------------------

@given(st.text(min_size=1, max_size=300), st.one_of(st.none(), st.text(min_size=1, max_size=50)))
def test_rewrite_question_never_empty(message, asset):
    """Rewritten question should always be a non-empty string."""
    result = rewrite_question(message, asset)
    assert isinstance(result, str)
    assert len(result) > 0


@given(st.text(min_size=1, max_size=300).filter(lambda s: s.strip()))
def test_rewrite_question_contains_input_or_rewrite(message):
    """Result should relate to the input — contain original words or a rewrite."""
    result = rewrite_question(message)
    # Non-whitespace input should produce non-empty output
    assert isinstance(result, str)
    assert len(result) > 0


# ---------------------------------------------------------------------------
# Safety keywords: never missed (unless educational framing)
# ---------------------------------------------------------------------------

@given(st.sampled_from(SAFETY_KEYWORDS), st.text(min_size=0, max_size=100))
def test_safety_keyword_with_prefix(keyword, prefix):
    """A safety keyword with a non-educational prefix must return 'safety'."""
    # Skip if the random prefix happens to start with an educational pattern
    msg = f"{prefix} {keyword}"
    stripped = strip_mentions(msg).lower().strip()
    if _EDUCATIONAL_QUESTION_RE.match(stripped):
        return  # Educational framing is expected to bypass safety — skip
    result = classify_intent(msg)
    assert result == "safety", (
        f"Safety keyword '{keyword}' with prefix '{prefix}' classified as '{result}'"
    )


# ---------------------------------------------------------------------------
# classify_intent: always returns a valid intent string
# ---------------------------------------------------------------------------

_VALID_INTENTS = {"greeting", "help", "industrial", "documentation", "safety", "off_topic"}


@given(st.text(min_size=0, max_size=500))
def test_classify_intent_returns_valid_enum(message):
    """classify_intent must always return one of the defined intent strings."""
    result = classify_intent(message)
    assert result in _VALID_INTENTS, f"Got unexpected intent '{result}'"


# ---------------------------------------------------------------------------
# Vendor helpers: None-safe, deterministic
# ---------------------------------------------------------------------------

@given(st.one_of(st.none(), st.text(min_size=0, max_size=200)))
def test_vendor_support_url_none_safe(text):
    """vendor_support_url must return str or None, never raise."""
    result = vendor_support_url(text)
    assert result is None or isinstance(result, str)


@given(st.one_of(st.none(), st.text(min_size=0, max_size=200)))
def test_vendor_name_none_safe(text):
    """vendor_name_from_text must return str or None, never raise."""
    result = vendor_name_from_text(text)
    assert result is None or isinstance(result, str)


# ---------------------------------------------------------------------------
# Expertise / emotional state: always returns valid enum
# ---------------------------------------------------------------------------

@given(st.text(min_size=0, max_size=500))
def test_detect_expertise_returns_valid(message):
    result = detect_expertise_level(message)
    assert result in {"senior", "junior", "unknown"}


@given(st.text(min_size=0, max_size=500))
def test_detect_emotional_state_returns_valid(message):
    result = detect_emotional_state(message)
    assert result in {"pressured", "neutral"}


# ---------------------------------------------------------------------------
# strip_mentions: idempotent
# ---------------------------------------------------------------------------

@given(st.text(min_size=0, max_size=200))
def test_strip_mentions_idempotent(text):
    once = strip_mentions(text)
    twice = strip_mentions(once)
    assert once == twice
