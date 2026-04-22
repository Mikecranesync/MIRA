"""Tests for the MIRA agent orchestrator framework (base.py + runner.py)."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# ---------------------------------------------------------------------------
# Minimal concrete agents for testing
# ---------------------------------------------------------------------------


def _import_base():
    """Import agent base with AGENT_LOG_DIR patched to a temp dir."""
    import importlib
    import sys

    # Ensure shared.agents.base resolves
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mira-bots"))
    import shared.agents.base as base_mod

    return base_mod


class _GoodAgent:
    """Detects 1 issue, acts OK, verifies OK — imported after path setup."""

    pass


class _FailVerifyAgent:
    """Detects 1 issue, acts OK, verify fails → escalation."""

    pass


class _LargeDetectAgent:
    """Detects 10 issues but max_issues_per_run=2."""

    pass


class _SlowDetectAgent:
    """detect() sleeps longer than timeout_seconds → TimeoutError."""

    pass


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmplog(tmp_path):
    """Patch AGENT_LOG_DIR to a temp directory for each test."""
    base_mod = _import_base()
    original = base_mod.AGENT_LOG_DIR
    base_mod.AGENT_LOG_DIR = tmp_path
    yield tmp_path
    base_mod.AGENT_LOG_DIR = original


def _make_good_agent(tmplog):
    base_mod = _import_base()
    AgentIssue = base_mod.AgentIssue
    AgentResult = base_mod.AgentResult
    MIRAAgent = base_mod.MIRAAgent

    class GoodAgent(MIRAAgent):
        name = "test_good"
        description = "Always succeeds"
        escalate = AsyncMock()

        async def detect(self):
            return [AgentIssue("i1", "test", "test issue")]

        async def act(self, issue):
            return AgentResult(issue.id, "did the thing", True, data={"health_url": ""})

        async def verify(self, result):
            return True

    return GoodAgent()


def _make_fail_verify_agent(tmplog):
    base_mod = _import_base()
    AgentIssue = base_mod.AgentIssue
    AgentResult = base_mod.AgentResult
    MIRAAgent = base_mod.MIRAAgent

    class FailVerifyAgent(MIRAAgent):
        name = "test_fail_verify"
        description = "Verify always fails"
        escalated: list = []

        async def detect(self):
            return [AgentIssue("i1", "test", "broken thing", severity="high")]

        async def act(self, issue):
            return AgentResult(issue.id, "tried the thing", False, details="it broke")

        async def verify(self, result):
            return False

        async def escalate(self, issue, result):
            self.escalated.append((issue.id, result.details))

    return FailVerifyAgent()


def _make_large_detect_agent(tmplog):
    base_mod = _import_base()
    AgentIssue = base_mod.AgentIssue
    AgentResult = base_mod.AgentResult
    MIRAAgent = base_mod.MIRAAgent

    class LargeDetectAgent(MIRAAgent):
        name = "test_large"
        description = "Detects 10 but cap is 2"
        max_issues_per_run = 2

        async def detect(self):
            return [AgentIssue(f"i{n}", "test", f"issue {n}") for n in range(10)]

        async def act(self, issue):
            return AgentResult(issue.id, "did it", True)

        async def verify(self, result):
            return True

    return LargeDetectAgent()


def _make_slow_detect_agent(tmplog):
    base_mod = _import_base()
    AgentIssue = base_mod.AgentIssue
    AgentResult = base_mod.AgentResult
    MIRAAgent = base_mod.MIRAAgent

    class SlowDetectAgent(MIRAAgent):
        name = "test_slow"
        description = "detect() times out"
        timeout_seconds = 1

        async def detect(self):
            await asyncio.sleep(5)
            return [AgentIssue("i1", "test", "never reached")]

        async def act(self, issue):
            return AgentResult(issue.id, "n/a", True)

        async def verify(self, result):
            return True

    return SlowDetectAgent()


# ---------------------------------------------------------------------------
# Tests: base agent loop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_good_agent_succeeds(tmplog):
    """Happy path: detect → act → verify all succeed → report shows 1 success."""
    agent = _make_good_agent(tmplog)
    with patch.object(agent, "_send_summary", AsyncMock()):
        report = await agent.run()

    assert report.issues_detected == 1
    assert report.actions_taken == 1
    assert report.actions_succeeded == 1
    assert report.actions_failed == 0
    assert report.escalations == 0
    assert report.details[0]["status"] == "success"


@pytest.mark.asyncio
async def test_escalation_fires_on_verify_failure(tmplog):
    """When verify() returns False, escalate() is called and report shows failure."""
    agent = _make_fail_verify_agent(tmplog)
    with patch.object(agent, "_send_summary", AsyncMock()):
        report = await agent.run()

    assert report.actions_taken == 1
    assert report.actions_failed == 1
    assert report.actions_succeeded == 0
    assert report.escalations == 1
    assert len(agent.escalated) == 1
    assert agent.escalated[0][0] == "i1"
    assert report.details[0]["status"] == "failed_escalated"


@pytest.mark.asyncio
async def test_report_saved_to_ndjson(tmplog):
    """After run(), a NDJSON line is appended to {agent_name}.ndjson."""
    agent = _make_good_agent(tmplog)
    with patch.object(agent, "_send_summary", AsyncMock()):
        await agent.run()

    log_path = tmplog / "test_good.ndjson"
    assert log_path.exists()
    entry = json.loads(log_path.read_text().strip())
    assert entry["agent"] == "test_good"
    assert entry["detected"] == 1
    assert entry["succeeded"] == 1
    assert entry["failed"] == 0


@pytest.mark.asyncio
async def test_max_issues_per_run_cap(tmplog):
    """detect() returns 10 but max_issues_per_run=2 — only 2 issues acted on."""
    agent = _make_large_detect_agent(tmplog)
    with patch.object(agent, "_send_summary", AsyncMock()):
        report = await agent.run()

    assert report.issues_detected == 2  # capped at max_issues_per_run
    assert report.actions_taken == 2
    assert report.actions_succeeded == 2


@pytest.mark.asyncio
async def test_detect_timeout_handled_gracefully(tmplog):
    """detect() exceeding timeout_seconds → run() returns report with 0 issues, no crash."""
    agent = _make_slow_detect_agent(tmplog)
    with patch.object(agent, "_send_summary", AsyncMock()):
        report = await agent.run()

    assert report.issues_detected == 0
    assert report.actions_taken == 0
    # No crash — graceful timeout handling
    assert report.finished_at != ""


@pytest.mark.asyncio
async def test_no_ntfy_when_nothing_detected(tmplog):
    """When detect() returns no issues, _send_summary() is NOT called."""
    base_mod = _import_base()
    AgentResult = base_mod.AgentResult
    MIRAAgent = base_mod.MIRAAgent

    class EmptyAgent(MIRAAgent):
        name = "test_empty"

        async def detect(self):
            return []

        async def act(self, issue):
            return AgentResult(issue.id, "n/a", True)

        async def verify(self, result):
            return True

    agent = EmptyAgent()
    summary_mock = AsyncMock()
    with patch.object(agent, "_send_summary", summary_mock):
        report = await agent.run()

    summary_mock.assert_not_called()
    assert report.issues_detected == 0


# ---------------------------------------------------------------------------
# Tests: AgentRunner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_runner_respects_interval(tmplog):
    """AgentRunner.run_once() skips agents whose interval hasn't elapsed."""
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mira-bots"))
    from shared.agents.runner import AgentRunner

    run_count = 0

    agent = _make_good_agent(tmplog)
    original_run = agent.run

    async def counting_run():
        nonlocal run_count
        run_count += 1
        return await original_run()

    agent.run = counting_run

    runner = AgentRunner()
    runner.register(agent, interval_minutes=60)  # 60-min interval

    with patch.object(agent, "_send_summary", AsyncMock()):
        # First call: last_run=0, interval elapsed → runs
        await runner.run_once()
        assert run_count == 1

        # Second call immediately: interval not elapsed → skips
        await runner.run_once()
        assert run_count == 1  # still 1


@pytest.mark.asyncio
async def test_runner_runs_agent_when_interval_elapsed(tmplog):
    """AgentRunner runs agent when last_run=0 (never run before)."""
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mira-bots"))
    from shared.agents.runner import AgentRunner

    agent = _make_good_agent(tmplog)
    runner = AgentRunner()
    runner.register(agent, interval_minutes=30)

    with patch.object(agent, "_send_summary", AsyncMock()):
        await runner.run_once()

    # last_run should be updated to ~now
    assert runner.agents[0]["last_run"] > 0
