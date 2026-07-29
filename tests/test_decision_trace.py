"""Unit tests for mira-bots/shared/decision_trace.py.

Tests the pure build_trace_row() function — no NeonDB required.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add shared/ to path so we can import without the full bot container.
_SHARED = str(Path(__file__).resolve().parent.parent / "mira-bots" / "shared")
if _SHARED not in sys.path:
    sys.path.insert(0, _SHARED)

from decision_trace import build_trace_row, citations_present_in


# ── citations_present_in ──────────────────────────────────────────────────────


def test_citation_detected():
    assert citations_present_in("Check the VFD manual. [Source: PowerFlex 525 manual p.42]")


def test_no_citation():
    assert not citations_present_in("I'm not sure what caused this fault.")


def test_citation_case_insensitive():
    assert citations_present_in("[source: Manual A page 3]")


def test_empty_reply():
    assert not citations_present_in("")
    assert not citations_present_in(None)


# ── build_trace_row — core fields ────────────────────────────────────────────


def test_build_trace_row_minimal():
    row = build_trace_row(
        tenant_id="11111111-1111-1111-1111-111111111111",
        user_question="Why did the conveyor stop?",
        recommendation="Check VFD fault code F004.",
    )
    assert row["tenant_id"] == "11111111-1111-1111-1111-111111111111"
    assert "conveyor" in row["user_question"]
    assert row["citations_present"] is False
    assert row["confidence"] is None
    assert row["outcome"] is None
    assert row["session_id"] is None


def test_build_trace_row_with_confidence():
    row = build_trace_row(
        tenant_id="22222222-2222-2222-2222-222222222222",
        user_question="Motor trip on conveyor",
        recommendation="Replace capacitor. [Source: SEW manual p.14]",
        confidence="high",
    )
    assert row["confidence"] == "high"
    assert row["citations_present"] is True


def test_build_trace_row_confidence_none():
    row = build_trace_row(
        tenant_id="33333333-3333-3333-3333-333333333333",
        user_question="What is this?",
        recommendation="Unknown fault.",
        confidence=None,
    )
    assert row["confidence"] is None


def test_build_trace_row_confidence_low():
    row = build_trace_row(
        tenant_id="44444444-4444-4444-4444-444444444444",
        user_question="VFD over-temp",
        recommendation="Could be the cooling fan.",
        confidence="low",
    )
    assert row["confidence"] == "low"
    assert row["citations_present"] is False


# ── build_trace_row — uns_context extraction ─────────────────────────────────


def test_uns_context_extracted():
    uns_context = {
        "uns_path": "enterprise.site.area.cv101",
        "source": "direct_connection",
        "confidence": 1.0,
    }
    row = build_trace_row(
        tenant_id="55555555-5555-5555-5555-555555555555",
        user_question="Fault?",
        recommendation="Check drive.",
        uns_context=uns_context,
    )
    assert row["uns_path"] == "enterprise.site.area.cv101"
    # _uns_source and _uns_confidence are private (underscore) — not a DB column
    assert row["_uns_source"] == "direct_connection"
    assert row["_uns_confidence"] == 1.0


def test_confidence_param_independent_of_uns_confidence():
    # The `confidence` DB column (engine rubric: high/medium/low/none) is separate
    # from _uns_confidence (UNS resolution certainty: 0.0–1.0).
    uns_context = {"uns_path": "enterprise.site.cv101", "confidence": 0.9}
    row = build_trace_row(
        tenant_id="66666666-6666-6666-6666-666666666666",
        user_question="VFD fault",
        recommendation="Replace drive.",
        uns_context=uns_context,
        confidence="high",
    )
    assert row["confidence"] == "high"
    assert row["_uns_confidence"] == 0.9


# ── build_trace_row — underscore-prefixed keys excluded from DB insert ────────


def test_underscore_keys_are_private():
    """Keys starting with _ must not leak into the DB row (the _insert strips them)."""
    row = build_trace_row(
        tenant_id="77777777-7777-7777-7777-777777777777",
        user_question="q",
        recommendation="r",
    )
    db_row = {k: v for k, v in row.items() if not k.startswith("_")}
    # confidence IS a real DB column — must be present
    assert "confidence" in db_row
    # private keys must be absent from DB row
    assert "_uns_source" not in db_row
    assert "_uns_confidence" not in db_row
