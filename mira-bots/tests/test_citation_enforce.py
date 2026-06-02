"""Tests for Phase 7 — citation enforcement (enforce_citation).

Covers:
- Uncited reply → rewritten (mock LLM returns a citation)
- Uncited reply, rewrite still uncited → admission
- Uncited reply, LLM errors → admission (fail-soft)
- Cited reply → untouched (zero extra LLM calls)
- Citation not required (no KB coverage) → pass, no rewrite

All tests are offline — no real LLM calls, no network.
"""

from __future__ import annotations

import os
import sys
import unittest.mock
from unittest.mock import AsyncMock, MagicMock

import pytest

# Minimal env vars to satisfy module-level imports.
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_cite_enforce_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Stub heavy optional deps
for _mod in (
    "PIL",
    "PIL.Image",
    "slack_sdk",
    "slack_sdk.web.async_client",
    "slack_sdk.errors",
):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = MagicMock()

from shared.citation_compliance import enforce_citation  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _kb(status: str = "covered") -> dict:
    return {"status": status, "citations": []}


def _mock_router(reply: str) -> MagicMock:
    """Return a mock InferenceRouter whose complete() returns (reply, {})."""
    router = MagicMock()
    router.complete = AsyncMock(return_value=(reply, {}))
    return router


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cited_reply_is_untouched():
    """A reply that already has a [Source:] tag must pass immediately.
    Zero extra LLM calls."""
    reply = "Set parameter P0100 to 60 [Source: Siemens G120 — Parameters]."
    router = _mock_router("should not be called")

    result, outcome = await enforce_citation(
        reply,
        _kb("covered"),
        router,
        "line frequency",
        fsm_state="DIAGNOSIS",
        chat_id="test-1",
    )

    assert result == reply
    assert outcome == "pass"
    router.complete.assert_not_called()


@pytest.mark.asyncio
async def test_uncited_reply_triggers_rewrite_and_uses_rewritten():
    """An uncited reply in DIAGNOSIS state must trigger one rewrite call.
    When the rewrite returns a citation, use it."""
    original = "Replace the overload relay and check wiring on terminal 3."
    rewritten = "Replace the overload relay [Source: GS10 Manual — Wiring]."
    router = _mock_router(rewritten)

    result, outcome = await enforce_citation(
        original,
        _kb("covered"),
        router,
        "overload relay GS10",
        fsm_state="DIAGNOSIS",
        chat_id="test-2",
    )

    assert result == rewritten
    assert outcome == "rewritten"
    router.complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_uncited_rewrite_also_missing_citation_returns_admission():
    """When the rewrite LLM also fails to add a citation, return the gap admission."""
    original = "Check the wiring harness and measure voltage at the drive terminals."
    # Rewrite that still has no [Source:] tag
    rewritten_no_tag = "Check wiring harness and measure voltage at drive terminals."
    router = _mock_router(rewritten_no_tag)

    result, outcome = await enforce_citation(
        original,
        _kb("covered"),
        router,
        "wiring harness",
        fsm_state="DIAGNOSIS",
        chat_id="test-3",
    )

    # Must fall back to admission
    assert "don't have verified evidence" in result.lower()
    assert outcome == "admitted_gap"
    router.complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_llm_error_returns_admission():
    """When the rewrite LLM call raises, return the gap admission (fail-soft)."""
    original = "Reset the fault and check the bus voltage."
    router = MagicMock()
    router.complete = AsyncMock(side_effect=RuntimeError("cascade exhausted"))

    result, outcome = await enforce_citation(
        original,
        _kb("covered"),
        router,
        "bus voltage",
        fsm_state="FIX_STEP",
        chat_id="test-4",
    )

    assert "don't have verified evidence" in result.lower()
    assert outcome == "admitted_gap"


@pytest.mark.asyncio
async def test_no_kb_coverage_returns_pass_without_rewrite():
    """When KB status is 'uncovered', citation is not required — pass, no rewrite."""
    reply = "Replace the overload relay."
    router = _mock_router("should not be called")

    result, outcome = await enforce_citation(
        reply,
        _kb("uncovered"),
        router,
        "overload relay",
        fsm_state="DIAGNOSIS",
        chat_id="test-5",
    )

    assert result == reply
    assert outcome == "pass"
    router.complete.assert_not_called()


@pytest.mark.asyncio
async def test_non_technical_reply_in_idle_passes():
    """A non-technical greeting-class reply in IDLE is not required to cite."""
    reply = "Sure, what equipment can I help with?"
    router = _mock_router("should not be called")

    result, outcome = await enforce_citation(
        reply,
        _kb("covered"),
        router,
        "hello",
        fsm_state="IDLE",
        chat_id="test-6",
    )

    assert result == reply
    assert outcome == "pass"
    router.complete.assert_not_called()


@pytest.mark.asyncio
async def test_admission_includes_topic_from_message():
    """The gap admission must include the user message topic."""
    original = "Verify wiring on the terminal block."
    router = MagicMock()
    router.complete = AsyncMock(side_effect=RuntimeError("fail"))

    result, outcome = await enforce_citation(
        original,
        _kb("partial"),
        router,
        "terminal block wiring",
        fsm_state="FIX_STEP",
        chat_id="test-7",
    )

    assert "terminal block wiring" in result
    assert outcome == "admitted_gap"
