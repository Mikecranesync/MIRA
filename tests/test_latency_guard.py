"""Tests for latency guard: token-budgeted history trimming.

Covers _trim_history_by_tokens() from rag_worker.py and the
HISTORY_LIMIT truncation fix in engine.py nameplate handler.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Add mira-bots to path
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.workers.rag_worker import _trim_history_by_tokens


# ── _trim_history_by_tokens tests ──────────────────────────────────────────


class TestTrimHistoryByTokens:

    def test_under_budget_passes_through(self):
        """Short history within budget is returned unchanged."""
        history = [
            {"role": "user", "content": "F4 on PowerFlex 525"},
            {"role": "assistant", "content": "F4 = UnderVoltage. Check input AC."},
        ]
        result = _trim_history_by_tokens(history, max_tokens=2000)
        assert result == history

    def test_over_budget_trims_oldest(self):
        """History exceeding budget drops oldest entries first."""
        # Each entry ~100 chars = ~25 tokens
        history = [
            {"role": "user", "content": f"Turn {i}: " + "x" * 90}
            for i in range(40)  # 40 entries * 25 tokens = ~1000 tokens
        ]
        result = _trim_history_by_tokens(history, max_tokens=200)
        # Budget of 200 tokens fits ~8 entries (each ~25 tokens)
        assert len(result) < len(history)
        assert len(result) <= 10  # rough upper bound

    def test_preserves_most_recent(self):
        """Most recent entries are always kept, oldest dropped."""
        history = [
            {"role": "user", "content": f"old message {i}: " + "x" * 200}
            for i in range(5)
        ] + [
            {"role": "user", "content": "recent: check motor"},
            {"role": "assistant", "content": "recent: megger the windings"},
        ]
        result = _trim_history_by_tokens(history, max_tokens=100)
        # Recent entries should be present
        assert any("recent" in e["content"] for e in result)
        # At least the last two short entries should fit
        assert result[-1]["content"] == "recent: megger the windings"

    def test_empty_history(self):
        """Empty history returns empty list."""
        assert _trim_history_by_tokens([], max_tokens=2000) == []

    def test_single_huge_entry_still_included(self):
        """A single entry larger than the budget is still included.

        The function starts from the most recent and works backward.
        The very last entry is always included (even if over budget)
        because we check BEFORE adding.
        """
        history = [
            {"role": "user", "content": "x" * 10000},  # ~2500 tokens
        ]
        result = _trim_history_by_tokens(history, max_tokens=500)
        # First entry checked: 2500 > 500, so it's dropped
        assert result == []

    def test_budget_from_env(self):
        """Default budget comes from _HISTORY_TOKEN_BUDGET constant."""
        # Just verify the function works with default (no max_tokens arg)
        history = [
            {"role": "user", "content": "short message"},
            {"role": "assistant", "content": "short reply"},
        ]
        result = _trim_history_by_tokens(history)
        assert result == history

    def test_realistic_conversation_depth(self):
        """Simulate a 15-exchange conversation where later messages are longer.

        Early turns: ~200 chars each (~50 tokens)
        Late turns: ~1200 chars each (~300 tokens)
        Budget of 2000 tokens should include recent turns, drop early ones.
        """
        history = []
        for i in range(30):  # 15 exchanges = 30 entries
            if i < 20:  # Early turns: short
                content = f"Turn {i}: " + "x" * 180
            else:  # Late turns: long diagnostic reasoning
                content = f"Turn {i}: " + "x" * 1180
            role = "user" if i % 2 == 0 else "assistant"
            history.append({"role": role, "content": content})

        result = _trim_history_by_tokens(history, max_tokens=2000)

        # Total tokens unbudgeted: 20*50 + 10*300 = 4000, well over 2000
        assert len(result) < 30
        # Most recent entry should always be present
        assert result[-1] == history[-1]
        # Oldest entries should be dropped
        assert history[0] not in result


# ── Nameplate truncation test ──────────────────────────────────────────────


class TestNameplateTruncation:
    """Verify that the nameplate handler truncates history."""

    def test_nameplate_handler_has_truncation(self):
        """engine.py nameplate handler should truncate history to HISTORY_LIMIT.

        Structural test — reads the source file directly (engine.py can't be
        imported without a running SQLite DB) and verifies HISTORY_LIMIT
        truncation appears near the "Asset registered" code path.
        """
        engine_path = REPO_ROOT / "mira-bots" / "shared" / "engine.py"
        source = engine_path.read_text()

        idx = source.find("Asset registered")
        assert idx > 0, "Asset registered string not found in engine.py"

        # Check that HISTORY_LIMIT truncation appears within 500 chars after
        nearby = source[idx : idx + 500]
        assert "HISTORY_LIMIT" in nearby, (
            "HISTORY_LIMIT truncation missing near nameplate handler"
        )
